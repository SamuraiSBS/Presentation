import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { devAuthAllowed } from "@studydeck/shared";

export type InternalRequest = Request & {
  userId: string;
};

@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<InternalRequest>();
    const devAuthEnabled = devAuthAllowed({
      ALLOW_DEV_AUTH: this.config.get<string>("ALLOW_DEV_AUTH"),
      DEPLOYMENT_ENV: this.config.get<string>("DEPLOYMENT_ENV"),
    });
    const expected = this.config.get<string>("INTERNAL_API_TOKEN");
    const actual = request.header("x-internal-token");
    const userId = request.header("x-user-id");

    if (devAuthEnabled) {
      request.userId = userId || this.config.get<string>("TEMP_USER_ID") || "local-user";
      return true;
    }

    if (!expected || actual !== expected || !userId) {
      throw new UnauthorizedException("Invalid internal API credentials");
    }

    request.userId = userId;
    return true;
  }
}
