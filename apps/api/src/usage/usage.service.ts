import { HttpStatus, Injectable } from "@nestjs/common";
import type { PlanCode, Prisma } from "@prisma/client";
import { planLimits } from "@studydeck/shared";
import { ApiError } from "../errors/api-error.js";
import { PrismaService } from "../prisma/prisma.service.js";

const DEFAULT_TIME_ZONE = "Europe/Moscow";

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  currentPeriod(now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
    const parts = zonedParts(now, timeZone);
    return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
  }

  nextResetAt(now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
    const { year, month } = zonedParts(now, timeZone);
    const nextMonthUtcGuess = Date.UTC(year, month, 1, 0, 0, 0, 0);
    return zonedWallTimeToUtc(nextMonthUtcGuess, timeZone).toISOString();
  }

  async getSummary(userId: string, now = new Date()) {
    const user = await this.prisma.user.upsert({
      where: { id: userId },
      create: { id: userId },
      update: {},
      select: { planCode: true, planOverride: true, planOverrideStartsAt: true, planOverrideExpiresAt: true },
    });

    const period = this.currentPeriod(now);
    const counter = await this.prisma.usageCounter.findUnique({
      where: { userId_period: { userId, period } },
      select: { presentationsCreated: true },
    });
    return usageSummary(effectivePlan(user, now), counter?.presentationsCreated ?? 0, period, this.nextResetAt(now));
  }

  async reserveCreationSlot(tx: Prisma.TransactionClient, ownerId: string, now = new Date()) {
    const user = await tx.user.upsert({
      where: { id: ownerId },
      create: { id: ownerId },
      update: {},
      select: { planCode: true, planOverride: true, planOverrideStartsAt: true, planOverrideExpiresAt: true },
    });
    const period = this.currentPeriod(now);
    const limit = planLimits[effectivePlan(user, now)].monthlyPresentations;

    await tx.usageCounter.upsert({
      where: { userId_period: { userId: ownerId, period } },
      create: { userId: ownerId, period, presentationsCreated: 0 },
      update: {},
    });

    const reserved = await tx.usageCounter.updateMany({
      where: { userId: ownerId, period, presentationsCreated: { lt: limit } },
      data: { presentationsCreated: { increment: 1 } },
    });
    if (reserved.count === 1) return;

    const current = await tx.usageCounter.findUnique({
      where: { userId_period: { userId: ownerId, period } },
      select: { presentationsCreated: true },
    });
    const used = current?.presentationsCreated ?? limit;
    throw new ApiError(
      HttpStatus.TOO_MANY_REQUESTS,
      "MONTHLY_PRESENTATION_LIMIT_REACHED",
      "Лимит на этот месяц исчерпан",
      { limit, used, resetsAt: this.nextResetAt(now) },
    );
  }
}

function effectivePlan(user: {
  planCode: PlanCode;
  planOverride: PlanCode | null;
  planOverrideStartsAt: Date | null;
  planOverrideExpiresAt: Date | null;
}, now: Date): PlanCode {
  const active = user.planOverride
    && (!user.planOverrideStartsAt || user.planOverrideStartsAt <= now)
    && (!user.planOverrideExpiresAt || user.planOverrideExpiresAt > now);
  return active ? user.planOverride! : user.planCode;
}

function usageSummary(planCode: PlanCode, used: number, period: string, resetsAt: string) {
  const limit = planLimits[planCode].monthlyPresentations;
  const exhausted = used >= limit;
  return {
    planCode,
    period,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetsAt,
    exhausted,
    canCreate: !exhausted,
  };
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

function zonedWallTimeToUtc(wallTimeUtcGuess: number, timeZone: string) {
  let result = wallTimeUtcGuess;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(new Date(result), timeZone);
    const representedWallTime = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    result += wallTimeUtcGuess - representedWallTime;
  }
  return new Date(result);
}
