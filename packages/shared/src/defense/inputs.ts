import { z } from "zod";
import {
  complianceModeSchema,
  conflictResolutionSchema,
  defenseAuthorProfileSchema,
  defenseJsonValueSchema,
  defensePlanSchema,
  defenseTypeSchema,
  factEvidenceSchema,
  factStateSchema,
  requirementPrioritySchema,
  requirementRuleSchema,
  requirementStateSchema,
  screenshotClassificationSchema,
  sourceRoleSchema,
  uploadSourceRoleSchema,
} from "./schemas.js";

const identifierSchema = z.string().trim().min(1).max(128);
const revisionSchema = z.number().int().nonnegative();
const idempotencyKeySchema = z.string().trim().min(8).max(200);

export const DEFENSE_UPLOAD_MAX_FILES = 20;
export const DEFENSE_UPLOAD_MAX_FILE_BYTES = 100 * 1024 * 1024;

export const createDefenseProjectInputSchema = z
  .object({
    title: z.string().trim().min(2).max(140),
    defenseType: defenseTypeSchema,
    complianceMode: complianceModeSchema,
    targetSlideCount: z.number().int().min(4).max(20),
    targetDurationSeconds: z.number().int().min(60).max(900),
    allowWebImages: z.boolean().default(false),
    authorProfile: defenseAuthorProfileSchema,
    folderId: identifierSchema.nullable().optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export type CreateDefenseProjectInput = z.infer<typeof createDefenseProjectInputSchema>;

export const patchDefenseConfigInputSchema = z
  .object({
    defenseType: defenseTypeSchema.optional(),
    complianceMode: complianceModeSchema.optional(),
    targetSlideCount: z.number().int().min(4).max(20).optional(),
    targetDurationSeconds: z.number().int().min(60).max(900).optional(),
    allowWebImages: z.boolean().optional(),
    authorProfile: defenseAuthorProfileSchema.optional(),
    confirmPresetRebuild: z.boolean().default(false),
    expectedAnalysisRevision: revisionSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const hasChange =
      input.defenseType !== undefined ||
      input.complianceMode !== undefined ||
      input.targetSlideCount !== undefined ||
      input.targetDurationSeconds !== undefined ||
      input.allowWebImages !== undefined ||
      input.authorProfile !== undefined;
    if (!hasChange) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "At least one defense config field is required" });
    }
    if (input.defenseType !== undefined && !input.confirmPresetRebuild) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPresetRebuild"],
        message: "Changing defenseType requires preset rebuild confirmation",
      });
    }
  });
export type PatchDefenseConfigInput = z.infer<typeof patchDefenseConfigInputSchema>;

export const startDefenseAnalysisInputSchema = z
  .object({
    confirmCost: z.literal(true),
    idempotencyKey: idempotencyKeySchema.optional(),
    expectedAnalysisRevision: revisionSchema.optional(),
  })
  .strict();
export type StartDefenseAnalysisInput = z.infer<typeof startDefenseAnalysisInputSchema>;

export const publicRepositoryUrlSchema = z
  .string()
  .trim()
  .max(2_048)
  .url()
  .superRefine((value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return;
    }
    if (url.protocol !== "https:") {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Repository URL must use HTTPS" });
    }
    if (url.username || url.password || url.port) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Repository URL cannot include credentials or a custom port" });
    }
    const hostname = url.hostname.toLowerCase();
    if (hostname !== "github.com" && hostname !== "gitlab.com") {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Only public github.com and gitlab.com repositories are supported" });
    }
    if (url.search || url.hash) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Repository URL cannot include a query or fragment" });
    }
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length < 2) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Repository URL must include owner and repository" });
    }
    if (hostname === "github.com" && pathParts.length !== 2) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "GitHub URL must point to the repository root" });
    }
  });

export const addDefenseRepositoryInputSchema = z
  .object({
    url: publicRepositoryUrlSchema,
    expectedAnalysisRevision: revisionSchema.optional(),
  })
  .strict();
export type AddDefenseRepositoryInput = z.infer<typeof addDefenseRepositoryInputSchema>;

export const defenseUploadManifestItemSchema = z
  .object({
    fieldName: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
    role: uploadSourceRoleSchema,
    label: z.string().trim().min(1).max(240).optional(),
    parentSourceId: identifierSchema.optional(),
  })
  .strict();
export type DefenseUploadManifestItem = z.infer<typeof defenseUploadManifestItemSchema>;

export const defenseUploadManifestSchema = z
  .object({
    files: z.array(defenseUploadManifestItemSchema).min(1).max(DEFENSE_UPLOAD_MAX_FILES),
    expectedAnalysisRevision: revisionSchema.optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const fieldNames = manifest.files.map((file) => file.fieldName);
    if (new Set(fieldNames).size !== fieldNames.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["files"], message: "Multipart field names must be unique" });
    }
  });
export type DefenseUploadManifest = z.infer<typeof defenseUploadManifestSchema>;

export const createFactInputSchema = z
  .object({
    key: z.string().trim().min(1).max(240).optional(),
    statement: z.string().trim().min(1).max(2_000),
    value: defenseJsonValueSchema.optional(),
    evidence: z.array(factEvidenceSchema).min(1).max(50),
    expectedAnalysisRevision: revisionSchema.optional(),
  })
  .strict();
export type CreateFactInput = z.infer<typeof createFactInputSchema>;

export const updateFactInputSchema = z
  .object({
    key: z.string().trim().min(1).max(240).nullable().optional(),
    statement: z.string().trim().min(1).max(2_000).optional(),
    value: defenseJsonValueSchema.optional(),
    state: factStateSchema.optional(),
    evidence: z.array(factEvidenceSchema).min(1).max(50).optional(),
    expectedAnalysisRevision: revisionSchema.optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.key !== undefined ||
      input.statement !== undefined ||
      input.value !== undefined ||
      input.state !== undefined ||
      input.evidence !== undefined,
    { message: "At least one fact field is required" },
  );
export type UpdateFactInput = z.infer<typeof updateFactInputSchema>;

export const deleteDefenseFactInputSchema = z
  .object({
    expectedAnalysisRevision: revisionSchema.optional(),
  })
  .strict();
export type DeleteDefenseFactInput = z.infer<typeof deleteDefenseFactInputSchema>;

export const updateRequirementInputSchema = z
  .object({
    text: z.string().trim().min(1).max(2_000).optional(),
    priority: requirementPrioritySchema.optional(),
    state: requirementStateSchema.optional(),
    rule: requirementRuleSchema.nullable().optional(),
    expectedAnalysisRevision: revisionSchema.optional(),
  })
  .strict()
  .refine(
    (input) => input.text !== undefined || input.priority !== undefined || input.state !== undefined || input.rule !== undefined,
    { message: "At least one requirement field is required" },
  );
export type UpdateRequirementInput = z.infer<typeof updateRequirementInputSchema>;

export const updateDefenseAssetInputSchema = z
  .object({
    role: sourceRoleSchema.optional(),
    label: z.string().trim().min(1).max(240).optional(),
    included: z.boolean().optional(),
    classification: screenshotClassificationSchema.nullable().optional(),
    expectedAnalysisRevision: revisionSchema.optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.role !== undefined || input.label !== undefined || input.included !== undefined || input.classification !== undefined,
    { message: "At least one asset field is required" },
  );
export type UpdateDefenseAssetInput = z.infer<typeof updateDefenseAssetInputSchema>;

export const resolveConflictInputSchema = z
  .object({
    action: z.enum(["resolve", "ignore"]),
    resolution: conflictResolutionSchema.optional(),
    expectedAnalysisRevision: revisionSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.action === "resolve" && !input.resolution) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["resolution"], message: "Resolve action needs resolution" });
    }
    if (input.action === "ignore" && input.resolution) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["resolution"], message: "Ignore action cannot include resolution" });
    }
  });
export type ResolveConflictInput = z.infer<typeof resolveConflictInputSchema>;

export const putDefensePlanInputSchema = z
  .object({
    expectedPlanRevision: revisionSchema,
    plan: defensePlanSchema,
  })
  .strict();
export type PutDefensePlanInput = z.infer<typeof putDefensePlanInputSchema>;

export const rebuildDefensePlanInputSchema = z
  .object({
    expectedAnalysisRevision: revisionSchema,
    expectedPlanRevision: revisionSchema,
    confirmPresetRebuild: z.literal(true),
  })
  .strict();
export type RebuildDefensePlanInput = z.infer<typeof rebuildDefensePlanInputSchema>;

export const confirmDefensePlanInputSchema = z
  .object({
    expectedAnalysisRevision: revisionSchema,
    expectedPlanRevision: revisionSchema,
  })
  .strict();
export type ConfirmDefensePlanInput = z.infer<typeof confirmDefensePlanInputSchema>;

export const startComplianceCheckInputSchema = z
  .object({
    expectedPresentationRevision: z.number().int().positive(),
    expectedAnalysisRevision: revisionSchema,
    expectedPlanRevision: revisionSchema,
    idempotencyKey: z.string().trim().min(8).max(200).optional(),
  })
  .strict();
export type StartComplianceCheckInput = z.infer<typeof startComplianceCheckInputSchema>;

export const requestComplianceReportPdfInputSchema = z
  .object({
    expectedPresentationRevision: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(8).max(200).optional(),
  })
  .strict();
export type RequestComplianceReportPdfInput = z.infer<typeof requestComplianceReportPdfInputSchema>;
