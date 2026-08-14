import { z } from "zod";
export const adminPeriodSchema = z.enum(["today", "7d", "30d", "month", "all", "custom"]);
export type AdminPeriod = z.infer<typeof adminPeriodSchema>;

export const adminTimeRangeSchema = z.object({
  period: adminPeriodSchema.default("30d"),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
}).superRefine((value, context) => {
  if (value.period === "custom" && (!value.from || !value.to)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Для произвольного периода нужны from и to" });
  }
});
export type AdminTimeRange = z.infer<typeof adminTimeRangeSchema>;

export const adminListQuerySchema = z.object({
  period: adminPeriodSchema.default("30d"),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  search: z.string().trim().max(160).optional(),
  status: z.string().trim().max(80).optional(),
  provider: z.string().trim().max(80).optional(),
  model: z.string().trim().max(160).optional(),
  plan: z.enum(["free", "student", "pro"]).optional(),
  category: z.string().trim().max(80).optional(),
  measurement: z.enum(["provider_reported", "calculated"]).optional(),
  severity: z.enum(["info", "warn", "error", "critical"]).optional(),
  service: z.enum(["web", "api", "worker"]).optional(),
  userId: z.string().trim().max(80).optional(),
  projectId: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.string().trim().max(80).optional(),
  direction: z.enum(["asc", "desc"]).default("desc"),
});
export type AdminListQuery = z.infer<typeof adminListQuerySchema>;

export const adminMoneySchema = z.object({
  source: z.string().nullable(),
  sourceCurrency: z.string().nullable(),
  rubAtEvent: z.string().nullable(),
  rubCurrent: z.string().nullable(),
  complete: z.boolean(),
});
export type AdminMoney = z.infer<typeof adminMoneySchema>;

export const adminMetricSchema = z.object({
  value: z.string(),
  previous: z.string().nullable(),
  changePercent: z.string().nullable(),
  complete: z.boolean().default(true),
});

export const adminOverviewSchema = z.object({
  range: z.object({ from: z.string().datetime().nullable(), to: z.string().datetime(), timeZone: z.literal("Europe/Moscow") }),
  localAccess: z.boolean(),
  users: z.object({ total: z.number().int(), new: z.number().int(), active: z.number().int() }),
  revenue: z.object({ grossRub: z.string(), refundsRub: z.string(), feesRub: z.string(), netRub: z.string(), activeSubscriptions: z.number().int() }),
  costs: z.object({ totalRubAtEvent: z.string(), totalRubCurrent: z.string(), unknownCount: z.number().int(), trackedSince: z.string().datetime().nullable() }),
  errors: z.object({ total: z.number().int(), critical: z.number().int(), generationFailureRate: z.string() }),
  trend: z.array(z.object({ date: z.string(), revenueRub: z.string(), costRub: z.string(), errors: z.number().int() })),
  incidents: z.array(z.object({ id: z.string(), severity: z.string(), message: z.string(), service: z.string(), occurredAt: z.string().datetime(), fingerprint: z.string() })),
  failedGenerations: z.array(z.object({ id: z.string(), projectId: z.string(), projectTitle: z.string(), kind: z.string(), error: z.string().nullable(), updatedAt: z.string().datetime() })),
});
export type AdminOverview = z.infer<typeof adminOverviewSchema>;

export const adminUserRowSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  image: z.string().nullable(),
  telegramId: z.string().nullable(),
  telegramUsername: z.string().nullable(),
  planCode: z.enum(["free", "student", "pro"]),
  effectivePlanCode: z.enum(["free", "student", "plus", "pro"]),
  subscriptionStatus: z.string().nullable(),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime().nullable(),
  blockedAt: z.string().datetime().nullable(),
  projects: z.number().int(),
  generations: z.number().int(),
  errors: z.number().int(),
  aiCostRub: z.string().nullable(),
  totalCostRub: z.string().nullable(),
  revenueRub: z.string(),
  marginRub: z.string().nullable(),
});
export type AdminUserRow = z.infer<typeof adminUserRowSchema>;

export const adminUsersResponseSchema = z.object({
  items: z.array(adminUserRowSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>;

export const adminUserDetailSchema = z.object({
  user: adminUserRowSchema.extend({
    email: z.string().nullable(),
    updatedAt: z.string().datetime(),
    blockReason: z.string().nullable(),
    planOverride: z.enum(["free", "student", "pro"]).nullable(),
    planOverrideStartsAt: z.string().datetime().nullable(),
    planOverrideExpiresAt: z.string().datetime().nullable(),
    planOverrideReason: z.string().nullable(),
  }),
  totals: z.object({ slides: z.number().int(), exports: z.number().int(), payments: z.number().int(), activity: z.number().int() }),
  projects: z.array(z.object({ id: z.string(), title: z.string(), status: z.string(), slideCount: z.number().int(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() })),
  generations: z.array(z.object({ id: z.string(), projectId: z.string(), projectTitle: z.string(), kind: z.string(), status: z.string(), progressLabel: z.string(), error: z.string().nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() })),
  costs: z.array(z.object({ id: z.string(), category: z.string(), provider: z.string(), sourceCost: z.string().nullable(), sourceCurrency: z.string().nullable(), rubCostAtEvent: z.string().nullable(), measurement: z.string(), occurredAt: z.string().datetime() })),
  payments: z.array(z.object({ id: z.string(), type: z.string(), status: z.string(), grossAmount: z.string(), feeAmount: z.string(), netAmount: z.string(), currency: z.string(), netRubAtEvent: z.string().nullable(), occurredAt: z.string().datetime() })),
  errors: z.array(z.object({ id: z.string(), severity: z.string(), service: z.string(), message: z.string(), fingerprint: z.string(), occurredAt: z.string().datetime() })),
  activity: z.array(z.object({ id: z.string(), type: z.string(), occurredAt: z.string().datetime(), projectId: z.string().nullable(), metadata: z.record(z.unknown()).nullable() })),
  audit: z.array(z.object({ id: z.string(), action: z.string(), reason: z.string().nullable(), occurredAt: z.string().datetime(), actorUserId: z.string() })),
  sensitiveContentHidden: z.literal(true),
});
export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>;

export const adminReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const adminPlanOverrideSchema = adminReasonSchema.extend({
  plan: z.enum(["free", "student", "pro"]),
  startsAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});
export type AdminPlanOverrideInput = z.infer<typeof adminPlanOverrideSchema>;

export const adminActionResultSchema = z.object({ ok: z.literal(true), message: z.string(), auditId: z.string().optional() });
export type AdminActionResult = z.infer<typeof adminActionResultSchema>;
