import { Injectable } from "@nestjs/common";
import { forbidden, projectNotFound } from "../errors/api-error.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { ProjectAccess } from "./project-access.types.js";

@Injectable()
export class ProjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(userId: string, projectId: string): Promise<ProjectAccess> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        userId: true,
        members: {
          where: { userId },
          select: { role: true },
          take: 1,
        },
      },
    });

    if (!project) throw projectNotFound();
    if (project.userId === userId) {
      return { project: { id: project.id, userId: project.userId }, role: "owner" };
    }

    const membership = project.members[0];
    if (!membership) throw projectNotFound();
    return { project: { id: project.id, userId: project.userId }, role: membership.role };
  }

  requireViewer(userId: string, projectId: string) {
    return this.resolve(userId, projectId);
  }

  async requireEditor(userId: string, projectId: string) {
    const access = await this.resolve(userId, projectId);
    if (access.role === "viewer") throw forbidden();
    return access;
  }

  async requireOwner(userId: string, projectId: string) {
    const access = await this.resolve(userId, projectId);
    if (access.role !== "owner") throw forbidden();
    return access;
  }
}
