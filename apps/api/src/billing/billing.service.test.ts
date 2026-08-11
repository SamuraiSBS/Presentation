import { describe, expect, it, vi } from "vitest";
import { BillingService } from "./billing.service.js";

function fixture() {
  const prisma = { user: { findUniqueOrThrow: vi.fn() } };
  const config = { get: vi.fn() };
  const service = new BillingService(prisma as never, config as never);
  return { service, prisma, config };
}

describe("BillingService customer self-service", () => {
  it("creates a Stripe billing-portal session that returns to the profile", async () => {
    const { service, prisma, config } = fixture();
    prisma.user.findUniqueOrThrow.mockResolvedValue({ stripeCustomerId: "cus-1" });
    config.get.mockReturnValue("https://studydeck.example");
    const create = vi.fn().mockResolvedValue({ url: "https://billing.stripe.test/session" });
    (service as unknown as { stripe: unknown }).stripe = { billingPortal: { sessions: { create } } };

    await expect(service.createPortalSession("user-1")).resolves.toEqual({ url: "https://billing.stripe.test/session" });
    expect(create).toHaveBeenCalledWith({ customer: "cus-1", return_url: "https://studydeck.example/profile" });
  });

  it("does not call Stripe to cancel an already-cancelled subscription", async () => {
    const { service } = fixture();
    await expect(service.cancelSubscriptionForAccountDeletion({ stripeSubscriptionId: "sub-1", subscriptionStatus: "canceled" }))
      .resolves.toMatchObject({ subscriptionId: "sub-1" });
  });
});
