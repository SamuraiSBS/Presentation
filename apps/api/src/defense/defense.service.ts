import path from "node:path";
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
  complianceReportDocumentSchema,
  defensePlanSchema,
  planLimits,
} from "@studydeck/shared";
import { ProjectAccessService } from "../access/project-access.service.js";
import { badRequest, conflict, resourceNotFound } from "../errors/api-error.js";
import { generationJobOptions } from "../jobs/job-options.js";
import { injectTraceContext, withTraceSpan } from "../observability.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { UsageService } from "../usage/usage.service.js";
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
  }

  async get(userId: string, projectId: string) {
    const access = await this.access.requireViewer(userId, projectId);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        workflow: true,
        presentation: { select: { revision: true } },
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
    this.assertAnalysisRevision(workspace, input.expectedAnalysisRevision);
    const presetChanges = input.defenseType !== undefined && input.defenseType !== workspace.defenseType;
    const planChanges = presetChanges
      || (input.complianceMode !== undefined && input.complianceMode !== workspace.complianceMode)
      || (input.targetSlideCount !== undefined && input.targetSlideCount !== workspace.targetSlideCount)
      || (input.targetDurationSeconds !== undefined && input.targetDurationSeconds !== workspace.targetDurationSeconds)
      || input.authorProfile !== undefined;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.defenseWorkspace.updateMany({
        where: {
          id: workspace.id,
          ...(input.expectedAnalysisRevision === undefined ? {} : { analysisRevision: input.expectedAnalysisRevision }),
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
    const repository = parsePublicRepositoryUrl(input.url);
    const existing = await this.prisma.source.findFirst({
      where: { projectId, role: "repository_document", url: repository.normalizedUrl },
    });
    if (existing) return { source: existing, analysisRevision: workspace.analysisRevision };
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
      await tx.defenseWorkspace.update({
        where: { id: workspace.id },
        data: {
          analysisStatus: "draft",
          analysisError: null,
          analysisRevision: { increment: 1 },
          plan: Prisma.DbNull,
          planRevision: { increment: 1 },
        },
      });
      return created;
    });
    return { source, analysisRevision: workspace.analysisRevision + 1 };
  }

  async startAnalysis(userId: string, projectId: string, input: StartDefenseAnalysisInput) {
    return withTraceSpan("api.defense.analysis.enqueue", {
      "studydeck.project_id": projectId,
      "studydeck.stage": "defense.analysis",
    }, async () => {
      const access = await this.access.requireEditor(userId, projectId);
      const workspace = await this.requireWorkspace(projectId);
      if (input.idempotencyKey) {
        const repeated = await this.prisma.generationJob.findFirst({
          where: { projectId, kind: "requirements_analysis", requestKey: input.idempotencyKey },
        });
        if (repeated) return generationJobResponse(repeated, projectId);
      }
      const active = await this.prisma.generationJob.findFirst({
        where: { projectId, kind: "requirements_analysis", status: { in: [...activeJobStatuses] } },
        orderBy: { createdAt: "desc" },
      });
      if (active) return generationJobResponse(active, projectId);
      const projectSourceCount = await this.prisma.source.count({
        where: { projectId, included: true, role: { in: [...projectSourceRoles] } },
      });
      if (!projectSourceCount) {
        throw badRequest("DEFENSE_PROJECT_SOURCE_REQUIRED", "Добавьте документ проекта, ZIP или публичный репозиторий");
      }

      await this.prisma.defenseWorkspace.update({
        where: { id: workspace.id },
        data: { analysisStatus: "queued", analysisError: null },
      });
      const job = await this.prisma.generationJob.create({
        data: {
          projectId,
          kind: "requirements_analysis",
          status: "queued",
          requestKey: input.idempotencyKey,
          progressStage: "extracting_sources",
          progressLabel: "Анализируем материалы защиты",
        },
      });
      try {
        const queueJob = await this.generationQueue.add(
          "analyze-defense-brief",
          {
            projectId,
            userId: access.project.userId,
            workspaceId: workspace.id,
            generationJobId: job.id,
            scope: "analysis",
            traceContext: injectTraceContext(),
          },
          generationJobOptions(),
        );
        const updated = await this.prisma.generationJob.update({
          where: { id: job.id },
          data: { queueJobId: queueJob.id },
        });
        return generationJobResponse(updated, projectId);
      } catch (error) {
        await this.prisma.$transaction([
          this.prisma.generationJob.update({
            where: { id: job.id },
            data: { status: "failed", error: "Не удалось поставить анализ в очередь", progressStage: "failed" },
          }),
          this.prisma.defenseWorkspace.update({
            where: { id: workspace.id },
            data: { analysisStatus: "failed", analysisError: "Не удалось поставить анализ в очередь" },
          }),
        ]);
        throw error;
      }
    });
  }

  async createFact(userId: string, projectId: string, input: CreateFactInput) {
    await this.access.requireEditor(userId, projectId);
    const workspace = await this.requireWorkspace(projectId);
    this.assertAnalysisRevision(workspace, input.expectedAnalysisRevision);
    await this.requireEvidenceSources(projectId, input.evidence);
    const fact = await this.prisma.$transaction(async (tx) => {
      await bumpAnalysisRevision(tx, workspace.id, input.expectedAnalysisRevision);
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
    this.assertAnalysisRevision(workspace, input.expectedAnalysisRevision);
    const fact = await this.prisma.projectFact.findFirst({ where: { id: factId, workspaceId: workspace.id } });
    if (!fact) throw resourceNotFound("Факт не найден");
    if (input.evidence) await this.requireEvidenceSources(projectId, input.evidence);
    const updated = await this.prisma.$transaction(async (tx) => {
      await bumpAnalysisRevision(tx, workspace.id, input.expectedAnalysisRevision);
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

  async deleteFact(userId: string, projectId: string, factId: string) {
    await this.access.requireEditor(userId, projectId);
    const workspace = await this.requireWorkspace(projectId);
    const fact = await this.prisma.projectFact.findFirst({ where: { id: factId, workspaceId: workspace.id } });
    if (!fact) throw resourceNotFound("Факт не найден");
    await this.prisma.$transaction(async (tx) => {
      await bumpAnalysisRevision(tx, workspace.id, undefined);
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
    this.assertAnalysisRevision(workspace, input.expectedAnalysisRevision);
    const requirement = await this.prisma.projectRequirement.findFirst({
      where: { id: requirementId, workspaceId: workspace.id },
    });
    if (!requirement) throw resourceNotFound("Требование не найдено");
    const updated = await this.prisma.$transaction(async (tx) => {
      await bumpAnalysisRevision(tx, workspace.id, input.expectedAnalysisRevision);
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
    this.assertAnalysisRevision(workspace, input.expectedAnalysisRevision);
    const source = await this.prisma.source.findFirst({ where: { id: sourceId, projectId } });
    if (!source) throw resourceNotFound("Материал не найден");
    if (input.role && !userAssignableRoles.has(input.role)) {
      throw badRequest("SOURCE_ROLE_NOT_USER_ASSIGNABLE", "Эту системную роль материала нельзя назначить вручную");
    }
    const metadata = input.classification === undefined
      ? undefined
      : metadataWithClassification(source.metadata, sourceId, input.classification);
    const updated = await this.prisma.$transaction(async (tx) => {
      await bumpAnalysisRevision(tx, workspace.id, input.expectedAnalysisRevision);
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
      await bumpAnalysisRevision(tx, workspace.id, input.expectedAnalysisRevision);
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
      if (existing?.status === "completed" || existing?.status === "active") return existing;
      if (existing?.status === "queued" && existing.queueJobId) return existing;

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

    try {
      const queueJob = await this.generationQueue.add(
        "generate-narration",
        {
          projectId,
          userId: access.project.userId,
          workspaceId: workspace.id,
          generationJobId: narrationJob.id,
          planRevision,
          traceContext: injectTraceContext(),
        },
        { ...generationJobOptions(), jobId: `defense-narration-${narrationJob.id}` },
      );
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
  }

  async rebuildPlan(userId: string, projectId: string, input: RebuildDefensePlanInput) {
    const access = await this.access.requireEditor(userId, projectId);
    const workspace = await this.requireWorkspace(projectId);
    this.assertAnalysisRevision(workspace, input.expectedAnalysisRevision);
    this.assertPlanRevision(workspace, input.expectedPlanRevision);
    const active = await this.prisma.generationJob.findFirst({
      where: { projectId, kind: "requirements_analysis", status: { in: [...activeJobStatuses] } },
      orderBy: { createdAt: "desc" },
    });
    if (active) return generationJobResponse(active, projectId);
    const job = await this.prisma.generationJob.create({
      data: {
        projectId,
        kind: "requirements_analysis",
        status: "queued",
        progressStage: "building_defense_plan",
        progressLabel: "Составляем план защиты",
      },
    });
    try {
      const queueJob = await this.generationQueue.add(
        "analyze-defense-brief",
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
        generationJobOptions(),
      );
      const updated = await this.prisma.generationJob.update({
        where: { id: job.id },
        data: { queueJobId: queueJob.id },
      });
      return generationJobResponse(updated, projectId);
    } catch (error) {
      await this.prisma.generationJob.update({
        where: { id: job.id },
        data: { status: "failed", error: "Не удалось поставить построение плана в очередь", progressStage: "failed" },
      });
      throw error;
    }
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
      if (input.idempotencyKey) {
        const repeated = await this.prisma.complianceReport.findFirst({
          where: { workspaceId: workspace.id, requestKey: input.idempotencyKey },
        });
        if (repeated) return { report: reportDetail(repeated), queueJobId: repeated.queueJobId };
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
      if (active) return { report: reportDetail(active), queueJobId: active.queueJobId };

      const { report, job } = await this.prisma.$transaction(async (tx) => {
        const createdReport = await tx.complianceReport.create({
          data: {
            workspaceId: workspace.id,
            requestKey: input.idempotencyKey,
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
            requestKey: input.idempotencyKey,
            progressStage: "checking_compliance",
            progressLabel: "Проверяем презентацию по ТЗ",
          },
        });
        return { report: createdReport, job: createdJob };
      });
      try {
        const queueJob = await this.generationQueue.add(
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
          generationJobOptions(),
        );
        await this.prisma.$transaction([
          this.prisma.generationJob.update({ where: { id: job.id }, data: { queueJobId: queueJob.id } }),
          this.prisma.complianceReport.update({ where: { id: report.id }, data: { queueJobId: queueJob.id } }),
        ]);
        return { report: reportDetail({ ...report, queueJobId: queueJob.id }), queueJobId: queueJob.id };
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
    if (report.pdfStatus === "ready" || report.pdfStatus === "queued" || report.pdfStatus === "processing") {
      return { report: reportDetail(report), queueJobId: report.pdfQueueJobId };
    }
    if (input.idempotencyKey && report.pdfRequestKey === input.idempotencyKey) {
      return { report: reportDetail(report), queueJobId: report.pdfQueueJobId };
    }
    await this.prisma.complianceReport.update({
      where: { id: report.id },
      data: {
        pdfStatus: "queued",
        pdfRequestKey: input.idempotencyKey,
        pdfObjectKey: null,
        error: null,
      },
    });
    try {
      const queueJob = await this.exportsQueue.add(
        "export-compliance-report",
        {
          projectId,
          userId: access.project.userId,
          workspaceId: workspace.id,
          reportId: report.id,
          traceContext: injectTraceContext(),
        },
        { attempts: 2 },
      );
      const updated = await this.prisma.complianceReport.update({
        where: { id: report.id },
        data: { pdfQueueJobId: queueJob.id },
      });
      return { report: reportDetail(updated), queueJobId: queueJob.id };
    } catch (error) {
      await this.prisma.complianceReport.update({
        where: { id: report.id },
        data: { pdfStatus: "failed", error: "Не удалось поставить PDF-отчёт в очередь" },
      });
      throw error;
    }
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
    const ids = [...new Set(evidence.flatMap((item) => item.confirmation === "source" && item.sourceId ? [item.sourceId] : []))];
    if (!ids.length) return;
    const count = await this.prisma.source.count({ where: { projectId, id: { in: ids } } });
    if (count !== ids.length) throw resourceNotFound("Источник подтверждения не найден");
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
}

function presetVersion(defenseType: "hackathon" | "diploma") {
  return `${defenseType}-v1`;
}

async function bumpAnalysisRevision(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  expectedRevision: number | undefined,
) {
  const updated = await tx.defenseWorkspace.updateMany({
    where: { id: workspaceId, ...(expectedRevision === undefined ? {} : { analysisRevision: expectedRevision }) },
    data: {
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

type ReportRow = {
  id: string;
  workspaceId: string;
  status: string;
  presentationRevision: number;
  analysisRevision: number;
  planRevision: number;
  document: Prisma.JsonValue;
  requiredSatisfied: number;
  requiredTotal: number;
  recommendedSatisfied: number;
  recommendedTotal: number;
  preferenceSatisfied: number;
  preferenceTotal: number;
  pdfObjectKey: string | null;
  pdfStatus: string | null;
  error: string | null;
  queueJobId?: string | null;
  pdfQueueJobId?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function reportDetail(report: ReportRow) {
  const document = complianceReportDocumentSchema.safeParse(report.document);
  return {
    id: report.id,
    workspaceId: report.workspaceId,
    status: report.status,
    presentationRevision: report.presentationRevision,
    analysisRevision: report.analysisRevision,
    planRevision: report.planRevision,
    document: document.success ? document.data : null,
    counts: document.success ? document.data.counts : null,
    pdfStatus: report.pdfStatus ?? "not_requested",
    pdfObjectKey: report.pdfObjectKey,
    error: report.error,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  };
}

function reportSummary(report: ReportRow, revisions: DefenseRevisions) {
  const detail = reportDetail(report);
  const items = detail.document?.items ?? [];
  return {
    id: detail.id,
    status: detail.status,
    presentationRevision: detail.presentationRevision,
    analysisRevision: detail.analysisRevision,
    planRevision: detail.planRevision,
    checkedAt: detail.document?.checkedAt ?? null,
    counts: detail.counts,
    hasBlockingIssues: items.some((item) => (
      item.priority === "required" && ["partial", "unsatisfied", "needs_review"].includes(item.result)
    )) || Boolean(detail.document?.placeholders.some((item) => !item.resolved))
      || Boolean(detail.document?.conflicts.some((item) => item.state === "unresolved")),
    stale: isReportStale(report, revisions),
    pdfStatus: detail.pdfStatus,
  };
}

type DefenseRevisions = {
  presentationRevision: number;
  analysisRevision: number;
  planRevision: number;
};

function isReportStale(report: ReportRow, revisions: DefenseRevisions) {
  return report.presentationRevision !== revisions.presentationRevision
    || report.analysisRevision !== revisions.analysisRevision
    || report.planRevision !== revisions.planRevision;
}

function safeReportName(objectKey: string) {
  return path.basename(objectKey).replace(/[^\w.-]+/g, "-") || "defense-compliance-report.pdf";
}
