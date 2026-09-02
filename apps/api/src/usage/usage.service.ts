import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PlanCode, Prisma } from "@prisma/client";
import { planLimits } from "@studydeck/shared";
import { ApiError } from "../errors/api-error.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { isLocalGenerationUnlimited } from "../runtime/local-generation.js";

const DEFAULT_TIME_ZONE = "Europe/Moscow";

type SubscriptionUser = {
  id: string;
  planCode: PlanCode;
  subscriptionExpiresAt: Date | null;
  subscriptionQuotaEpoch: string | null;
  planOverride: PlanCode | null;
  planOverrideStartsAt: Date | null;
  planOverrideExpiresAt: Date | null;
};

export type PlanEntitlement = {
  planCode: PlanCode;
  quotaEpoch: string;
  subscriptionExpiresAt: Date | null;
};

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  currentPeriod(reset: "month" | "week", now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
    const parts = zonedParts(now, timeZone);
    if (reset === "month") return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
    const weekday = weekdayIndex(now, timeZone);
    const monday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - weekday));
    return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;
  }

  nextResetAt(reset: "month" | "week", now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
    const parts = zonedParts(now, timeZone);
    if (reset === "month") {
      return zonedWallTimeToUtc(Date.UTC(parts.year, parts.month, 1), timeZone).toISOString();
    }
    const weekday = weekdayIndex(now, timeZone);
    return zonedWallTimeToUtc(Date.UTC(parts.year, parts.month - 1, parts.day + (7 - weekday)), timeZone).toISOString();
  }

  async getPlan(userId: string, now = new Date()): Promise<PlanEntitlement> {
    const user = await this.prisma.user.upsert({
      where: { id: userId },
      create: { id: userId },
      update: {},
      select: subscriptionUserSelect,
    });
    return entitlementFor(user, now);
  }

  async getSummary(userId: string, now = new Date()) {
    const entitlement = await this.getPlan(userId, now);
    const limits = planLimits[entitlement.planCode];
    const period = this.currentPeriod(limits.reset, now);
    const unlimited = isLocalGenerationUnlimited(this.config);
    const counter = unlimited ? null : await this.prisma.generationQuotaCounter.findUnique({
      where: { userId_period_quotaEpoch: { userId, period, quotaEpoch: entitlement.quotaEpoch } },
      select: { used: true },
    });
    const used = counter?.used ?? 0;
    const limit = unlimited ? Number.MAX_SAFE_INTEGER : limits.generationLimit;
    const exhausted = used >= limit;
    return {
      planCode: entitlement.planCode,
      period,
      reset: limits.reset,
      allowedSlideCounts: [...limits.allowedSlideCounts],
      used,
      limit,
      remaining: Math.max(0, limit - used),
      resetsAt: this.nextResetAt(limits.reset, now),
      exhausted,
      canCreate: unlimited || !exhausted,
      ...(unlimited ? { unlimited: true } : {}),
      subscriptionExpiresAt: entitlement.subscriptionExpiresAt?.toISOString() ?? null,
    };
  }

  async assertSlideCount(tx: Prisma.TransactionClient, ownerId: string, slideCount: number, now = new Date()) {
    const user = await tx.user.upsert({
      where: { id: ownerId },
      create: { id: ownerId },
      update: {},
      select: subscriptionUserSelect,
    });
    const entitlement = entitlementFor(user, now);
    assertAllowedSlideCount(entitlement, slideCount);
    return entitlement;
  }

  async assertAllowedSlideCount(ownerId: string, slideCount: number, now = new Date()) {
    const entitlement = await this.getPlan(ownerId, now);
    assertAllowedSlideCount(entitlement, slideCount);
    return entitlement;
  }

  /**
   * Reserves one final-presentation launch in the same database transaction
   * that creates the GenerationJob. The conditional increment is the race
   * barrier: concurrent transactions can never cross the configured cap.
   */
  async reserveGenerationSlot(
    tx: Prisma.TransactionClient,
    ownerId: string,
    generationJobId: string,
    slideCount: number,
    now = new Date(),
  ) {
    const user = await tx.user.upsert({
      where: { id: ownerId },
      create: { id: ownerId },
      update: {},
      select: subscriptionUserSelect,
    });
    const entitlement = entitlementFor(user, now);
    assertAllowedSlideCount(entitlement, slideCount);
    const limits = planLimits[entitlement.planCode];
    const period = this.currentPeriod(limits.reset, now);

    const existing = await tx.generationQuotaReservation.findUnique({
      where: { generationJobId },
      select: { id: true },
    });
    if (existing) return { ...entitlement, period, idempotent: true };
    if (isLocalGenerationUnlimited(this.config)) return { ...entitlement, period, idempotent: false };

    await tx.generationQuotaCounter.upsert({
      where: { userId_period_quotaEpoch: { userId: ownerId, period, quotaEpoch: entitlement.quotaEpoch } },
      create: { userId: ownerId, period, quotaEpoch: entitlement.quotaEpoch, used: 0 },
      update: {},
    });
    const reserved = await tx.generationQuotaCounter.updateMany({
      where: {
        userId: ownerId,
        period,
        quotaEpoch: entitlement.quotaEpoch,
        used: { lt: limits.generationLimit },
      },
      data: { used: { increment: 1 } },
    });
    if (reserved.count !== 1) {
      const current = await tx.generationQuotaCounter.findUnique({
        where: { userId_period_quotaEpoch: { userId: ownerId, period, quotaEpoch: entitlement.quotaEpoch } },
        select: { used: true },
      });
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        "PRESENTATION_GENERATION_LIMIT_REACHED",
        "Лимит генераций исчерпан",
        {
          planCode: entitlement.planCode,
          limit: limits.generationLimit,
          used: current?.used ?? limits.generationLimit,
          remaining: 0,
          resetsAt: this.nextResetAt(limits.reset, now),
          reset: limits.reset,
        },
      );
    }
    await tx.generationQuotaReservation.create({
      data: {
        userId: ownerId,
        generationJobId,
        period,
        quotaEpoch: entitlement.quotaEpoch,
        planCode: entitlement.planCode,
      },
    });
    return { ...entitlement, period, idempotent: false };
  }

  async releaseGenerationSlot(generationJobId: string) {
    return this.prisma.$transaction((tx) => this.releaseGenerationSlotInTransaction(tx, generationJobId));
  }

  async releaseGenerationSlotInTransaction(tx: Prisma.TransactionClient, generationJobId: string) {
    const reservation = await tx.generationQuotaReservation.findUnique({
      where: { generationJobId },
      select: { id: true, userId: true, period: true, quotaEpoch: true, status: true },
    });
    if (!reservation || reservation.status === "released") return false;
    const released = await tx.generationQuotaReservation.updateMany({
      where: { id: reservation.id, status: "reserved" },
      data: { status: "released", releasedAt: new Date() },
    });
    if (released.count !== 1) return false;
    await tx.generationQuotaCounter.updateMany({
      where: {
        userId: reservation.userId,
        period: reservation.period,
        quotaEpoch: reservation.quotaEpoch,
        used: { gt: 0 },
      },
      data: { used: { decrement: 1 } },
    });
    return true;
  }
}

const subscriptionUserSelect = {
  id: true,
  planCode: true,
  subscriptionExpiresAt: true,
  subscriptionQuotaEpoch: true,
  planOverride: true,
  planOverrideStartsAt: true,
  planOverrideExpiresAt: true,
} as const;

function entitlementFor(user: SubscriptionUser, now: Date): PlanEntitlement {
  const overrideActive = user.planOverride
    && (!user.planOverrideStartsAt || user.planOverrideStartsAt <= now)
    && (!user.planOverrideExpiresAt || user.planOverrideExpiresAt > now);
  if (overrideActive) {
    return {
      planCode: user.planOverride!,
      quotaEpoch: `override:${user.planOverride}:${user.planOverrideStartsAt?.toISOString() || "open"}`,
      subscriptionExpiresAt: user.planOverrideExpiresAt,
    };
  }
  const hasActivePaidPlan = user.planCode !== "free" && Boolean(user.subscriptionExpiresAt && user.subscriptionExpiresAt > now);
  if (hasActivePaidPlan) {
    return {
      planCode: user.planCode,
      quotaEpoch: user.subscriptionQuotaEpoch || `subscription:${user.id}`,
      subscriptionExpiresAt: user.subscriptionExpiresAt,
    };
  }
  return { planCode: "free", quotaEpoch: `free:${user.id}`, subscriptionExpiresAt: null };
}

function assertAllowedSlideCount(entitlement: PlanEntitlement, slideCount: number) {
  if (!planLimits[entitlement.planCode].allowedSlideCounts.includes(slideCount as never)) {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      "SLIDE_COUNT_NOT_ALLOWED_FOR_PLAN",
      "Выбранное количество слайдов недоступно на текущем тарифе",
      { planCode: entitlement.planCode, allowedSlideCounts: planLimits[entitlement.planCode].allowedSlideCounts },
    );
  }
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function weekdayIndex(date: Date, timeZone: string) {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
}

function zonedWallTimeToUtc(wallTimeUtcGuess: number, timeZone: string) {
  let result = wallTimeUtcGuess;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(new Date(result), timeZone);
    const representedWallTime = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    result += wallTimeUtcGuess - representedWallTime;
  }
  return new Date(result);
}
