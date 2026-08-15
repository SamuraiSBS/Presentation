import { describe, expect, it, vi } from "vitest";
import { UsersService } from "./users.service.js";

function fixture() {
  const tx = {
    accountDeletion: { create: vi.fn().mockResolvedValue({ id: "deletion-1", stripeSubscriptionId: "sub-1", subscriptionCancelledAt: null }) },
    user: { update: vi.fn() },
  };
  const prisma = {
    user: { findUniqueOrThrow: vi.fn() },
    accountDeletion: { update: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const usage = { getSummary: vi.fn() };
  const billing = { cancelSubscriptionForAccountDeletion: vi.fn() };
  const maintenanceQueue = { add: vi.fn() };
  const service = new UsersService(prisma as never, usage as never, billing as never, maintenanceQueue as never);
  return { service, prisma, tx, billing, maintenanceQueue };
}

describe("UsersService account deletion", () => {
  it("cancels Stripe before it schedules background cleanup", async () => {
    const { service, prisma, tx, billing, maintenanceQueue } = fixture();
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: "user-1",
      stripeSubscriptionId: "sub-1",
      subscriptionStatus: "active",
      accountDeletion: null,
    });
    billing.cancelSubscriptionForAccountDeletion.mockResolvedValue({ subscriptionId: "sub-1", cancelledAt: new Date("2026-08-11T12:00:00.000Z") });
    prisma.accountDeletion.update
      .mockResolvedValueOnce({ id: "deletion-1", status: "queued" })
      .mockResolvedValueOnce({ id: "deletion-1", status: "queued", requestedAt: new Date("2026-08-11T12:00:00.000Z"), completedAt: null, error: null });
    maintenanceQueue.add.mockResolvedValue({ id: "queue-1" });

    await expect(service.removeMe("user-1", "УДАЛИТЬ")).resolves.toMatchObject({ id: "deletion-1", status: "queued" });

    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ blockReason: "ACCOUNT_DELETION_PENDING" }) }));
    expect(billing.cancelSubscriptionForAccountDeletion).toHaveBeenCalledWith(expect.objectContaining({ stripeSubscriptionId: "sub-1" }));
    expect(maintenanceQueue.add).toHaveBeenCalledWith("delete-account", { deletionId: "deletion-1" }, expect.objectContaining({ attempts: 60 }));
    expect(billing.cancelSubscriptionForAccountDeletion.mock.invocationCallOrder[0]).toBeLessThan(maintenanceQueue.add.mock.invocationCallOrder[0]);
  });

  it("persists a failed lifecycle instead of deleting data when billing cancellation fails", async () => {
    const { service, prisma, billing, maintenanceQueue } = fixture();
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: "user-1", stripeSubscriptionId: "sub-1", subscriptionStatus: "active", accountDeletion: null });
    billing.cancelSubscriptionForAccountDeletion.mockRejectedValue(new Error("Stripe temporarily unavailable"));
    prisma.accountDeletion.update.mockResolvedValue({ id: "deletion-1", status: "failed", requestedAt: new Date(), completedAt: null, error: "Stripe temporarily unavailable" });

    await expect(service.removeMe("user-1", true)).resolves.toMatchObject({ status: "failed", error: "Stripe temporarily unavailable" });
    expect(maintenanceQueue.add).not.toHaveBeenCalled();
  });
});
