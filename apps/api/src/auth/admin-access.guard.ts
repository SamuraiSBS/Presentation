import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service.js";
import type { InternalRequest } from "./internal-auth.guard.js";

@Injectable()
export class AdminAccessGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<InternalRequest>();
    if (this.devAccessAllowed()) return true;

    const allowedIds = new Set(
      (this.config.get<string>("ADMIN_TELEGRAM_IDS") || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    if (!allowedIds.size || !request.userId) throw this.forbidden();

    const user = await this.prisma.user.findUnique({
      where: { id: request.userId },
      select: { telegramId: true },
    });
    if (!user?.telegramId || !allowedIds.has(user.telegramId)) throw this.forbidden();
    return true;
  }

  private devAccessAllowed() {
    if (this.config.get<string>("ALLOW_DEV_ADMIN") !== "true") return false;
    const marker = (this.config.get<string>("DEPLOYMENT_ENV") || "").toLowerCase();
    return marker !== "production";
  }

  private forbidden() {
    return new ForbiddenException({
      code: "ADMIN_ACCESS_DENIED",
      message: "Доступ к административной панели запрещён",
    });
  }
}
