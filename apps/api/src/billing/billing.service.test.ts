import { afterEach, describe, expect, it, vi } from "vitest";
import { BillingService } from "./billing.service.js";

function fixture() {
  const tx = {
    yooKassaPayment: { upsert: vi.fn(), update: vi.fn() },
    user: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    paymentTransaction: { upsert: vi.fn() },
  };
  const prisma = {
    user: { findUniqueOrThrow: vi.fn() },
    yooKassaPayment: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const config = { get: vi.fn((key: string) => ({
    YOOKASSA_SHOP_ID: "shop-1",
    YOOKASSA_SECRET_KEY: "secret-1",
    PUBLIC_APP_URL: "https://studydeck.example",
  })[key]) };
  const service = new BillingService(prisma as never, config as never);
  return { service, prisma, tx };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("BillingService YooKassa purchases", () => {
  it("creates a one-time YooKassa payment with the client retry key", async () => {
    const { service, prisma } = fixture();
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: "user-1", planCode: "free", subscriptionExpiresAt: null });
    prisma.yooKassaPayment.findUnique.mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "payment-1", status: "pending", confirmation: { confirmation_url: "https://yookassa.test/pay" },
    }), { status: 200 })));

    await expect(service.createCheckoutSession("user-1", "student", "checkout-student-1"))
      .resolves.toEqual({ url: "https://yookassa.test/pay" });

    expect(fetch).toHaveBeenCalledWith("https://api.yookassa.ru/v3/payments", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Idempotence-Key": "checkout-student-1" }),
    }));
    expect(prisma.yooKassaPayment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ planCode: "student", amountRub: 590, status: "pending" }),
    }));
  });

  it("does not activate a webhook until YooKassa confirms a succeeded payment", async () => {
    const { service, prisma } = fixture();
    prisma.yooKassaPayment.updateMany.mockResolvedValue({ count: 1 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "payment-1", status: "pending", paid: false }), { status: 200 })));

    await expect(service.handleYooKassaWebhook({ event: "payment.waiting_for_capture", object: { id: "payment-1" } }))
      .resolves.toEqual({ received: true, activated: false });

    expect(prisma.yooKassaPayment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { providerPaymentId: "payment-1", activatedAt: null },
    }));
  });

  it("extends the same active tariff without changing its quota epoch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T10:00:00.000Z"));
    const { service, tx } = fixture();
    tx.yooKassaPayment.upsert.mockResolvedValue({ id: "purchase-1", activatedAt: null });
    const activeUntil = new Date("2026-08-30T10:00:00.000Z");
    tx.user.findUniqueOrThrow.mockResolvedValue({ planCode: "student", subscriptionExpiresAt: activeUntil, subscriptionQuotaEpoch: "week-epoch" });
    tx.yooKassaPayment.update.mockResolvedValue({});
    tx.user.update.mockResolvedValue({});
    tx.paymentTransaction.upsert.mockResolvedValue({});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "payment-1", status: "succeeded", paid: true,
      amount: { value: "590.00", currency: "RUB" },
      metadata: { userId: "user-1", plan: "student", idempotencyKey: "checkout-student-2" },
    }), { status: 200 })));

    await expect(service.handleYooKassaWebhook({ event: "payment.succeeded", object: { id: "payment-1" } }))
      .resolves.toEqual({ received: true, activated: true });

    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ planCode: "student", subscriptionQuotaEpoch: "week-epoch", subscriptionExpiresAt: new Date("2026-09-29T10:00:00.000Z") }),
    }));
  });

  it("starts a fresh weekly quota epoch when an active plan is upgraded", async () => {
    const { service, tx } = fixture();
    tx.yooKassaPayment.upsert.mockResolvedValue({ id: "purchase-upgrade", activatedAt: null });
    tx.user.findUniqueOrThrow.mockResolvedValue({
      planCode: "student",
      subscriptionExpiresAt: new Date("2026-08-30T10:00:00.000Z"),
      subscriptionQuotaEpoch: "student-week-epoch",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "payment-upgrade", status: "succeeded", paid: true,
      amount: { value: "1290.00", currency: "RUB" },
      metadata: { userId: "user-1", plan: "plus", idempotencyKey: "checkout-plus-1" },
    }), { status: 200 })));

    await expect(service.handleYooKassaWebhook({ event: "payment.succeeded", object: { id: "payment-upgrade" } }))
      .resolves.toEqual({ received: true, activated: true });

    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        planCode: "plus",
        subscriptionQuotaEpoch: expect.not.stringMatching(/^student-week-epoch$/),
      }),
    }));
  });

  it("redirects the obsolete portal action to pricing because there is no auto-renewal", async () => {
    const { service } = fixture();
    await expect(service.createPortalSession("user-1")).resolves.toEqual({ url: "https://studydeck.example/pricing" });
  });
});
