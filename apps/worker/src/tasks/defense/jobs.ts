import crypto from "node:crypto";
import path from "node:path";
import type { Job } from "bullmq";
import { Prisma } from "@prisma/client";
import {
  complianceReportDocumentSchema,
  defenseAssetSchema,
  defensePlanSchema,
  defenseSourceMetadataSchema,
  defenseStyleBriefSchema,
  getDefensePreset,
  materializeDefensePresetRequirements,
  presentationSchema,
  projectConflictSchema,
  projectFactSchema,
  projectRequirementSchema,
  requirementRuleSchema,
  screenshotClassificationSchema,
  type DefenseAsset,
  type DefenseSourceMetadata,
  type ProjectConflict,
  type ProjectFact,
  type ProjectRequirement,
} from "@studydeck/shared";
import { captureGenerationError, errorLogFields, logger, type TraceCarrier, withTraceSpan } from "../../observability.js";
import { getPrisma } from "../../prisma.js";
import { putObjectBuffer, readObjectBuffer } from "../../storage.js";
import { recordCostEvent, runWithUsageContext } from "../../usage-ledger.js";
import { safeErrorSummary, updateGenerationProgress, type GenerationProgressStage } from "../job-progress.js";
import { analyzeDefenseCandidates, type DefenseAnalysisChunk } from "./analysis.js";
import { extractDefenseArchiveDocuments } from "./archive.js";
import { checkDefenseCompliance } from "./compliance.js";
import { createComplianceReportPdf } from "./compliance-report-pdf.js";
import { buildDefensePlan } from "./plan-builder.js";
import { extractDefensePptxStyle } from "./pptx-style.js";
import { extractSourceWithProvenance } from "./provenance.js";
import { fetchPublicRepositoryDocuments, parsePublicRepositoryUrl } from "./repository.js";
import { classifyDefenseScreenshot } from "./screenshot-classifier.js";

export type DefenseAnalysisJobData = {
  projectId: string;
  userId: string;
  workspaceId: string;
  generationJobId: string;
  scope?: "analysis" | "plan";
  expectedAnalysisRevision?: number;
  expectedPlanRevision?: number;
  traceContext?: TraceCarrier;
};

export type DefenseComplianceJobData = {
  projectId: string;
  userId: string;
  workspaceId: string;
  reportId: string;
  generationJobId: string;
  presentationRevision: number;
  analysisRevision: number;
  planRevision: number;
  traceContext?: TraceCarrier;
};

export type ComplianceReportExportJobData = {
  projectId: string;
  userId: string;
  workspaceId: string;
  reportId: string;
  traceContext?: TraceCarrier;
};

type PrismaClient = ReturnType<typeof getPrisma>;

export async function handleDefenseAnalysisJob(job: Job<DefenseAnalysisJobData>) {
  return runWithUsageContext({
    userId: job.data.userId,
    projectId: job.data.projectId,
    generationJobId: job.data.generationJobId,
    queueJobId: job.id ? String(job.id) : undefined,
    stage: job.data.scope === "plan" ? "building_defense_plan" : "requirements_analysis",
  }, () => runDefenseAnalysisJob(job));
}

export async function handleDefenseComplianceJob(job: Job<DefenseComplianceJobData>) {
  return runWithUsageContext({
    userId: job.data.userId,
    projectId: job.data.projectId,
    generationJobId: job.data.generationJobId,
    queueJobId: job.id ? String(job.id) : undefined,
    stage: "checking_compliance",
  }, () => runDefenseComplianceJob(job));
}

export async function handleComplianceReportExportJob(job: Job<ComplianceReportExportJobData>) {
  return runWithUsageContext({
    userId: job.data.userId,
    projectId: job.data.projectId,
    queueJobId: job.id ? String(job.id) : undefined,
    stage: "compliance_report_pdf",
  }, () => runComplianceReportExportJob(job));
}

async function runDefenseAnalysisJob(job: Job<DefenseAnalysisJobData>) {
  const prisma = getPrisma();
  const { projectId, workspaceId, generationJobId } = job.data;
  const setStage = createStageUpdater(prisma, job, generationJobId);
  try {
    await prisma.generationJob.update({ where: { id: generationJobId }, data: { status: "active", error: null } });
    if (job.data.scope === "plan") {
      await setStage("building_defense_plan");
      await rebuildPersistedPlan(prisma, job.data);
      await completeGenerationJob(prisma, generationJobId);
      return;
    }

    const workspace = await prisma.defenseWorkspace.findFirst({
      where: { id: workspaceId, projectId },
      include: { project: { include: { sources: { where: { included: true }, orderBy: { createdAt: "asc" } } } } },
    });
    if (!workspace || workspace.project.workflow !== "requirements_driven") throw new Error("Defense workspace was not found");
    await prisma.defenseWorkspace.update({ where: { id: workspaceId }, data: { analysisStatus: "analyzing", analysisError: null } });

    await setStage("extracting_sources");
    const materialized = await withTraceSpan("defense.ingestion", {
      "studydeck.project_id": projectId,
      "studydeck.workspace_id": workspaceId,
      "studydeck.stage": "defense.ingestion",
      "studydeck.source_count": workspace.project.sources.length,
    }, () => materializeDefenseSources(prisma, projectId, workspace.project.sources), job.data.traceContext);

    await setStage("extracting_requirements");
    const candidates = await withTraceSpan("defense.analysis", {
      "studydeck.project_id": projectId,
      "studydeck.workspace_id": workspaceId,
      "studydeck.stage": "defense.requirements",
      "studydeck.chunk_count": materialized.chunks.length,
    }, () => analyzeDefenseCandidates(materialized.chunks), job.data.traceContext);

    await setStage("classifying_assets");
    const styleBrief = await extractAndPersistStyle(prisma, projectId, materialized.styleReferences);
    await classifyAndPersistScreenshots(prisma, materialized.screenshots);

    await setStage("building_defense_plan");
    await persistAnalysisAndPlan(prisma, workspaceId, projectId, candidates, materialized, styleBrief);
    await completeGenerationJob(prisma, generationJobId);
    await prisma.userActivityEvent.create({
      data: { userId: job.data.userId, projectId, type: "defense.analysis.completed", metadata: { factCount: candidates.facts.length, requirementCount: candidates.requirements.length, conflictCount: candidates.conflicts.length } },
    });
  } catch (error) {
    const message = safeErrorSummary(error);
    captureGenerationError(error, { projectId, jobId: job.id, stage: job.data.scope === "plan" ? "building_defense_plan" : "requirements_analysis" });
    await Promise.allSettled([
      prisma.generationJob.update({ where: { id: generationJobId }, data: { status: "failed", error: message, progressStage: "failed", progressLabel: "Не получилось", progressPercent: 100 } }),
      job.data.scope === "plan"
        ? Promise.resolve()
        : prisma.defenseWorkspace.update({ where: { id: workspaceId }, data: { analysisStatus: "failed", analysisError: message } }),
    ]);
    throw error;
  }
}

async function runDefenseComplianceJob(job: Job<DefenseComplianceJobData>) {
  const prisma = getPrisma();
  const { projectId, workspaceId, reportId, generationJobId } = job.data;
  const setStage = createStageUpdater(prisma, job, generationJobId);
  try {
    await prisma.generationJob.update({ where: { id: generationJobId }, data: { status: "active", error: null } });
    await prisma.complianceReport.update({ where: { id: reportId }, data: { status: "processing", error: null } });
    await setStage("checking_compliance");
    const reportRow = await prisma.complianceReport.findFirst({
      where: { id: reportId, workspaceId },
      include: {
        workspace: {
          include: {
            project: { include: { presentation: true, sources: { where: { included: true } } } },
            facts: { include: { evidence: true } },
            requirements: true,
            conflicts: true,
          },
        },
      },
    });
    if (!reportRow || reportRow.workspace.projectId !== projectId) throw new Error("Compliance report was not found");
    const presentationRow = reportRow.workspace.project.presentation;
    if (!presentationRow) throw new Error("Presentation was not found for compliance check");
    if (
      presentationRow.revision !== job.data.presentationRevision
      || reportRow.workspace.analysisRevision !== job.data.analysisRevision
      || reportRow.workspace.planRevision !== job.data.planRevision
    ) {
      throw new Error("Compliance inputs became stale before the check started");
    }
    const plan = defensePlanSchema.parse(reportRow.workspace.plan);
    const presentation = presentationSchema.parse(presentationRow.document);
    const previousRow = await prisma.complianceReport.findFirst({
      where: { workspaceId, status: "ready", id: { not: reportId }, createdAt: { lt: reportRow.createdAt } },
      orderBy: { createdAt: "desc" },
    });
    const previousReport = previousRow ? complianceReportDocumentSchema.safeParse(previousRow.document) : null;
    const report = await withTraceSpan("defense.compliance", {
      "studydeck.project_id": projectId,
      "studydeck.workspace_id": workspaceId,
      "studydeck.report_id": reportId,
      "studydeck.stage": "defense.compliance",
    }, () => checkDefenseCompliance({
      reportId,
      workspaceId,
      presentationRevision: presentationRow.revision,
      analysisRevision: reportRow.workspace.analysisRevision,
      planRevision: reportRow.workspace.planRevision,
      presentation,
      plan,
      authorProfile: asRecord(reportRow.workspace.authorProfile),
      requirements: reportRow.workspace.requirements.map(mapRequirement),
      facts: reportRow.workspace.facts.map(mapFact),
      conflicts: reportRow.workspace.conflicts.map(mapConflict),
      assets: reportRow.workspace.project.sources.flatMap(mapAsset),
      previousReport: previousReport?.success ? previousReport.data : null,
    }), job.data.traceContext);

    await setStage("saving_report");
    await prisma.complianceReport.update({
      where: { id: reportId },
      data: {
        status: "ready",
        document: report as unknown as Prisma.InputJsonValue,
        requiredSatisfied: report.counts.required.satisfied,
        requiredTotal: report.counts.required.total,
        recommendedSatisfied: report.counts.recommended.satisfied,
        recommendedTotal: report.counts.recommended.total,
        preferenceSatisfied: report.counts.preference.satisfied,
        preferenceTotal: report.counts.preference.total,
        error: null,
      },
    });
    await completeGenerationJob(prisma, generationJobId);
    await prisma.userActivityEvent.create({ data: { userId: job.data.userId, projectId, type: "defense.compliance.completed", metadata: { reportId, requiredUnsatisfied: report.counts.required.unsatisfied } } });
  } catch (error) {
    const message = safeErrorSummary(error);
    captureGenerationError(error, { projectId, jobId: job.id, stage: "checking_compliance" });
    await Promise.allSettled([
      prisma.complianceReport.update({ where: { id: reportId }, data: { status: "failed", error: message } }),
      prisma.generationJob.update({ where: { id: generationJobId }, data: { status: "failed", error: message, progressStage: "failed", progressLabel: "Не получилось", progressPercent: 100 } }),
    ]);
    throw error;
  }
}

async function runComplianceReportExportJob(job: Job<ComplianceReportExportJobData>) {
  const prisma = getPrisma();
  const { projectId, workspaceId, reportId } = job.data;
  await prisma.complianceReport.update({ where: { id: reportId }, data: { pdfStatus: "processing", error: null } });
  try {
    const row = await prisma.complianceReport.findFirst({ where: { id: reportId, workspaceId }, include: { workspace: true } });
    if (!row || row.workspace.projectId !== projectId || row.status !== "ready") throw new Error("Ready compliance report was not found");
    const report = complianceReportDocumentSchema.parse(row.document);
    const buffer = await withTraceSpan("defense.compliance.pdf", {
      "studydeck.project_id": projectId,
      "studydeck.workspace_id": workspaceId,
      "studydeck.report_id": reportId,
      "studydeck.stage": "defense.report_pdf",
    }, () => createComplianceReportPdf(report), job.data.traceContext);
    const objectKey = `projects/${projectId}/defense/reports/${reportId}.pdf`;
    await putObjectBuffer(objectKey, buffer, "application/pdf");
    await recordCostEvent({
      idempotencyKey: `compliance-report:${reportId}:compute`,
      category: "export_compute",
      provider: "studydeck-worker",
      quantity: "1",
      unit: "report_pdf",
      unitPrice: process.env.EXPORT_COMPUTE_PRICE_RUB,
      currency: "RUB",
      measurement: "calculated",
    });
    await recordCostEvent({
      idempotencyKey: `compliance-report:${reportId}:storage`,
      category: "storage",
      provider: process.env.S3_ENDPOINT?.includes("localhost") || process.env.S3_ENDPOINT?.includes("minio") ? "minio" : "object_storage",
      quantity: String(buffer.length),
      unit: "stored_byte_month",
      unitPrice: process.env.STORAGE_PRICE_USD_PER_BYTE_MONTH,
      currency: "USD",
      measurement: "calculated",
    });
    await prisma.complianceReport.update({ where: { id: reportId }, data: { pdfStatus: "ready", pdfObjectKey: objectKey, error: null } });
  } catch (error) {
    const message = safeErrorSummary(error);
    await prisma.complianceReport.update({ where: { id: reportId }, data: { pdfStatus: "failed", error: message } });
    logger.error({ projectId, workspaceId, reportId, ...errorLogFields(error) }, "compliance report PDF failed");
    throw error;
  }
}

async function materializeDefenseSources(prisma: PrismaClient, projectId: string, sources: Array<SourceRow>) {
  const chunks: DefenseAnalysisChunk[] = [];
  const styleReferences: Array<{ sourceId: string; label: string; buffer: Buffer }> = [];
  const screenshots: Array<{ sourceId: string; label: string; buffer: Buffer; contentType?: string }> = [];
  const sourceRows: SourceRow[] = [];
  for (const source of sources) {
    if (!source.role) continue;
    if (source.type === "REPOSITORY" || (source.role === "repository_document" && source.url && !source.objectKey)) {
      const repository = parsePublicRepositoryUrl(source.url || "");
      const documents = await fetchPublicRepositoryDocuments(repository, {
        githubToken: process.env.GITHUB_PUBLIC_TOKEN,
        gitlabToken: process.env.GITLAB_PUBLIC_TOKEN,
      });
      for (const document of documents) {
        const child = await upsertDerivedSource(prisma, projectId, source, document.path, document.buffer, "repository_document", {
          origin: "repository",
          parentSourceId: source.id,
          repository: {
            provider: repository.provider,
            owner: repository.ownerPath,
            repository: repository.repository,
            ref: "HEAD",
            path: document.path,
            url: repository.canonicalUrl,
          },
          chunks: [],
          warnings: [],
        });
        await extractDocumentRow(prisma, child, document.buffer, chunks);
        sourceRows.push(child);
      }
      continue;
    }
    if (!source.objectKey) {
      if (source.text || source.excerpt) {
        const text = source.text || source.excerpt;
        const result = await extractSourceWithProvenance({ sourceId: source.id, label: `${source.label}.txt`, buffer: Buffer.from(text, "utf8") });
        chunks.push(...toAnalysisChunks(source, result.chunks));
      }
      sourceRows.push(source);
      continue;
    }
    const buffer = await readObjectBuffer(source.objectKey);
    if (path.extname(source.label).toLowerCase() === ".zip") {
      const documents = await extractDefenseArchiveDocuments(buffer);
      for (const document of documents) {
        const child = await upsertDerivedSource(prisma, projectId, source, document.path, document.buffer, "archive_document", {
          origin: "archive",
          parentSourceId: source.id,
          archive: { path: document.path, parentSourceId: source.id },
          chunks: [],
          warnings: [],
        });
        await extractDocumentRow(prisma, child, document.buffer, chunks);
        sourceRows.push(child);
      }
      continue;
    }
    if (source.role === "style_reference") styleReferences.push({ sourceId: source.id, label: source.label, buffer });
    else if (source.role === "screenshot") screenshots.push({ sourceId: source.id, label: source.label, buffer, contentType: metadataFor(source.metadata).image?.contentType });
    else if (!["logo", "supporting_image", "web_image"].includes(source.role)) await extractDocumentRow(prisma, source, buffer, chunks);
    sourceRows.push(source);
  }
  return { chunks, styleReferences, screenshots, sources: sourceRows };
}

async function extractDocumentRow(prisma: PrismaClient, source: SourceRow, buffer: Buffer, target: DefenseAnalysisChunk[]) {
  const result = await extractSourceWithProvenance({ sourceId: source.id, label: source.label, buffer });
  const metadata = metadataFor(source.metadata);
  const chunkMetadata = result.chunks.map((chunk, index) => ({
    id: `${source.id}:${index}`,
    sourceId: source.id,
    locator: chunk.locator,
    excerpt: chunk.excerpt,
    normalizedText: chunk.text,
    fingerprint: crypto.createHash("sha256").update(`${source.id}:${chunk.locator}:${chunk.text}`).digest("hex"),
  }));
  const warnings = unique([...(metadata.warnings || []), ...(result.warning ? [result.warning] : [])]);
  const nextMetadata = defenseSourceMetadataSchema.parse({
    ...metadata,
    document: {
      ...(metadata.document || {}),
      ...(path.extname(source.label).toLowerCase() === ".pdf" ? { hasTextLayer: !result.needsReview } : {}),
      ...(path.extname(source.label).toLowerCase() === ".pptx" ? { slideCount: result.chunks.length || undefined } : {}),
    },
    chunks: chunkMetadata,
    warnings,
  });
  const fullText = result.chunks.map((chunk) => chunk.text).join("\n\n").slice(0, 100_000);
  await prisma.source.update({
    where: { id: source.id },
    data: { text: fullText, excerpt: fullText.slice(0, 1100), metadata: nextMetadata as unknown as Prisma.InputJsonValue },
  });
  target.push(...chunkMetadata.map((chunk) => ({
    id: chunk.id,
    sourceId: source.id,
    sourceRole: source.role || "project_document",
    locator: chunk.locator,
    excerpt: chunk.excerpt,
    text: chunk.normalizedText,
  })));
}

async function upsertDerivedSource(
  prisma: PrismaClient,
  projectId: string,
  parent: SourceRow,
  relativePath: string,
  buffer: Buffer,
  role: "repository_document" | "archive_document",
  metadata: DefenseSourceMetadata,
) {
  const extension = path.posix.extname(relativePath).toLowerCase();
  const hash = crypto.createHash("sha256").update(`${parent.id}:${relativePath}`).digest("hex").slice(0, 24);
  const objectKey = `projects/${projectId}/defense/ingestion/${parent.id}/${hash}${safeExtension(extension)}`;
  await putObjectBuffer(objectKey, buffer, contentTypeFromExtension(extension));
  const existing = await prisma.source.findFirst({ where: { projectId, parentSourceId: parent.id, label: relativePath } });
  if (existing) {
    return prisma.source.update({
      where: { id: existing.id },
      data: { type: extension.slice(1).toUpperCase() || "DOCUMENT", role, size: buffer.length, objectKey, metadata: metadata as unknown as Prisma.InputJsonValue, included: true },
    });
  }
  return prisma.source.create({
    data: { projectId, parentSourceId: parent.id, label: relativePath, type: extension.slice(1).toUpperCase() || "DOCUMENT", role, size: buffer.length, objectKey, metadata: metadata as unknown as Prisma.InputJsonValue, included: true },
  });
}

async function extractAndPersistStyle(
  prisma: PrismaClient,
  projectId: string,
  references: Array<{ sourceId: string; label: string; buffer: Buffer }>,
) {
  const reference = references.find((item) => path.extname(item.label).toLowerCase() === ".pptx");
  if (!reference) return null;
  const extracted = await extractDefensePptxStyle(reference.buffer);
  const logoSourceIds: string[] = [];
  for (const candidate of extracted.logoCandidates) {
    const extension = candidate.contentType === "image/png" ? ".png" : candidate.contentType === "image/webp" ? ".webp" : ".jpg";
    const hash = crypto.createHash("sha256").update(candidate.buffer).digest("hex").slice(0, 24);
    const objectKey = `projects/${projectId}/defense/style/${hash}${extension}`;
    await putObjectBuffer(objectKey, candidate.buffer, candidate.contentType);
    const metadata = defenseSourceMetadataSchema.parse({
      origin: "upload",
      parentSourceId: reference.sourceId,
      image: { width: candidate.width || 1, height: candidate.height || 1, contentType: candidate.contentType, byteSize: candidate.buffer.length },
      chunks: [],
      warnings: [],
    });
    const existing = await prisma.source.findFirst({ where: { projectId, objectKey } });
    const source = existing || await prisma.source.create({
      data: { projectId, parentSourceId: reference.sourceId, label: path.posix.basename(candidate.path), type: "IMAGE", role: "logo", size: candidate.buffer.length, objectKey, metadata: metadata as unknown as Prisma.InputJsonValue },
    });
    logoSourceIds.push(source.id);
  }
  return defenseStyleBriefSchema.parse({
    sourceId: reference.sourceId,
    palette: { dominant: extracted.palette },
    fonts: { heading: extracted.headingFont, body: extracted.bodyFont },
    logoSourceIds,
    motifs: [],
    tone: extracted.mood,
    visualDirection: "Использовать палитру, шрифтовой характер и логотип из PPTX без копирования master layout и координат.",
    warnings: extracted.warnings,
  });
}

async function classifyAndPersistScreenshots(
  prisma: PrismaClient,
  screenshots: Array<{ sourceId: string; label: string; buffer: Buffer; contentType?: string }>,
) {
  for (const screenshot of screenshots) {
    const classification = await classifyDefenseScreenshot(screenshot);
    const { width, height, ...rawClassification } = classification;
    const parsed = screenshotClassificationSchema.parse(rawClassification);
    const source = await prisma.source.findUniqueOrThrow({ where: { id: screenshot.sourceId } });
    const metadata = metadataFor(source.metadata);
    const next = defenseSourceMetadataSchema.parse({
      ...metadata,
      image: {
        width: width || metadata.image?.width || 1,
        height: height || metadata.image?.height || 1,
        contentType: screenshot.contentType || metadata.image?.contentType || "image/png",
        byteSize: screenshot.buffer.length,
        classification: parsed,
      },
    });
    await prisma.source.update({ where: { id: screenshot.sourceId }, data: { metadata: next as unknown as Prisma.InputJsonValue } });
  }
}

async function persistAnalysisAndPlan(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  candidates: Awaited<ReturnType<typeof analyzeDefenseCandidates>>,
  materialized: Awaited<ReturnType<typeof materializeDefenseSources>>,
  styleBrief: ReturnType<typeof defenseStyleBriefSchema.parse> | null,
) {
  const chunkById = new Map(materialized.chunks.map((chunk) => [chunk.id, chunk]));
  await prisma.$transaction(async (tx) => {
    const workspace = await tx.defenseWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const hasDefenseSpec = await tx.source.count({ where: { projectId, included: true, role: "defense_spec" } }) > 0;
    if (hasDefenseSpec) {
      await tx.projectRequirement.deleteMany({ where: { workspaceId, origin: "builtin" } });
    } else {
      for (const requirement of materializeDefensePresetRequirements(workspace.standardPresetVersion as "hackathon-v1" | "diploma-v1")) {
        const existing = await tx.projectRequirement.findFirst({ where: { workspaceId, key: requirement.key } });
        if (!existing) {
          await tx.projectRequirement.create({
            data: {
              id: requirement.id,
              workspaceId,
              key: requirement.key,
              text: requirement.text,
              priority: requirement.priority,
              origin: "builtin",
              state: "active",
              rule: requirement.rule as Prisma.InputJsonValue,
              presetVersion: requirement.presetVersion,
            },
          });
        }
      }
    }

    for (const candidate of candidates.facts) {
      const evidence = candidate.evidenceChunkIds.flatMap((id) => {
        const chunk = chunkById.get(id);
        return chunk ? [{ confirmation: "source" as const, sourceId: chunk.sourceId, locator: chunk.locator, excerpt: chunk.excerpt }] : [];
      });
      if (!evidence.length) continue;
      const existing = await tx.projectFact.findFirst({ where: { workspaceId, key: candidate.key }, include: { evidence: true } });
      if (!existing) {
        await tx.projectFact.create({ data: { workspaceId, key: candidate.key, statement: candidate.statement, evidence: { create: evidence } } });
        continue;
      }
      const existingFingerprints = new Set(existing.evidence.map((item) => `${item.sourceId || ""}:${item.locator || ""}:${item.excerpt || ""}`));
      const additions = evidence.filter((item) => !existingFingerprints.has(`${item.sourceId}:${item.locator || ""}:${item.excerpt || ""}`));
      if (additions.length) await tx.factEvidence.createMany({ data: additions.map((item) => ({ ...item, factId: existing.id })) });
    }

    for (const candidate of candidates.requirements) {
      const chunk = chunkById.get(candidate.evidenceChunkId);
      if (!chunk) continue;
      const existing = await tx.projectRequirement.findFirst({ where: { workspaceId, key: candidate.key } });
      if (existing) continue;
      const rule = mapCandidateRule(candidate.rule);
      await tx.projectRequirement.create({
        data: {
          workspaceId,
          key: candidate.key,
          text: candidate.text,
          priority: candidate.priority,
          origin: "source",
          state: "active",
          sourceId: chunk.sourceId,
          locator: chunk.locator,
          excerpt: chunk.excerpt,
          ...(rule ? { rule: rule as Prisma.InputJsonValue } : {}),
        },
      });
    }

    const existingConflicts = await tx.projectConflict.findMany({ where: { workspaceId } });
    for (const candidate of candidates.conflicts) {
      const optionId = stableId(`conflict-option:${candidate.key}:0`);
      const existing = existingConflicts.find((conflict) => Array.isArray(conflict.options) && asRecord(conflict.options[0]).id === optionId);
      const options = candidate.options.map((option, index) => {
        const chunk = chunkById.get(option.evidenceChunkIds[0]);
        return {
          id: stableId(`conflict-option:${candidate.key}:${index}`),
          label: option.statement.slice(0, 500),
          value: option.statement,
          ...(chunk ? { sourceId: chunk.sourceId, locator: chunk.locator, excerpt: chunk.excerpt } : {}),
        };
      });
      if (options.length < 2) continue;
      if (!existing) await tx.projectConflict.create({ data: { workspaceId, kind: candidate.kind, summary: candidate.summary, options: options as Prisma.InputJsonValue } });
      else if (existing.state === "unresolved") await tx.projectConflict.update({ where: { id: existing.id }, data: { summary: candidate.summary, options: options as Prisma.InputJsonValue } });
    }

    const [facts, requirements, conflicts, sources] = await Promise.all([
      tx.projectFact.findMany({ where: { workspaceId }, include: { evidence: true } }),
      tx.projectRequirement.findMany({ where: { workspaceId } }),
      tx.projectConflict.findMany({ where: { workspaceId } }),
      tx.source.findMany({ where: { projectId, included: true, role: { not: null } } }),
    ]);
    const plan = createPlan(workspace, hasDefenseSpec, facts.map(mapFact), requirements.map(mapRequirement), conflicts.map(mapConflict), sources.flatMap(mapAsset));
    await tx.defenseWorkspace.update({
      where: { id: workspaceId },
      data: {
        analysisStatus: "review_ready",
        analysisRevision: { increment: 1 },
        analysisError: null,
        styleBrief: styleBrief ? styleBrief as unknown as Prisma.InputJsonValue : Prisma.DbNull,
        plan: plan as unknown as Prisma.InputJsonValue,
        planRevision: { increment: 1 },
      },
    });
  });
}

async function rebuildPersistedPlan(prisma: PrismaClient, data: DefenseAnalysisJobData) {
  const workspace = await prisma.defenseWorkspace.findFirst({
    where: { id: data.workspaceId, projectId: data.projectId },
    include: {
      facts: { include: { evidence: true } },
      requirements: true,
      conflicts: true,
      project: { include: { sources: { where: { included: true, role: { not: null } } } } },
    },
  });
  if (!workspace) throw new Error("Defense workspace was not found");
  if (data.expectedAnalysisRevision !== undefined && workspace.analysisRevision !== data.expectedAnalysisRevision) throw new Error("Defense analysis revision changed before plan rebuild");
  if (data.expectedPlanRevision !== undefined && workspace.planRevision !== data.expectedPlanRevision) throw new Error("Defense plan revision changed before rebuild");
  const hasDefenseSpec = workspace.project.sources.some((source) => source.role === "defense_spec");
  const plan = createPlan(workspace, hasDefenseSpec, workspace.facts.map(mapFact), workspace.requirements.map(mapRequirement), workspace.conflicts.map(mapConflict), workspace.project.sources.flatMap(mapAsset));
  const updated = await prisma.defenseWorkspace.updateMany({
    where: { id: workspace.id, analysisRevision: workspace.analysisRevision, planRevision: workspace.planRevision },
    data: { plan: plan as unknown as Prisma.InputJsonValue, planRevision: { increment: 1 } },
  });
  if (!updated.count) throw new Error("Defense plan revision changed while rebuilding");
}

function createPlan(
  workspace: { defenseType: string; complianceMode: string; targetSlideCount: number; targetDurationSeconds: number; authorProfile: Prisma.JsonValue; standardPresetVersion: string },
  hasDefenseSpec: boolean,
  facts: ProjectFact[],
  requirements: ProjectRequirement[],
  conflicts: ProjectConflict[],
  assets: DefenseAsset[],
) {
  const preset = getDefensePreset(workspace.standardPresetVersion as "hackathon-v1" | "diploma-v1");
  const output = buildDefensePlan({
    config: {
      defenseType: workspace.defenseType as "hackathon" | "diploma",
      complianceMode: workspace.complianceMode as "strict" | "adaptive",
      targetSlideCount: workspace.targetSlideCount,
      targetDurationSeconds: workspace.targetDurationSeconds,
      authorProfile: asRecord(workspace.authorProfile),
      standardPresetVersion: hasDefenseSpec ? null : preset.version,
    },
    presetSlides: hasDefenseSpec ? [] : preset.slides.map((slide) => ({ key: slide.key, title: slide.title, purpose: slide.purpose })),
    requirements: requirements.map((item) => ({ ...item, rule: item.rule || null })),
    facts: facts.map((item) => ({ id: item.id, statement: item.statement, active: item.state === "active", evidenceCount: item.evidence.length })),
    assets: assets.map((asset) => ({ id: asset.sourceId, role: asset.role, label: asset.label, metadata: asset.metadata as unknown as Record<string, unknown> })),
    conflicts: conflicts.map((item) => ({ id: item.id, summary: item.summary, kind: item.kind, state: item.state })),
  });
  return defensePlanSchema.parse(output);
}

function mapCandidateRule(rule: { kind: string; slideOrder?: number; minimum?: number; maximum?: number; field?: string; assetRole?: string; value?: string }) {
  let candidate: unknown;
  if (rule.kind === "slide_position" && rule.slideOrder) candidate = { kind: "slide_position", position: "exact", order: rule.slideOrder };
  else if (rule.kind === "slide_count") candidate = { kind: "slide_count", min: integer(rule.minimum), max: integer(rule.maximum) };
  else if (rule.kind === "timing") candidate = { kind: "timing", scope: rule.slideOrder ? "slide" : "total", slideOrder: integer(rule.slideOrder), minSeconds: integer(rule.minimum), maxSeconds: integer(rule.maximum) };
  else if (rule.kind === "required_field" && rule.field) candidate = { kind: "author_field", field: rule.field };
  else if (rule.kind === "asset_count" && rule.assetRole) candidate = { kind: "asset_count", role: rule.assetRole, minCount: integer(rule.minimum) || 1, slideOrder: integer(rule.slideOrder) };
  else if (rule.kind === "palette" && rule.value) candidate = { kind: "palette", property: "dominant", color: rule.value };
  else return undefined;
  const parsed = requirementRuleSchema.safeParse(removeUndefined(candidate));
  return parsed.success ? parsed.data : undefined;
}

function mapFact(row: {
  id: string; key: string | null; statement: string; value: Prisma.JsonValue; state: string; createdAt: Date; updatedAt: Date;
  evidence: Array<{ id: string; confirmation: string; sourceId: string | null; locator: string | null; excerpt: string | null; confirmedById: string | null; createdAt: Date }>;
}) {
  return projectFactSchema.parse({
    id: row.id,
    ...(row.key ? { key: row.key } : {}),
    statement: row.statement,
    ...(row.value === null ? {} : { value: row.value }),
    state: row.state,
    evidence: row.evidence.map((item) => ({
      id: item.id,
      factId: row.id,
      confirmation: item.confirmation,
      ...(item.sourceId ? { sourceId: item.sourceId } : {}),
      ...(item.locator ? { locator: item.locator } : {}),
      ...(item.excerpt ? { excerpt: item.excerpt } : {}),
      ...(item.confirmedById ? { confirmedById: item.confirmedById } : {}),
      confirmedAt: item.createdAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function mapRequirement(row: {
  id: string; key: string | null; text: string; priority: string; origin: string; state: string; sourceId: string | null; locator: string | null; excerpt: string | null; rule: Prisma.JsonValue; presetVersion: string | null; createdAt: Date; updatedAt: Date;
}) {
  const rule = requirementRuleSchema.safeParse(row.rule);
  return projectRequirementSchema.parse({
    id: row.id,
    ...(row.key ? { key: row.key } : {}),
    text: row.text,
    priority: row.priority,
    origin: row.origin,
    state: row.state,
    ...(row.sourceId ? { sourceId: row.sourceId } : {}),
    ...(row.locator ? { locator: row.locator } : {}),
    ...(row.excerpt ? { excerpt: row.excerpt } : {}),
    ...(rule.success ? { rule: rule.data } : {}),
    ...(row.presetVersion ? { presetVersion: row.presetVersion } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function mapConflict(row: {
  id: string; kind: string; summary: string; options: Prisma.JsonValue; state: string; resolution: Prisma.JsonValue; resolvedById: string | null; resolvedAt: Date | null; createdAt: Date; updatedAt: Date;
}) {
  return projectConflictSchema.parse({
    id: row.id,
    kind: row.kind,
    summary: row.summary,
    options: row.options,
    state: row.state,
    ...(row.resolution === null ? {} : { resolution: row.resolution }),
    ...(row.resolvedById ? { resolvedById: row.resolvedById } : {}),
    ...(row.resolvedAt ? { resolvedAt: row.resolvedAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function mapAsset(row: SourceRow): DefenseAsset[] {
  if (!row.role) return [];
  const parsed = defenseAssetSchema.safeParse({ sourceId: row.id, role: row.role, label: row.label, metadata: metadataFor(row.metadata), included: row.included });
  return parsed.success ? [parsed.data] : [];
}

function metadataFor(value: Prisma.JsonValue | null): DefenseSourceMetadata {
  const parsed = defenseSourceMetadataSchema.safeParse(value || {});
  return parsed.success ? parsed.data : defenseSourceMetadataSchema.parse({ chunks: [], warnings: [] });
}

function toAnalysisChunks(source: SourceRow, chunks: Array<{ locator: string; excerpt: string; text: string }>): DefenseAnalysisChunk[] {
  return chunks.map((chunk, index) => ({ id: `${source.id}:${index}`, sourceId: source.id, sourceRole: source.role || "project_document", locator: chunk.locator, excerpt: chunk.excerpt, text: chunk.text }));
}

function createStageUpdater<T extends { generationJobId: string }>(prisma: PrismaClient, job: Job<T>, generationJobId: string) {
  return async (stage: GenerationProgressStage) => {
    const current = await prisma.generationJob.findUnique({ where: { id: generationJobId }, select: { cancelRequestedAt: true } });
    if (current?.cancelRequestedAt) throw new Error("Generation cancelled by administrator");
    return updateGenerationProgress(job, stage, (data) => prisma.generationJob.update({ where: { id: generationJobId }, data }));
  };
}

async function completeGenerationJob(prisma: PrismaClient, generationJobId: string) {
  await prisma.generationJob.update({ where: { id: generationJobId }, data: { status: "completed", progressStage: "completed", progressLabel: "Готово", progressPercent: 100, error: null } });
}

function contentTypeFromExtension(extension: string) {
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === ".pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (extension === ".md") return "text/markdown; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function safeExtension(extension: string) {
  return /^\.[a-z0-9]{1,8}$/i.test(extension) ? extension : ".bin";
}

function stableId(value: string) {
  return `def_${crypto.createHash("sha1").update(value).digest("hex").slice(0, 20)}`;
}

function integer(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) ? number : undefined;
}

function removeUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

type SourceRow = {
  id: string;
  projectId: string;
  parentSourceId: string | null;
  label: string;
  type: string;
  role: string | null;
  size: number;
  objectKey: string | null;
  url: string | null;
  excerpt: string;
  text: string;
  metadata: Prisma.JsonValue | null;
  included: boolean;
  createdAt: Date;
};
