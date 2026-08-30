import { z } from "zod";
import { defenseSourceMetadataSchema, sourceRoleSchema } from "../defense/schemas.js";
export const scenarioSchema = z.enum([
  "general",
  "university_report",
  "school_report",
  "student_seminar",
  "project_defense",
  "article_presentation",
  "lesson",
]);
export type Scenario = z.infer<typeof scenarioSchema>;

export const projectStatusSchema = z.enum([
  "draft",
  "uploading",
  "script_queued",
  "script_generating",
  "script_ready",
  "queued",
  "generating",
  "ready",
  "failed",
]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const projectAccessRoleSchema = z.enum(["owner", "editor", "viewer"]);
export type ProjectAccessRole = z.infer<typeof projectAccessRoleSchema>;

export const projectMemberRoleSchema = z.enum(["editor", "viewer"]);
export type ProjectMemberRole = z.infer<typeof projectMemberRoleSchema>;

export const folderColorSchema = z.enum(["orange", "green", "purple", "blue", "neutral"]);
export type FolderColor = z.infer<typeof folderColorSchema>;

export const jobStatusSchema = z.enum(["queued", "active", "completed", "failed"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const sourceSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.string(),
  size: z.number().int().nonnegative().optional(),
  excerpt: z.string().default(""),
  objectKey: z.string().optional(),
  url: z.string().url().optional(),
  included: z.boolean().optional(),
  role: sourceRoleSchema.nullable().optional(),
  metadata: defenseSourceMetadataSchema.nullable().optional(),
  parentSourceId: z.string().nullable().optional(),
});
export type Source = z.infer<typeof sourceSchema>;

export const updateSourceReviewInputSchema = z.object({
  included: z.boolean(),
}).strict();
export type UpdateSourceReviewInput = z.infer<typeof updateSourceReviewInputSchema>;

export const sourceRefSchema = z.object({
  sourceId: z.string(),
  label: z.string(),
  excerpt: z.string(),
  page: z.string().nullable().default(null),
});
export type SourceRef = z.infer<typeof sourceRefSchema>;
