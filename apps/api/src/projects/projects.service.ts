import crypto from "node:crypto";
import path from "node:path";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
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
  type UpdateSlideInput,
  ensureEditableCanvas,
  planLimits,
  presentationSchema,
  slideCanvasSchema,
} from "@studydeck/shared";
import { ProjectAccessService } from "../access/project-access.service.js";
import { conflict, resourceNotFound } from "../errors/api-error.js";
import { generationJobOptions } from "../jobs/job-options.js";
import { errorLogFields, injectTraceContext, logger, withTraceSpan } from "../observability.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ProjectStorageService, rewriteProjectDocument } from "../storage/project-storage.service.js";
import { UsageService } from "../usage/usage.service.js";
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
    return withTraceSpan("api.project.create", {
      "studydeck.stage": "project_create",
      "studydeck.slide_count": input.slideCount,
      "studydeck.mode": input.mode,
    }, async () => this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { id: userId },
        create: { id: userId },
        update: {},
        select: { planCode: true },
      });
      const limit = planLimits[user.planCode];
      if (input.slideCount > limit.maxSlides) {
        throw new BadRequestException(`Your plan allows up to ${limit.maxSlides} slides`);
      }
      await this.usage.reserveCreationSlot(tx, userId);
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
  }

  async getAccessible(userId: string, id: string) {
    const access = await this.access.requireViewer(userId, id);
    const project = await this.getProjectDetail(id);
    return {
      ...project,
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
      include: { sources: true, presentation: true },
    });
    const folderId = input.folderId !== undefined ? input.folderId : project.folderId;
    await this.requireOwnerFolder(access.project.userId, folderId);

    const destinationProjectId = crypto.randomUUID();
    const keyMap = await this.storage.copyProjectPrefix(project.id, destinationProjectId);
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.usage.reserveCreationSlot(tx, access.project.userId);
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
              size: source.size,
              objectKey: source.objectKey ? keyMap.get(source.objectKey) ?? rewriteProjectKey(source.objectKey, project.id, destinationProjectId) : null,
              url: source.url,
              excerpt: source.excerpt,
              text: source.text,
            },
            select: { id: true },
          });
          sourceIdMap.set(source.id, created.id);
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
      await this.prisma.project.update({ where: { id: project.id }, data: { status: "script_queued", error: null } });
      const job = await this.prisma.generationJob.create({
        data: { projectId: project.id, kind: "narration", status: "queued" },
      });
      const queueJob = await this.generationQueue.add(
        "generate-narration",
        { projectId: project.id, userId: access.project.userId, traceContext: injectTraceContext() },
        generationJobOptions(),
      );
      await this.prisma.generationJob.update({ where: { id: job.id }, data: { queueJobId: queueJob.id } });
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

      const activeJob = await this.prisma.generationJob.findFirst({
        where: { projectId: project.id, kind: "presentation", status: { in: [...activePresentationJobStatuses] } },
        orderBy: { createdAt: "desc" },
      });
      if (activeJob) {
        const status = project.status === "generating" ? "generating" : "queued";
        if (project.status !== status) {
          await this.prisma.project.update({ where: { id: project.id }, data: { status, error: null } });
        }
        return { projectId: project.id, jobId: activeJob.id, queueJobId: activeJob.queueJobId, status };
      }

      await this.prisma.project.update({ where: { id: project.id }, data: { status: "queued", error: null } });
      const job = await this.prisma.generationJob.create({
        data: { projectId: project.id, kind: "presentation", status: "queued" },
      });
      const queueJob = await this.generationQueue.add(
        "generate-presentation",
        { projectId: project.id, userId: access.project.userId, traceContext: injectTraceContext() },
        generationJobOptions(),
      );
      await this.prisma.generationJob.update({ where: { id: job.id }, data: { queueJobId: queueJob.id } });
      return { projectId: project.id, jobId: job.id, queueJobId: queueJob.id, status: "queued" };
    });
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
    if (file.size > planLimits[project.user.planCode].maxProjectBytes) {
      throw new BadRequestException("Image upload limit exceeded");
    }

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
