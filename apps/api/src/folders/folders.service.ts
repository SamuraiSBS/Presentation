import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateFolderInput, UpdateFolderInput } from "@studydeck/shared";
import { conflict, resourceNotFound } from "../errors/api-error.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class FoldersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const [ownedFolders, sharedProjects] = await Promise.all([
      this.prisma.folder.findMany({
        where: { ownerId: userId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          color: true,
          sortOrder: true,
          owner: { select: { id: true, name: true, image: true } },
          _count: { select: { projects: true } },
        },
      }),
      this.prisma.project.findMany({
        where: {
          userId: { not: userId },
          folderId: { not: null },
          members: { some: { userId } },
        },
        select: {
          folder: {
            select: {
              id: true,
              name: true,
              color: true,
              sortOrder: true,
              owner: { select: { id: true, name: true, image: true } },
            },
          },
        },
      }),
    ]);

    type FolderListItem = {
      id: string;
      name: string;
      color: (typeof ownedFolders)[number]["color"];
      sortOrder: number;
      projectCount: number;
      owner: (typeof ownedFolders)[number]["owner"];
      isShared: boolean;
      scope: "mine" | "shared";
    };

    const items: FolderListItem[] = ownedFolders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      color: folder.color,
      sortOrder: folder.sortOrder,
      projectCount: folder._count.projects,
      owner: folder.owner,
      isShared: false,
      scope: "mine" as const,
    }));

    const sharedByFolder = new Map<string, FolderListItem>();
    for (const project of sharedProjects) {
      const folder = project.folder;
      if (!folder) continue;
      const existing = sharedByFolder.get(folder.id);
      if (existing) {
        existing.projectCount += 1;
      } else {
        sharedByFolder.set(folder.id, {
          id: folder.id,
          name: folder.name,
          color: folder.color,
          sortOrder: folder.sortOrder,
          projectCount: 1,
          owner: folder.owner,
          isShared: true,
          scope: "shared",
        });
      }
    }

    const sharedItems = [...sharedByFolder.values()].sort((left, right) =>
      left.name.localeCompare(right.name, "ru"));
    return { items: [...items, ...sharedItems] };
  }

  async create(userId: string, input: CreateFolderInput) {
    await this.prisma.user.upsert({ where: { id: userId }, create: { id: userId }, update: {} });
    try {
      const folder = await this.prisma.folder.create({
        data: { ownerId: userId, name: input.name, color: input.color },
        select: {
          id: true,
          name: true,
          color: true,
          sortOrder: true,
          owner: { select: { id: true, name: true, image: true } },
        },
      });
      return { ...folder, projectCount: 0, isShared: false, scope: "mine" as const };
    } catch (error) {
      throwFolderConflict(error);
    }
  }

  async update(userId: string, folderId: string, input: UpdateFolderInput) {
    await this.requireOwnedFolder(userId, folderId);
    try {
      const folder = await this.prisma.folder.update({
        where: { id: folderId },
        data: input,
        select: {
          id: true,
          name: true,
          color: true,
          sortOrder: true,
          owner: { select: { id: true, name: true, image: true } },
          _count: { select: { projects: true } },
        },
      });
      return {
        id: folder.id,
        name: folder.name,
        color: folder.color,
        sortOrder: folder.sortOrder,
        owner: folder.owner,
        projectCount: folder._count.projects,
        isShared: false,
        scope: "mine" as const,
      };
    } catch (error) {
      throwFolderConflict(error);
    }
  }

  async remove(userId: string, folderId: string) {
    await this.requireOwnedFolder(userId, folderId);
    await this.prisma.$transaction([
      this.prisma.project.updateMany({ where: { folderId }, data: { folderId: null } }),
      this.prisma.folder.delete({ where: { id: folderId } }),
    ]);
    return { id: folderId };
  }

  private async requireOwnedFolder(userId: string, folderId: string) {
    const folder = await this.prisma.folder.findFirst({ where: { id: folderId, ownerId: userId }, select: { id: true } });
    if (!folder) throw resourceNotFound("Папка не найдена");
    return folder;
  }
}

function throwFolderConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw conflict("FOLDER_NAME_CONFLICT", "Папка с таким названием уже существует");
  }
  throw error;
}
