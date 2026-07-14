import { Injectable } from "@nestjs/common";
import { projectSummarySelect, toProjectSummary } from "../projects/project-summary.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { UsageService } from "../usage/usage.service.js";

export const ACTIVE_PROJECT_STATUSES = ["uploading", "script_queued", "script_generating", "queued", "generating"] as const;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
  ) {}

  async get(userId: string) {
    const user = await this.prisma.user.upsert({
      where: { id: userId },
      create: { id: userId },
      update: {},
      select: { id: true, name: true, image: true, telegramUsername: true, planCode: true },
    });
    const select = projectSummarySelect(userId);
    const [usage, presentationsCreated, readyStats, recentProjects, activeProjects, attentionProjects, sharedProjects] = await Promise.all([
      this.usage.getSummary(userId),
      this.prisma.project.count({ where: { userId } }),
      this.prisma.project.aggregate({
        where: { userId, status: "ready" },
        _count: { _all: true },
        _sum: { slideCount: true },
      }),
      this.prisma.project.findMany({
        where: { userId },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 5,
        select,
      }),
      this.prisma.project.findMany({
        where: {
          userId,
          status: { in: [...ACTIVE_PROJECT_STATUSES] },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 5,
        select,
      }),
      this.prisma.project.findMany({
        where: { userId, status: "failed" },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 5,
        select,
      }),
      this.prisma.project.findMany({
        where: { userId: { not: userId }, members: { some: { userId } } },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 5,
        select,
      }),
    ]);

    const readyPresentations = readyStats._count._all;
    return {
      user,
      usage,
      stats: {
        presentationsCreated,
        slidesCreated: readyStats._sum.slideCount ?? 0,
        readyPresentations,
        savedHoursMin: readyPresentations * 1.5,
        savedHoursMax: readyPresentations * 2,
      },
      recentProjects: recentProjects.map((project) => toProjectSummary(project, userId)),
      activeProjects: activeProjects.map((project) => toProjectSummary(project, userId)),
      attentionProjects: attentionProjects.map((project) => toProjectSummary(project, userId)),
      sharedProjects: sharedProjects.map((project) => toProjectSummary(project, userId)),
    };
  }
}
