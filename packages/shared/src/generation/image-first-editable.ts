import crypto from "node:crypto";
import { z } from "zod";

/**
 * The v1 image-first contract deliberately lives beside, rather than inside,
 * the historical ai_scene contracts.  It is disabled until a later rollout
 * attaches it to the production generation route.
 */
export const IMAGE_FIRST_EDITABLE_V1_VERSION = "image_first_editable_v1" as const;
export const IMAGE_FIRST_EDITABLE_V1_FEATURE_FLAG = "IMAGE_FIRST_EDITABLE_V1_ENABLED" as const;

export const imageFirstEditableSlideCountSchema = z.union([
  z.literal(6), z.literal(8), z.literal(10), z.literal(12), z.literal(14),
]);
export type ImageFirstEditableSlideCount = z.infer<typeof imageFirstEditableSlideCountSchema>;

export const imageFirstEditableRoleSchema = z.enum(["cover", "content", "closing"]);
export const imageFirstEditableRenderModeSchema = z.enum(["image_text_lift", "native_evidence"]);
export const imageFirstEditableCompositionArchetypeSchema = z.enum([
  "editorial_hero", "asymmetric_editorial", "timeline", "comparison", "process", "relationship_map", "typographic_pause", "evidence_composition",
]);
export const imageFirstEditableSemanticKindSchema = z.enum(["title", "thesis", "conclusion", "date", "number", "name", "term", "caption"]);
export const imageFirstEditableContentProvenanceSchema = z.object({
  /** `fallback_added` is navigation/pause copy, never a speech-grounded claim. */
  kind: z.enum(["speech_grounded", "repeated_accepted_speech", "fallback_added"]),
  repeatedFromSemanticId: z.string().trim().regex(/^ife1:[a-z0-9][a-z0-9:_-]*$/i).optional(),
}).superRefine((value, ctx) => {
  if (value.kind === "repeated_accepted_speech" && !value.repeatedFromSemanticId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["repeatedFromSemanticId"], message: "repeated_origin_required" });
  if (value.kind !== "repeated_accepted_speech" && value.repeatedFromSemanticId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["repeatedFromSemanticId"], message: "repeated_origin_forbidden" });
});
export type ImageFirstEditableContentProvenance = z.infer<typeof imageFirstEditableContentProvenanceSchema>;

export const imageFirstEditableSpeechTraceSchema = z.object({
  sectionId: z.string().trim().min(1).max(160),
  sectionOrder: z.number().int().positive(),
  sectionHash: z.string().regex(/^[a-f0-9]{64}$/),
  excerpt: z.string().trim().min(1).max(4_000),
});
export type ImageFirstEditableSpeechTrace = z.infer<typeof imageFirstEditableSpeechTraceSchema>;

export const imageFirstEditableSourceRefSchema = z.object({
  sourceId: z.string().trim().min(1).max(160),
  excerpt: z.string().trim().min(1).max(1_000),
});
export type ImageFirstEditableSourceRef = z.infer<typeof imageFirstEditableSourceRefSchema>;

export const imageFirstEditableSemanticStringSchema = z.object({
  semanticId: z.string().trim().regex(/^ife1:[a-z0-9][a-z0-9:_-]*$/i),
  kind: imageFirstEditableSemanticKindSchema,
  text: z.string().trim().min(1).max(360),
  speechTrace: imageFirstEditableSpeechTraceSchema,
  sourceRefs: z.array(imageFirstEditableSourceRefSchema).max(8).default([]),
  provenance: imageFirstEditableContentProvenanceSchema.default({ kind: "speech_grounded" }),
});
export type ImageFirstEditableSemanticString = z.infer<typeof imageFirstEditableSemanticStringSchema>;

const baseSlideSchema = z.object({
  slideId: z.string().trim().min(1).max(160),
  order: z.number().int().positive(),
  role: imageFirstEditableRoleSchema,
  title: imageFirstEditableSemanticStringSchema.refine((value) => value.kind === "title", "title_kind_required"),
  theses: z.array(imageFirstEditableSemanticStringSchema.refine((value) => value.kind === "thesis", "thesis_kind_required")).max(4).default([]),
  conclusion: imageFirstEditableSemanticStringSchema.refine((value) => value.kind === "conclusion", "conclusion_kind_required").optional(),
  semanticLabels: z.array(imageFirstEditableSemanticStringSchema.refine((value) => ["date", "number", "name", "term", "caption"].includes(value.kind), "label_kind_required")).max(12).default([]),
  visualIntent: z.string().trim().min(12).max(600),
  compositionArchetype: imageFirstEditableCompositionArchetypeSchema,
  renderMode: imageFirstEditableRenderModeSchema,
});

const imageFirstEditableDeckContentPlanObjectSchema = z.object({
  version: z.literal(IMAGE_FIRST_EDITABLE_V1_VERSION),
  requestedSlideCount: imageFirstEditableSlideCountSchema,
  acceptedSpeechHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  visualFamilyIntent: z.string().trim().min(12).max(500),
  /** Immutable diagnostics for deterministic exact-count fallback. */
  fallbackDiagnostics: z.array(z.string().trim().min(1).max(240)).max(32).default([]),
  slides: z.array(baseSlideSchema),
});

export const imageFirstEditableDeckContentPlanSchema = imageFirstEditableDeckContentPlanObjectSchema.superRefine((value, ctx) => {
  if (value.slides.length !== value.requestedSlideCount) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slides"], message: "exact_slide_count_required" });
  const ordered = [...value.slides].sort((left, right) => left.order - right.order);
  if (ordered.some((slide, index) => slide.order !== index + 1)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slides"], message: "continuous_order_required" });
  if (ordered[0]?.role !== "cover") ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slides", 0, "role"], message: "cover_first_required" });
  if (ordered.at(-1)?.role !== "closing") ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slides", value.slides.length - 1, "role"], message: "closing_last_required" });
  for (const [index, slide] of ordered.entries()) {
    if (slide.role === "content" && (slide.theses.length < 1 || slide.theses.length > 4)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slides", index, "theses"], message: "content_theses_1_to_4_required" });
    if (slide.role === "cover" && (slide.theses.length || slide.conclusion)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slides", index], message: "cover_must_not_have_body_copy" });
  }
  const semanticIds = value.slides.flatMap((slide) => [slide.title, ...slide.theses, ...(slide.conclusion ? [slide.conclusion] : []), ...slide.semanticLabels].map((entry) => entry.semanticId));
  if (new Set(semanticIds).size !== semanticIds.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slides"], message: "semantic_ids_must_be_unique" });
});
export type ImageFirstEditableDeckContentPlan = z.infer<typeof imageFirstEditableDeckContentPlanSchema>;

export const imageFirstEditableDeckContentLockSchema = imageFirstEditableDeckContentPlanObjectSchema.extend({
  slides: z.array(baseSlideSchema.extend({ contentHash: z.string().regex(/^[a-f0-9]{64}$/) })),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).superRefine((value, ctx) => {
  const planResult = imageFirstEditableDeckContentPlanSchema.safeParse({ ...value, slides: value.slides.map(({ contentHash: _contentHash, ...slide }) => slide) });
  if (!planResult.success) {
    for (const issue of planResult.error.issues) ctx.addIssue(issue);
  }
});
export type ImageFirstEditableDeckContentLock = z.infer<typeof imageFirstEditableDeckContentLockSchema>;

export const imageFirstEditableEditableValuesSchema = z.object({
  version: z.literal(IMAGE_FIRST_EDITABLE_V1_VERSION),
  generatedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  currentValues: z.array(z.object({ semanticId: z.string().trim().min(1), text: z.string().trim().min(1).max(360) })).default([]),
});
export type ImageFirstEditableEditableValues = z.infer<typeof imageFirstEditableEditableValuesSchema>;

export type AcceptedSpeechSection = { id: string; order: number; text: string };

export function imageFirstEditableFeatureEnabled(env: Record<string, string | undefined> = process.env) {
  return env[IMAGE_FIRST_EDITABLE_V1_FEATURE_FLAG] === "true";
}

export function hashImageFirstEditableValue(value: unknown) {
  return crypto.createHash("sha256").update(typeof value === "string" ? normalize(value) : stableJson(value)).digest("hex");
}

export function hashAcceptedSpeech(sections: readonly AcceptedSpeechSection[]) {
  return hashImageFirstEditableValue(sections.map((section) => ({ id: section.id, order: section.order, text: normalize(section.text) })));
}

export function speechTraceForSection(section: AcceptedSpeechSection, excerpt = section.text): ImageFirstEditableSpeechTrace {
  return { sectionId: section.id, sectionOrder: section.order, sectionHash: hashImageFirstEditableValue(normalize(section.text)), excerpt: normalize(excerpt) };
}

export function lockImageFirstEditableDeck(plan: ImageFirstEditableDeckContentPlan): ImageFirstEditableDeckContentLock {
  const parsed = imageFirstEditableDeckContentPlanSchema.parse(plan);
  const slides = parsed.slides.map((slide) => ({ ...slide, contentHash: hashImageFirstEditableValue(exactSlideContent(slide)) }));
  return imageFirstEditableDeckContentLockSchema.parse({
    ...parsed,
    slides,
    contentHash: hashImageFirstEditableValue({
      version: parsed.version,
      requestedSlideCount: parsed.requestedSlideCount,
      acceptedSpeechHash: parsed.acceptedSpeechHash,
      sourceSnapshotHash: parsed.sourceSnapshotHash,
      visualFamilyIntent: parsed.visualFamilyIntent,
      fallbackDiagnostics: parsed.fallbackDiagnostics,
      slides: slides.map((slide) => ({ slideId: slide.slideId, contentHash: slide.contentHash })),
    }),
  });
}

export function verifyImageFirstEditableLockHashes(lock: ImageFirstEditableDeckContentLock) {
  const parsed = imageFirstEditableDeckContentLockSchema.parse(lock);
  const expected = lockImageFirstEditableDeck({ ...parsed, slides: parsed.slides.map(({ contentHash: _contentHash, ...slide }) => slide) });
  return expected.contentHash === parsed.contentHash && expected.slides.every((slide, index) => slide.contentHash === parsed.slides[index]?.contentHash);
}

export function validateImageFirstEditableEditableLineage(lock: ImageFirstEditableDeckContentLock, values: ImageFirstEditableEditableValues) {
  const parsedLock = imageFirstEditableDeckContentLockSchema.parse(lock);
  const parsedValues = imageFirstEditableEditableValuesSchema.parse(values);
  if (parsedValues.generatedContentHash !== parsedLock.contentHash) return false;
  const ids = new Set(parsedLock.slides.flatMap((slide) => [slide.title, ...slide.theses, ...(slide.conclusion ? [slide.conclusion] : []), ...slide.semanticLabels].map((entry) => entry.semanticId)));
  return new Set(parsedValues.currentValues.map((entry) => entry.semanticId)).size === parsedValues.currentValues.length
    && parsedValues.currentValues.every((entry) => ids.has(entry.semanticId));
}

function exactSlideContent(slide: ImageFirstEditableDeckContentPlan["slides"][number]) {
  return {
    slideId: slide.slideId,
    order: slide.order,
    role: slide.role,
    text: [slide.title, ...slide.theses, ...(slide.conclusion ? [slide.conclusion] : []), ...slide.semanticLabels].map((entry) => ({ semanticId: entry.semanticId, kind: entry.kind, text: normalize(entry.text), provenance: entry.provenance })),
  };
}

function normalize(value: string) { return value.replace(/\s+/gu, " ").trim(); }
function stableJson(value: unknown) { return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.keys(item).sort().reduce<Record<string, unknown>>((result, key) => ({ ...result, [key]: (item as Record<string, unknown>)[key] }), {}) : item); }
