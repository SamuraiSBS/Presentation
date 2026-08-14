import { describe, expect, it, vi } from "vitest";
import { releaseGenerationQuotaReservation } from "./generation-quota.js";

describe("releaseGenerationQuotaReservation", () => {
  it("decrements the counter only on the first terminal release", async () => {
    const tx = {
      generationQuotaReservation: {
        findUnique: vi.fn().mockResolvedValue({ id: "reservation-1", userId: "user-1", period: "2026-08-10", quotaEpoch: "epoch-1", status: "reserved" }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      generationQuotaCounter: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = { $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };

    await expect(releaseGenerationQuotaReservation(prisma as never, "job-1")).resolves.toBe(true);
    expect(tx.generationQuotaCounter.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ used: { gt: 0 } }), data: { used: { decrement: 1 } },
    }));
  });

  it("does not decrement a reservation that was already released", async () => {
    const tx = {
      generationQuotaReservation: { findUnique: vi.fn().mockResolvedValue({ status: "released" }), updateMany: vi.fn() },
      generationQuotaCounter: { updateMany: vi.fn() },
    };
    const prisma = { $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };

    await expect(releaseGenerationQuotaReservation(prisma as never, "job-1")).resolves.toBe(false);
    expect(tx.generationQuotaCounter.updateMany).not.toHaveBeenCalled();
  });
});
