import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import type { InternalRequest } from "./internal-auth.guard.js";

@Injectable()
export class BlockedUserGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<InternalRequest>();
    const user = await this.prisma.user.findUnique({
      where: { id: request.userId },
      select: { id: true, blockedAt: true, blockReason: true, lastSeenAt: true },
    });
    if (!user?.blockedAt) {
      const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
      if (user && (!user.lastSeenAt || user.lastSeenAt < staleBefore)) {
        void this.prisma.user.updateMany({
          where: { id: user.id, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: staleBefore } }] },
          data: { lastSeenAt: new Date() },
        });
      }
      return true;
    }
    throw new ForbiddenException({
      code: "USER_BLOCKED",
      message: "Аккаунт временно заблокирован. Обратитесь в поддержку.",
      details: { reason: user.blockReason || undefined },
    });
  }
}
