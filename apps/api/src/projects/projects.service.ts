import crypto from "node:crypto";
import path from "node:path";
import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Prisma } from "@prisma/client";
import type { Queue } from "bullmq";
import {
  type CanvasImageElement,
  type CreateProjectInput,
  type DuplicateProjectInput,
  type GeneratePresentationInput,
  type PresentationDocument,
  type ProjectListQuery,
  type UpdateNarrationInput,
  type UpdateProjectMetadataInput,
  type UpdateSourceReviewInput,
  type UpdateSlideInput,
  buildSlideCanvas,
  aitunnelCatalogSnapshot,
  assessFullSpeechContract,
  standardGenerationCostPolicy,
  hasCustomSlideCanvas,
  ensureEditableCanvas,
  defensePlanSchema,
  planLimits,
  presentationSchema,
  resolvePresentationTheme,
  safeGenerationRecovery,
  isPublicNarrationState,
  publicNarrationFailureMessage,
  type PublicNarrationState,
  slideCanvasSchema,
} from "@studydeck/shared";
import { ProjectAccessService } from "../access/project-access.service.js";
import { badRequest, conflict, resourceNotFound } from "../errors/api-error.js";
import { generationJobOptions, narrationJobOptions } from "../jobs/job-options.js";
import { errorLogFields, injectTraceContext, logger, withTraceSpan } from "../observability.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ProjectStorageService, rewriteProjectDocument } from "../storage/project-storage.service.js";
import { MalwareScanService } from "../security/malware-scan.service.js";
import { UsageService } from "../usage/usage.service.js";
import { ProductAnalyticsService } from "../analytics/product-analytics.service.js";
import { projectSummarySelect, toProjectSummary } from "./project-summary.js";

const activePresentationJobStatuses = ["queued", "active"] as const;

@Injectable()
export class ProjectsService {
  private s3Client?: S3Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue("generation") private readonly generationQueue: Queue,
    private readonly access: ProjectAccessService,
    private readonly usage: UsageService,
    private readonly storage: ProjectStorageService,
    private readonly malwareScanner: MalwareScanService,
    @Optional() private readonly productAnalytics?: ProductAnalyticsService,
  ) {}

  async list(userId: string, query: ProjectListQuery) {
    const accessWhere: Prisma.ProjectWhereInput = query.scope === "mine"
      ? { userId }
      : query.scope === "shared"
        ? { userId: { not: userId }, members: { some: { userId } } }
        : { OR: [{ userId }, { members: { some: { userId } } }] };
    const where: Prisma.ProjectWhereInput = {
      AND: [
        accessWhere,
        query.folderId === "none"
          ? { folderId: null }
          : query.folderId
            ? { folderId: query.folderId }
            : {},
        query.status ? { status: query.status } : {},
        query.search ? { title: { contains: query.search, mode: "insensitive" } } : {},
      ],
    };
    const orderBy: Prisma.ProjectOrderByWithRelationInput[] = query.sort === "created_desc"
      ? [{ createdAt: "desc" }, { id: "desc" }]
      : query.sort === "title_asc"
        ? [{ title: "asc" }, { id: "asc" }]
        : [{ updatedAt: "desc" }, { id: "desc" }];
    const select = projectSummarySelect(userId);

    const [rows, usage] = await Promise.all([
      this.prisma.project.findMany({
        where,
        orderBy,
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        select,
      }),
      this.usage.getSummary(userId),
    ]);
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: page.map((project) => toProjectSummary(project, userId)),
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
      usage,
    };
  }

  async create(userId: string, input: CreateProjectInput) {
    const created = await withTraceSpan("api.project.create", {
      "studydeck.stage": "project_create",
      "studydeck.slide_count": input.slideCount,
      "studydeck.mode": input.mode,
    }, async () => this.prisma.$transaction(async (tx) => {
      await this.usage.assertSlideCount(tx, userId, input.slideCount);
      return tx.project.create({
        data: {
          userId,
          title: input.title,
          prompt: promptWithGenerationBrief(input.prompt, input.generationBrief),
          scenario: input.scenario,
          level: input.level,
          mode: input.mode,
          slideCount: input.slideCount,
        },
        include: { sources: true, presentation: true },
      });
    }));
    void this.productAnalytics?.capture(userId, "project_created", {
      scenario: input.scenario,
      mode: input.mode,
      workflow: "standard",
      slide_count: input.slideCount,
    });
    return created;
  }

  async getAccessible(userId: string, id: string) {
    const access = await this.access.requireViewer(userId, id);
    const project = await this.getProjectDetail(id);
    const narrationState = publicNarrationState(project);
    return {
      ...project,
      error: publicProjectError(project.error, project.status, narrationState),
      jobs: project.jobs.map((job) => ({ ...job, error: publicJobError(job.error, job.status) })),
      narrationState,
      accessRole: access.role,
      presentationRevision: project.presentation?.revision ?? 0,
      owner: project.user,
    };
  }

  async updateMetadata(userId: string, id: string, input: UpdateProjectMetadataInput) {
    const access = await this.access.requireOwner(userId, id);
    if (input.folderId !== undefined) {
      await this.requireOwnerFolder(access.project.userId, input.folderId);
    }
    await this.prisma.project.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
      },
    });
    return this.getAccessible(userId, id);
  }

  async duplicate(userId: string, id: string, input: DuplicateProjectInput) {
    const access = await this.access.requireOwner(userId, id);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id },
      include: {
        sources: true,
        presentation: true,
        defenseWorkspace: {
          include: {
            facts: { include: { evidence: true } },
            requirements: true,
            conflicts: true,
          },
        },
      },
    });
    const folderId = input.folderId !== undefined ? input.folderId : project.folderId;
    await this.requireOwnerFolder(access.project.userId, folderId);

    const destinationProjectId = crypto.randomUUID();
    const keyMap = await this.storage.copyProjectPrefix(project.id, destinationProjectId);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.project.create({
          data: {
            id: destinationProjectId,
            userId: access.project.userId,
            folderId,
            title: input.title || `${project.title} — копия`,
            prompt: project.prompt,
            scenario: project.scenario,
            level: project.level,
            mode: project.mode,
            workflow: project.workflow,
            slideCount: project.slideCount,
            status: duplicateStatus(project),
            speechDraft: project.speechDraft,
            speechDraftUpdatedAt: project.speechDraftUpdatedAt,
            error: null,
          },
        });

        const sourceIdMap = new Map<string, string>();
        for (const source of project.sources) {
          const created = await tx.source.create({
            data: {
              projectId: destinationProjectId,
              label: source.label,
              type: source.type,
              role: source.role,
              size: source.size,
              objectKey: source.objectKey ? keyMap.get(source.objectKey) ?? rewriteProjectKey(source.objectKey, project.id, destinationProjectId) : null,
              url: source.url,
              excerpt: source.excerpt,
              text: source.text,
              included: source.included,
            },
            select: { id: true },
          });
          sourceIdMap.set(source.id, created.id);
        }

        for (const source of project.sources) {
          const sourceId = sourceIdMap.get(source.id);
          if (!sourceId) continue;
          const metadata = source.metadata == null
            ? undefined
            : rewriteDefenseValue(
              source.metadata,
              sourceIdMap,
              project.id,
              destinationProjectId,
              keyMap,
            ) as Prisma.InputJsonValue;
          const parentSourceId = source.parentSourceId ? sourceIdMap.get(source.parentSourceId) ?? null : null;
          if (metadata !== undefined || parentSourceId) {
            await tx.source.update({
              where: { id: sourceId },
              data: {
                ...(metadata !== undefined ? { metadata } : {}),
                ...(parentSourceId ? { parentSourceId } : {}),
              },
            });
          }
        }

        if (project.defenseWorkspace) {
          const workspace = await tx.defenseWorkspace.create({
            data: {
              projectId: destinationProjectId,
              defenseType: project.defenseWorkspace.defenseType,
              complianceMode: project.defenseWorkspace.complianceMode,
              language: project.defenseWorkspace.language,
              targetSlideCount: project.defenseWorkspace.targetSlideCount,
              targetDurationSeconds: project.defenseWorkspace.targetDurationSeconds,
              allowWebImages: project.defenseWorkspace.allowWebImages,
              authorProfile: project.defenseWorkspace.authorProfile as Prisma.InputJsonValue,
              standardPresetVersion: project.defenseWorkspace.standardPresetVersion,
              analysisStatus: project.defenseWorkspace.analysisStatus,
              analysisRevision: project.defenseWorkspace.analysisRevision,
              styleBrief: project.defenseWorkspace.styleBrief == null
                ? undefined
                : rewriteDefenseValue(
                  project.defenseWorkspace.styleBrief,
                  sourceIdMap,
                  project.id,
                  destinationProjectId,
                  keyMap,
                ) as Prisma.InputJsonValue,
              plan: undefined,
              planRevision: project.defenseWorkspace.planRevision,
              analysisError: null,
            },
          });
          const entityIdMap = new Map(sourceIdMap);

          for (const fact of project.defenseWorkspace.facts) {
            const createdFact = await tx.projectFact.create({
              data: {
                workspaceId: workspace.id,
                key: fact.key,
                statement: fact.statement,
                value: fact.value == null
                  ? undefined
                  : rewriteDefenseValue(
                    fact.value,
                    entityIdMap,
                    project.id,
                    destinationProjectId,
                    keyMap,
                  ) as Prisma.InputJsonValue,
                state: fact.state,
              },
            });
            entityIdMap.set(fact.id, createdFact.id);
            if (fact.evidence.length) {
              await tx.factEvidence.createMany({
                data: fact.evidence.map((evidence) => ({
                  factId: createdFact.id,
                  confirmation: evidence.confirmation,
                  sourceId: evidence.sourceId ? sourceIdMap.get(evidence.sourceId) ?? null : null,
                  locator: evidence.locator,
                  excerpt: evidence.excerpt,
                  confirmedById: evidence.confirmedById,
                  createdAt: evidence.createdAt,
                })),
              });
            }
          }

          for (const requirement of project.defenseWorkspace.requirements) {
            const createdRequirement = await tx.projectRequirement.create({
              data: {
                workspaceId: workspace.id,
                key: requirement.key,
                text: requirement.text,
                priority: requirement.priority,
                origin: requirement.origin,
                state: requirement.state,
                sourceId: requirement.sourceId ? sourceIdMap.get(requirement.sourceId) ?? null : null,
                locator: requirement.locator,
                excerpt: requirement.excerpt,
                rule: requirement.rule == null
                  ? undefined
                  : rewriteDefenseValue(
                    requirement.rule,
                    entityIdMap,
                    project.id,
                    destinationProjectId,
                    keyMap,
                  ) as Prisma.InputJsonValue,
                presetVersion: requirement.presetVersion,
              },
            });
            entityIdMap.set(requirement.id, createdRequirement.id);
          }

          for (const conflictItem of project.defenseWorkspace.conflicts) {
            const createdConflict = await tx.projectConflict.create({
              data: {
                workspaceId: workspace.id,
                kind: conflictItem.kind,
                summary: conflictItem.summary,
                options: rewriteDefenseValue(
                  conflictItem.options,
                  entityIdMap,
                  project.id,
                  destinationProjectId,
                  keyMap,
                ) as Prisma.InputJsonValue,
                state: conflictItem.state,
                resolution: conflictItem.resolution == null
                  ? undefined
                  : rewriteDefenseValue(
                    conflictItem.resolution,
                    entityIdMap,
                    project.id,
                    destinationProjectId,
                    keyMap,
                  ) as Prisma.InputJsonValue,
                resolvedById: conflictItem.resolvedById,
                resolvedAt: conflictItem.resolvedAt,
              },
            });
            entityIdMap.set(conflictItem.id, createdConflict.id);
          }

          if (project.defenseWorkspace.plan != null) {
            await tx.defenseWorkspace.update({
              where: { id: workspace.id },
              data: {
                plan: rewriteDefenseValue(
                  project.defenseWorkspace.plan,
                  entityIdMap,
                  project.id,
                  destinationProjectId,
                  keyMap,
                ) as Prisma.InputJsonValue,
              },
            });
          }
        }

        if (project.presentation) {
          const document = rewriteProjectDocument(
            project.presentation.document,
            keyMap,
            sourceIdMap,
            project.id,
            destinationProjectId,
          );
          await tx.presentation.create({
            data: {
              projectId: destinationProjectId,
              document: document as Prisma.InputJsonValue,
              revision: 1,
            },
          });
        }
      });
    } catch (error) {
      try {
        await this.storage.deleteProjectPrefix(destinationProjectId);
      } catch (cleanupError) {
        logger.error({
          destinationProjectId,
          ...errorLogFields(cleanupError),
        }, "could not clean up duplicate after database rollback");
      }
      throw error;
    }
    return this.getAccessible(userId, destinationProjectId);
  }

  async remove(userId: string, id: string) {
    await this.access.requireOwner(userId, id);
    await this.storage.deleteProjectPrefix(id);
    await this.prisma.project.delete({ where: { id } });
    return { id, deleted: true };
  }

  async enqueueNarration(userId: string, id: string) {
    return withTraceSpan("api.generation.enqueue", {
      "studydeck.project_id": id,
      "studydeck.stage": "generation.speech",
      "studydeck.job_kind": "narration",
    }, async () => {
      const access = await this.access.requireEditor(userId, id);
      const project = await this.getProjectDetail(id);
      if (project.workflow === "requirements_driven") {
        throw badRequest(
          "DEFENSE_PLAN_CONFIRMATION_REQUIRED",
          "Запускайте подготовку речи подтверждением плана защиты",
        );
      }
      await this.prisma.project.update({ where: { id: project.id }, data: { status: "script_queued", error: null } });
      const envelope = await this.createAitunnelEnvelope(project.id, "narration");
      const job = envelope.job;
      const queueJob = await this.generationQueue.add(
        "generate-narration",
        { projectId: project.id, userId: access.project.userId, generationJobId: job.id, costEnvelopeId: envelope.id, traceContext: injectTraceContext() },
        narrationJobOptions(),
      );
      await this.prisma.generationJob.update({ where: { id: job.id }, data: { queueJobId: queueJob.id } });
      void this.productAnalytics?.capture(access.project.userId, "generation_requested", { kind: "narration", retry: false });
      return { projectId: project.id, jobId: job.id, queueJobId: queueJob.id, status: "script_queued" };
    });
  }

  async updateNarrationDraft(userId: string, id: string, input: UpdateNarrationInput) {
    await this.access.requireEditor(userId, id);
    const project = await this.getProjectDetail(id);
    const nextStatus = project.status === "ready" ? project.status : "script_ready";
    const updated = await this.prisma.project.update({
      where: { id: project.id },
      data: {
        speechDraft: input.speechDraft,
        speechDraftUpdatedAt: new Date(),
        status: nextStatus,
        error: null,
      },
      include: { sources: true, presentation: true, jobs: { orderBy: { createdAt: "desc" }, take: 1 }, exports: true },
    });
    if (!input.accept) return { ...updated, accessRole: (await this.access.resolve(userId, id)).role, presentationRevision: updated.presentation?.revision ?? 0 };

    void this.productAnalytics?.capture(project.userId, "script_approved", {
      workflow: project.workflow,
      source_count: project.sources.length,
      unconfirmed_source_count: project.sources.filter((source) => !source.reviewedAt).length,
    });
    await this.enqueueGeneration(userId, id);
    return this.getAccessible(userId, id);
  }

  async enqueueGeneration(userId: string, id: string, input: GeneratePresentationInput = {}) {
    return withTraceSpan("api.generation.enqueue", {
      "studydeck.project_id": id,
      "studydeck.stage": "generation.slides",
      "studydeck.job_kind": "presentation",
    }, async () => {
      const access = await this.access.requireEditor(userId, id);
      let project = await this.getProjectDetail(id);
      if (project.workflow === "requirements_driven") {
        const workspace = await this.prisma.defenseWorkspace.findUnique({
          where: { projectId: project.id },
          select: { plan: true },
        });
        const plan = defensePlanSchema.safeParse(workspace?.plan);
        if (!plan.success || plan.data.status !== "approved") {
          throw badRequest(
            "DEFENSE_PLAN_NOT_APPROVED",
            "Подтвердите план защиты перед созданием презентации",
          );
        }
      }
      if (input.speechDraft !== undefined) {
        await this.prisma.project.update({
          where: { id },
          data: { speechDraft: input.speechDraft, speechDraftUpdatedAt: new Date(), status: "script_ready", error: null },
        });
        project = await this.getProjectDetail(id);
      }

      if (!project.speechDraft?.trim()) {
        throw new BadRequestException("Accept or save the speech text before generating the presentation");
      }
      if (project.presentation || project.status === "ready") {
        if (project.status !== "ready") {
          await this.prisma.project.update({ where: { id: project.id }, data: { status: "ready", error: null } });
        }
        return { projectId: project.id, status: "ready" };
      }
      const narrationAssessment = assessFullSpeechContract(project.speechDraft, project);
      if (narrationAssessment.applicable && !narrationAssessment.isAccepted) {
        throw badRequest(
          "NARRATION_DRAFT_REVIEW_REQUIRED",
          "Проверьте и сохраните текст выступления перед сборкой слайдов.",
        );
      }

      const envelope = await this.createAitunnelEnvelope(project.id, "presentation", access.project.userId);
      const job = envelope.job;
      if (envelope.existing) {
        const status = project.status === "generating" ? "generating" : "queued";
        if (project.status !== status) {
          await this.prisma.project.update({ where: { id: project.id }, data: { status, error: null } });
        }
        return { projectId: project.id, jobId: job.id, queueJobId: job.queueJobId, status };
      }

      await this.prisma.project.update({ where: { id: project.id }, data: { status: "queued", error: null } });
      let queueAccepted = false;
      try {
        const queueJob = await this.generationQueue.add(
          "generate-presentation",
          { projectId: project.id, userId: access.project.userId, generationJobId: job.id, costEnvelopeId: envelope.id, traceContext: injectTraceContext() },
          generationJobOptions(),
        );
        queueAccepted = true;
        await this.prisma.generationJob.update({ where: { id: job.id }, data: { queueJobId: queueJob.id } });
        void this.productAnalytics?.capture(access.project.userId, "generation_requested", {
          kind: "presentation",
          retry: Boolean(project.jobs.some((item) => item.kind === "presentation" && item.status === "failed")),
        });
        return { projectId: project.id, jobId: job.id, queueJobId: queueJob.id, status: "queued" };
      } catch (error) {
        // A queue rejection means nothing was launched, so the slot belongs
        // back to the user. Once BullMQ accepted the job it remains charged:
        // the worker will either complete it or perform the terminal refund.
        if (!queueAccepted) {
          await this.usage.releaseGenerationSlot(job.id).catch(() => undefined);
          await this.prisma.$transaction([
            this.prisma.generationJob.update({ where: { id: job.id }, data: { status: "failed", error: "queue_unavailable" } }),
            this.prisma.project.update({ where: { id: project.id }, data: { status: "script_ready", error: null } }),
          ]).catch(() => undefined);
        }
        throw error;
      }
    });
  }

  private async createAitunnelEnvelope(projectId: string, kind: "narration" | "presentation", ownerId?: string) {
    const policy = standardGenerationCostPolicy();
    return this.prisma.$transaction(async (tx) => {
      // This row lock serializes two browser tabs trying to launch the same
      // deck. The active-job read below therefore sees the first reservation.
      let slideCount: number | undefined;
      if (kind === "presentation") {
        const lockedProject = await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() }, select: { slideCount: true } });
        slideCount = lockedProject.slideCount;
        const active = await tx.generationJob.findFirst({
          where: { projectId, kind, status: { in: [...activePresentationJobStatuses] } },
          orderBy: { createdAt: "desc" },
        });
        if (active) return { id: undefined, job: active, existing: true };
      }
      const job = await tx.generationJob.create({ data: { projectId, kind, status: "queued" } });
      if (kind === "presentation" && ownerId) {
        await this.usage.reserveGenerationSlot(tx, ownerId, job.id, slideCount!);
      }
      if (process.env.AI_PROVIDER?.trim().toLowerCase() !== "aitunnel") {
        return { id: undefined, job, existing: false };
      }
      const priorAttemptEnvelopes = kind === "presentation"
        ? await tx.costEnvelope.findMany({
          // A failed presentation can exhaust its envelope after the source
          // snapshot was successfully captured. Include that failed
          // presentation envelope itself: it is the attempt group whose cap
          // and immutable snapshot must govern the retry.
          where: {
            projectId,
            OR: [
              { narrationJob: { is: { status: "completed" } } },
              { presentationJob: { is: { status: "failed" } } },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, policyVersion: true, sourceSnapshot: true, status: true, presentationJobId: true },
        })
        : [];
      // The envelope is the attempt group. A recovery job must retain this
      // identifier even after a prior presentation job exhausted it: creating
      // a replacement envelope would grant the same user run a fresh cap.
      const existing = priorAttemptEnvelopes.find((envelope) => envelope.policyVersion === policy.version) || null;
      const preservedSourceSnapshot = priorAttemptEnvelopes.find((envelope) => envelope.sourceSnapshot && typeof envelope.sourceSnapshot === "object")?.sourceSnapshot;
      // A pre-v8 narration envelope does not reserve the final Terra request.
      // Do not silently reuse it for slides: its old cap cannot safely govern
      // the post-narration provider path.
      if (existing) {
        // Keep the attempt-group envelope and its immutable snapshot, but
        // move the one-to-one presentation-job relation to the retry. The
        // worker's reservation keys include generationJobId, so this keeps
        // retry spend under the same cap without replaying prior settlement.
        const envelope = await tx.costEnvelope.update({ where: { id: existing.id }, data: { presentationJobId: job.id } });
        return { id: envelope.id, job, existing: false };
      }
      const envelope = await tx.costEnvelope.create({
        data: {
          projectId,
          policyVersion: policy.version,
          limitRub: policy.limitRub,
          policySnapshot: policy,
          catalogSnapshot: aitunnelCatalogSnapshot(),
          // A v7 narration run may already have paid to build the immutable
          // source snapshot. Preserve it when upgrading only its presentation
          // half to v8; do not repeat web research just for the envelope.
          ...(kind === "presentation" && preservedSourceSnapshot ? { sourceSnapshot: preservedSourceSnapshot } : {}),
          ...(kind === "narration" ? { narrationJobId: job.id } : { presentationJobId: job.id }),
        },
      });
      return { id: envelope.id, job, existing: false };
    });
  }

  async updateSourceReview(
    userId: string,
    projectId: string,
    sourceId: string,
    input: UpdateSourceReviewInput,
  ) {
    await this.access.requireEditor(userId, projectId);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { workflow: true },
    });
    if (project?.workflow === "requirements_driven") {
      throw badRequest(
        "DEFENSE_SOURCE_ENDPOINT_REQUIRED",
        "Для материалов защиты используйте маршрут /defense/assets: он сохраняет ревизии и актуальность плана.",
      );
    }
    const source = await this.prisma.source.findFirst({ where: { id: sourceId, projectId } });
    if (!source) throw new NotFoundException("Источник не найден");
    if (!input.included) {
      const includedCount = await this.prisma.source.count({ where: { projectId, included: true } });
      if (includedCount <= 1) {
        throw new BadRequestException("Оставьте хотя бы один источник для презентации");
      }
    }
    await this.prisma.source.update({ where: { id: sourceId }, data: { included: input.included, reviewedAt: new Date() } });
    const sources = await this.prisma.source.findMany({ where: { projectId }, select: { included: true, reviewedAt: true } });
    void this.productAnalytics?.capture(userId, "sources_reviewed", {
      source_count: sources.length,
      unconfirmed_source_count: sources.filter((item) => !item.reviewedAt).length,
      excluded_source_count: sources.filter((item) => !item.included).length,
      source_reviewed: true,
    });
    return this.getAccessible(userId, projectId);
  }

  async updateSlide(userId: string, projectId: string, slideId: string, input: UpdateSlideInput) {
    await this.access.requireEditor(userId, projectId);
    const presentation = await this.prisma.presentation.findUnique({ where: { projectId } });
    if (!presentation) throw new NotFoundException("Presentation not generated yet");
    if (presentation.revision !== input.expectedRevision) {
      throw revisionConflict(presentation.revision);
    }

    const document = ensureEditableCanvas(presentationSchema.parse(presentation.document) as PresentationDocument);
    const slide = document.slides.find((item) => item.id === slideId);
    if (!slide) throw new NotFoundException("Slide not found");
    if (input.title !== undefined) slide.title = input.title;
    if (input.thesis !== undefined) slide.thesis = input.thesis;
    if (input.bullets !== undefined) slide.bullets = input.bullets;
    if (input.layout !== undefined) slide.layout = input.layout;
    if (input.visual !== undefined) slide.visual = input.visual;
    if (input.blocks !== undefined) slide.blocks = input.blocks;
    if (input.canvas !== undefined) slide.canvas = slideCanvasSchema.parse(input.canvas);
    if (input.speakerNotes !== undefined) slide.speakerNotes = input.speakerNotes;
    const scriptItem = document.speechScript.find((item) => item.slideOrder === slide.order);
    if (scriptItem) {
      if (input.title !== undefined) scriptItem.slideTitle = input.title;
      if (input.speakerNotes !== undefined) scriptItem.text = input.speakerNotes;
    }
    // Text fields and generated canvas are two projections of one saved
    // document. Recompose only known generated art; a custom canvas remains
    // exactly as the editor authored it.
    if (input.canvas === undefined && (input.title !== undefined || input.thesis !== undefined || input.bullets !== undefined || input.layout !== undefined || input.visual !== undefined || input.blocks !== undefined)) {
      const theme = resolvePresentationTheme(document);
      if (!hasCustomSlideCanvas(slide, theme)) {
        slide.canvas = buildSlideCanvas(slide, theme, {
          designDirection: document.designBrief?.slideDirections.find((direction) => direction.slideOrder === slide.order),
        });
      }
    }

    const updated = await this.prisma.presentation.updateMany({
      where: { projectId, revision: input.expectedRevision },
      data: { document, revision: { increment: 1 } },
    });
    if (updated.count === 0) {
      const current = await this.prisma.presentation.findUnique({ where: { projectId }, select: { revision: true } });
      throw revisionConflict(current?.revision ?? input.expectedRevision + 1);
    }
    return this.getAccessible(userId, projectId);
  }

  async uploadSlideAsset(userId: string, projectId: string, slideId: string, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("No image uploaded");
    const contentType = cleanText(file.mimetype).toLowerCase();
    const extension = extensionFromContentType(contentType);
    if (!extension) throw new BadRequestException("Only PNG, JPEG and WEBP images are supported");

    const access = await this.access.requireEditor(userId, projectId);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { user: true, presentation: true },
    });
    if (!project) throw resourceNotFound("Презентация не найдена");
    if (!project.presentation) throw new NotFoundException("Presentation not generated yet");
    if (project.userId !== access.project.userId) throw resourceNotFound("Презентация не найдена");
    const entitlement = await this.usage.getPlan(project.userId);
    if (file.size > planLimits[entitlement.planCode].maxProjectBytes) {
      throw new BadRequestException("Image upload limit exceeded");
    }
    // Object storage is shared with workers and exports, so scan before the
    // first external write rather than relying on later asynchronous cleanup.
    await this.malwareScanner.scan(file.buffer, file.originalname || "slide-image");

    const document = ensureEditableCanvas(presentationSchema.parse(project.presentation.document) as PresentationDocument);
    const slide = document.slides.find((item) => item.id === slideId);
    if (!slide) throw new NotFoundException("Slide not found");
    const currentCanvas = slide.canvas;
    if (!currentCanvas) throw new BadRequestException("Slide canvas could not be created");

    const elementId = `image-${crypto.randomUUID()}`;
    const objectKey = `projects/${projectId}/slides/${slideId}/assets/${elementId}-${safeFileName(file.originalname || `image.${extension}`)}`;
    await this.getS3().send(new PutObjectCommand({
      Bucket: this.config.getOrThrow<string>("S3_BUCKET"),
      Key: objectKey,
      Body: file.buffer,
      ContentType: contentType,
    }));

    const nextZ = Math.max(1, ...currentCanvas.elements.map((element) => element.zIndex)) + 1;
    const element: CanvasImageElement = {
      id: elementId,
      type: "image",
      x: 760,
      y: 150,
      w: 380,
      h: 300,
      rotation: 0,
      zIndex: nextZ,
      opacity: 1,
      locked: false,
      url: `/api/projects/${projectId}/slides/${slideId}/assets/${elementId}`,
      objectKey,
      alt: file.originalname || "Uploaded image",
      contentType,
      fit: "cover",
    };
    slide.canvas = { ...currentCanvas, elements: [...currentCanvas.elements, element] };

    const saved = await this.prisma.presentation.updateMany({
      where: { projectId, revision: project.presentation.revision },
      data: { document, revision: { increment: 1 } },
    });
    if (saved.count === 0) {
      await this.storage.deleteObjectKey(objectKey);
      const current = await this.prisma.presentation.findUnique({ where: { projectId }, select: { revision: true } });
      throw revisionConflict(current?.revision ?? project.presentation.revision + 1);
    }
    return { element, presentationRevision: project.presentation.revision + 1 };
  }

  async getSlideAssetDownloadUrl(userId: string, projectId: string, slideId: string, elementId: string) {
    await this.access.requireViewer(userId, projectId);
    const presentation = await this.prisma.presentation.findUnique({ where: { projectId }, select: { document: true } });
    if (!presentation) throw new NotFoundException("Presentation not generated yet");
    const document = ensureEditableCanvas(presentationSchema.parse(presentation.document) as PresentationDocument);
    const slide = document.slides.find((item) => item.id === slideId);
    const element = slide?.canvas?.elements.find((item) => item.id === elementId && item.type === "image");
    const objectKey = elementId === "visual-image"
      ? slide?.visual.image?.objectKey
      : element?.type === "image" ? element.objectKey : undefined;
    if (!objectKey) throw new NotFoundException("Asset not found");
    const url = await getSignedUrl(
      this.getS3(),
      new GetObjectCommand({ Bucket: this.config.getOrThrow<string>("S3_BUCKET"), Key: objectKey }),
      { expiresIn: 60 * 5 },
    );
    return { url };
  }

  private async getProjectDetail(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, image: true } },
        folder: { select: { id: true, name: true, color: true } },
        sources: true,
        presentation: true,
        jobs: { orderBy: { createdAt: "desc" }, take: 1 },
        exports: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!project) throw resourceNotFound("Презентация не найдена");
    return project;
  }

  private async requireOwnerFolder(ownerId: string, folderId: string | null | undefined) {
    if (folderId == null) return;
    const folder = await this.prisma.folder.findFirst({ where: { id: folderId, ownerId }, select: { id: true } });
    if (!folder) throw resourceNotFound("Папка не найдена");
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

function publicProjectError(value: string | null, status: string, narrationState: PublicNarrationState | null) {
  if (!value) return null;
  if (narrationState === "source_preparation_failed" || narrationState === "narration_failed") {
    return publicNarrationFailureMessage(narrationState);
  }
  return safeGenerationRecovery(status === "failed" ? "unknown" : "transient").message;
}

function publicJobError(value: string | null, status: string) {
  if (!value) return null;
  if (isPublicNarrationState(value)) return null;
  return safeGenerationRecovery(status === "failed" ? "unknown" : "transient").message;
}

function publicNarrationState(project: {
  status: string;
  speechDraft: string | null;
  jobs: Array<{ kind: string; error: string | null }>;
}): PublicNarrationState | null {
  const latestNarrationJob = project.jobs.find((job) => job.kind === "narration");
  const persistedState = latestNarrationJob?.error;
  if (project.speechDraft?.trim()) {
    if (persistedState === "accepted_speech" || ["queued", "generating", "ready"].includes(project.status)) {
      return "accepted_speech";
    }
    return "editable_draft";
  }
  if (isPublicNarrationState(persistedState)) return persistedState;
  return project.status === "failed" ? "narration_failed" : null;
}

function revisionConflict(currentRevision: number) {
  return conflict("REVISION_CONFLICT", "Презентация изменилась в другой вкладке или другим участником", { currentRevision });
}

function duplicateStatus(project: { presentation: unknown; speechDraft: string | null }) {
  if (project.presentation) return "ready" as const;
  if (project.speechDraft?.trim()) return "script_ready" as const;
  return "draft" as const;
}

function rewriteProjectKey(value: string, sourceProjectId: string, destinationProjectId: string) {
  return value.replaceAll(`projects/${sourceProjectId}/`, `projects/${destinationProjectId}/`);
}

function rewriteDefenseValue(
  value: unknown,
  idMap: ReadonlyMap<string, string>,
  sourceProjectId: string,
  destinationProjectId: string,
  keyMap: ReadonlyMap<string, string>,
): unknown {
  if (typeof value === "string") {
    return idMap.get(value)
      ?? keyMap.get(value)
      ?? value
        .replaceAll(`projects/${sourceProjectId}/`, `projects/${destinationProjectId}/`)
        .replaceAll(`/api/projects/${sourceProjectId}/`, `/api/projects/${destinationProjectId}/`);
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteDefenseValue(item, idMap, sourceProjectId, destinationProjectId, keyMap));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      rewriteDefenseValue(nested, idMap, sourceProjectId, destinationProjectId, keyMap),
    ]),
  );
}

function extensionFromContentType(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/jpeg" || contentType === "image/jpg") return "jpg";
  if (contentType === "image/webp") return "webp";
  return "";
}

function safeFileName(value: string) {
  const extension = path.extname(value);
  const baseName = path.basename(value, extension).replace(/[^\w.-]+/g, "-").slice(0, 80) || "image";
  return `${baseName}${extension || ""}`.slice(0, 120);
}

function cleanText(value: unknown) {
  return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

function promptWithGenerationBrief(prompt: string, brief?: CreateProjectInput["generationBrief"]) {
  if (!brief) return prompt;
  const briefText = [
    "Creation brief:",
    `- audience: ${brief.audience}`,
    `- speechStyle: ${brief.speechStyle}`,
    `- slideDensity: ${brief.slideDensity}`,
    `- visualStrategy: ${brief.visualStrategy}`,
    `- exportTarget: ${brief.exportTarget}`,
  ].join("\n");
  return `${prompt.trim()}\n\n${briefText}`.slice(0, 12000);
}
