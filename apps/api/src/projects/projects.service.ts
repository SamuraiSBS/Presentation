import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import {
  type CreateProjectInput,
  type PresentationDocument,
  type UpdateSlideInput,
  planLimits,
  presentationSchema,
} from "@studydeck/shared";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
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
        prompt: input.prompt,
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

  async enqueueGeneration(userId: string, id: string) {
    const project = await this.getOwned(userId, id);
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
    const job = await this.prisma.generationJob.create({ data: { projectId: project.id, status: "queued" } });
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

    const document = presentationSchema.parse(project.presentation.document) as PresentationDocument;
    const slide = document.slides.find((item) => item.id === slideId);
    if (!slide) throw new NotFoundException("Slide not found");

    if (input.title !== undefined) slide.title = input.title;
    if (input.blocks !== undefined) slide.blocks = input.blocks;
    if (input.speakerNotes !== undefined) slide.speakerNotes = input.speakerNotes;

    return this.prisma.presentation.update({
      where: { projectId },
      data: { document },
    });
  }
}
