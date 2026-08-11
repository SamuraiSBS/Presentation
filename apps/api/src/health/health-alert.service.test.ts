import { describe, expect, it, vi } from "vitest";
import { HealthAlertService } from "./health-alert.service.js";

const configValues: Record<string, string> = {
  DEPLOYMENT_ENV: "production",
  ADMIN_ALERTS_ENABLED: "true",
  ADMIN_TELEGRAM_BOT_TOKEN: "test-token",
  ADMIN_TELEGRAM_CHAT_ID: "123",
  HEALTH_QUEUE_LAG_MAX_AGE_MS: "1000",
  HEALTH_QUEUE_WAITING_MAX: "5",
};

function subject(readiness: object) {
  const health = { ready: vi.fn().mockResolvedValue(readiness) };
  const prisma = { operationalEvent: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) } };
  const config = { get: vi.fn((key: string) => configValues[key]) };
  return { service: new HealthAlertService(health as never, prisma as never, config as never), health, prisma };
}

describe("HealthAlertService", () => {
  it("alerts separately for readiness, stale worker heartbeat, and queue-lag SLO breach", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const { service, prisma } = subject({
      ok: false,
      checks: {
        database: { ok: true },
        worker: { ok: false, error: "worker heartbeat is stale" },
        queues: { ok: true, lag: { generation: { waiting: 5, oldestWaitingMs: 1_500 } } },
      },
    });

    await service.checkOnce();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(prisma.operationalEvent.create).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it("does nothing when the production Telegram channel is not configured", async () => {
    const original = configValues.ADMIN_ALERTS_ENABLED;
    configValues.ADMIN_ALERTS_ENABLED = "false";
    const { service, health } = subject({ ok: true, checks: {} });

    await service.checkOnce();

    expect(health.ready).not.toHaveBeenCalled();
    configValues.ADMIN_ALERTS_ENABLED = original;
  });
});
