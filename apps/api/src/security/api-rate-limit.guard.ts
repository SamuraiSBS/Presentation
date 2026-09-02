import { createHash } from "node:crypto";
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { Redis } from "ioredis";
import { isLocalGenerationUnlimited } from "../runtime/local-generation.js";

type RateLimitProfile = "general" | "upload" | "generation" | "export" | "invite" | "billing";

const profileConfiguration: Record<RateLimitProfile, { env: string; fallback: number }> = {
  general: { env: "API_RATE_LIMIT_MAX", fallback: 120 },
  upload: { env: "API_RATE_LIMIT_UPLOAD_MAX", fallback: 12 },
  generation: { env: "API_RATE_LIMIT_GENERATION_MAX", fallback: 6 },
  export: { env: "API_RATE_LIMIT_EXPORT_MAX", fallback: 12 },
  invite: { env: "API_RATE_LIMIT_INVITE_MAX", fallback: 20 },
  billing: { env: "API_RATE_LIMIT_BILLING_MAX", fallback: 10 },
};

const incrementWithExpiry = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
  return current
`;

export function rateLimitProfileFor(pathname: string, method: string): RateLimitProfile {
  if (method === "POST" && /\/projects\/[^/]+\/(?:uploads|defense\/uploads)$/.test(pathname)) return "upload";
  if (method === "POST" && /\/projects\/[^/]+\/slides\/[^/]+\/assets$/.test(pathname)) return "upload";
  if (method === "POST" && /\/projects\/[^/]+\/(?:generate|narration)$/.test(pathname)) return "generation";
  if (method === "POST" && /\/projects\/[^/]+\/defense\/(?:analyze|plan\/rebuild|compliance-checks)$/.test(pathname)) return "generation";
  if (method === "POST" && /\/projects\/[^/]+\/exports(?:$|\/)/.test(pathname)) return "export";
  if (method === "POST" && /\/invitations(?:$|\/)/.test(pathname)) return "invite";
  if (method === "POST" && pathname.startsWith("/v1/billing/")) return "billing";
  return "general";
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function requestPath(request: Request) {
  const raw = request.originalUrl || request.url || "/";
  return raw.split("?", 1)[0] || "/";
}

function stableIdentifier(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

@Injectable()
export class ApiRateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly redis: Redis;

  constructor(private readonly config: ConfigService) {
    this.redis = new Redis(this.config.get<string>("REDIS_URL") || "redis://localhost:6379", {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(1_000, 50 * attempt),
    });
    // Redis connection errors are handled as explicit 503 responses below. An
    // error listener prevents ioredis from treating an expected reconnect as an
    // unhandled process-level error.
    this.redis.on("error", () => undefined);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const pathname = requestPath(request);
    if (request.method === "OPTIONS" || pathname.startsWith("/v1/health")) return true;

    const profile = rateLimitProfileFor(pathname, request.method);
    if (profile === "generation" && isLocalGenerationUnlimited(this.config)) return true;
    const windowMs = positiveInteger(this.config.get<string>("API_RATE_LIMIT_WINDOW_MS"), 60_000);
    const userLimit = positiveInteger(this.config.get<string>(profileConfiguration[profile].env), profileConfiguration[profile].fallback);
    const ipMultiplier = positiveInteger(this.config.get<string>("API_RATE_LIMIT_IP_MULTIPLIER"), 3);
    const userId = request.header("x-user-id")?.trim();
    const ip = (request.ip || request.socket.remoteAddress || "unknown").trim();
    const buckets = [
      { name: `ip:${stableIdentifier(ip)}`, limit: userLimit * ipMultiplier },
      ...(userId && userId.length <= 256 ? [{ name: `user:${stableIdentifier(userId)}`, limit: userLimit }] : []),
    ];

    for (const bucket of buckets) {
      await this.consume(context, profile, bucket.name, bucket.limit, windowMs);
    }
    return true;
  }

  async onModuleDestroy() {
    this.redis.disconnect();
  }

  private async consume(
    context: ExecutionContext,
    profile: RateLimitProfile,
    identity: string,
    limit: number,
    windowMs: number,
  ) {
    const key = `studydeck:rate-limit:v1:${profile}:${identity}`;
    let count: number;
    try {
      count = Number(await this.redis.eval(incrementWithExpiry, 1, key, String(windowMs)));
    } catch {
      throw new HttpException(
        { statusCode: HttpStatus.SERVICE_UNAVAILABLE, code: "RATE_LIMIT_STORE_UNAVAILABLE", message: "Request protection is temporarily unavailable" },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (count <= limit) return;
    const retryAfterMs = Math.max(1_000, await this.redis.pttl(key).catch(() => windowMs));
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1_000)));
    response.setHeader("X-RateLimit-Limit", String(limit));
    response.setHeader("X-RateLimit-Remaining", "0");
    throw new HttpException(
      { statusCode: HttpStatus.TOO_MANY_REQUESTS, code: "RATE_LIMITED", message: "Too many requests" },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
