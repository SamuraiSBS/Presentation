import crypto from "node:crypto";
import path from "node:path";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Queue } from "bullmq";
import {
  type CanvasImageElement,
  type CreateProjectInput,
  type GeneratePresentationInput,
  type PresentationDocument,
  type UpdateNarrationInput,
  type UpdateSlideInput,
  ensureEditableCanvas,
  planLimits,
  presentationSchema,
  slideCanvasSchema,
} from "@studydeck/shared";
import { PrismaService } from "../prisma/prisma.service.js";

const activePresentationJobStatuses = ["queued", "active"] as const;

@Injectable()
export class ProjectsService {
  private s3Client?: S3Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue("generation") private readonly generationQueue: Queue,
  ) {}

  async list(userId: string) {
    return this.prisma.project.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: { presentation: true, sources: true, exports: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
  }

  async create(userId: string, input: CreateProjectInput) {
    const user = await this.prisma.user.upsert({
      where: { id: userId },
      create: { id: userId },
      update: {},
    });
    const limit = planLimits[user.planCode];
    if (input.slideCount > limit.maxSlides) {
      throw new BadRequestException(`Your plan allows up to ${limit.maxSlides} slides`);
    }

    return this.prisma.project.create({
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
  }

  async getOwned(userId: string, id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, userId },
      include: { sources: true, presentation: true, jobs: { orderBy: { createdAt: "desc" }, take: 1 }, exports: true },
    });

    if (!project) throw new NotFoundException("Project not found");
    return project;
  }

  async enqueueNarration(userId: string, id: string) {
    const project = await this.getOwned(userId, id);
    await this.prisma.project.update({ where: { id: project.id }, data: { status: "script_queued", error: null } });
    const job = await this.prisma.generationJob.create({
      data: { projectId: project.id, kind: "narration", status: "queued" },
    });
    const queueJob = await this.generationQueue.add("generate-narration", { projectId: project.id, userId }, { attempts: 2 });

    await this.prisma.generationJob.update({ where: { id: job.id }, data: { queueJobId: queueJob.id } });

    return { projectId: project.id, jobId: job.id, queueJobId: queueJob.id, status: "script_queued" };
  }

  async updateNarrationDraft(userId: string, id: string, input: UpdateNarrationInput) {
    const project = await this.getOwned(userId, id);
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

    if (!input.accept) {
      return updated;
    }

    await this.enqueueGeneration(userId, id);
    return this.getOwned(userId, id);
  }

  async enqueueGeneration(userId: string, id: string, input: GeneratePresentationInput = {}) {
    let project = await this.getOwned(userId, id);
    if (input.speechDraft !== undefined) {
      project = await this.updateNarrationDraft(userId, id, { speechDraft: input.speechDraft, accept: false });
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
      where: {
        projectId: project.id,
        kind: "presentation",
        status: { in: [...activePresentationJobStatuses] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (activeJob) {
      const status = project.status === "generating" ? "generating" : "queued";
      if (project.status !== status) {
        await this.prisma.project.update({ where: { id: project.id }, data: { status, error: null } });
      }
      return { projectId: project.id, jobId: activeJob.id, queueJobId: activeJob.queueJobId, status };
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const period = new Date().toISOString().slice(0, 7);
    const usage = await this.prisma.usageCounter.upsert({
      where: { userId_period: { userId, period } },
      create: { userId, period },
      update: {},
    });
    const limit = planLimits[user.planCode];

    if (usage.generated >= limit.monthlyPresentations) {
      throw new BadRequestException("Monthly generation limit reached");
    }

    await this.prisma.project.update({ where: { id: project.id }, data: { status: "queued", error: null } });
    const job = await this.prisma.generationJob.create({
      data: { projectId: project.id, kind: "presentation", status: "queued" },
    });
    const queueJob = await this.generationQueue.add("generate-presentation", { projectId: project.id, userId }, { attempts: 2 });

    await this.prisma.generationJob.update({ where: { id: job.id }, data: { queueJobId: queueJob.id } });
    await this.prisma.usageCounter.update({
      where: { userId_period: { userId, period } },
      data: { generated: { increment: 1 } },
    });

    return { projectId: project.id, jobId: job.id, queueJobId: queueJob.id, status: "queued" };
  }

  async updateSlide(userId: string, projectId: string, slideId: string, input: UpdateSlideInput) {
    const project = await this.getOwned(userId, projectId);
    if (!project.presentation) throw new NotFoundException("Presentation not generated yet");

    const document = ensureEditableCanvas(presentationSchema.parse(project.presentation.document) as PresentationDocument);
    const slide = document.slides.find((item) => item.id === slideId);
    if (!slide) throw new NotFoundException("Slide not found");

    if (input.title !== undefined) slide.title = input.title;
    if (input.layout !== undefined) slide.layout = input.layout;
    if (input.visual !== undefined) slide.visual = input.visual;
    if (input.blocks !== undefined) slide.blocks = input.blocks;
    if (input.canvas !== undefined) slide.canvas = slideCanvasSchema.parse(input.canvas);
    if (input.speakerNotes !== undefined) slide.speakerNotes = input.speakerNotes;

    return this.prisma.presentation.update({
      where: { projectId },
      data: { document },
    });
  }

  async uploadSlideAsset(userId: string, projectId: string, slideId: string, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("No image uploaded");
    const contentType = cleanText(file.mimetype).toLowerCase();
    const extension = extensionFromContentType(contentType);
    if (!extension) throw new BadRequestException("Only PNG, JPEG and WEBP images are supported");

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      include: { user: true, presentation: true },
    });
    if (!project) throw new NotFoundException("Project not found");
    if (!project.presentation) throw new NotFoundException("Presentation not generated yet");
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
    await this.getS3().send(
      new PutObjectCommand({
        Bucket: this.config.getOrThrow<string>("S3_BUCKET"),
        Key: objectKey,
        Body: file.buffer,
        ContentType: contentType,
      }),
    );

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

    slide.canvas = {
      ...currentCanvas,
      elements: [...currentCanvas.elements, element],
    };

    await this.prisma.presentation.update({ where: { projectId }, data: { document } });
    return { element };
  }

  async getSlideAssetDownloadUrl(userId: string, projectId: string, slideId: string, elementId: string) {
    const project = await this.getOwned(userId, projectId);
    if (!project.presentation) throw new NotFoundException("Presentation not generated yet");

    const document = ensureEditableCanvas(presentationSchema.parse(project.presentation.document) as PresentationDocument);
    const slide = document.slides.find((item) => item.id === slideId);
    const element = slide?.canvas?.elements.find((item) => item.id === elementId && item.type === "image");
    const objectKey = elementId === "visual-image"
      ? slide?.visual.image?.objectKey
      : element?.type === "image"
        ? element.objectKey
        : undefined;
    if (!objectKey) throw new NotFoundException("Asset not found");

    const url = await getSignedUrl(
      this.getS3(),
      new GetObjectCommand({
        Bucket: this.config.getOrThrow<string>("S3_BUCKET"),
        Key: objectKey,
      }),
      { expiresIn: 60 * 5 },
    );

    return { url };
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
