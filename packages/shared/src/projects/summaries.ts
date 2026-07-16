import { z } from "zod";
import { planCodeSchema } from "../billing/limits.js";
import { exportStatusSchema, exportTypeSchema } from "../exports/schemas.js";
import { folderColorSchema, projectAccessRoleSchema, projectMemberRoleSchema, projectStatusSchema } from "./schemas.js";
export const isoDateTimeSchema = z
  .union([z.string().datetime({ offset: true }), z.date()])
  .transform((value) => (value instanceof Date ? value.toISOString() : value));

export const userIdentitySummarySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  image: z.string().nullable(),
});
export type UserIdentitySummary = z.infer<typeof userIdentitySummarySchema>;

export const projectSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: projectStatusSchema,
  slideCount: z.number().int().nonnegative(),
  updatedAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  error: z.string().nullable(),
  accessRole: projectAccessRoleSchema,
  owner: userIdentitySummarySchema,
  folder: z
    .object({
      id: z.string(),
      name: z.string(),
      color: folderColorSchema,
    })
    .nullable(),
  hasPresentation: z.boolean(),
  latestExport: z
    .object({
      id: z.string(),
      type: exportTypeSchema,
      status: exportStatusSchema,
    })
    .nullable(),
  memberCount: z.number().int().nonnegative(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const folderSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  color: folderColorSchema,
  sortOrder: z.number().int(),
  projectCount: z.number().int().nonnegative(),
  owner: userIdentitySummarySchema,
  isShared: z.boolean(),
});
export type FolderSummary = z.infer<typeof folderSummarySchema>;

export const projectMemberSchema = z.object({
  id: z.string(),
  role: projectMemberRoleSchema,
  createdAt: isoDateTimeSchema,
  user: userIdentitySummarySchema.extend({
    telegramUsername: z.string().nullable(),
  }),
});
export type ProjectMember = z.infer<typeof projectMemberSchema>;

export const usageSummarySchema = z.object({
  planCode: planCodeSchema,
  period: z.string().regex(/^\d{4}-\d{2}$/),
  limit: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  resetsAt: isoDateTimeSchema,
  exhausted: z.boolean(),
});
export type UsageSummary = z.infer<typeof usageSummarySchema>;

export const dashboardSummarySchema = z.object({
  user: userIdentitySummarySchema.extend({
    telegramUsername: z.string().nullable(),
    planCode: planCodeSchema,
  }),
  usage: usageSummarySchema,
  stats: z.object({
    presentationsCreated: z.number().int().nonnegative(),
    slidesCreated: z.number().int().nonnegative(),
    readyPresentations: z.number().int().nonnegative(),
    savedHoursMin: z.number().nonnegative(),
    savedHoursMax: z.number().nonnegative(),
  }),
  recentProjects: z.array(projectSummarySchema).max(5),
  activeProjects: z.array(projectSummarySchema),
  attentionProjects: z.array(projectSummarySchema),
  sharedProjects: z.array(projectSummarySchema).max(5),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
