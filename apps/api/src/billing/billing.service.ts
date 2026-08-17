import crypto from "node:crypto";
import { BadRequestException, ConflictException, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PlanCode, Prisma } from "@prisma/client";
import { paidPlanCodes, planPricesRub, planRank, type PaidPlanCode } from "@studydeck/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { ProductAnalyticsService } from "../analytics/product-analytics.service.js";

type YooKassaPayment = {
  id: string;
  status: "pending" | "waiting_for_capture" | "succeeded" | "canceled" | string;
  paid?: boolean;
  amount?: { value?: string; currency?: string };
  confirmation?: { type?: string; confirmation_url?: string };
  metadata?: Record<string, unknown>;
  created_at?: string;
};

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional() private readonly productAnalytics?: ProductAnalyticsService,
  ) {}

  async createCheckoutSession(userId: string, plan: PaidPlanCode, suppliedKey?: string) {
    if (!(paidPlanCodes as readonly string[]).includes(plan)) throw new BadRequestException("Недоступный тариф");
    const idempotencyKey = normalizeIdempotencyKey(suppliedKey);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, planCode: true, subscriptionExpiresAt: true },
    });
    this.assertPurchaseAllowed(user, plan);

    const existing = await this.prisma.yooKassaPayment.findUnique({ where: { idempotencyKey } });
    if (existing?.confirmationUrl && existing.status === "pending") return { url: existing.confirmationUrl };
    if (existing?.activatedAt) throw new ConflictException("Этот платёж уже подтверждён. Создайте новый платёж для следующей покупки.");

    await this.prisma.yooKassaPayment.upsert({
      where: { idempotencyKey },
      update: {},
      create: {
        userId,
        idempotencyKey,
        planCode: plan,
        amountRub: planPricesRub[plan],
        status: "pending",
      },
    });

    const appUrl = this.config.get<string>("PUBLIC_APP_URL") || "http://localhost:3000";
    const payment = await this.requestYooKassa("/payments", {
      method: "POST",
      headers: { "Idempotence-Key": idempotencyKey },
      body: {
        amount: { value: planPricesRub[plan].toFixed(2), currency: "RUB" },
        capture: true,
        confirmation: { type: "redirect", return_url: `${appUrl}/billing?checkout=success` },
        description: `Lazyum ${plan} — 30 дней доступа`,
        metadata: { userId, plan, idempotencyKey },
      },
    });
    const url = payment.confirmation?.confirmation_url;
    if (!payment.id || !url) throw new ServiceUnavailableException("ЮKassa не вернула ссылку на оплату");
    await this.prisma.yooKassaPayment.update({
      where: { idempotencyKey },
      data: { providerPaymentId: payment.id, confirmationUrl: url, status: payment.status, payload: payment as Prisma.InputJsonValue },
    });
    void this.productAnalytics?.capture(userId, "checkout_started", { plan, provider: "yookassa" });
    return { url };
  }

  async createPortalSession(_userId: string) {
    // Purchases are one-time and have no provider-managed recurring contract.
    // The pricing page is therefore the only meaningful account surface.
    const appUrl = this.config.get<string>("PUBLIC_APP_URL") || "http://localhost:3000";
    return { url: `${appUrl}/pricing` };
  }

  /** YooKassa webhooks are verified against the provider API before state changes. */
  async handleYooKassaWebhook(payload: unknown) {
    const event = payload as { event?: unknown; object?: unknown };
    const hintedPayment = event?.object as { id?: unknown } | undefined;
    const paymentId = typeof hintedPayment?.id === "string" ? hintedPayment.id : "";
    if (!paymentId) throw new BadRequestException("Некорректный webhook ЮKassa");

    const payment = await this.requestYooKassa(`/payments/${encodeURIComponent(paymentId)}`, { method: "GET" });
    if (payment.status !== "succeeded" || payment.paid !== true) {
      await this.prisma.yooKassaPayment.updateMany({
        where: { providerPaymentId: paymentId, activatedAt: null },
        data: { status: payment.status, payload: payment as Prisma.InputJsonValue },
      });
      return { received: true, activated: false };
    }
    const activated = await this.activateSucceededPayment(payment);
    return { received: true, activated };
  }

  /** There is no recurring charge to cancel for a one-time 30-day purchase. */
  async cancelSubscriptionForAccountDeletion(user: {
    stripeSubscriptionId: string | null;
    subscriptionStatus: string | null;
  }) {
    return { subscriptionId: user.stripeSubscriptionId, cancelledAt: new Date() };
  }

  private async activateSucceededPayment(payment: YooKassaPayment) {
    const paymentId = payment.id;
    const metadata = payment.metadata || {};
    const userId = typeof metadata.userId === "string" ? metadata.userId : null;
    const plan = typeof metadata.plan === "string" && (paidPlanCodes as readonly string[]).includes(metadata.plan)
      ? metadata.plan as PaidPlanCode
      : null;
    const idempotencyKey = typeof metadata.idempotencyKey === "string" ? metadata.idempotencyKey : null;
    const expectedAmount = plan ? planPricesRub[plan].toFixed(2) : null;
    if (!userId || !plan || !idempotencyKey || payment.amount?.currency !== "RUB" || payment.amount?.value !== expectedAmount) {
      throw new BadRequestException("Платёж ЮKassa не прошёл проверку тарифа");
    }

    return this.prisma.$transaction(async (tx) => {
      // The pending row exists before the provider call. Match the webhook to
      // our idempotency key so a fast notification cannot race the response
      // handler that persists providerPaymentId.
      const paymentRow = await tx.yooKassaPayment.upsert({
        where: { idempotencyKey },
        update: { status: "succeeded", paidAt: new Date(), payload: payment as Prisma.InputJsonValue },
        create: {
          userId,
          idempotencyKey,
          providerPaymentId: paymentId,
          planCode: plan,
          amountRub: planPricesRub[plan],
          status: "succeeded",
          paidAt: new Date(),
          payload: payment as Prisma.InputJsonValue,
        },
        select: { id: true, activatedAt: true },
      });
      if (paymentRow.activatedAt) return false;

      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { planCode: true, subscriptionExpiresAt: true, subscriptionQuotaEpoch: true },
      });
      this.assertPurchaseAllowed(user, plan);
      const now = new Date();
      const hasActivePaidPlan = user.planCode !== "free" && Boolean(user.subscriptionExpiresAt && user.subscriptionExpiresAt > now);
      const isRenewal = hasActivePaidPlan && user.planCode === plan;
      const expiresAt = isRenewal
        ? addDays(user.subscriptionExpiresAt!, 30)
        : addDays(now, 30);
      const quotaEpoch = isRenewal
        ? user.subscriptionQuotaEpoch || crypto.randomUUID()
        : crypto.randomUUID();

      await tx.user.update({
        where: { id: userId },
        data: {
          planCode: plan,
          subscriptionStatus: "active",
          subscriptionExpiresAt: expiresAt,
          subscriptionQuotaEpoch: quotaEpoch,
        },
      });
      await tx.yooKassaPayment.update({ where: { id: paymentRow.id }, data: { activatedAt: now } });
      await tx.paymentTransaction.upsert({
        where: { providerEventId: `yookassa:${paymentId}` },
        update: {},
        create: {
          userId,
          providerEventId: `yookassa:${paymentId}`,
          yooKassaPaymentId: paymentId,
          type: "payment",
          status: "succeeded",
          grossAmount: planPricesRub[plan],
          netAmount: planPricesRub[plan],
          currency: "RUB",
          exchangeRateToRub: 1,
          grossRubAtEvent: planPricesRub[plan],
          netRubAtEvent: planPricesRub[plan],
          occurredAt: now,
          metadata: { plan, kind: isRenewal ? "renewal" : hasActivePaidPlan ? "upgrade" : "new_30_day_access", provider: "yookassa" },
        },
      });
      void this.productAnalytics?.capture(userId, "paid_conversion", { plan, provider: "yookassa", purchase_kind: isRenewal ? "renewal" : hasActivePaidPlan ? "upgrade" : "new" });
      return true;
    });
  }

  private assertPurchaseAllowed(user: { planCode: PlanCode; subscriptionExpiresAt: Date | null }, targetPlan: PaidPlanCode) {
    const active = user.planCode !== "free" && Boolean(user.subscriptionExpiresAt && user.subscriptionExpiresAt > new Date());
    if (active && planRank[targetPlan] < planRank[user.planCode]) {
      throw new ConflictException("Понижение тарифа доступно после окончания текущей подписки");
    }
  }

  private async requestYooKassa(path: string, init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: unknown }) {
    const shopId = this.config.get<string>("YOOKASSA_SHOP_ID");
    const secret = this.config.get<string>("YOOKASSA_SECRET_KEY");
    if (!shopId || !secret) throw new ServiceUnavailableException("ЮKassa не настроена");
    const response = await fetch(`${this.config.get<string>("YOOKASSA_API_URL") || "https://api.yookassa.ru/v3"}${path}`, {
      method: init.method,
      headers: {
        authorization: `Basic ${Buffer.from(`${shopId}:${secret}`).toString("base64")}`,
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
    const data = await response.json().catch(() => null) as YooKassaPayment | { description?: string } | null;
    if (!response.ok || !data || !("id" in data || response.status === 204)) {
      const description = data && "description" in data ? data.description : undefined;
      throw new ServiceUnavailableException(typeof description === "string" ? description : "ЮKassa временно недоступна");
    }
    return data as YooKassaPayment;
  }
}

function normalizeIdempotencyKey(value?: string) {
  const key = value?.trim();
  if (!key) return `checkout:${crypto.randomUUID()}`;
  if (key.length > 64) throw new BadRequestException("Некорректный ключ идемпотентности оплаты");
  return key;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
