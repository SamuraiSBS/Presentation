import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import type { PaymentTransactionType } from "@prisma/client";
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

    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      await this.syncSubscription(subscription);
    }

    if (event.type === "invoice.payment_succeeded") {
      await this.recordPaidInvoice(event, event.data.object as Stripe.Invoice);
    }

    if (event.type === "invoice.payment_failed") {
      await this.recordFailedInvoice(event, event.data.object as Stripe.Invoice);
    }

    if (event.type === "charge.refunded") {
      await this.recordRefund(event, event.data.object as Stripe.Charge);
    }

    if (event.type === "charge.dispute.created") {
      await this.recordDispute(event, event.data.object as Stripe.Dispute);
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

  async createPortalSession(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { stripeCustomerId: true },
    });
    if (!user.stripeCustomerId) {
      throw new Error("Billing portal is unavailable because this account has no Stripe customer");
    }

    const appUrl = this.config.get<string>("PUBLIC_APP_URL") || "http://localhost:3000";
    const session = await this.getStripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${appUrl}/profile`,
    });
    return { url: session.url };
  }

  /**
   * Stripe must be cancelled before data cleanup starts.  The caller persists
   * the returned timestamp in AccountDeletion, making a safe retry possible
   * when the HTTP request or worker is interrupted between steps.
   */
  async cancelSubscriptionForAccountDeletion(user: {
    stripeSubscriptionId: string | null;
    subscriptionStatus: string | null;
  }) {
    if (!user.stripeSubscriptionId || ["canceled", "incomplete_expired"].includes(user.subscriptionStatus || "")) {
      return { subscriptionId: user.stripeSubscriptionId, cancelledAt: new Date() };
    }

    const subscription = await this.getStripe().subscriptions.cancel(user.stripeSubscriptionId);
    return { subscriptionId: subscription.id, cancelledAt: new Date() };
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

  private async recordPaidInvoice(event: Stripe.Event, invoice: Stripe.Invoice) {
    const customerId = stringId(invoice.customer);
    const user = customerId ? await this.prisma.user.findFirst({ where: { stripeCustomerId: customerId }, select: { id: true } }) : null;
    const amount = minorToMajor(invoice.amount_paid, invoice.currency);
    const fx = await this.exchangeRate(invoice.currency);
    const fee = await this.invoiceFee(invoice);
    const net = subtractMoney(amount, fee);
    await this.prisma.paymentTransaction.upsert({
      where: { stripeEventId: event.id },
      update: {},
      create: {
        userId: user?.id,
        stripeEventId: event.id,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId(invoice),
        stripeInvoiceId: invoice.id,
        stripePaymentIntentId: paymentIntentId(invoice),
        stripeChargeId: chargeId(invoice),
        type: "payment",
        status: "succeeded",
        grossAmount: amount,
        feeAmount: fee,
        netAmount: net,
        currency: invoice.currency.toUpperCase(),
        exchangeRateToRub: fx,
        grossRubAtEvent: fx ? multiplyMoney(amount, fx) : null,
        feeRubAtEvent: fx ? multiplyMoney(fee, fx) : null,
        netRubAtEvent: fx ? multiplyMoney(net, fx) : null,
        occurredAt: new Date(event.created * 1000),
        metadata: { billingReason: invoice.billing_reason || null },
      },
    });
  }

  private async recordFailedInvoice(event: Stripe.Event, invoice: Stripe.Invoice) {
    const customerId = stringId(invoice.customer);
    const user = customerId ? await this.prisma.user.findFirst({ where: { stripeCustomerId: customerId }, select: { id: true } }) : null;
    const amount = minorToMajor(invoice.amount_due, invoice.currency);
    await this.prisma.paymentTransaction.upsert({
      where: { stripeEventId: event.id },
      update: {},
      create: { userId: user?.id, stripeEventId: event.id, stripeCustomerId: customerId, stripeInvoiceId: invoice.id, type: "payment", status: "failed", grossAmount: amount, netAmount: "0", currency: invoice.currency.toUpperCase(), occurredAt: new Date(event.created * 1000) },
    });
  }

  private async recordRefund(event: Stripe.Event, charge: Stripe.Charge) {
    const customerId = stringId(charge.customer);
    const user = customerId ? await this.prisma.user.findFirst({ where: { stripeCustomerId: customerId }, select: { id: true } }) : null;
    const amount = `-${minorToMajor(charge.amount_refunded, charge.currency)}`;
    const fx = await this.exchangeRate(charge.currency);
    await this.upsertNegativeTransaction(event, "refund", amount, charge.currency, user?.id, customerId, charge.id, fx);
  }

  private async recordDispute(event: Stripe.Event, dispute: Stripe.Dispute) {
    const charge = typeof dispute.charge === "string" ? await this.getStripe().charges.retrieve(dispute.charge) : dispute.charge;
    const customerId = charge ? stringId(charge.customer) : null;
    const user = customerId ? await this.prisma.user.findFirst({ where: { stripeCustomerId: customerId }, select: { id: true } }) : null;
    const amount = `-${minorToMajor(dispute.amount, dispute.currency)}`;
    const fx = await this.exchangeRate(dispute.currency);
    await this.upsertNegativeTransaction(event, "dispute", amount, dispute.currency, user?.id, customerId, stringId(dispute.charge), fx);
  }

  private async upsertNegativeTransaction(event: Stripe.Event, type: PaymentTransactionType, amount: string, currency: string, userId: string | undefined, customerId: string | null, chargeIdValue: string | null, fx: string | null) {
    await this.prisma.paymentTransaction.upsert({
      where: { stripeEventId: event.id },
      update: {},
      create: { userId, stripeEventId: event.id, stripeCustomerId: customerId, stripeChargeId: chargeIdValue, type, status: "succeeded", grossAmount: amount, netAmount: amount, currency: currency.toUpperCase(), exchangeRateToRub: fx, grossRubAtEvent: fx ? multiplyMoney(amount, fx) : null, netRubAtEvent: fx ? multiplyMoney(amount, fx) : null, occurredAt: new Date(event.created * 1000) },
    });
  }

  private async invoiceFee(invoice: Stripe.Invoice) {
    const charge = chargeId(invoice);
    if (!charge) return "0";
    try {
      const item = await this.getStripe().charges.retrieve(charge, { expand: ["balance_transaction"] });
      if (!item.balance_transaction || typeof item.balance_transaction === "string") return "0";
      return minorToMajor(item.balance_transaction.fee, item.balance_transaction.currency);
    } catch {
      return "0";
    }
  }

  private async exchangeRate(currency: string) {
    const code = currency.toUpperCase();
    if (code === "RUB") return "1";
    const cached = await this.prisma.exchangeRate.findFirst({ where: { baseCurrency: code, quoteCurrency: "RUB" }, orderBy: { effectiveAt: "desc" } });
    return cached?.rate.toString() || null;
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

function minorToMajor(amount: number, currency: string) {
  const zeroDecimal = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);
  return zeroDecimal.has(currency.toLowerCase()) ? String(amount) : `${Math.trunc(amount / 100)}.${String(Math.abs(amount % 100)).padStart(2, "0")}`;
}

function multiplyMoney(left: string, right: string) {
  const scale = 100_000_000n;
  const value = (toScaled(left) * toScaled(right)) / scale;
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const text = absolute.toString().padStart(9, "0");
  return `${sign}${text.slice(0, -8)}.${text.slice(-8)}`;
}

function subtractMoney(left: string, right: string) {
  const value = toScaled(left) - toScaled(right);
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const text = absolute.toString().padStart(9, "0");
  return `${sign}${text.slice(0, -8)}.${text.slice(-8)}`;
}

function toScaled(value: string) {
  const sign = value.startsWith("-") ? -1n : 1n;
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  return sign * BigInt(`${whole || "0"}${fraction.padEnd(8, "0").slice(0, 8)}`);
}

function stringId(value: string | { id: string } | null | undefined) { return typeof value === "string" ? value : value?.id || null; }
function subscriptionId(invoice: Stripe.Invoice) { return stringId((invoice as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null }).subscription); }
function paymentIntentId(invoice: Stripe.Invoice) { return stringId((invoice as Stripe.Invoice & { payment_intent?: string | Stripe.PaymentIntent | null }).payment_intent); }
function chargeId(invoice: Stripe.Invoice) { return stringId((invoice as Stripe.Invoice & { charge?: string | Stripe.Charge | null }).charge); }
