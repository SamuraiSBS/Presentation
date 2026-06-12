import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class BillingService {
  private stripe?: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async handleStripeWebhook(rawBody: Buffer, signature: string) {
    const secret = this.config.get<string>("STRIPE_WEBHOOK_SECRET");
    if (!secret) return { received: false, reason: "stripe webhook not configured" };

    const event = this.getStripe().webhooks.constructEvent(rawBody, signature, secret);
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      await this.syncCheckoutSession(session);
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      await this.syncSubscription(subscription);
    }

    return { received: true };
  }

  async createCheckoutSession(userId: string, plan: "student" | "pro") {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const priceId = plan === "pro" ? this.config.get<string>("STRIPE_PRICE_PRO") : this.config.get<string>("STRIPE_PRICE_STUDENT");
    if (!priceId) throw new Error(`Stripe price for ${plan} is not configured`);

    const appUrl = this.config.get<string>("PUBLIC_APP_URL") || "http://localhost:3000";
    const session = await this.getStripe().checkout.sessions.create({
      mode: "subscription",
      customer: user.stripeCustomerId || undefined,
      customer_email: user.stripeCustomerId ? undefined : user.email || undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/billing?checkout=success`,
      cancel_url: `${appUrl}/pricing?checkout=cancelled`,
      metadata: { userId, plan },
    });

    return { url: session.url };
  }

  private async syncCheckoutSession(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.userId;
    if (!userId || !session.customer) return;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        stripeCustomerId: String(session.customer),
        stripeSubscriptionId: session.subscription ? String(session.subscription) : undefined,
        subscriptionStatus: "checkout_completed",
      },
    });
  }

  private async syncSubscription(subscription: Stripe.Subscription) {
    const planCode = this.planCodeForPrice(subscription.items.data[0]?.price.id);
    await this.prisma.user.updateMany({
      where: { stripeCustomerId: String(subscription.customer) },
      data: {
        stripeSubscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
        planCode,
      },
    });
  }

  private planCodeForPrice(priceId?: string) {
    if (priceId && priceId === this.config.get<string>("STRIPE_PRICE_PRO")) return "pro";
    if (priceId && priceId === this.config.get<string>("STRIPE_PRICE_STUDENT")) return "student";
    return "free";
  }

  private getStripe() {
    if (!this.stripe) {
      this.stripe = new Stripe(this.config.getOrThrow<string>("STRIPE_SECRET_KEY"), {
        apiVersion: "2025-02-24.acacia",
        typescript: true,
      });
    }
    return this.stripe;
  }
}
