import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Prisma } from "@prisma/client";
import type { Queue } from "bullmq";
import {
  type AddDefenseRepositoryInput,
  type ConfirmDefensePlanInput,
  type CreateDefenseProjectInput,
  type CreateFactInput,
  type DeleteDefenseFactInput,
  type DefensePlan,
  type FactEvidence,
  type PatchDefenseConfigInput,
  type PutDefensePlanInput,
  type RebuildDefensePlanInput,
  type RequestComplianceReportPdfInput,
  type ResolveConflictInput,
  type StartComplianceCheckInput,
  type StartDefenseAnalysisInput,
  type UpdateDefenseAssetInput,
  type UpdateFactInput,
  type UpdateRequirementInput,
  defensePlanSchema,
  planLimits,
} from "@studydeck/shared";
import { ProjectAccessService } from "../access/project-access.service.js";
import { badRequest, conflict, resourceNotFound } from "../errors/api-error.js";
import { generationJobOptions, narrationJobOptions } from "../jobs/job-options.js";
import { enqueueOrRetryJob, needsQueueRecovery } from "../jobs/queue-recovery.js";
import { injectTraceContext, withTraceSpan } from "../observability.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { UsageService } from "../usage/usage.service.js";
import { isReportStale, reportDetail, reportSummary, safeReportName } from "./compliance-report-view.js";
import { defenseAnalysisPlanJobSpec } from "./defense-analysis-plan-job.js";
import { parsePublicRepositoryUrl } from "./repository-url.js";

const activeJobStatuses = ["queued", "active"] as const;
const projectSourceRoles = ["project_document", "repository_document", "archive_document"] as const;
const userAssignableRoles = new Set([
  "project_document",
  "technical_spec",
  "defense_spec",
  "style_reference",
  "screenshot",
  "logo",
  "supporting_image",
]);

@Injectable()
export class DefenseService {
  private s3Client?: S3Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue("generation") private readonly generationQueue: Queue,
    @InjectQueue("exports") private readonly exportsQueue: Queue,
    private readonly access: ProjectAccessService,
    private readonly usage: UsageService,
  ) {}

  async create(userId: string, input: CreateDefenseProjectInput) {
    const repeated = await this.prisma.project.findFirst({
      where: { userId, creationRequestKey: input.idempotencyKey, workflow: "requirements_driven" },
      select: { id: true },
    });
    if (repeated) return { id: repeated.id, ...(await this.get(userId, repeated.id)) };

    try {
      const project = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.upsert({
          where: { id: userId },
          create: { id: userId },
          update: {},
          select: { planCode: true },
        });
        const limit = planLimits[user.planCode];
        if (input.targetSlideCount > limit.maxSlides) {
          throw new BadRequestException(`Your plan allows up to ${limit.maxSlides} slides`);
        }
        if (input.folderId) {
          const folder = await tx.folder.findFirst({
            where: { id: input.folderId, ownerId: userId },
            select: { id: true },
          });
          if (!folder) throw resourceNotFound("Папка не найдена");
        }
        await this.usage.reserveCreationSlot(tx, userId);
        return tx.project.create({
          data: {
            userId,
            creationRequestKey: input.idempotencyKey,
            folderId: input.folderId,
            title: input.title,
            prompt: `Защита проекта: ${input.title}`,
            scenario: "project_defense",
            level: "student",
            mode: "fast_draft",
            workflow: "requirements_driven",
            slideCount: input.targetSlideCount,
            defenseWorkspace: {
              create: {
                defenseType: input.defenseType,
                complianceMode: input.complianceMode,
                targetSlideCount: input.targetSlideCount,
                targetDurationSeconds: input.targetDurationSeconds,
                allowWebImages: input.allowWebImages,
                authorProfile: input.authorProfile as Prisma.InputJsonValue,
                standardPresetVersion: presetVersion(input.defenseType),
              },
            },
          },
          select: { id: true },
        });
      });
      return { id: project.id, ...(await this.get(userId, project.id)) };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const concurrent = await this.prisma.project.findFirst({
        where: { userId, creationRequestKey: input.idempotencyKey, workflow: "requirements_driven" },
        select: { id: true },
      });
      if (!concurrent) throw error;
      return { id: concurrent.id, ...(await this.get(userId, concurrent.id)) };
    }
  }

  async get(userId: string, projectId: string) {
    const access = await this.access.requireViewer(userId, projectId);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        workflow: true,
        presentation: { select: { revision: true } },
        jobs: {
          where: { kind: { in: ["requirements_analysis", "narration", "compliance"] }, status: { in: [...activeJobStatuses] } },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, kind: true, status: true, queueJobId: true, progressStage: true, progressLabel: true },
        },
        sources: { orderBy: { createdAt: "asc" } },
        defenseWorkspace: {
          include: {
            facts: { include: { evidence: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "asc" } },
            requirements: { orderBy: { createdAt: "asc" } },
            conflicts: { orderBy: { createdAt: "asc" } },
            complianceReports: { orderBy: { createdAt: "desc" }, take: 25 },
          },
        },
      },
    });
    if (!project || project.workflow !== "requirements_driven" || !project.defenseWorkspace) {
      throw resourceNotFound("Рабочее пространство защиты не найдено");
    }
    const { facts, requirements, conflicts, complianceReports, ...workspace } = project.defenseWorkspace;
    const presentationRevision = project.presentation?.revision ?? 0;
    return {
      workspace,
      jobs: project.jobs,
      sources: project.sources,
      facts,
      requirements,
      conflicts,
      reports: complianceReports.map((report) => reportSummary(report, {
        presentationRevision,
        analysisRevision: workspace.analysisRevision,
        planRevision: workspace.planRevision,
      })),
      presentationRevision,
      accessRole: access.role,
    };
  }

  async updateConfig(userId: string, projectId: string, input: PatchDefenseConfigInput) {
    await this.access.requireEditor(userId, projectId);
    const workspace = await this.requireWorkspace(projectId);
    this.assertInputsEditable(workspace);
    this.assertAnalysisRevision(workspace, input.expectedAnalysisRevision);
    const presetChanges = input.defenseType !== undefined && input.defenseType !== workspace.defenseType;
    const planChanges = presetChanges
      || (input.complianceMode !== undefined && input.complianceMode !== workspace.complianceMode)
      || (input.targetSlideCount !== undefined && input.targetSlideCount !== workspace.targetSlideCount)
      || (input.targetDurationSeconds !== undefined && input.targetDurationSeconds !== workspace.targetDurationSeconds)
      || (input.allowWebImages !== undefined && input.allowWebImages !== workspace.allowWebImages)
      || input.authorProfile !== undefined;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.defenseWorkspace.updateMany({
        where: {
          id: workspace.id,
          analysisRevision: workspace.analysisRevision,
          planRevision: workspace.planRevision,
        },
        data: {
          ...(input.defenseType === undefined ? {} : {
            defenseType: input.defenseType,
            standardPresetVersion: presetVersion(input.defenseType),
          }),
          ...(input.complianceMode === undefined ? {} : { complianceMode: input.complianceMode }),
          ...(input.targetSlideCount === undefined ? {} : { targetSlideCount: input.targetSlideCount }),
          ...(input.targetDurationSeconds === undefined ? {} : { targetDurationSeconds: input.targetDurationSeconds }),
          ...(input.allowWebImages === undefined ? {} : { allowWebImages: input.allowWebImages }),
          ...(input.authorProfile === undefined
            ? {}
            : { authorProfile: input.authorProfile as Prisma.InputJsonValue }),
          analysisStatus: "draft",
          analysisError: null,
          analysisRevision: { increment: 1 },
          ...(planChanges ? { plan: Prisma.DbNull, planRevision: { increment: 1 } } : {}),
        },
      });
      if (!updated.count) throw await analysisRevisionConflict(tx, workspace.id);
      if (presetChanges) {
        await tx.projectRequirement.deleteMany({ where: { workspaceId: workspace.id, origin: "builtin" } });
      }
      if (input.targetSlideCount !== undefined) {
        await tx.project.update({ where: { id: projectId }, data: { slideCount: input.targetSlideCount } });
      }
    });
    return this.get(userId, projectId);
  }

  async addRepository(userId: string, projectId: string, input: AddDefenseRepositoryInput) {
    await this.access.requireEditor(userId, projectId);
    const workspace = await this.requireWorkspace(projectId);
    this.assertInputsEditable(workspace);
    this.assertAnalysisRevision(workspace, input.expectedAnalysisRevision);
    const repository = parsePublicRepositoryUrl(input.url);
    const existing = await this.prisma.source.findFirst({
      where: { projectId, role: "repository_document", url: repository.normalizedUrl },
    });
    if (existing) return { source: existing, analysisRevision: workspace.analysisRevision };
    try {
      const source = await this.prisma.$transaction(async (tx) => {
        const created = await tx.source.create({
          data: {
            projectId,
            label: `${repository.namespace}/${repository.repository}`,
            type: "REPOSITORY",
            role: "repository_document",
            url: repository.normalizedUrl,
            metadata: {
              origin: "repository",
              repository: {
                provider: repository.provider,
                owner: repository.namespace,
                repository: repository.repository,
                ref: "HEAD",
                path: "",
                url: repository.normalizedUrl,
              },
              chunks: [],
              warnings: [],
            },
          },
        });
        const bumped = await tx.defenseWorkspace.updateMany({
          where: {
            id: workspace.id,
            analysisRevision: workspace.analysisRevision,
            planRevision: workspace.planRevision,
          },
          data: {
            analysisStatus: "draft",
            analysisError: null,
            analysisRevision: { increment: 1 },
            plan: Prisma.DbNull,
            planRevision: { increment: 1 },
          },
        });
        if (!bumped.count) throw await analysisRevisionConflict(tx, workspace.id);
        return created;
      });
      return { source, analysisRevision: workspace.analysisRevision + 1 };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const concurrent = await this.prisma.source.findFirst({
        where: { projectId, role: "repository_document", url: repository.normalizedUrl },
      });
      if (!concurrent) throw error;
      return { source: concurrent, analysisRevision: workspace.analysisRevision };
    }
  }

  async startAnalysis(userId: string, projectId: string, input: StartDefenseAnalysisInput) {
    return withTraceSpan("api.defense.analysis.enqueue", {
      "studydeck.project_id": projectId,
      "studydeck.stage": "defense.analysis",
    }, async () => {
      const access = await this.access.requireEditor(userId, projectId);
      const workspace = await this.requireWorkspace(projectId);
      this.assertInputsEditable(workspace);
      this.assertAnalysisRevision(workspace, input.expectedAnalysisRevision);
      // An analysis is defined by the workspace input revision. A client retry after a
      // lost response must not create another job merely because it generated a new key.
      const jobSpec = defenseAnalysisPlanJobSpec({ scope: "analysis", workspaceId: workspace.id, analysisRevision: workspace.analysisRevision, planRevision: workspace.planRevision });
      const requestKey = jobSpec.requestKey;
      const repeated = await this.prisma.generationJob.findUnique({
        where: { projectId_kind_requestKey: { projectId, kind: "requirements_analysis", requestKey } },
      });
      if (repeated && await this.hasRunnableGenerationJob(repeated)) {
        return generationJobResponse(repeated, projectId);
      }
      const projectSourceCount = await this.prisma.source.count({
        where: { projectId, included: true, role: { in: [...projectSourceRoles] } },
      });
      if (!projectSourceCount) {
        throw badRequest("DEFENSE_PROJECT_SOURCE_REQUIRED", "Добавьте документ проекта, ZIP или публичный репозиторий");
      }
      const prepared = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.generationJob.findUnique({
          where: { projectId_kind_requestKey: { projectId, kind: "requirements_analysis", requestKey } },
        });
        if (existing && await this.hasRunnableGenerationJob(existing)) {
          return { job: existing, shouldEnqueue: false };
        }
        const updatedWorkspace = await tx.defenseWorkspace.updateMany({
          where: {
            id: workspace.id,
            analysisRevision: workspace.analysisRevision,
            planRevision: workspace.planRevision,
          },
          data: { analysisStatus: "queued", analysisError: null },
        });
        if (!updatedWorkspace.count) throw await analysisRevisionConflict(tx, workspace.id);
        const job = existing
          ? await tx.generationJob.update({
            where: { id: existing.id },
            data: {
              status: "queued",
              queueJobId: null,
              error: null,
              cancelRequestedAt: null,
              progressStage: jobSpec.progressStage,
              progressLabel: jobSpec.progressLabel,
              progressPercent: 0,
              stageStartedAt: null,
            },
          })
          : await tx.generationJob.create({
            data: {
              projectId,
              kind: "requirements_analysis",
              status: "queued",
              requestKey,
              progressStage: jobSpec.progressStage,
              progressLabel: jobSpec.progressLabel,
            },
          });
        return { job, shouldEnqueue: true };
      }).catch(async (error) => {
        if (!isUniqueViolation(error)) throw error;
        const concurrent = await this.prisma.generationJob.findUnique({
          where: { projectId_kind_requestKey: { projectId, kind: "requirements_analysis", requestKey } },
        });
        if (!concurrent) throw error;
        return { job: concurrent, shouldEnqueue: !(await this.hasRunnableGenerationJob(concurrent)) };
      });
      if (!prepared.shouldEnqueue) return generationJobResponse(prepared.job, projectId);
      const job = prepared.job;
      let queueJob;
      try {
        queueJob = await enqueueOrRetryJob(
          this.generationQueue,
          jobSpec.queueJobName,
          {
            projectId,
            userId: access.project.userId,
            workspaceId: workspace.id,
            generationJobId: job.id,
            scope: "analysis",
            expectedAnalysisRevision: workspace.analysisRevision,
            expectedPlanRevision: workspace.planRevision,
            traceContext: injectTraceContext(),
          },
          { ...generationJobOptions(), jobId: `${jobSpec.queueJobIdPrefix}-${job.id}` },
        );
      } catch (error) {
        await this.prisma.$transaction([
          this.prisma.generationJob.update({
            where: { id: job.id },
            data: { status: "failed", error: jobSpec.queueFailureMessage, progressStage: "failed" },
          }),
          this.prisma.defenseWorkspace.updateMany({
            where: {
              id: workspace.id,
              analysisRevision: workspace.analysisRevision,
              planRevision: workspace.planRevision,
            },
            data: { analysisStatus: "failed", analysisError: jobSpec.queueFailureMessage },
          }),
        ]);
        throw error;
      }
      const updated = await this.prisma.generationJob.update({
        where: { id: job.id },
        data: { queueJobId: queueJob.id },
      });
      return generationJobResponse(updated, projectId);
    });
  }

  async createFact(userId: string, projectId: string, input: CreateFactInput) {
    await this.access.requireEditor(userId, projectId);
    const workspace = await this.requireWorkspace(projectId);
    this.assertInputsEditable(workspace);
    this.assertAnalysisRevision(workspace, input.expectedAnalysisRevision);
    await this.requireEvidenceSources(projectId, input.evidence);
    const fact = await this.prisma.$transaction(async (tx) => {
      await bumpAnalysisRevision(tx, workspace.id, workspace.analysisRevision, workspace.planRevision);
      return tx.projectFact.create({
        data: {
          workspaceId: workspace.id,
          key: input.key,
          statement: input.statement,
          ...(input.value === undefined ? {} : { value: jsonValue(input.value) }),
          evidence: { create: evidenceCreateData(input.evidence, userId) },
        },
        include: { evidence: true },
      });
    });
    return { fact, analysisRevision: workspace.analysisRevision + 1 };
  }

  async updateFact(userId: string, projectId: string, factId: string, input: UpdateFactInput) {
    await this.access.requireEditor(userId, projectId);
    const workspace = await this.requireWorkspace(projectId);
    this.assertInputsEditable(workspace);
    this.assertAnalysisRevision(workspace, input.expectedAnalysisRevision);
    const fact = await this.prisma.projectFact.findFirst({ where: { id: factId, workspaceId: workspace.id } });
    if (!fact) throw resourceNotFound("Факт не найден");
    if (input.evidence) await this.requireEvidenceSources(projectId, input.evidence);
    const updated = await this.prisma.$transaction(async (tx) => {
      await bumpAnalysisRevision(tx, workspace.id, workspace.analysisRevision, workspace.planRevision);
      await tx.projectFact.update({
        where: { id: factId },
        data: {
          ...(input.key === undefined ? {} : { key: input.key }),
          ...(input.statement === undefined ? {} : { statement: input.statement }),
          ...(input.value === undefined ? {} : { value: jsonValue(input.value) }),
          ...(input.state === undefined ? {} : { state: input.state }),
        },
      });
      if (input.evidence || input.statement !== undefined) {
        await tx.factEvidence.deleteMany({ where: { factId } });
        await tx.factEvidence.createMany({
          data: evidenceCreateData(
            input.evidence || [{ confirmation: "user" }],
            userId,
          ).map((item) => ({ ...item, factId })),
        });
      }
      return tx.projectFact.findUniqueOrThrow({ where: { id: factId }, include: { evidence: true } });
    });
    return { fact: updated, analysisRevision: workspace.analysisRevision + 1 };
  }

  async deleteFact(
    userId: string,
    projectId: string,
    factId: string,
    input: DeleteDefenseFactInput = {},
  ) {
    await this.access.requireEditor(userId, projectId);
    const workspace = await this.requireWorkspace(projectId);
    this.assertInputsEditable(workspace);
    this.assertAnalysisRevision(workspace, input.expectedAnalysisRevision);
    const fact = await this.prisma.projectFact.findFirst({ where: { id: factId, workspaceId: workspace.id } });
    if (!fact) throw resourceNotFound("Факт не найден");
    await this.prisma.$transaction(async (tx) => {
      await bumpAnalysisRevision(tx, workspace.id, workspace.analysisRevision, workspace.planRevision);
      await tx.projectFact.update({ where: { id: factId }, data: { state: "removed" } });
    });
    return { id: factId, deleted: true, analysisRevision: workspace.analysisRevision + 1 };
  }

  async updateRequirement(
    userId: string,
    projectId: string,
    requirementId: string,
    input: UpdateRequirementInput,
  ) {
    await this.access.requireEditor(userId, projectId);
    const workspace = await this.requireWorkspace(projectId);
    this.assertInputsEditable(workspace);
    this.assertAnalysisRevision(workspace, input.expectedAnalysisRevision);
    const requirement = await this.prisma.projectRequirement.findFirst({
      where: { id: requirementId, workspaceId: workspace.id },
    });
    if (!requirement) throw resourceNotFound("Требование не найдено");
    const updated = await this.prisma.$transaction(async (tx) => {
      await bumpAnalysisRevision(tx, workspace.id, workspace.analysisRevision, workspace.planRevision);
      return tx.projectRequirement.update({
        where: { id: requirementId },
        data: {
          ...(input.text === undefined ? {} : { text: input.text }),
          ...(input.text === undefined ? {} : {
            origin: "user",
            sourceId: null,
            locator: null,
            excerpt: null,
            presetVersion: null,
          }),
          ...(input.priority === undefined ? {} : { priority: input.priority }),
          ...(input.state === undefined ? {} : { state: input.state }),
          ...(input.rule === undefined
            ? {}
            : { rule: input.rule === null ? Prisma.DbNull : input.rule as Prisma.InputJsonValue }),
        },
      });
    });
    return { requirement: updated, analysisRevision: workspace.analysisRevision + 1 };
  }

  async updateAsset(userId: string, projectId: string, sourceId: string, input: UpdateDefenseAssetInput) {
    await this.access.requireEditor(userId, projectId);
    const workspace = await this.requireWorkspace(projectId);
    this.assertInputsEditable(workspace);
    this.assertAnalysisRevision(workspace, input.expectedAnalysisRevision);
    const source = await this.prisma.source.findFirst({ where: { id: sourceId, projectId } });
    if (!source) throw resourceNotFound("Материал не найден");
    if (input.role && !userAssignableRoles.has(input.role)) {
      throw badRequest("SOURCE_ROLE_NOT_USER_ASSIGNABLE", "Эту системную роль материала нельзя назначить вручную");
    }
    if (input.included === false && source.included && projectSourceRoles.includes(source.role as typeof projectSourceRoles[number])) {
      const remainingProjectSources = await this.prisma.source.count({
        where: { projectId, included: true, role: { in: [...projectSourceRoles] } },
      });
      if (remainingProjectSources <= 1) {
        throw badRequest("DEFENSE_PROJECT_SOURCE_REQUIRED", "Оставьте хотя бы один включённый материал проекта для защиты");
      }
    }
    const metadata = input.classification === undefined
      ? undefined
      : metadataWithClassification(source.metadata, sourceId, input.classification);
    const updated = await this.prisma.$transaction(async (tx) => {
      await bumpAnalysisRevision(tx, workspace.id, workspace.analysisRevision, workspace.planRevision);
      return tx.source.update({
        where: { id: sourceId },
        data: {
          ...(input.role === undefined ? {} : { role: input.role }),
          ...(input.label === undefined ? {} : { label: input.label }),
          ...(input.included === undefined ? {} : { included: input.included }),
          ...(metadata === undefined ? {} : { metadata: metadata as Prisma.InputJsonValue }),
        },
      });
    });
    return { source: updated, analysisRevision: workspace.analysisRevision + 1 };
  }

  async resolveConflict(
    userId: string,
    projectId: string,
    conflictId: string,
    input: ResolveConflictInput,
  ) {
    await this.access.requireEditor(userId, projectId);
    const workspace = await this.requireWorkspace(projectId);
    this.assertInputsEditable(workspace);
    this.assertAnalysisRevision(workspace, input.expectedAnalysisRevision);
    const item = await this.prisma.projectConflict.findFirst({
      where: { id: conflictId, workspaceId: workspace.id },
    });
    if (!item) throw resourceNotFound("Противоречие не найдено");
    if (input.action === "resolve" && input.resolution?.optionId) {
      const options = Array.isArray(item.options) ? item.options : [];
      if (!options.some((option) => isRecord(option) && option.id === input.resolution?.optionId)) {
        throw badRequest("UNKNOWN_CONFLICT_OPTION", "Выбранный вариант не относится к этому противоречию");
      }
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await bumpAnalysisRevision(tx, workspace.id, workspace.analysisRevision, workspace.planRevision);
      return tx.projectConflict.update({
        where: { id: conflictId },
        data: input.action === "ignore"
          ? {
            state: "ignored",
            resolution: Prisma.DbNull,
            resolvedById: userId,
            resolvedAt: new Date(),
          }
          : {
            state: "resolved",
            resolution: input.resolution as Prisma.InputJsonValue,
            resolvedById: userId,
            resolvedAt: new Date(),
          },
      });
    });
    return { conflict: updated, analysisRevision: workspace.analysisRevision + 1 };
  }

  async getPlan(userId: string, projectId: string) {
    await this.access.requireViewer(userId, projectId);
    const workspace = await this.requireWorkspace(projectId);
    return {
      plan: workspace.plan,
      planRevision: workspace.planRevision,
      analysisRevision: workspace.analysisRevision,
    };
  }

  async updatePlan(userId: string, projectId: string, input: PutDefensePlanInput) {
    await this.access.requireEditor(userId, projectId);
    const workspace = await this.requireWorkspace(projectId);
    this.assertInputsEditable(workspace);
    this.assertPlanRevision(workspace, input.expectedPlanRevision);
    if (input.plan.status !== "draft" || input.plan.approvedAt !== null) {
      throw badRequest("DEFENSE_PLAN_APPROVAL_FORGED", "План можно подтвердить только отдельным действием запуска речи");
    }
    this.assertPlanMatchesWorkspace(workspace, input.plan);
    await this.validatePlanReferences(projectId, workspace.id, input.plan);
    if (input.plan.defenseType !== workspace.defenseType || input.plan.complianceMode !== workspace.complianceMode) {
      throw badRequest("DEFENSE_PLAN_CONFIG_MISMATCH", "План создан для другого типа или режима защиты");
    }
    const updated = await this.prisma.defenseWorkspace.updateMany({
      where: { id: workspace.id, planRevision: input.expectedPlanRevision },
      data: { plan: input.plan as Prisma.InputJsonValue, planRevision: { increment: 1 } },
    });
    if (!updated.count) throw await planRevisionConflict(this.prisma, workspace.id);
    return {
      plan: input.plan,
      planRevision: input.expectedPlanRevision + 1,
      analysisRevision: workspace.analysisRevision,
    };
  }

  async confirmPlan(userId: string, projectId: string, input: ConfirmDefensePlanInput) {
    const access = await this.access.requireEditor(userId, projectId);
    const workspace = await this.requireWorkspace(projectId);
    this.assertAnalysisRevision(workspace, input.expectedAnalysisRevision);
    const parsed = defensePlanSchema.safeParse(workspace.plan);
    if (!parsed.success) throw badRequest("DEFENSE_PLAN_MISSING", "Сначала составьте план защиты");
    this.assertPlanMatchesWorkspace(workspace, parsed.data);
    await this.validatePlanReferences(projectId, workspace.id, parsed.data);
    await this.assertNarrationReadiness(workspace, parsed.data);
    const repeatedConfirmation = parsed.data.status === "approved"
      && workspace.planRevision === input.expectedPlanRevision + 1;
    if (!repeatedConfirmation) this.assertPlanRevision(workspace, input.expectedPlanRevision);
    const plan = repeatedConfirmation
      ? parsed.data
      : defensePlanSchema.parse({
        ...parsed.data,
        status: "approved",
        approvedAt: parsed.data.approvedAt ?? new Date().toISOString(),
      });
    const planRevision = repeatedConfirmation ? workspace.planRevision : input.expectedPlanRevision + 1;
    const requestKey = `defense-narration-${workspace.id}-${planRevision}`;

    const narrationJob = await this.prisma.$transaction(async (tx) => {
      if (!repeatedConfirmation) {
        const updated = await tx.defenseWorkspace.updateMany({
          where: {
            id: workspace.id,
            analysisRevision: input.expectedAnalysisRevision,
            planRevision: input.expectedPlanRevision,
          },
          data: { plan: plan as Prisma.InputJsonValue, planRevision: { increment: 1 } },
        });
        if (!updated.count) throw await planRevisionConflict(tx, workspace.id);
      }

      const existing = await tx.generationJob.findUnique({
        where: {
          projectId_kind_requestKey: {
            projectId,
            kind: "narration",
            requestKey,
          },
        },
      });
      if (existing && await this.hasRunnableGenerationJob(existing)) return existing;

      const job = existing
        ? await tx.generationJob.update({
          where: { id: existing.id },
          data: {
            status: "queued",
            queueJobId: null,
            error: null,
            cancelRequestedAt: null,
            progressStage: "queued",
            progressLabel: "В очереди",
            progressPercent: 0,
            stageStartedAt: null,
          },
        })
        : await tx.generationJob.create({
          data: {
            projectId,
            kind: "narration",
            status: "queued",
            requestKey,
          },
        });
      await tx.project.update({
        where: { id: projectId },
        data: { status: "script_queued", error: null },
      });
      return job;
    });

    if (narrationJob.status === "completed" || narrationJob.status === "active" || narrationJob.queueJobId) {
      return {
        plan,
        planRevision,
        analysisRevision: workspace.analysisRevision,
        ...narrationJobResult(narrationJob, projectId),
      };
    }

    let queueJob;
    try {
      queueJob = await enqueueOrRetryJob(
        this.generationQueue,
        "generate-narration",
        {
          projectId,
          userId: access.project.userId,
          workspaceId: workspace.id,
          generationJobId: narrationJob.id,
          planRevision,
          traceContext: injectTraceContext(),
        },
        { ...narrationJobOptions(), jobId: `defense-narration-${narrationJob.id}` },
      );
    } catch (error) {
      await this.prisma.$transaction([
        this.prisma.generationJob.update({
          where: { id: narrationJob.id },
          data: {
            status: "failed",
            error: "Не удалось поставить подготовку речи в очередь",
            progressStage: "failed",
            progressLabel: "Не получилось",
            progressPercent: 100,
          },
        }),
        this.prisma.project.update({
          where: { id: projectId },
          data: { status: "draft", error: "Не удалось поставить подготовку речи в очередь" },
        }),
      ]);
      throw error;
    }
    const updatedJob = await this.prisma.generationJob.update({
      where: { id: narrationJob.id },
      data: { queueJobId: queueJob.id },
    });
    return {
      plan,
      planRevision,
      analysisRevision: workspace.analysisRevision,
      ...narrationJobResult(updatedJob, projectId),
    };
  }

  async rebuildPlan(userId: string, projectId: string, input: RebuildDefensePlanInput) {
    const access = await this.access.requireEditor(userId, projectId);
    const workspace = await this.requireWorkspace(projectId);
    this.assertInputsEditable(workspace);
    this.assertAnalysisRevision(workspace, input.expectedAnalysisRevision);
    this.assertPlanRevision(workspace, input.expectedPlanRevision);
    const jobSpec = defenseAnalysisPlanJobSpec({ scope: "plan", workspaceId: workspace.id, analysisRevision: workspace.analysisRevision, planRevision: workspace.planRevision });
    const requestKey = jobSpec.requestKey;
    const prepared = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.generationJob.findUnique({
        where: { projectId_kind_requestKey: { projectId, kind: "requirements_analysis", requestKey } },
      });
      if (existing && await this.hasRunnableGenerationJob(existing)) {
        return { job: existing, shouldEnqueue: false };
      }
      const job = existing
        ? await tx.generationJob.update({
          where: { id: existing.id },
          data: {
            status: "queued",
            queueJobId: null,
            error: null,
            cancelRequestedAt: null,
            progressStage: jobSpec.progressStage,
            progressLabel: jobSpec.progressLabel,
            progressPercent: 0,
            stageStartedAt: null,
          },
        })
        : await tx.generationJob.create({
          data: {
            projectId,
            kind: "requirements_analysis",
            status: "queued",
            requestKey,
            progressStage: jobSpec.progressStage,
            progressLabel: jobSpec.progressLabel,
          },
        });
      return { job, shouldEnqueue: true };
    }).catch(async (error) => {
      if (!isUniqueViolation(error)) throw error;
      const concurrent = await this.prisma.generationJob.findUnique({
        where: { projectId_kind_requestKey: { projectId, kind: "requirements_analysis", requestKey } },
      });
      if (!concurrent) throw error;
      return { job: concurrent, shouldEnqueue: !(await this.hasRunnableGenerationJob(concurrent)) };
    });
    if (!prepared.shouldEnqueue) return generationJobResponse(prepared.job, projectId);
    const job = prepared.job;
    let queueJob;
    try {
      queueJob = await enqueueOrRetryJob(
        this.generationQueue,
        jobSpec.queueJobName,
        {
          projectId,
          userId: access.project.userId,
          workspaceId: workspace.id,
          generationJobId: job.id,
          scope: "plan",
          expectedAnalysisRevision: input.expectedAnalysisRevision,
          expectedPlanRevision: input.expectedPlanRevision,
          traceContext: injectTraceContext(),
        },
        { ...generationJobOptions(), jobId: `${jobSpec.queueJobIdPrefix}-${job.id}` },
      );
    } catch (error) {
      await this.prisma.generationJob.update({
        where: { id: job.id },
        data: { status: "failed", error: jobSpec.queueFailureMessage, progressStage: "failed" },
      });
      throw error;
    }
    const updated = await this.prisma.generationJob.update({
      where: { id: job.id },
      data: { queueJobId: queueJob.id },
    });
    return generationJobResponse(updated, projectId);
  }

  async startComplianceCheck(userId: string, projectId: string, input: StartComplianceCheckInput) {
    return withTraceSpan("api.defense.compliance.enqueue", {
      "studydeck.project_id": projectId,
      "studydeck.stage": "defense.compliance",
    }, async () => {
      const access = await this.access.requireEditor(userId, projectId);
      const workspace = await this.requireWorkspace(projectId);
      const presentation = await this.prisma.presentation.findUnique({ where: { projectId } });
      if (!presentation) throw badRequest("PRESENTATION_REQUIRED", "Сначала создайте презентацию");
      this.assertComplianceRevisions(workspace, presentation.revision, input);
      const plan = defensePlanSchema.safeParse(workspace.plan);
      if (!plan.success || plan.data.status !== "approved") {
        throw badRequest("DEFENSE_PLAN_NOT_APPROVED", "Подтвердите план защиты перед проверкой");
      }
      const requestKey = defenseRequestKey(
        "compliance",
        workspace.id,
        presentation.revision,
        `${workspace.analysisRevision}-${workspace.planRevision}`,
      );
      const repeated = await this.prisma.complianceReport.findUnique({
        where: { workspaceId_requestKey: { workspaceId: workspace.id, requestKey } },
      });
      if (repeated && await this.hasRunnableComplianceReport(projectId, repeated)) {
        return { report: reportDetail(repeated), queueJobId: repeated.queueJobId };
      }
      const active = await this.prisma.complianceReport.findFirst({
        where: {
          workspaceId: workspace.id,
          status: { in: ["queued", "processing"] },
          presentationRevision: presentation.revision,
          analysisRevision: workspace.analysisRevision,
          planRevision: workspace.planRevision,
        },
        orderBy: { createdAt: "desc" },
      });
      if (active && await this.hasRunnableComplianceReport(projectId, active)) {
        return { report: reportDetail(active), queueJobId: active.queueJobId };
      }
      const recoverableReport = repeated ?? active;
      const jobRequestKey = recoverableReport?.requestKey ?? requestKey;

      const prepared = await this.prisma.$transaction(async (tx) => {
        if (recoverableReport) {
          const retriedReport = await tx.complianceReport.update({
            where: { id: recoverableReport.id },
            data: { status: "queued", queueJobId: null, error: null },
          });
          const existingJob = await tx.generationJob.findUnique({
            where: { projectId_kind_requestKey: { projectId, kind: "compliance", requestKey: jobRequestKey } },
          });
          const retriedJob = existingJob
            ? await tx.generationJob.update({
              where: { id: existingJob.id },
              data: {
                status: "queued",
                queueJobId: null,
                error: null,
                cancelRequestedAt: null,
                progressStage: "checking_compliance",
                progressLabel: "Проверяем презентацию по ТЗ",
                progressPercent: 0,
                stageStartedAt: null,
              },
            })
            : await tx.generationJob.create({
              data: {
                projectId,
                kind: "compliance",
                status: "queued",
                requestKey: jobRequestKey,
                progressStage: "checking_compliance",
                progressLabel: "Проверяем презентацию по ТЗ",
              },
            });
          return { report: retriedReport, job: retriedJob, shouldEnqueue: true };
        }
        const createdReport = await tx.complianceReport.create({
          data: {
            workspaceId: workspace.id,
            requestKey,
            presentationRevision: presentation.revision,
            analysisRevision: workspace.analysisRevision,
            planRevision: workspace.planRevision,
          },
        });
        const createdJob = await tx.generationJob.create({
          data: {
            projectId,
            kind: "compliance",
            status: "queued",
            requestKey,
            progressStage: "checking_compliance",
            progressLabel: "Проверяем презентацию по ТЗ",
          },
        });
        return { report: createdReport, job: createdJob, shouldEnqueue: true };
      }).catch(async (error) => {
        if (!isUniqueViolation(error)) throw error;
        const concurrent = await this.prisma.complianceReport.findUnique({
          where: { workspaceId_requestKey: { workspaceId: workspace.id, requestKey } },
        });
        if (!concurrent) throw error;
        const concurrentJob = await this.prisma.generationJob.findUnique({
          where: { projectId_kind_requestKey: { projectId, kind: "compliance", requestKey } },
        });
        if (!concurrentJob) throw error;
        if (await this.hasRunnableComplianceReport(projectId, concurrent)) {
          return { report: concurrent, job: concurrentJob, shouldEnqueue: false };
        }
        const [report, job] = await this.prisma.$transaction([
          this.prisma.complianceReport.update({
            where: { id: concurrent.id },
            data: { status: "queued", queueJobId: null, error: null },
          }),
          this.prisma.generationJob.update({
            where: { id: concurrentJob.id },
            data: {
              status: "queued",
              queueJobId: null,
              error: null,
              cancelRequestedAt: null,
              progressStage: "checking_compliance",
              progressLabel: "Проверяем презентацию по ТЗ",
              progressPercent: 0,
              stageStartedAt: null,
            },
          }),
        ]);
        return { report, job, shouldEnqueue: true };
      });
      const { report, job } = prepared;
      if (!prepared.shouldEnqueue) return { report: reportDetail(report), queueJobId: report.queueJobId };
      let queueJob;
      try {
        queueJob = await enqueueOrRetryJob(
          this.generationQueue,
          "check-defense-compliance",
          {
            projectId,
            userId: access.project.userId,
            workspaceId: workspace.id,
            reportId: report.id,
            generationJobId: job.id,
            presentationRevision: presentation.revision,
            analysisRevision: workspace.analysisRevision,
            planRevision: workspace.planRevision,
            traceContext: injectTraceContext(),
          },
          { ...generationJobOptions(), jobId: `defense-compliance-${job.id}` },
        );
      } catch (error) {
        await this.prisma.$transaction([
          this.prisma.generationJob.update({
            where: { id: job.id },
            data: { status: "failed", error: "Не удалось поставить проверку в очередь", progressStage: "failed" },
          }),
          this.prisma.complianceReport.update({
            where: { id: report.id },
            data: { status: "failed", error: "Не удалось поставить проверку в очередь" },
          }),
        ]);
        throw error;
      }
      await this.prisma.$transaction([
        this.prisma.generationJob.update({ where: { id: job.id }, data: { queueJobId: queueJob.id } }),
        this.prisma.complianceReport.update({ where: { id: report.id }, data: { queueJobId: queueJob.id } }),
      ]);
      return { report: reportDetail({ ...report, queueJobId: queueJob.id }), queueJobId: queueJob.id };
    });
  }

  async listReports(userId: string, projectId: string) {
    await this.access.requireViewer(userId, projectId);
    const workspace = await this.requireWorkspace(projectId);
    const presentation = await this.prisma.presentation.findUnique({
      where: { projectId },
      select: { revision: true },
    });
    const reports = await this.prisma.complianceReport.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return {
      reports: reports.map((report) => reportSummary(report, {
        presentationRevision: presentation?.revision ?? 0,
        analysisRevision: workspace.analysisRevision,
        planRevision: workspace.planRevision,
      })),
    };
  }

  async getReport(userId: string, projectId: string, reportId: string) {
    await this.access.requireViewer(userId, projectId);
    const workspace = await this.requireWorkspace(projectId);
    const presentation = await this.prisma.presentation.findUnique({
      where: { projectId },
      select: { revision: true },
    });
    const report = await this.prisma.complianceReport.findFirst({
      where: { id: reportId, workspaceId: workspace.id },
    });
    if (!report) throw resourceNotFound("Отчёт не найден");
    return {
      report: reportDetail(report),
      stale: isReportStale(report, {
        presentationRevision: presentation?.revision ?? 0,
        analysisRevision: workspace.analysisRevision,
        planRevision: workspace.planRevision,
      }),
    };
  }

  async requestReportPdf(
    userId: string,
    projectId: string,
    reportId: string,
    input: RequestComplianceReportPdfInput,
  ) {
    const access = await this.access.requireViewer(userId, projectId);
    const workspace = await this.requireWorkspace(projectId);
    const report = await this.prisma.complianceReport.findFirst({
      where: { id: reportId, workspaceId: workspace.id },
    });
    if (!report) throw resourceNotFound("Отчёт не найден");
    if (report.status !== "ready") throw badRequest("COMPLIANCE_REPORT_NOT_READY", "Отчёт ещё не готов");
    if (report.presentationRevision !== input.expectedPresentationRevision) {
      throw conflict("COMPLIANCE_REPORT_REVISION_MISMATCH", "Выбран отчёт для другой версии презентации", {
        reportPresentationRevision: report.presentationRevision,
      });
    }
    if (
      report.pdfStatus === "ready"
      || ((report.pdfStatus === "queued" || report.pdfStatus === "processing")
        && !(await needsQueueRecovery(this.exportsQueue, report.pdfQueueJobId)))
    ) {
      return { report: reportDetail(report), queueJobId: report.pdfQueueJobId };
    }
    const requestKey = defenseRequestKey("report-pdf", report.id, report.presentationRevision);
    const retryablePdfState: Prisma.ComplianceReportWhereInput[] = [
      { pdfStatus: null },
      { pdfStatus: "failed" },
      { pdfStatus: "queued", pdfQueueJobId: null },
      { pdfStatus: "processing", pdfQueueJobId: null },
    ];
    if (report.pdfStatus === "queued" && report.pdfQueueJobId) {
      retryablePdfState.push({ pdfStatus: "queued", pdfQueueJobId: report.pdfQueueJobId });
    }
    if (report.pdfStatus === "processing" && report.pdfQueueJobId) {
      retryablePdfState.push({ pdfStatus: "processing", pdfQueueJobId: report.pdfQueueJobId });
    }
    const queued = await this.prisma.complianceReport.updateMany({
      where: {
        id: report.id,
        OR: retryablePdfState,
      },
      data: {
        pdfStatus: "queued",
        pdfRequestKey: requestKey,
        pdfObjectKey: null,
        pdfQueueJobId: null,
        error: null,
      },
    });
    if (!queued.count) {
      const current = await this.prisma.complianceReport.findUnique({ where: { id: report.id } });
      if (current) return { report: reportDetail(current), queueJobId: current.pdfQueueJobId };
    }
    let queueJob;
    try {
      queueJob = await enqueueOrRetryJob(
        this.exportsQueue,
        "export-compliance-report",
        {
          projectId,
          userId: access.project.userId,
          workspaceId: workspace.id,
          reportId: report.id,
          traceContext: injectTraceContext(),
        },
        { attempts: 2, jobId: `defense-compliance-pdf-${report.id}-${report.presentationRevision}` },
      );
    } catch (error) {
      await this.prisma.complianceReport.update({
        where: { id: report.id },
        data: { pdfStatus: "failed", error: "Не удалось поставить PDF-отчёт в очередь" },
      });
      throw error;
    }
    const updated = await this.prisma.complianceReport.update({
      where: { id: report.id },
      data: { pdfQueueJobId: queueJob.id },
    });
    return { report: reportDetail(updated), queueJobId: queueJob.id };
  }

  async getReportPdfDownloadUrl(userId: string, projectId: string, reportId: string) {
    await this.access.requireViewer(userId, projectId);
    const workspace = await this.requireWorkspace(projectId);
    const report = await this.prisma.complianceReport.findFirst({
      where: { id: reportId, workspaceId: workspace.id },
    });
    if (!report) throw resourceNotFound("Отчёт не найден");
    if (report.pdfStatus !== "ready" || !report.pdfObjectKey) {
      throw badRequest("COMPLIANCE_REPORT_PDF_NOT_READY", "PDF-отчёт ещё не готов");
    }
    const url = await getSignedUrl(
      this.getS3(),
      new GetObjectCommand({
        Bucket: this.config.getOrThrow<string>("S3_BUCKET"),
        Key: report.pdfObjectKey,
        ResponseContentDisposition: `attachment; filename="${safeReportName(report.pdfObjectKey)}"`,
      }),
      { expiresIn: 60 * 5 },
    );
    return { url };
  }

  private async requireWorkspace(projectId: string) {
    const workspace = await this.prisma.defenseWorkspace.findUnique({ where: { projectId } });
    if (!workspace) throw resourceNotFound("Рабочее пространство защиты не найдено");
    return workspace;
  }

  private assertAnalysisRevision(
    workspace: { analysisRevision: number },
    expectedRevision: number | undefined,
  ) {
    if (expectedRevision !== undefined && expectedRevision !== workspace.analysisRevision) {
      throw conflict("ANALYSIS_REVISION_CONFLICT", "Данные защиты изменились в другой вкладке", {
        currentAnalysisRevision: workspace.analysisRevision,
      });
    }
  }

  private assertInputsEditable(workspace: { plan: Prisma.JsonValue | null }) {
    const plan = defensePlanSchema.safeParse(workspace.plan);
    if (plan.success && plan.data.status === "approved") {
      throw conflict(
        "DEFENSE_PLAN_ALREADY_CONFIRMED",
        "После подтверждения плана изменять требования, факты и материалы нельзя. Создайте новый черновик защиты.",
      );
    }
  }

  private assertPlanRevision(workspace: { planRevision: number }, expectedRevision: number) {
    if (expectedRevision !== workspace.planRevision) {
      throw conflict("PLAN_REVISION_CONFLICT", "План защиты изменился в другой вкладке", {
        currentPlanRevision: workspace.planRevision,
      });
    }
  }

  private assertComplianceRevisions(
    workspace: { analysisRevision: number; planRevision: number },
    presentationRevision: number,
    input: StartComplianceCheckInput,
  ) {
    if (
      input.expectedPresentationRevision !== presentationRevision
      || input.expectedAnalysisRevision !== workspace.analysisRevision
      || input.expectedPlanRevision !== workspace.planRevision
    ) {
      throw conflict("DEFENSE_REVISION_CONFLICT", "Презентация или данные защиты изменились", {
        currentPresentationRevision: presentationRevision,
        currentAnalysisRevision: workspace.analysisRevision,
        currentPlanRevision: workspace.planRevision,
      });
    }
  }

  private async requireEvidenceSources(projectId: string, evidence: readonly FactEvidence[]) {
    const sourceEvidence = evidence.filter((item) => item.confirmation === "source");
    const ids = [...new Set(sourceEvidence.flatMap((item) => item.sourceId ? [item.sourceId] : []))];
    if (!ids.length) return;
    const sources = await this.prisma.source.findMany({
      where: { projectId, id: { in: ids } },
      select: { id: true, included: true, metadata: true },
    });
    if (sources.length !== ids.length) throw resourceNotFound("Источник подтверждения не найден");
    const byId = new Map(sources.map((source) => [source.id, source]));
    for (const item of sourceEvidence) {
      const source = item.sourceId ? byId.get(item.sourceId) : undefined;
      if (!source || !source.included) {
        throw badRequest("DEFENSE_EVIDENCE_SOURCE_EXCLUDED", "Подтверждение должно ссылаться на включённый материал защиты");
      }
      const locators = sourceLocators(source.metadata);
      if (locators.size && (!item.locator || !locators.has(item.locator))) {
        throw badRequest("DEFENSE_EVIDENCE_LOCATOR_INVALID", "Укажите locator существующего фрагмента материала");
      }
    }
  }

  private async validatePlanReferences(projectId: string, workspaceId: string, plan: DefensePlan) {
    const factIds = unique(plan.slides.flatMap((slide) => slide.factIds));
    const requirementIds = unique(plan.slides.flatMap((slide) => slide.requirementIds));
    const sourceIds = unique(plan.slides.flatMap((slide) => slide.assetSourceIds));
    const [facts, requirements, sources] = await Promise.all([
      this.prisma.projectFact.count({ where: { workspaceId, id: { in: factIds }, state: "active" } }),
      this.prisma.projectRequirement.count({ where: { workspaceId, id: { in: requirementIds }, state: "active" } }),
      this.prisma.source.count({ where: { projectId, id: { in: sourceIds }, included: true } }),
    ]);
    if (facts !== factIds.length || requirements !== requirementIds.length || sources !== sourceIds.length) {
      throw badRequest(
        "DEFENSE_PLAN_REFERENCE_INVALID",
        "План содержит удалённый или принадлежащий другому проекту факт, требование или материал",
      );
    }
  }

  private async assertNarrationReadiness(
    workspace: { id: string; projectId: string; analysisStatus: string },
    plan: DefensePlan,
  ) {
    if (workspace.analysisStatus !== "review_ready") {
      throw badRequest(
        "DEFENSE_ANALYSIS_NOT_READY",
        "Сначала завершите анализ материалов и проверьте найденные факты",
      );
    }

    const [confirmedFacts, activeRequirements] = await Promise.all([
      this.prisma.projectFact.count({
        where: {
          workspaceId: workspace.id,
          state: "active",
          evidence: {
            some: {
              OR: [
                { confirmation: "user" },
                {
                  confirmation: "source",
                  locator: { not: null },
                  source: { is: { projectId: workspace.projectId, included: true } },
                },
              ],
            },
          },
        },
      }),
      this.prisma.projectRequirement.count({ where: { workspaceId: workspace.id, state: "active" } }),
    ]);
    if (!confirmedFacts && !activeRequirements) {
      throw badRequest(
        "DEFENSE_INSUFFICIENT_EVIDENCE",
        "В материалах пока нет подтверждённых фактов или требований. Добавьте материал и повторите анализ.",
      );
    }

    const ungroundedSlides = plan.slides.filter((slide) =>
      requiresProjectEvidence(slide)
        && !slide.factIds.length
        && !slide.requirementIds.length
        && !slide.assetSourceIds.length
        && !slide.placeholders.length,
    );
    if (ungroundedSlides.length) {
      throw badRequest(
        "DEFENSE_PLAN_EVIDENCE_GAP",
        `Добавьте факт или заполнитель для разделов: ${ungroundedSlides.map((slide) => slide.order).join(", ")}`,
        { slideOrders: ungroundedSlides.map((slide) => slide.order) },
      );
    }
  }

  private assertPlanMatchesWorkspace(
    workspace: { targetSlideCount: number; targetDurationSeconds: number },
    plan: DefensePlan,
  ) {
    if (plan.slides.length !== workspace.targetSlideCount) {
      throw badRequest(
        "DEFENSE_PLAN_SLIDE_COUNT_MISMATCH",
        `В плане должно быть ${workspace.targetSlideCount} слайдов`,
      );
    }
    if (plan.totalTimingSeconds > workspace.targetDurationSeconds) {
      throw badRequest(
        "DEFENSE_PLAN_TIMING_EXCEEDED",
        "Тайминг плана превышает выбранную продолжительность защиты",
      );
    }
  }

  private getS3() {
    if (!this.s3Client) {
      this.s3Client = new S3Client({
        region: this.config.get<string>("S3_REGION") || "us-east-1",
        endpoint: this.config.get<string>("S3_ENDPOINT"),
        forcePathStyle: this.config.get<string>("S3_FORCE_PATH_STYLE") !== "false",
        credentials: {
          accessKeyId: this.config.getOrThrow<string>("S3_ACCESS_KEY_ID"),
          secretAccessKey: this.config.getOrThrow<string>("S3_SECRET_ACCESS_KEY"),
        },
      });
    }
    return this.s3Client;
  }

  private async hasRunnableGenerationJob(job: { status: string; queueJobId: string | null }) {
    if (job.status === "completed") return true;
    if (!["queued", "active"].includes(job.status)) return false;
    return !(await needsQueueRecovery(this.generationQueue, job.queueJobId));
  }

  private async hasRunnableComplianceReport(
    projectId: string,
    report: { status: string; requestKey: string | null },
  ) {
    if (report.status === "ready") return true;
    if (!["queued", "processing"].includes(report.status)) return false;
    if (!report.requestKey) return false;
    const job = await this.prisma.generationJob.findUnique({
      where: { projectId_kind_requestKey: { projectId, kind: "compliance", requestKey: report.requestKey } },
    });
    if (!job || !["queued", "active"].includes(job.status)) return false;
    return !(await needsQueueRecovery(this.generationQueue, job.queueJobId));
  }
}

function presetVersion(defenseType: "hackathon" | "diploma") {
  return `${defenseType}-v1`;
}

function requiresProjectEvidence(slide: DefensePlan["slides"][number]) {
  if (slide.order === 1) return false;
  return !/(?:^|\s)(?:итог[\p{L}]*|заключени[\p{L}]*|завершени[\p{L}]*|контакт[\p{L}]*)(?:$|\s)/iu.test(`${slide.title} ${slide.purpose}`);
}

async function bumpAnalysisRevision(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  expectedRevision: number | undefined,
  expectedPlanRevision: number | undefined,
) {
  const updated = await tx.defenseWorkspace.updateMany({
    where: {
      id: workspaceId,
      ...(expectedRevision === undefined ? {} : { analysisRevision: expectedRevision }),
      ...(expectedPlanRevision === undefined ? {} : { planRevision: expectedPlanRevision }),
    },
    data: {
      analysisStatus: "draft",
      analysisError: null,
      analysisRevision: { increment: 1 },
      plan: Prisma.DbNull,
      planRevision: { increment: 1 },
    },
  });
  if (!updated.count) throw await analysisRevisionConflict(tx, workspaceId);
}

async function analysisRevisionConflict(
  prisma: Pick<Prisma.TransactionClient, "defenseWorkspace">,
  workspaceId: string,
) {
  const current = await prisma.defenseWorkspace.findUnique({ where: { id: workspaceId }, select: { analysisRevision: true } });
  return conflict("ANALYSIS_REVISION_CONFLICT", "Данные защиты изменились в другой вкладке", {
    currentAnalysisRevision: current?.analysisRevision ?? 0,
  });
}

async function planRevisionConflict(
  prisma: Pick<PrismaService, "defenseWorkspace">,
  workspaceId: string,
) {
  const current = await prisma.defenseWorkspace.findUnique({ where: { id: workspaceId }, select: { planRevision: true } });
  return conflict("PLAN_REVISION_CONFLICT", "План защиты изменился в другой вкладке", {
    currentPlanRevision: current?.planRevision ?? 0,
  });
}

function evidenceCreateData(evidence: readonly FactEvidence[], userId: string) {
  return evidence.map((item) => ({
    confirmation: item.confirmation,
    sourceId: item.confirmation === "source" ? item.sourceId : null,
    locator: item.locator,
    excerpt: item.excerpt,
    confirmedById: item.confirmation === "user" ? userId : null,
    createdAt: new Date(),
  }));
}

function jsonValue(value: unknown) {
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

function metadataWithClassification(
  rawMetadata: Prisma.JsonValue | null,
  sourceId: string,
  classification: UpdateDefenseAssetInput["classification"],
) {
  const metadata = isRecord(rawMetadata) ? structuredClone(rawMetadata) : {};
  const image = isRecord(metadata.image) ? metadata.image : null;
  if (!image) throw badRequest("ASSET_IMAGE_METADATA_MISSING", "У материала нет проверенных размеров изображения");
  if (classification && classification.sourceId !== sourceId) {
    throw badRequest("ASSET_CLASSIFICATION_SOURCE_MISMATCH", "Классификация относится к другому материалу");
  }
  if (classification === null) delete image.classification;
  else image.classification = classification;
  metadata.image = image;
  return metadata;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function sourceLocators(metadata: Prisma.JsonValue | null) {
  if (!isRecord(metadata) || !Array.isArray(metadata.chunks)) return new Set<string>();
  return new Set(
    metadata.chunks.flatMap((chunk) => (
      isRecord(chunk) && typeof chunk.locator === "string" && chunk.locator.trim()
        ? [chunk.locator]
        : []
    )),
  );
}

function defenseRequestKey(scope: string, workspaceId: string, revision: number, suffix?: string) {
  return ["defense", scope, workspaceId, revision, suffix || "auto"]
    .join(":")
    .slice(0, 200);
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function generationJobResponse(job: {
  id: string;
  queueJobId: string | null;
  status: string;
  progressStage: string;
  progressLabel: string;
}, projectId: string) {
  return {
    projectId,
    jobId: job.id,
    queueJobId: job.queueJobId,
    status: job.status,
    progressStage: job.progressStage,
    progressLabel: job.progressLabel,
  };
}

function narrationJobResult(job: {
  id: string;
  queueJobId: string | null;
  status: string;
}, projectId: string) {
  return {
    projectId,
    jobId: job.id,
    queueJobId: job.queueJobId,
    status: job.status === "completed"
      ? "script_ready"
      : job.status === "active"
        ? "script_generating"
        : "script_queued",
  };
}
