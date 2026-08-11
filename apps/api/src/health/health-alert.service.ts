import crypto from "node:crypto";
import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { logger } from "../observability.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { HealthService } from "./health.service.js";

type QueueLag = { waiting: number; oldestWaitingMs: number | null };

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_REMINDER_MS = 15 * 60_000;
const DEFAULT_MAX_QUEUE_AGE_MS = 5 * 60_000;
const DEFAULT_MAX_QUEUE_WAITING = 20;

/**
 * Runs in the API process, rather than in the worker, so a stopped worker can
 * still be detected and reported. It is deliberately disabled outside a fully
 * configured production alert channel.
 */
@Injectable()
export class HealthAlertService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly health: HealthService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    if (!this.enabled()) return;
    void this.checkOnce();
    this.timer = setInterval(() => void this.checkOnce(), this.positiveNumber("HEALTH_ALERT_INTERVAL_MS", DEFAULT_INTERVAL_MS));
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async checkOnce() {
    if (!this.enabled()) return;

    try {
      const readiness = await this.health.ready();
      if (!readiness.ok) {
        const failedChecks = Object.entries(readiness.checks)
          .filter(([, check]) => !check.ok)
          .map(([name]) => name)
          .join(", ");
        await this.sendAlert("health-readiness", `Readiness returned 503: ${failedChecks || "unknown dependency"}.`);
      }

      const worker = readiness.checks.worker;
      if (!worker.ok) {
        await this.sendAlert("health-worker-heartbeat", "Worker heartbeat is stale or unavailable.");
      }

      const queues = readiness.checks.queues;
      if (queues.ok && queues.lag) {
        const maxAgeMs = this.positiveNumber("HEALTH_QUEUE_LAG_MAX_AGE_MS", DEFAULT_MAX_QUEUE_AGE_MS);
        const maxWaiting = this.positiveNumber("HEALTH_QUEUE_WAITING_MAX", DEFAULT_MAX_QUEUE_WAITING);
        for (const [name, lag] of Object.entries(queues.lag as Record<string, QueueLag>)) {
          if (lag.waiting >= maxWaiting || (lag.oldestWaitingMs !== null && lag.oldestWaitingMs >= maxAgeMs)) {
            await this.sendAlert(
              `health-queue-lag:${name}`,
              `Queue ${name} breached its SLO: waiting=${lag.waiting}, oldestWaitingMs=${lag.oldestWaitingMs ?? "none"}.`,
            );
          }
        }
      }
    } catch (error) {
      logger.warn({ errorName: error instanceof Error ? error.name : typeof error }, "health alert check failed");
    }
  }

  private enabled() {
    return this.config.get<string>("DEPLOYMENT_ENV") === "production"
      && this.config.get<string>("ADMIN_ALERTS_ENABLED") === "true"
      && Boolean(this.config.get<string>("ADMIN_TELEGRAM_BOT_TOKEN")?.trim())
      && Boolean(this.config.get<string>("ADMIN_TELEGRAM_CHAT_ID")?.trim());
  }

  private positiveNumber(key: string, fallback: number) {
    const value = Number(this.config.get<string>(key) || fallback);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private async sendAlert(fingerprint: string, text: string) {
    const now = new Date();
    const hash = crypto.createHash("sha256").update(`telegram:${fingerprint}`).digest("hex");
    const previous = await this.prisma.operationalEvent.findFirst({
      where: {
        category: "alert_sent",
        fingerprint: hash,
        occurredAt: { gte: new Date(now.getTime() - this.positiveNumber("HEALTH_ALERT_REMINDER_MS", DEFAULT_REMINDER_MS)) },
      },
    });
    if (previous) return;

    const token = this.config.get<string>("ADMIN_TELEGRAM_BOT_TOKEN")!.trim();
    const chatId = this.config.get<string>("ADMIN_TELEGRAM_CHAT_ID")!.trim();
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: `StudyDeck: ${text}`, disable_web_page_preview: true }),
    });
    if (!response.ok) throw new Error(`Telegram alert failed: ${response.status}`);
    await this.prisma.operationalEvent.create({
      data: {
        service: "api",
        severity: "info",
        category: "alert_sent",
        operation: "telegram",
        message: "Redacted health alert delivered",
        fingerprint: hash,
        occurredAt: now,
        expiresAt: new Date(now.getTime() + 30 * 86_400_000),
      },
    });
  }
}
