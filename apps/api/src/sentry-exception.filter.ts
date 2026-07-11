import { ArgumentsHost, Catch, HttpException } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import type { HttpAdapterHost } from "@nestjs/core";
import crypto from "node:crypto";
import { captureApiError } from "./observability.js";
import { PrismaService } from "./prisma/prisma.service.js";

@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  constructor(applicationRef: HttpAdapterHost["httpAdapter"], private readonly prisma: PrismaService) {
    super(applicationRef);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<{ method?: string; route?: { path?: string }; url?: string }>();
    const statusCode = exception instanceof HttpException ? exception.getStatus() : 500;

    captureApiError(exception, {
      method: request?.method,
      path: sanitizeRequestPath(request?.route?.path || request?.url?.split("?")[0]),
      statusCode,
    });

    if (statusCode >= 500) {
      const message = exception instanceof Error ? exception.message.slice(0, 500) : "Внутренняя ошибка API";
      const errorClass = exception instanceof Error ? exception.name : typeof exception;
      const fingerprint = crypto.createHash("sha256").update(`api:${errorClass}:${request?.route?.path || request?.url || "unknown"}`).digest("hex");
      void this.prisma.operationalEvent.create({ data: {
        service: "api",
        severity: statusCode >= 503 ? "critical" : "error",
        category: "http_error",
        operation: request?.method,
        message,
        errorClass,
        httpStatus: statusCode,
        fingerprint,
        occurredAt: new Date(),
        expiresAt: new Date(Date.now() + 90 * 86_400_000),
      } }).catch(() => undefined);
    }

    super.catch(exception, host);
  }
}

function sanitizeRequestPath(path?: string) {
  return path?.replace(/\/invitations\/[^/]+/g, "/invitations/:token");
}
