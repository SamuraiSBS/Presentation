import { Injectable } from "@nestjs/common";
import { badRequest } from "../errors/api-error.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ProjectStorageService } from "../storage/project-storage.service.js";
import { UsageService } from "../usage/usage.service.js";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ProjectStorageService,
    private readonly usage: UsageService,
  ) {}

  async getMe(userId: string) {
    const usage = await this.usage.getSummary(userId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        image: true,
        telegramId: true,
        telegramUsername: true,
        planCode: true,
        createdAt: true,
      },
    });
    return { ...user, usage };
  }

  async removeMe(userId: string, confirmation: unknown) {
    const confirmed = confirmation === true
      || (typeof confirmation === "string" && confirmation.trim().toUpperCase() === "УДАЛИТЬ");
    if (!confirmed) {
      throw badRequest("ACCOUNT_DELETION_NOT_CONFIRMED", "Подтвердите удаление аккаунта");
    }

    const projects = await this.prisma.project.findMany({ where: { userId }, select: { id: true } });
    for (const project of projects) {
      await this.storage.deleteProjectPrefix(project.id);
    }
    await this.prisma.user.delete({ where: { id: userId } });
    return { deleted: true };
  }
}
