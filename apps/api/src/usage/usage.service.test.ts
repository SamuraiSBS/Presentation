import { describe, expect, it, vi } from "vitest";
import { UsageService } from "./usage.service.js";

const paidUser = {
  id: "user-1",
  planCode: "plus" as const,
  subscriptionExpiresAt: new Date("2026-09-01T00:00:00.000Z"),
  subscriptionQuotaEpoch: "upgrade-epoch",
  planOverride: null,
  planOverrideStartsAt: null,
  planOverrideExpiresAt: null,
};

function fixture(deploymentEnv = "production") {
  const tx = {
    user: { upsert: vi.fn().mockResolvedValue(paidUser) },
    generationQuotaReservation: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    generationQuotaCounter: { upsert: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
  };
  const prisma = {
    user: { upsert: vi.fn().mockResolvedValue(paidUser) },
    generationQuotaCounter: { findUnique: vi.fn() },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const config = { get: vi.fn((key: string) => key === "DEPLOYMENT_ENV" ? deploymentEnv : undefined) };
  return { service: new UsageService(prisma as never, config as never), prisma, tx, config };
}

describe("UsageService generation quotas", () => {
  it("uses Monday-to-Sunday Moscow weeks", () => {
    const { service } = fixture();
    const mondayMoscow = new Date("2026-08-09T21:30:00.000Z");
    expect(service.currentPeriod("week", mondayMoscow)).toBe("2026-08-10");
    expect(service.nextResetAt("week", mondayMoscow)).toBe("2026-08-16T21:00:00.000Z");
  });

  it("reports an active paid plan from its separate weekly counter", async () => {
    const { service, prisma } = fixture();
    prisma.generationQuotaCounter.findUnique.mockResolvedValue({ used: 3 });

    await expect(service.getSummary("user-1", new Date("2026-08-14T12:00:00.000Z"))).resolves.toMatchObject({
      planCode: "plus", reset: "week", period: "2026-08-10", limit: 10, used: 3, remaining: 7,
      allowedSlideCounts: [6, 8, 10, 12], subscriptionExpiresAt: "2026-09-01T00:00:00.000Z",
    });
  });

  it("reports unlimited usage and skips the counter in local mode", async () => {
    const { service, prisma } = fixture("local");

    await expect(service.getSummary("user-1", new Date("2026-08-14T12:00:00.000Z"))).resolves.toMatchObject({
      unlimited: true,
      exhausted: false,
      canCreate: true,
      limit: Number.MAX_SAFE_INTEGER,
      remaining: Number.MAX_SAFE_INTEGER,
    });
    expect(prisma.generationQuotaCounter.findUnique).not.toHaveBeenCalled();
  });

  it("reserves with a conditional counter increment and records the exact job", async () => {
    const { service, tx } = fixture();
    tx.generationQuotaReservation.findUnique.mockResolvedValue(null);
    tx.generationQuotaCounter.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.reserveGenerationSlot(tx as never, "user-1", "job-1", 12, new Date("2026-08-14T12:00:00.000Z")))
      .resolves.toMatchObject({ planCode: "plus", period: "2026-08-10", idempotent: false });

    expect(tx.generationQuotaCounter.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ used: { lt: 10 }, quotaEpoch: "upgrade-epoch" }),
      data: { used: { increment: 1 } },
    }));
    expect(tx.generationQuotaReservation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ generationJobId: "job-1", planCode: "plus", quotaEpoch: "upgrade-epoch" }),
    }));
  });

  it("rejects an exhausted quota without creating a reservation", async () => {
    const { service, tx } = fixture();
    tx.generationQuotaReservation.findUnique.mockResolvedValue(null);
    tx.generationQuotaCounter.updateMany.mockResolvedValue({ count: 0 });
    tx.generationQuotaCounter.findUnique.mockResolvedValue({ used: 10 });

    await expect(service.reserveGenerationSlot(tx as never, "user-1", "job-2", 12, new Date("2026-08-14T12:00:00.000Z")))
      .rejects.toMatchObject({ status: 429, response: expect.objectContaining({ code: "PRESENTATION_GENERATION_LIMIT_REACHED" }) });
    expect(tx.generationQuotaReservation.create).not.toHaveBeenCalled();
  });

  it("does not reserve a quota slot in local mode", async () => {
    const { service, tx } = fixture("local");
    tx.generationQuotaReservation.findUnique.mockResolvedValue(null);

    await expect(service.reserveGenerationSlot(tx as never, "user-1", "job-local", 12, new Date("2026-08-14T12:00:00.000Z"))).resolves.toMatchObject({
      planCode: "plus",
      idempotent: false,
    });
    expect(tx.generationQuotaCounter.upsert).not.toHaveBeenCalled();
    expect(tx.generationQuotaCounter.updateMany).not.toHaveBeenCalled();
    expect(tx.generationQuotaReservation.create).not.toHaveBeenCalled();
  });

  it("releases a terminally failed job exactly once", async () => {
    const { service, tx } = fixture();
    tx.generationQuotaReservation.findUnique.mockResolvedValue({ id: "reservation-1", userId: "user-1", period: "2026-08-10", quotaEpoch: "upgrade-epoch", status: "reserved" });
    tx.generationQuotaReservation.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.releaseGenerationSlot("job-1")).resolves.toBe(true);
    expect(tx.generationQuotaCounter.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ used: { gt: 0 } }), data: { used: { decrement: 1 } },
    }));
  });
});
