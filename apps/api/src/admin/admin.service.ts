import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { AdminListQuery, AdminPlanOverrideInput } from "@studydeck/shared";
import { Prisma } from "@prisma/client";
import type { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service.js";
import { ProjectStorageService } from "../storage/project-storage.service.js";
import { generationJobOptions } from "../jobs/job-options.js";
import { adminRange } from "./admin-time.js";

const ZERO = "0";

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ProjectStorageService,
    @InjectQueue("generation") private readonly generationQueue: Queue,
    @InjectQueue("exports") private readonly exportsQueue: Queue,
  ) {}

  async overview(query: AdminListQuery) {
    const range = adminRange(query);
    const createdAt = dateFilter(range.from, range.to);
    const occurredAt = dateFilter(range.from, range.to);
    const [totalUsers, newUsers, activeUsers, revenue, aiCost, otherCost, errorCount, criticalCount, completedJobs, failedJobs, incidents, failedGenerations, activeSubscriptions, tracked] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt } }),
      this.prisma.user.count({ where: { lastSeenAt: occurredAt } }),
      this.prisma.paymentTransaction.aggregate({ where: { occurredAt }, _sum: { grossRubAtEvent: true, feeRubAtEvent: true, netRubAtEvent: true } }),
      this.prisma.aiUsageEvent.aggregate({ where: { createdAt }, _sum: { rubCostAtEvent: true }, _count: true }),
      this.prisma.costEvent.aggregate({ where: { occurredAt }, _sum: { rubCostAtEvent: true }, _count: true }),
      this.prisma.operationalEvent.count({ where: { occurredAt, severity: { in: ["error", "critical"] } } }),
      this.prisma.operationalEvent.count({ where: { occurredAt, severity: "critical" } }),
      this.prisma.generationJob.count({ where: { createdAt, status: "completed" } }),
      this.prisma.generationJob.count({ where: { createdAt, status: "failed" } }),
      this.prisma.operationalEvent.findMany({ where: { occurredAt, severity: { in: ["error", "critical"] } }, orderBy: { occurredAt: "desc" }, take: 8 }),
      this.prisma.generationJob.findMany({ where: { createdAt, status: "failed" }, include: { project: { select: { title: true } } }, orderBy: { updatedAt: "desc" }, take: 8 }),
      this.prisma.user.count({ where: { subscriptionStatus: { in: ["active", "trialing"] } } }),
      this.prisma.aiUsageEvent.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    ]);
    const gross = decimal(revenue._sum.grossRubAtEvent);
    const net = decimal(revenue._sum.netRubAtEvent);
    const fees = decimal(revenue._sum.feeRubAtEvent);
    const costs = add(decimal(aiCost._sum.rubCostAtEvent), decimal(otherCost._sum.rubCostAtEvent));
    const currentCosts = await this.currentCostTotal(range.from, range.to);
    const unknownCount = await this.prisma.aiUsageEvent.count({ where: { createdAt, status: { in: ["unknown_price", "unknown_usage"] } } });
    const jobs = completedJobs + failedJobs;
    return {
      range: { from: range.from?.toISOString() || null, to: range.to.toISOString(), timeZone: range.timeZone },
      localAccess: process.env.ALLOW_DEV_ADMIN === "true" && process.env.DEPLOYMENT_ENV !== "production",
      users: { total: totalUsers, new: newUsers, active: activeUsers },
      revenue: { grossRub: gross, refundsRub: subtract(gross, add(net, fees)), feesRub: fees, netRub: net, activeSubscriptions },
      costs: { totalRubAtEvent: costs, totalRubCurrent: currentCosts, unknownCount, trackedSince: tracked?.createdAt.toISOString() || null },
      errors: { total: errorCount, critical: criticalCount, generationFailureRate: jobs ? ((failedJobs / jobs) * 100).toFixed(2) : ZERO },
      trend: [],
      incidents: incidents.map((item) => ({ id: item.id, severity: item.severity, message: item.message, service: item.service, occurredAt: item.occurredAt.toISOString(), fingerprint: item.fingerprint })),
      failedGenerations: failedGenerations.map((item) => ({ id: item.id, projectId: item.projectId, projectTitle: item.project.title, kind: item.kind, error: item.error, updatedAt: item.updatedAt.toISOString() })),
    };
  }

  async users(query: AdminListQuery) {
    const where: Prisma.UserWhereInput = query.search ? {
      OR: [
        { id: { contains: query.search, mode: "insensitive" } },
        { name: { contains: query.search, mode: "insensitive" } },
        { telegramUsername: { contains: query.search, mode: "insensitive" } },
        { telegramId: { contains: query.search } },
      ],
    } : {};
    if (query.plan) where.planCode = query.plan;
    if (query.status === "blocked") where.blockedAt = { not: null };
    if (query.status === "active") where.blockedAt = null;
    const skip = (query.page - 1) * query.pageSize;
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, orderBy: { createdAt: query.direction }, skip, take: query.pageSize, include: { _count: { select: { projects: true } } } }),
      this.prisma.user.count({ where }),
    ]);
    const rows = await Promise.all(items.map((user) => this.userRow(user)));
    return { items: rows, page: query.page, pageSize: query.pageSize, total };
  }

  async user(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { _count: { select: { projects: true } } } });
    if (!user) throw new NotFoundException("Пользователь не найден");
    const row = await this.userRow(user);
    const [projects, generations, costs, payments, errors, activity, audit, slides, exportsCount] = await Promise.all([
      this.prisma.project.findMany({ where: { userId: id }, select: { id: true, title: true, status: true, slideCount: true, createdAt: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 50 }),
      this.prisma.generationJob.findMany({ where: { project: { userId: id } }, include: { project: { select: { title: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
      this.prisma.costEvent.findMany({ where: { userId: id }, orderBy: { occurredAt: "desc" }, take: 50 }),
      this.prisma.paymentTransaction.findMany({ where: { userId: id }, orderBy: { occurredAt: "desc" }, take: 50 }),
      this.prisma.operationalEvent.findMany({ where: { userId: id, severity: { in: ["error", "critical"] } }, orderBy: { occurredAt: "desc" }, take: 50 }),
      this.prisma.userActivityEvent.findMany({ where: { userId: id }, orderBy: { occurredAt: "desc" }, take: 50 }),
      this.prisma.adminAuditLog.findMany({ where: { targetType: "user", targetId: id }, orderBy: { occurredAt: "desc" }, take: 50 }),
      this.prisma.project.aggregate({ where: { userId: id }, _sum: { slideCount: true } }),
      this.prisma.export.count({ where: { project: { userId: id } } }),
    ]);
    return {
      user: { ...row, email: user.email, updatedAt: user.updatedAt.toISOString(), blockReason: user.blockReason, planOverride: user.planOverride, planOverrideStartsAt: iso(user.planOverrideStartsAt), planOverrideExpiresAt: iso(user.planOverrideExpiresAt), planOverrideReason: user.planOverrideReason },
      totals: { slides: slides._sum.slideCount || 0, exports: exportsCount, payments: payments.length, activity: activity.length },
      projects: projects.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() })),
      generations: generations.map((item) => ({ id: item.id, projectId: item.projectId, projectTitle: item.project.title, kind: item.kind, status: item.status, progressLabel: item.progressLabel, error: item.error, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() })),
      costs: costs.map((item) => ({ id: item.id, category: item.category, provider: item.provider, sourceCost: nullableDecimal(item.sourceCost), sourceCurrency: item.sourceCurrency, rubCostAtEvent: nullableDecimal(item.rubCostAtEvent), measurement: item.measurement, occurredAt: item.occurredAt.toISOString() })),
      payments: payments.map((item) => ({ id: item.id, type: item.type, status: item.status, grossAmount: decimal(item.grossAmount), feeAmount: decimal(item.feeAmount), netAmount: decimal(item.netAmount), currency: item.currency, netRubAtEvent: nullableDecimal(item.netRubAtEvent), occurredAt: item.occurredAt.toISOString() })),
      errors: errors.map((item) => ({ id: item.id, severity: item.severity, service: item.service, message: item.message, fingerprint: item.fingerprint, occurredAt: item.occurredAt.toISOString() })),
      activity: activity.map((item) => ({ id: item.id, type: item.type, occurredAt: item.occurredAt.toISOString(), projectId: item.projectId, metadata: recordOrNull(item.metadata) })),
      audit: audit.map((item) => ({ id: item.id, action: item.action, reason: item.reason, occurredAt: item.occurredAt.toISOString(), actorUserId: item.actorUserId })),
      sensitiveContentHidden: true as const,
    };
  }

  async costs(query: AdminListQuery) {
    const range = adminRange(query);
    const aiWhere: Prisma.AiUsageEventWhereInput = { createdAt: dateFilter(range.from, range.to) };
    if (query.provider) aiWhere.provider = query.provider;
    if (query.model) aiWhere.model = query.model;
    if (query.userId) aiWhere.userId = query.userId;
    if (query.projectId) aiWhere.projectId = query.projectId;
    const costWhere: Prisma.CostEventWhereInput = { occurredAt: dateFilter(range.from, range.to) };
    if (query.provider) costWhere.provider = query.provider;
    if (query.category) costWhere.category = query.category as Prisma.EnumCostCategoryFilter;
    if (query.measurement) costWhere.measurement = query.measurement;
    if (query.userId) costWhere.userId = query.userId;
    if (query.projectId) costWhere.projectId = query.projectId;
    const envelopeWhere: Prisma.CostEnvelopeWhereInput = { createdAt: dateFilter(range.from, range.to) };
    if (query.projectId) envelopeWhere.projectId = query.projectId;
    if (query.userId) envelopeWhere.project = { userId: query.userId };
    const [ai, other, aiSum, otherSum, unknownCount, envelopes] = await Promise.all([
      this.prisma.aiUsageEvent.findMany({ where: aiWhere, orderBy: { createdAt: "desc" }, take: query.pageSize, skip: (query.page - 1) * query.pageSize }),
      this.prisma.costEvent.findMany({ where: costWhere, orderBy: { occurredAt: "desc" }, take: query.pageSize, skip: (query.page - 1) * query.pageSize }),
      this.prisma.aiUsageEvent.aggregate({ where: aiWhere, _sum: { rubCostAtEvent: true } }),
      this.prisma.costEvent.aggregate({ where: costWhere, _sum: { rubCostAtEvent: true } }),
      this.prisma.aiUsageEvent.count({ where: { ...aiWhere, status: { in: ["unknown_price", "unknown_usage"] } } }),
      this.prisma.costEnvelope.findMany({
        where: envelopeWhere,
        orderBy: { createdAt: "desc" },
        take: query.pageSize,
        include: {
          reservations: { orderBy: { createdAt: "asc" } },
          aiUsageEvents: { select: { provider: true, model: true } },
          costEvents: { select: { category: true, provider: true, quantity: true, sourceCost: true, sourceCurrency: true, rubCostAtEvent: true, measurement: true } },
        },
      }),
    ]);
    const currentTotal = await this.currentCostTotal(range.from, range.to);
    return {
      summary: { totalRubAtEvent: add(decimal(aiSum._sum.rubCostAtEvent), decimal(otherSum._sum.rubCostAtEvent)), totalRubCurrent: currentTotal, unknownCount },
      ai: ai.map((item) => ({ id: item.id, provider: item.provider, model: item.model, stage: item.stage, status: item.status, inputTokens: item.inputTokens, outputTokens: item.outputTokens, cachedInputTokens: item.cachedInputTokens, cacheWriteTokens: item.cacheWriteTokens, reasoningTokens: item.reasoningTokens, sourceCost: nullableDecimal(item.sourceCost), sourceCurrency: item.sourceCurrency, rubCostAtEvent: nullableDecimal(item.rubCostAtEvent), occurredAt: item.createdAt.toISOString() })),
      other: other.map((item) => ({ id: item.id, category: item.category, provider: item.provider, quantity: decimal(item.quantity), unit: item.unit, sourceCost: nullableDecimal(item.sourceCost), sourceCurrency: item.sourceCurrency, rubCostAtEvent: nullableDecimal(item.rubCostAtEvent), measurement: item.measurement, occurredAt: item.occurredAt.toISOString() })),
      envelopes: envelopes.map((envelope) => {
        const terminal = envelope.reservations.find((item) => !["settled", "released"].includes(item.status));
        const tavilyQueries = envelope.costEvents
          .filter((item) => item.provider === "tavily" && (item.category === "web_search" || item.category === "image_search"))
          .reduce((total, item) => total + Number(item.quantity), 0);
        return {
          id: envelope.id,
          projectId: envelope.projectId,
          policyVersion: envelope.policyVersion,
          status: envelope.status,
          limitRub: decimal(envelope.limitRub),
          reservedRub: decimal(envelope.reservedRub),
          settledRub: decimal(envelope.settledRub),
          remainingRub: subtract(subtract(decimal(envelope.limitRub), decimal(envelope.reservedRub)), decimal(envelope.settledRub)),
          terminationReason: terminal?.reason || (envelope.status === "active" ? null : envelope.status),
          tavilyQueries,
          actualModels: [...new Set(envelope.aiUsageEvents.map((item) => `${item.provider}:${item.model}`))],
          reservations: envelope.reservations.map((item) => ({ id: item.id, bucket: item.bucket, stage: item.stage, status: item.status, reservedRub: decimal(item.reservedRub), settledRub: decimal(item.settledRub), releasedRub: decimal(item.releasedRub), reason: item.reason })),
          costSources: envelope.costEvents.map((item) => ({ category: item.category, provider: item.provider, quantity: decimal(item.quantity), sourceCost: nullableDecimal(item.sourceCost), currency: item.sourceCurrency, rubCostAtEvent: nullableDecimal(item.rubCostAtEvent), measurement: item.measurement })),
          createdAt: envelope.createdAt.toISOString(),
        };
      }),
    };
  }

  async revenue(query: AdminListQuery) {
    const range = adminRange(query);
    const where = { occurredAt: dateFilter(range.from, range.to) };
    const [items, totals] = await Promise.all([
      this.prisma.paymentTransaction.findMany({ where, orderBy: { occurredAt: "desc" }, take: query.pageSize, skip: (query.page - 1) * query.pageSize }),
      this.prisma.paymentTransaction.aggregate({ where, _sum: { grossRubAtEvent: true, feeRubAtEvent: true, netRubAtEvent: true } }),
    ]);
    return { totals: { grossRub: decimal(totals._sum.grossRubAtEvent), feesRub: decimal(totals._sum.feeRubAtEvent), netRub: decimal(totals._sum.netRubAtEvent) }, items: items.map((item) => ({ ...safePayment(item), occurredAt: item.occurredAt.toISOString() })) };
  }

  async generations(query: AdminListQuery) {
    const range = adminRange(query);
    const where: Prisma.GenerationJobWhereInput = { createdAt: dateFilter(range.from, range.to) };
    if (query.status) where.status = query.status as Prisma.EnumJobStatusFilter;
    if (query.projectId) where.projectId = query.projectId;
    const [items, total] = await Promise.all([
      this.prisma.generationJob.findMany({ where, include: { project: { select: { title: true, userId: true } } }, orderBy: { createdAt: "desc" }, take: query.pageSize, skip: (query.page - 1) * query.pageSize }),
      this.prisma.generationJob.count({ where }),
    ]);
    return { items: items.map((item) => ({ ...item, projectTitle: item.project.title, userId: item.project.userId, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(), cancelRequestedAt: iso(item.cancelRequestedAt), project: undefined })), total, page: query.page, pageSize: query.pageSize };
  }

  async events(query: AdminListQuery) {
    const range = adminRange(query);
    const where: Prisma.OperationalEventWhereInput = { occurredAt: dateFilter(range.from, range.to) };
    if (query.severity) where.severity = query.severity;
    else if (query.status === "_errors") where.severity = { in: ["error", "critical"] };
    if (query.service) where.service = query.service;
    if (query.search) where.OR = [{ message: { contains: query.search, mode: "insensitive" } }, { fingerprint: { contains: query.search, mode: "insensitive" } }];
    const [items, total] = await Promise.all([
      this.prisma.operationalEvent.findMany({ where, orderBy: { occurredAt: "desc" }, take: query.pageSize, skip: (query.page - 1) * query.pageSize }),
      this.prisma.operationalEvent.count({ where }),
    ]);
    return { items: items.map((item) => ({ ...item, occurredAt: item.occurredAt.toISOString(), expiresAt: item.expiresAt.toISOString() })), total, page: query.page, pageSize: query.pageSize };
  }

  async audit(query: AdminListQuery) {
    const range = adminRange(query);
    const where: Prisma.AdminAuditLogWhereInput = { occurredAt: dateFilter(range.from, range.to) };
    if (query.search) where.OR = [{ action: { contains: query.search, mode: "insensitive" } }, { targetId: { contains: query.search, mode: "insensitive" } }];
    const [items, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({ where, include: { actor: { select: { name: true, telegramUsername: true } } }, orderBy: { occurredAt: "desc" }, take: query.pageSize, skip: (query.page - 1) * query.pageSize }),
      this.prisma.adminAuditLog.count({ where }),
    ]);
    return { items: items.map((item) => ({ ...item, occurredAt: item.occurredAt.toISOString() })), total, page: query.page, pageSize: query.pageSize };
  }

  alerts() {
    return {
      enabled: process.env.ADMIN_ALERTS_ENABLED === "true" && process.env.DEPLOYMENT_ENV === "production",
      productionOnly: true,
      rules: [
        { id: "critical-errors", label: "Критические ошибки", enabled: true, threshold: null },
        { id: "daily-cost", label: "Дневной бюджет", enabled: Boolean(process.env.ADMIN_DAILY_COST_ALERT_RUB), threshold: process.env.ADMIN_DAILY_COST_ALERT_RUB || null },
        { id: "error-burst", label: "Всплеск одинаковых ошибок", enabled: Boolean(process.env.ADMIN_ERROR_BURST_THRESHOLD), threshold: process.env.ADMIN_ERROR_BURST_THRESHOLD || null },
        { id: "unknown-price", label: "Неизвестная цена модели", enabled: true, threshold: null },
        { id: "health-readiness", label: "Readiness 503", enabled: true, threshold: null },
        { id: "health-worker-heartbeat", label: "Heartbeat worker", enabled: true, threshold: "45s" },
        { id: "health-queue-lag", label: "Очереди", enabled: true, threshold: `${process.env.HEALTH_QUEUE_WAITING_MAX || 20} jobs / ${process.env.HEALTH_QUEUE_LAG_MAX_AGE_MS || 300_000}ms` },
      ],
    };
  }

  async block(actorUserId: string, userId: string, reason: string) {
    if (actorUserId === userId) throw new BadRequestException("Нельзя заблокировать собственный аккаунт администратора");
    return this.mutateUser(actorUserId, userId, "user.block", reason, { blockedAt: new Date(), blockedBy: { connect: { id: actorUserId } }, blockReason: reason }, "Пользователь заблокирован");
  }

  async unblock(actorUserId: string, userId: string) {
    return this.mutateUser(actorUserId, userId, "user.unblock", null, { blockedAt: null, blockedBy: { disconnect: true }, blockReason: null }, "Пользователь разблокирован");
  }

  async setPlanOverride(actorUserId: string, userId: string, input: AdminPlanOverrideInput) {
    await this.ensureActor(actorUserId);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException("Пользователь не найден");
    const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= startsAt) throw new BadRequestException("Окончание override должно быть позже начала");
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { planOverride: input.plan, planOverrideStartsAt: startsAt, planOverrideExpiresAt: expiresAt, planOverrideReason: input.reason, planOverrideActor: { connect: { id: actorUserId } } } });
      return tx.adminAuditLog.create({ data: { actorUserId, action: "user.plan_override.set", targetType: "user", targetId: userId, reason: input.reason, metadata: { plan: input.plan, startsAt: startsAt.toISOString(), expiresAt: expiresAt?.toISOString() || null } } });
    });
    return { ok: true as const, message: "Ручной тариф назначен", auditId: result.id };
  }

  async clearPlanOverride(actorUserId: string, userId: string) {
    return this.mutateUser(actorUserId, userId, "user.plan_override.clear", null, { planOverride: null, planOverrideStartsAt: null, planOverrideExpiresAt: null, planOverrideReason: null, planOverrideActor: { disconnect: true } }, "Ручной тариф отключён");
  }

  async retryGeneration(actorUserId: string, id: string) {
    await this.ensureActor(actorUserId);
    const previous = await this.prisma.generationJob.findUnique({ where: { id }, include: { project: true } });
    if (!previous) throw new NotFoundException("Генерация не найдена");
    if (previous.status !== "failed") throw new ConflictException("Повтор доступен только для неуспешной генерации");
    if (previous.kind !== "narration" && previous.kind !== "presentation") {
      throw new BadRequestException("Повтор этой служебной проверки запустите из рабочего пространства защиты");
    }
    const created = await this.prisma.generationJob.create({ data: { projectId: previous.projectId, kind: previous.kind, status: "queued" } });
    const queueName = previous.kind === "narration" ? "generate-narration" : "generate-presentation";
    const queueJob = await this.generationQueue.add(queueName, { projectId: previous.projectId, userId: previous.project.userId }, generationJobOptions());
    await this.prisma.$transaction([
      this.prisma.generationJob.update({ where: { id: created.id }, data: { queueJobId: queueJob.id } }),
      this.prisma.project.update({ where: { id: previous.projectId }, data: { status: previous.kind === "narration" ? "script_queued" : "queued", error: null } }),
      this.prisma.adminAuditLog.create({ data: { actorUserId, action: "generation.retry", targetType: "generation", targetId: id, metadata: { replacementJobId: created.id } } }),
    ]);
    return { ok: true as const, message: "Генерация поставлена в очередь повторно" };
  }

  async cancelGeneration(actorUserId: string, id: string, reason: string) {
    await this.ensureActor(actorUserId);
    const item = await this.prisma.generationJob.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("Генерация не найдена");
    if (!["queued", "active"].includes(item.status)) throw new ConflictException("Эту генерацию уже нельзя отменить");
    if (item.status === "queued" && item.queueJobId) await (await this.generationQueue.getJob(item.queueJobId))?.remove();
    const audit = await this.prisma.$transaction(async (tx) => {
      await tx.generationJob.update({ where: { id }, data: { cancelRequestedAt: new Date(), ...(item.status === "queued" ? { status: "failed", error: "Отменено администратором", progressStage: "failed", progressLabel: "Отменено" } : {}) } });
      return tx.adminAuditLog.create({ data: { actorUserId, action: "generation.cancel", targetType: "generation", targetId: id, reason } });
    });
    return { ok: true as const, message: item.status === "active" ? "Запрошена безопасная отмена генерации" : "Генерация отменена", auditId: audit.id };
  }

  async retryExport(actorUserId: string, id: string) {
    await this.ensureActor(actorUserId);
    const item = await this.prisma.export.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("Экспорт не найден");
    if (item.status !== "failed") throw new ConflictException("Повтор доступен только для неуспешного экспорта");
    const queueJob = await this.exportsQueue.add("export-presentation", { exportId: item.id, projectId: item.projectId, type: item.type }, { attempts: 2 });
    await this.prisma.$transaction([
      this.prisma.export.update({ where: { id }, data: { status: "queued", error: null, queueJobId: queueJob.id } }),
      this.prisma.adminAuditLog.create({ data: { actorUserId, action: "export.retry", targetType: "export", targetId: id } }),
    ]);
    return { ok: true as const, message: "Экспорт поставлен в очередь повторно" };
  }

  async deleteProject(actorUserId: string, id: string, reason: string) {
    await this.ensureActor(actorUserId);
    const project = await this.prisma.project.findUnique({ where: { id }, select: { id: true, title: true } });
    if (!project) throw new NotFoundException("Проект не найден");
    await this.storage.deleteProjectPrefix(id);
    const audit = await this.prisma.$transaction(async (tx) => {
      await tx.project.delete({ where: { id } });
      return tx.adminAuditLog.create({ data: { actorUserId, action: "project.delete", targetType: "project", targetId: id, reason, metadata: { title: project.title } } });
    });
    return { ok: true as const, message: "Проект удалён", auditId: audit.id };
  }

  private async userRow(user: { id: string; name: string | null; image: string | null; telegramId: string | null; telegramUsername: string | null; planCode: "free" | "student" | "plus" | "pro"; subscriptionStatus: string | null; createdAt: Date; lastSeenAt: Date | null; blockedAt: Date | null; planOverride: "free" | "student" | "plus" | "pro" | null; planOverrideStartsAt: Date | null; planOverrideExpiresAt: Date | null; _count: { projects: number } }) {
    const now = new Date();
    const effectivePlanCode = user.planOverride && (!user.planOverrideStartsAt || user.planOverrideStartsAt <= now) && (!user.planOverrideExpiresAt || user.planOverrideExpiresAt > now) ? user.planOverride : user.planCode;
    const [generations, errors, ai, costs, revenue] = await Promise.all([
      this.prisma.generationJob.count({ where: { project: { userId: user.id } } }),
      this.prisma.operationalEvent.count({ where: { userId: user.id, severity: { in: ["error", "critical"] } } }),
      this.prisma.aiUsageEvent.aggregate({ where: { userId: user.id }, _sum: { rubCostAtEvent: true }, _count: true }),
      this.prisma.costEvent.aggregate({ where: { userId: user.id }, _sum: { rubCostAtEvent: true } }),
      this.prisma.paymentTransaction.aggregate({ where: { userId: user.id }, _sum: { netRubAtEvent: true } }),
    ]);
    const aiCost = nullableDecimal(ai._sum.rubCostAtEvent);
    const totalCost = aiCost === null && !costs._sum.rubCostAtEvent ? null : add(aiCost || ZERO, decimal(costs._sum.rubCostAtEvent));
    const revenueRub = decimal(revenue._sum.netRubAtEvent);
    return { id: user.id, name: user.name, image: user.image, telegramId: user.telegramId, telegramUsername: user.telegramUsername, planCode: user.planCode, effectivePlanCode, subscriptionStatus: user.subscriptionStatus, createdAt: user.createdAt.toISOString(), lastSeenAt: iso(user.lastSeenAt), blockedAt: iso(user.blockedAt), projects: user._count.projects, generations, errors, aiCostRub: aiCost, totalCostRub: totalCost, revenueRub, marginRub: totalCost === null ? null : subtract(revenueRub, totalCost) };
  }

  private async mutateUser(actorUserId: string, userId: string, action: string, reason: string | null, data: Prisma.UserUpdateInput, message: string) {
    await this.ensureActor(actorUserId);
    const exists = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!exists) throw new NotFoundException("Пользователь не найден");
    const audit = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data });
      return tx.adminAuditLog.create({ data: { actorUserId, action, targetType: "user", targetId: userId, reason } });
    });
    return { ok: true as const, message, auditId: audit.id };
  }

  private async ensureActor(actorUserId: string) {
    await this.prisma.user.upsert({ where: { id: actorUserId }, create: { id: actorUserId }, update: {} });
  }

  private async currentCostTotal(from: Date | null, to: Date) {
    const fromSql = from ? Prisma.sql`AND "occurredAt" >= ${from}` : Prisma.empty;
    const aiFromSql = from ? Prisma.sql`AND "createdAt" >= ${from}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Array<{ total: Prisma.Decimal | null }>>(Prisma.sql`
      SELECT SUM(
        CASE
          WHEN costs."sourceCurrency" = 'RUB' THEN costs."sourceCost"
          ELSE costs."sourceCost" * COALESCE(
            (SELECT rate."rate" FROM "ExchangeRate" rate WHERE rate."baseCurrency" = costs."sourceCurrency" AND rate."quoteCurrency" = 'RUB' ORDER BY rate."effectiveAt" DESC LIMIT 1),
            costs."exchangeRateToRub"
          )
        END
      ) AS total
      FROM (
        SELECT "sourceCurrency", "sourceCost", "exchangeRateToRub" FROM "AiUsageEvent" WHERE "createdAt" <= ${to} ${aiFromSql}
        UNION ALL
        SELECT "sourceCurrency", "sourceCost", "exchangeRateToRub" FROM "CostEvent" WHERE "occurredAt" <= ${to} ${fromSql}
      ) costs
    `);
    return decimal(rows[0]?.total);
  }
}

function dateFilter(from: Date | null, to: Date) { return { ...(from ? { gte: from } : {}), lte: to }; }
function iso(value: Date | null | undefined) { return value ? value.toISOString() : null; }
function decimal(value: { toString(): string } | string | number | null | undefined) { return value == null ? ZERO : value.toString(); }
function nullableDecimal(value: { toString(): string } | string | number | null | undefined) { return value == null ? null : value.toString(); }
function add(left: string, right: string) { return (BigInt(toMicros(left)) + BigInt(toMicros(right))).toString().replace(/(\d{6})$/, ".$1").replace(/^\./, "0."); }
function subtract(left: string, right: string) { const value = BigInt(toMicros(left)) - BigInt(toMicros(right)); const sign = value < 0n ? "-" : ""; const absolute = value < 0n ? -value : value; const text = absolute.toString().padStart(7, "0"); return `${sign}${text.slice(0, -6)}.${text.slice(-6)}`; }
function toMicros(value: string) { const [whole, fraction = ""] = value.split("."); return `${whole || "0"}${fraction.padEnd(6, "0").slice(0, 6)}`; }
function recordOrNull(value: Prisma.JsonValue | null): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function safePayment(item: { id: string; userId: string | null; type: string; status: string; grossAmount: { toString(): string }; feeAmount: { toString(): string }; netAmount: { toString(): string }; currency: string; grossRubAtEvent: { toString(): string } | null; feeRubAtEvent: { toString(): string } | null; netRubAtEvent: { toString(): string } | null }) { return { id: item.id, userId: item.userId, type: item.type, status: item.status, grossAmount: decimal(item.grossAmount), feeAmount: decimal(item.feeAmount), netAmount: decimal(item.netAmount), currency: item.currency, grossRubAtEvent: nullableDecimal(item.grossRubAtEvent), feeRubAtEvent: nullableDecimal(item.feeRubAtEvent), netRubAtEvent: nullableDecimal(item.netRubAtEvent) }; }
