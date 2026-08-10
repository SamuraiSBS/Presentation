import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { productionConfigurationErrors, workerHeartbeatKey, workerHeartbeatMaxAgeMs } from "@studydeck/shared";
import type { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service.js";
import { HealthStorageService } from "./health-storage.service.js";

type Check = { ok: true } | { ok: false; error: string };
type QueueLag = { waiting: number; active: number; delayed: number; oldestWaitingMs: number | null };

const REQUIRED_RUNTIME_VALUES = [
  "DATABASE_URL",
  "REDIS_URL",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: HealthStorageService,
    @InjectQueue("generation") private readonly generationQueue: Queue,
    @InjectQueue("exports") private readonly exportsQueue: Queue,
    @InjectQueue("admin-maintenance") private readonly maintenanceQueue: Queue,
  ) {}

  live() {
    return { ok: true, service: "studydeck-api", status: "live", at: new Date().toISOString() };
  }

  async ready() {
    const checks = {
      configuration: this.configuration(),
      database: await this.check("database is unavailable", () => this.prisma.$queryRaw`SELECT 1`),
      migrations: await this.check("migration validation failed", async () => {
        const rows = await this.prisma.$queryRaw<Array<{ pending: number | bigint }>>`
          SELECT COUNT(*)::int AS pending
          FROM "_prisma_migrations"
          WHERE finished_at IS NULL AND rolled_back_at IS NULL
        `;
        if (Number(rows[0]?.pending || 0) !== 0) throw new Error("an unfinished migration exists");
      }),
      storage: await this.check("storage is unavailable", () => this.storage.check()),
      queues: await this.checkQueues(),
      worker: await this.workerHeartbeat(),
    };
    const ok = Object.values(checks).every((check) => check.ok);
    return {
      ok,
      service: "studydeck-api",
      status: ok ? "ready" : "not_ready",
      at: new Date().toISOString(),
      checks,
    };
  }

  async workers() {
    const [heartbeat, queues] = await Promise.all([this.workerHeartbeat(), this.checkQueues()]);
    const ok = heartbeat.ok && queues.ok;
    return {
      ok,
      service: "studydeck-api",
      status: ok ? "ready" : "not_ready",
      at: new Date().toISOString(),
      checks: { worker: heartbeat, queues },
    };
  }

  private configuration(): Check {
    const missing = REQUIRED_RUNTIME_VALUES.filter((key) => !this.config.get<string>(key)?.trim());
    const productionErrors = productionConfigurationErrors(process.env);
    if (missing.length || productionErrors.length) {
      return { ok: false, error: "required runtime configuration is invalid" };
    }
    return { ok: true };
  }

  private async check(errorMessage: string, operation: () => Promise<unknown>): Promise<Check> {
    try {
      await operation();
      return { ok: true };
    } catch {
      return { ok: false, error: errorMessage };
    }
  }

  private async checkQueues(): Promise<Check & { lag?: Record<string, QueueLag> }> {
    try {
      const lag = Object.fromEntries(await Promise.all([
        this.queueLag("generation", this.generationQueue),
        this.queueLag("exports", this.exportsQueue),
        this.queueLag("admin-maintenance", this.maintenanceQueue),
      ]));
      return { ok: true, lag };
    } catch {
      return { ok: false, error: "queue connectivity check failed" };
    }
  }

  private async queueLag(name: string, queue: Queue): Promise<[string, QueueLag]> {
    const [counts, waiting] = await Promise.all([queue.getJobCounts(), queue.getWaiting(0, 0)]);
    const oldest = waiting[0];
    return [name, {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      delayed: counts.delayed || 0,
      oldestWaitingMs: oldest ? Math.max(0, Date.now() - oldest.timestamp) : null,
    }];
  }

  private async workerHeartbeat(): Promise<Check & { ageMs?: number }> {
    try {
      const rawHeartbeat = await this.generationQueue.client.then((client) => client.get(workerHeartbeatKey));
      const heartbeatAt = Number(rawHeartbeat);
      const ageMs = Number.isFinite(heartbeatAt) ? Math.max(0, Date.now() - heartbeatAt) : Number.POSITIVE_INFINITY;
      if (ageMs > workerHeartbeatMaxAgeMs) return { ok: false, error: "worker heartbeat is stale" };
      return { ok: true, ageMs };
    } catch {
      return { ok: false, error: "worker heartbeat check failed" };
    }
  }
}
