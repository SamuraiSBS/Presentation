import { z } from "zod";

export type DefenseJsonValue =
  | string
  | number
  | boolean
  | null
  | DefenseJsonValue[]
  | { [key: string]: DefenseJsonValue };

export const defenseJsonValueSchema: z.ZodType<DefenseJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(defenseJsonValueSchema),
    z.record(defenseJsonValueSchema),
  ]),
);

const identifierSchema = z.string().trim().min(1).max(128);const isoDateTimeSchema = z.string().datetime({ offset: true });
const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((value) => value.toUpperCase());

function uniqueIdentifierArray(max = 100) {
  return z
    .array(identifierSchema)
    .max(max)
    .default([])
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "IDs must be unique" });
      }
    });
}

export const projectWorkflowSchema = z.enum(["standard", "requirements_driven"]);
export type ProjectWorkflow = z.infer<typeof projectWorkflowSchema>;

export const defenseTypeSchema = z.enum(["hackathon", "diploma"]);
export type DefenseType = z.infer<typeof defenseTypeSchema>;

export const complianceModeSchema = z.enum(["strict", "adaptive"]);
export type ComplianceMode = z.infer<typeof complianceModeSchema>;

export const defenseLanguageSchema = z.literal("ru");
export type DefenseLanguage = z.infer<typeof defenseLanguageSchema>;

export const defenseAnalysisStatusSchema = z.enum([
  "draft",
  "queued",
  "analyzing",
  "review_ready",
  "ready",
  "failed",
]);
export type DefenseAnalysisStatus = z.infer<typeof defenseAnalysisStatusSchema>;

export const defensePresetVersionSchema = z.enum(["hackathon-v1", "diploma-v1"]);
export type DefensePresetVersion = z.infer<typeof defensePresetVersionSchema>;

export const authorProfileFieldSchema = z.enum([
  "fullName",
  "institution",
  "department",
  "group",
  "supervisor",
  "city",
  "year",
  "teamName",
  "eventName",
]);
export type AuthorProfileField = z.infer<typeof authorProfileFieldSchema>;

const optionalProfileTextSchema = (max: number) => z.string().trim().min(1).max(max).optional();
const defenseYearSchema = z
  .string()
  .trim()
  .regex(/^\d{4}$/)
  .refine((value) => {
    const year = Number(value);
    return year >= 1900 && year <= 2100;
  }, "Year must be between 1900 and 2100");

export const defenseAuthorProfileSchema = z
  .object({
    fullName: optionalProfileTextSchema(160),
    institution: optionalProfileTextSchema(240),
    department: optionalProfileTextSchema(240),
    group: optionalProfileTextSchema(80),
    supervisor: optionalProfileTextSchema(160),
    city: optionalProfileTextSchema(120),
    year: defenseYearSchema.optional(),
    teamName: optionalProfileTextSchema(160),
    eventName: optionalProfileTextSchema(200),
  })
  .strict()
  .default({});
export type DefenseAuthorProfile = z.infer<typeof defenseAuthorProfileSchema>;

const defenseConfigShape = {
  defenseType: defenseTypeSchema,
  complianceMode: complianceModeSchema,
  language: defenseLanguageSchema.default("ru"),
  targetSlideCount: z.number().int().min(4).max(20),
  targetDurationSeconds: z.number().int().min(60).max(900),
  allowWebImages: z.boolean().default(false),
  authorProfile: defenseAuthorProfileSchema,
  standardPresetVersion: defensePresetVersionSchema,
};

function validatePresetMatchesDefenseType(
  value: { defenseType: DefenseType; standardPresetVersion: DefensePresetVersion },
  context: z.RefinementCtx,
) {
  if (!value.standardPresetVersion.startsWith(`${value.defenseType}-`)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["standardPresetVersion"],
      message: "Preset version must match defenseType",
    });
  }
}

export const defenseConfigSchema = z.object(defenseConfigShape).strict().superRefine(validatePresetMatchesDefenseType);
export type DefenseConfig = z.infer<typeof defenseConfigSchema>;

export const contentPlaceholderKindSchema = z.enum([
  "text",
  "identity",
  "metric",
  "screenshot",
  "diagram",
  "conflict",
]);
export type ContentPlaceholderKind = z.infer<typeof contentPlaceholderKindSchema>;

export const contentPlaceholderSeveritySchema = z.enum(["info", "warning", "error"]);
export type ContentPlaceholderSeverity = z.infer<typeof contentPlaceholderSeveritySchema>;

export const contentPlaceholderSchema = z
  .object({
    id: identifierSchema,
    requirementId: identifierSchema.optional(),
    factId: identifierSchema.optional(),
    kind: contentPlaceholderKindSchema,
    label: z.string().trim().min(1).max(300),
    resolved: z.boolean().default(false),
    severity: contentPlaceholderSeveritySchema.default("warning"),
    resolvedById: identifierSchema.optional(),
    resolvedAt: isoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((placeholder, context) => {
    if (placeholder.resolved && !placeholder.resolvedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolvedAt"],
        message: "Resolved placeholders require resolvedAt",
      });
    }
    if (!placeholder.resolved && (placeholder.resolvedAt || placeholder.resolvedById)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolved"],
        message: "Unresolved placeholders cannot include resolution metadata",
      });
    }
  });
export type ContentPlaceholder = z.infer<typeof contentPlaceholderSchema>;

const AUTHOR_FIELD_LABELS: Record<AuthorProfileField, string> = {
  fullName: "Укажите ФИО автора проекта",
  institution: "Укажите учебное заведение",
  department: "Укажите кафедру",
  group: "Укажите группу",
  supervisor: "Укажите руководителя",
  city: "Укажите город",
  year: "Укажите год защиты",
  teamName: "Укажите название команды",
  eventName: "Укажите название мероприятия",
};

export const DEFENSE_AUTHOR_FIELDS: Readonly<Record<DefenseType, readonly AuthorProfileField[]>> = {
  diploma: ["fullName", "institution", "department", "group", "supervisor", "city", "year"],
  hackathon: ["fullName", "teamName", "eventName"],
};

export function buildAuthorPlaceholders(
  defenseType: DefenseType,
  authorProfile: DefenseAuthorProfile,
): ContentPlaceholder[] {
  return DEFENSE_AUTHOR_FIELDS[defenseType]
    .filter((field) => !authorProfile[field])
    .map((field) =>
      contentPlaceholderSchema.parse({
        id: `author-${field}`,
        kind: "identity",
        label: AUTHOR_FIELD_LABELS[field],
        severity: defenseType === "diploma" ? "error" : "warning",
      }),
    );
}

export const sourceRoleSchema = z.enum([
  "project_document",
  "technical_spec",
  "defense_spec",
  "style_reference",
  "screenshot",
  "logo",
  "supporting_image",
  "repository_document",
  "archive_document",
  "web_image",
]);
export type SourceRole = z.infer<typeof sourceRoleSchema>;

export const uploadSourceRoleSchema = z.enum([
  "project_document",
  "technical_spec",
  "defense_spec",
  "style_reference",
  "screenshot",
  "logo",
  "supporting_image",
]);
export type UploadSourceRole = z.infer<typeof uploadSourceRoleSchema>;

export const screenshotKindSchema = z.enum([
  "landing",
  "authentication",
  "dashboard",
  "navigation",
  "list",
  "detail",
  "form",
  "settings",
  "report",
  "mobile",
  "other",
]);
export type ScreenshotKind = z.infer<typeof screenshotKindSchema>;

export const screenshotClassificationSchema = z
  .object({
    sourceId: identifierSchema,
    kind: screenshotKindSchema,
    label: z.string().trim().min(1).max(160),
    visiblePurpose: z.string().trim().max(500).default(""),
    confidence: z.number().min(0).max(1),
    matchedFactIds: uniqueIdentifierArray(50),
    matchedRequirementIds: uniqueIdentifierArray(50),
    status: z.enum(["classified", "needs_review", "user_confirmed"]),
    provider: z.enum(["openai", "metadata", "user"]),
  })
  .strict();
export type ScreenshotClassification = z.infer<typeof screenshotClassificationSchema>;

export const defenseSourceChunkSchema = z
  .object({
    id: identifierSchema.optional(),
    sourceId: identifierSchema,
    locator: z.string().trim().max(240).default(""),
    excerpt: z.string().trim().max(2_000).default(""),
    normalizedText: z.string().trim().min(1).max(20_000),
    fingerprint: z.string().trim().min(8).max(256).optional(),
  })
  .strict();
export type DefenseSourceChunk = z.infer<typeof defenseSourceChunkSchema>;

export const defenseSourceMetadataSchema = z
  .object({
    origin: z.enum(["upload", "repository", "archive", "web"]).optional(),
    originalFileName: z.string().trim().min(1).max(260).optional(),
    mimeType: z.string().trim().min(1).max(160).optional(),
    locator: z.string().trim().max(500).optional(),
    parentSourceId: identifierSchema.optional(),
    repository: z
      .object({
        provider: z.enum(["github", "gitlab"]),
        owner: z.string().trim().min(1).max(200),
        repository: z.string().trim().min(1).max(200),
        ref: z.string().trim().min(1).max(240).default("HEAD"),
        path: z.string().trim().max(1_000).default(""),
        url: z.string().url(),
      })
      .strict()
      .optional(),
    archive: z
      .object({
        path: z.string().trim().min(1).max(1_000),
        parentSourceId: identifierSchema,
      })
      .strict()
      .optional(),
    document: z
      .object({
        pageCount: z.number().int().positive().optional(),
        slideCount: z.number().int().positive().optional(),
        hasTextLayer: z.boolean().optional(),
      })
      .strict()
      .optional(),
    image: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        contentType: z.string().trim().min(1).max(160),
        byteSize: z.number().int().nonnegative().optional(),
        classification: screenshotClassificationSchema.optional(),
      })
      .strict()
      .optional(),
    chunks: z.array(defenseSourceChunkSchema).max(500).default([]),
    warnings: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  })
  .strict()
  .superRefine((metadata, context) => {
    if (metadata.origin === "repository" && !metadata.repository) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["repository"], message: "Repository metadata is required" });
    }
    if (metadata.origin === "archive" && !metadata.archive) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["archive"], message: "Archive metadata is required" });
    }
  });
export type DefenseSourceMetadata = z.infer<typeof defenseSourceMetadataSchema>;

export const defenseAssetSchema = z
  .object({
    sourceId: identifierSchema,
    role: sourceRoleSchema,
    label: z.string().trim().min(1).max(240),
    metadata: defenseSourceMetadataSchema.default({ chunks: [], warnings: [] }),
    included: z.boolean().default(true),
  })
  .strict();
export type DefenseAsset = z.infer<typeof defenseAssetSchema>;

export const factConfirmationSchema = z.enum(["source", "user"]);
export type FactConfirmation = z.infer<typeof factConfirmationSchema>;

export const factEvidenceSchema = z
  .object({
    id: identifierSchema.optional(),
    factId: identifierSchema.optional(),
    confirmation: factConfirmationSchema,
    sourceId: identifierSchema.optional(),
    locator: z.string().trim().max(500).optional(),
    excerpt: z.string().trim().max(2_000).optional(),
    confirmedById: identifierSchema.optional(),
    confirmedAt: isoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.confirmation === "source" && !evidence.sourceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceId"],
        message: "Source-confirmed evidence requires sourceId",
      });
    }
    if (evidence.confirmation === "source" && !evidence.locator?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["locator"],
        message: "Source-confirmed evidence requires a locator",
      });
    }
    if (evidence.confirmation === "user" && evidence.sourceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceId"],
        message: "Author-confirmed evidence cannot impersonate a source document",
      });
    }
  });
export type FactEvidence = z.infer<typeof factEvidenceSchema>;

export const factStateSchema = z.enum(["active", "removed"]);
export type FactState = z.infer<typeof factStateSchema>;

export const projectFactSchema = z
  .object({
    id: identifierSchema,
    workspaceId: identifierSchema.optional(),
    key: z.string().trim().min(1).max(240).optional(),
    statement: z.string().trim().min(1).max(2_000),
    value: defenseJsonValueSchema.optional(),
    state: factStateSchema.default("active"),
    evidence: z.array(factEvidenceSchema).min(1).max(50),
    createdAt: isoDateTimeSchema.optional(),
    updatedAt: isoDateTimeSchema.optional(),
  })
  .strict();
export type ProjectFact = z.infer<typeof projectFactSchema>;

export const requirementPrioritySchema = z.enum(["required", "recommended", "preference"]);
export type RequirementPriority = z.infer<typeof requirementPrioritySchema>;

export const requirementOriginSchema = z.enum(["builtin", "source", "user"]);
export type RequirementOrigin = z.infer<typeof requirementOriginSchema>;

export const requirementStateSchema = z.enum(["active", "ignored"]);
export type RequirementState = z.infer<typeof requirementStateSchema>;

const slideCountRuleSchema = z
  .object({
    kind: z.literal("slide_count"),
    exact: z.number().int().min(1).max(20).optional(),
    min: z.number().int().min(1).max(20).optional(),
    max: z.number().int().min(1).max(20).optional(),
  })
  .strict();

const slidePositionRuleSchema = z
  .object({
    kind: z.literal("slide_position"),
    position: z.enum(["first", "last", "exact"]),
    order: z.number().int().min(1).max(20).optional(),
    purposeKey: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

const timingRuleSchema = z
  .object({
    kind: z.literal("timing"),
    scope: z.enum(["total", "slide"]),
    slideOrder: z.number().int().min(1).max(20).optional(),
    minSeconds: z.number().int().min(1).max(900).optional(),
    maxSeconds: z.number().int().min(1).max(900).optional(),
    exactSeconds: z.number().int().min(1).max(900).optional(),
  })
  .strict();

const authorFieldRuleSchema = z
  .object({
    kind: z.literal("author_field"),
    field: authorProfileFieldSchema,
  })
  .strict();

const assetCountRuleSchema = z
  .object({
    kind: z.literal("asset_count"),
    role: sourceRoleSchema,
    minCount: z.number().int().min(1).max(20),
    slideOrder: z.number().int().min(1).max(20).optional(),
  })
  .strict();

const paletteRuleSchema = z
  .object({
    kind: z.literal("palette"),
    property: z.enum(["background", "surface", "text", "accent", "accentAlt", "line", "dominant"]),
    color: hexColorSchema,
  })
  .strict();

const themeRuleSchema = z
  .object({
    kind: z.literal("theme"),
    themeId: z.string().trim().min(1).max(120).optional(),
    tone: z.enum(["light", "dark", "mixed"]).optional(),
  })
  .strict();

const contentRuleSchema = z
  .object({
    kind: z.literal("content_presence"),
    target: z.enum(["slides", "notes", "slides_and_notes"]),
    phrase: z.string().trim().min(1).max(500).optional(),
    slideOrder: z.number().int().min(1).max(20).optional(),
  })
  .strict();

const speakerNotesRuleSchema = z
  .object({
    kind: z.literal("speaker_notes"),
    slideOrder: z.number().int().min(1).max(20).optional(),
  })
  .strict();

export const requirementRuleSchema = z
  .union([
    slideCountRuleSchema,
    slidePositionRuleSchema,
    timingRuleSchema,
    authorFieldRuleSchema,
    assetCountRuleSchema,
    paletteRuleSchema,
    themeRuleSchema,
    contentRuleSchema,
    speakerNotesRuleSchema,
  ])
  .superRefine((rule, context) => {
    if (rule.kind === "slide_count") {
      if (rule.exact === undefined && rule.min === undefined && rule.max === undefined) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Slide count rule needs exact, min, or max" });
      }
      if (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["min"], message: "min cannot exceed max" });
      }
    }
    if (rule.kind === "slide_position" && (rule.position === "exact") !== (rule.order !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["order"],
        message: "Only exact slide position requires order",
      });
    }
    if (rule.kind === "timing") {
      const hasLimit = rule.minSeconds !== undefined || rule.maxSeconds !== undefined || rule.exactSeconds !== undefined;
      if (!hasLimit) context.addIssue({ code: z.ZodIssueCode.custom, message: "Timing rule needs a limit" });
      if (rule.scope === "slide" && rule.slideOrder === undefined) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["slideOrder"], message: "Slide timing requires slideOrder" });
      }
      if (rule.scope === "total" && rule.slideOrder !== undefined) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["slideOrder"], message: "Total timing cannot target one slide" });
      }
      if (rule.minSeconds !== undefined && rule.maxSeconds !== undefined && rule.minSeconds > rule.maxSeconds) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["minSeconds"], message: "minSeconds cannot exceed maxSeconds" });
      }
    }
    if (rule.kind === "theme" && !rule.themeId && !rule.tone) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Theme rule needs themeId or tone" });
    }
  });
export type RequirementRule = z.infer<typeof requirementRuleSchema>;

export const projectRequirementSchema = z
  .object({
    id: identifierSchema,
    workspaceId: identifierSchema.optional(),
    key: z.string().trim().min(1).max(240).optional(),
    text: z.string().trim().min(1).max(2_000),
    priority: requirementPrioritySchema,
    origin: requirementOriginSchema,
    state: requirementStateSchema.default("active"),
    sourceId: identifierSchema.optional(),
    locator: z.string().trim().max(500).optional(),
    excerpt: z.string().trim().max(2_000).optional(),
    rule: requirementRuleSchema.optional(),
    presetVersion: defensePresetVersionSchema.optional(),
    createdAt: isoDateTimeSchema.optional(),
    updatedAt: isoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((requirement, context) => {
    if (requirement.origin === "source" && !requirement.sourceId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceId"], message: "Source requirement needs sourceId" });
    }
    if (requirement.origin === "builtin" && !requirement.presetVersion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["presetVersion"],
        message: "Built-in requirement needs presetVersion",
      });
    }
  });
export type ProjectRequirement = z.infer<typeof projectRequirementSchema>;

export const conflictKindSchema = z.enum(["fact", "requirement", "timing", "style"]);
export type ConflictKind = z.infer<typeof conflictKindSchema>;

export const conflictStateSchema = z.enum(["unresolved", "resolved", "ignored"]);
export type ConflictState = z.infer<typeof conflictStateSchema>;

export const conflictOptionSchema = z
  .object({
    id: identifierSchema,
    label: z.string().trim().min(1).max(500),
    value: defenseJsonValueSchema.optional(),
    sourceId: identifierSchema.optional(),
    locator: z.string().trim().max(500).optional(),
    excerpt: z.string().trim().max(2_000).optional(),
  })
  .strict();
export type ConflictOption = z.infer<typeof conflictOptionSchema>;

export const conflictResolutionSchema = z
  .object({
    optionId: identifierSchema.optional(),
    value: defenseJsonValueSchema.optional(),
    note: z.string().trim().max(1_000).optional(),
  })
  .strict()
  .refine((resolution) => resolution.optionId !== undefined || resolution.value !== undefined, {
    message: "Resolution needs optionId or a custom value",
  });
export type ConflictResolution = z.infer<typeof conflictResolutionSchema>;

export const projectConflictSchema = z
  .object({
    id: identifierSchema,
    workspaceId: identifierSchema.optional(),
    kind: conflictKindSchema,
    summary: z.string().trim().min(1).max(2_000),
    options: z.array(conflictOptionSchema).min(2).max(20),
    state: conflictStateSchema.default("unresolved"),
    resolution: conflictResolutionSchema.optional(),
    resolvedById: identifierSchema.optional(),
    resolvedAt: isoDateTimeSchema.optional(),
    createdAt: isoDateTimeSchema.optional(),
    updatedAt: isoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((conflict, context) => {
    if (conflict.state === "resolved" && (!conflict.resolution || !conflict.resolvedAt)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Resolved conflict needs resolution and resolvedAt" });
    }
    if (conflict.state === "unresolved" && (conflict.resolution || conflict.resolvedAt || conflict.resolvedById)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Unresolved conflict cannot include resolution metadata" });
    }
    if (conflict.resolution?.optionId && !conflict.options.some((option) => option.id === conflict.resolution?.optionId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["resolution", "optionId"], message: "Unknown conflict option" });
    }
  });
export type ProjectConflict = z.infer<typeof projectConflictSchema>;

export const defenseStyleBriefSchema = z
  .object({
    sourceId: identifierSchema.optional(),
    palette: z
      .object({
        dominant: z.array(hexColorSchema).max(8).default([]),
        background: hexColorSchema.optional(),
        surface: hexColorSchema.optional(),
        text: hexColorSchema.optional(),
        accent: hexColorSchema.optional(),
        accentAlt: hexColorSchema.optional(),
      })
      .strict()
      .default({ dominant: [] }),
    fonts: z
      .object({
        heading: z.string().trim().min(1).max(120).optional(),
        body: z.string().trim().min(1).max(120).optional(),
      })
      .strict()
      .default({}),
    logoSourceIds: uniqueIdentifierArray(20),
    motifs: z.array(z.string().trim().min(1).max(240)).max(20).default([]),
    tone: z.enum(["light", "dark", "mixed"]).default("light"),
    mappedThemeId: z.string().trim().min(1).max(120).optional(),
    visualDirection: z.string().trim().max(1_000).default(""),
    warnings: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  })
  .strict();
export type DefenseStyleBrief = z.infer<typeof defenseStyleBriefSchema>;

export const defensePlanSlideOriginSchema = z.enum(["builtin", "source", "user"]);
export type DefensePlanSlideOrigin = z.infer<typeof defensePlanSlideOriginSchema>;

export const defensePlanSlideSchema = z
  .object({
    id: identifierSchema,
    order: z.number().int().min(1).max(20),
    title: z.string().trim().min(1).max(160),
    purpose: z.string().trim().min(1).max(600),
    timingSeconds: z.number().int().min(20).max(240),
    requirementIds: uniqueIdentifierArray(100),
    factIds: uniqueIdentifierArray(100),
    assetSourceIds: uniqueIdentifierArray(100),
    placeholders: z.array(contentPlaceholderSchema).max(50).default([]),
    visualStrategy: z.string().trim().max(600).default(""),
    adaptiveChangeReason: z.string().trim().min(1).max(600).optional(),
    origin: defensePlanSlideOriginSchema.default("user"),
    presetSlideKey: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .superRefine((slide, context) => {
    if (slide.origin === "builtin" && !slide.presetSlideKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["presetSlideKey"],
        message: "Built-in plan slide needs presetSlideKey",
      });
    }
  });
export type DefensePlanSlide = z.infer<typeof defensePlanSlideSchema>;

export const defensePlanSchema = z
  .object({
    version: z.literal(1).default(1),
    defenseType: defenseTypeSchema,
    complianceMode: complianceModeSchema,
    presetVersion: defensePresetVersionSchema.nullable().default(null),
    status: z.enum(["draft", "approved"]).default("draft"),
    slides: z.array(defensePlanSlideSchema).min(4).max(20),
    totalTimingSeconds: z.number().int().min(80).max(900),
    approvedAt: isoDateTimeSchema.nullable().default(null),
  })
  .strict()
  .superRefine((plan, context) => {
    const orders = plan.slides.map((slide) => slide.order);
    const ids = plan.slides.map((slide) => slide.id);
    const expectedOrders = Array.from({ length: plan.slides.length }, (_, index) => index + 1);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["slides"], message: "Plan slide IDs must be unique" });
    }
    if (orders.some((order, index) => order !== expectedOrders[index])) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["slides"], message: "Plan slide order must be contiguous" });
    }
    const timingTotal = plan.slides.reduce((total, slide) => total + slide.timingSeconds, 0);
    if (timingTotal !== plan.totalTimingSeconds) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totalTimingSeconds"],
        message: "totalTimingSeconds must equal the sum of slide timings",
      });
    }
    if (plan.status === "approved" && !plan.approvedAt) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["approvedAt"], message: "Approved plan needs approvedAt" });
    }
    if (plan.status === "draft" && plan.approvedAt) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["approvedAt"], message: "Draft plan cannot have approvedAt" });
    }
    if (plan.presetVersion && !plan.presetVersion.startsWith(`${plan.defenseType}-`)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["presetVersion"], message: "Preset must match defense type" });
    }
  });
export type DefensePlan = z.infer<typeof defensePlanSchema>;

export const defenseGroundingBundleSchema = z
  .object({
    version: z.literal(1).default(1),
    analysisRevision: z.number().int().nonnegative(),
    planRevision: z.number().int().nonnegative(),
    config: defenseConfigSchema,
    facts: z.array(projectFactSchema).max(500),
    requirements: z.array(projectRequirementSchema).max(500),
    resolvedConflicts: z.array(projectConflictSchema).max(100).default([]),
    plan: defensePlanSchema,
    styleBrief: defenseStyleBriefSchema.nullable().default(null),
    assets: z.array(defenseAssetSchema).max(200).default([]),
  })
  .strict()
  .superRefine((bundle, context) => {
    if (bundle.facts.some((fact) => fact.state !== "active")) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["facts"], message: "Grounding can contain only active facts" });
    }
    if (bundle.requirements.some((requirement) => requirement.state !== "active")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requirements"],
        message: "Grounding can contain only active requirements",
      });
    }
    if (bundle.resolvedConflicts.some((conflict) => conflict.state !== "resolved")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolvedConflicts"],
        message: "Grounding can contain only resolved conflicts",
      });
    }
    if (bundle.plan.status !== "approved") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["plan", "status"], message: "Grounding needs an approved plan" });
    }
    if (bundle.plan.defenseType !== bundle.config.defenseType) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["plan", "defenseType"],
        message: "Plan defense type must match grounding config",
      });
    }
    if (bundle.plan.complianceMode !== bundle.config.complianceMode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["plan", "complianceMode"],
        message: "Plan compliance mode must match grounding config",
      });
    }
    if (bundle.plan.slides.length !== bundle.config.targetSlideCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["plan", "slides"],
        message: "Approved plan slide count must match grounding config",
      });
    }
    if (bundle.plan.totalTimingSeconds > bundle.config.targetDurationSeconds) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["plan", "totalTimingSeconds"],
        message: "Approved plan timing exceeds grounding config",
      });
    }
    const factIds = new Set(bundle.facts.map((fact) => fact.id));
    const requirementIds = new Set(bundle.requirements.map((requirement) => requirement.id));
    const assetIds = new Set(bundle.assets.filter((asset) => asset.included).map((asset) => asset.sourceId));
    for (const [slideIndex, slide] of bundle.plan.slides.entries()) {
      for (const factId of slide.factIds) {
        if (!factIds.has(factId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["plan", "slides", slideIndex, "factIds"],
            message: `Unknown or inactive fact ${factId}`,
          });
        }
      }
      for (const requirementId of slide.requirementIds) {
        if (!requirementIds.has(requirementId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["plan", "slides", slideIndex, "requirementIds"],
            message: `Unknown or inactive requirement ${requirementId}`,
          });
        }
      }
      for (const assetId of slide.assetSourceIds) {
        if (!assetIds.has(assetId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["plan", "slides", slideIndex, "assetSourceIds"],
            message: `Unknown or excluded asset ${assetId}`,
          });
        }
      }
    }
  });
export type DefenseGroundingBundle = z.infer<typeof defenseGroundingBundleSchema>;

export const defenseWorkspaceSchema = z
  .object({
    id: identifierSchema,
    projectId: identifierSchema,
    ...defenseConfigShape,
    analysisStatus: defenseAnalysisStatusSchema.default("draft"),
    analysisRevision: z.number().int().nonnegative().default(0),
    planRevision: z.number().int().nonnegative().default(0),
    styleBrief: defenseStyleBriefSchema.nullable().default(null),
    plan: defensePlanSchema.nullable().default(null),
    analysisError: z.string().max(2_000).nullable().default(null),
    facts: z.array(projectFactSchema).max(500).default([]),
    requirements: z.array(projectRequirementSchema).max(500).default([]),
    conflicts: z.array(projectConflictSchema).max(100).default([]),
    assets: z.array(defenseAssetSchema).max(200).default([]),
    createdAt: isoDateTimeSchema.optional(),
    updatedAt: isoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((workspace, context) => {
    validatePresetMatchesDefenseType(workspace, context);
    for (const [index, fact] of workspace.facts.entries()) {
      if (fact.workspaceId && fact.workspaceId !== workspace.id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["facts", index, "workspaceId"],
          message: "Fact belongs to another defense workspace",
        });
      }
    }
    for (const [index, requirement] of workspace.requirements.entries()) {
      if (requirement.workspaceId && requirement.workspaceId !== workspace.id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["requirements", index, "workspaceId"],
          message: "Requirement belongs to another defense workspace",
        });
      }
    }
    for (const [index, conflict] of workspace.conflicts.entries()) {
      if (conflict.workspaceId && conflict.workspaceId !== workspace.id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["conflicts", index, "workspaceId"],
          message: "Conflict belongs to another defense workspace",
        });
      }
    }
  });
export type DefenseWorkspace = z.infer<typeof defenseWorkspaceSchema>;
