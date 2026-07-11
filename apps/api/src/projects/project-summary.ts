import { Prisma } from "@prisma/client";
import type { ProjectAccessRole, ProjectSummary } from "@studydeck/shared";

export function projectSummarySelect(userId: string) {
  return Prisma.validator<Prisma.ProjectSelect>()({
    id: true,
    userId: true,
    title: true,
    status: true,
    slideCount: true,
    updatedAt: true,
    createdAt: true,
    error: true,
    user: { select: { id: true, name: true, image: true } },
    folder: { select: { id: true, name: true, color: true } },
    presentation: { select: { id: true } },
    exports: {
      orderBy: { createdAt: "desc" },
      take: 1,
      select: { id: true, type: true, status: true },
    },
    members: {
      where: { userId },
      take: 1,
      select: { role: true },
    },
    _count: { select: { members: true } },
  });
}

export type ProjectSummaryRow = Prisma.ProjectGetPayload<{
  select: ReturnType<typeof projectSummarySelect>;
}>;

export function toProjectSummary(project: ProjectSummaryRow, userId: string): ProjectSummary {
  const accessRole: ProjectAccessRole = project.userId === userId
    ? "owner"
    : project.members[0]?.role ?? "viewer";
  const latestExport = project.exports[0] ?? null;

  return {
    id: project.id,
    title: project.title,
    status: project.status,
    slideCount: project.slideCount,
    updatedAt: project.updatedAt.toISOString(),
    createdAt: project.createdAt.toISOString(),
    error: project.error,
    accessRole,
    owner: project.user,
    folder: project.folder,
    hasPresentation: Boolean(project.presentation),
    latestExport,
    memberCount: project._count.members,
  };
}
