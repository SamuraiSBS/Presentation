import { z } from "zod";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/, "expected a SHA-256 hash");
const sceneColorSchema = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "scene colors must be #RRGGBB");
const costRubSchema = z.string().regex(/^\d+(?:\.\d+)?$/, "expected a non-negative RUB amount");

export const aiSceneV3TextIdSchema = z.enum([
  "title",
  "subtitle",
  "anchor:1",
  "anchor:2",
  "anchor:3",
  "anchor:4",
  "anchor:5",
  "anchor:6",
  "anchor:7",
  "conclusion",
]);
export type AiSceneV3TextId = z.infer<typeof aiSceneV3TextIdSchema>;

/**
 * Gate 1's native overlay is reviewed as presentation text, not as a tiny
 * image caption. These minima are intentionally part of the shared contract
 * so a layout cannot make a later quality gate fail by silently shrinking it.
 */
export const AI_SCENE_V3_READABILITY_MINIMUMS = {
  title: 40,
  anchor: 24,
  other: 16,
} as const;

export function aiSceneV3MinimumFontSize(semanticId: AiSceneV3TextId) {
  if (semanticId === "title") return AI_SCENE_V3_READABILITY_MINIMUMS.title;
  if (semanticId.startsWith("anchor:")) return AI_SCENE_V3_READABILITY_MINIMUMS.anchor;
  return AI_SCENE_V3_READABILITY_MINIMUMS.other;
}

export const editableTextValueSchema = z.object({
  text: z.string().trim().min(1).max(240).refine((value) => !/[.…]$/.test(value), "editable text must not end with an unfinished ellipsis"),
});
export type EditableTextValue = z.infer<typeof editableTextValueSchema>;

export const compositionTypeV3Schema = z.enum([
  "hero_with_annotations",
  "timeline",
  "comparison",
  "map",
  "process",
  "layered_explanation",
  "gallery",
  "visual_conclusion",
]);
export type CompositionTypeV3 = z.infer<typeof compositionTypeV3Schema>;

export const deckArtDirectionV3Schema = z.object({
  version: z.literal(3),
  styleId: z.string().trim().min(3).max(120),
  styleVersion: z.number().int().positive(),
  tone: z.enum(["light", "dark", "mixed"]),
  palette: z.object({
    background: sceneColorSchema,
    surface: sceneColorSchema,
    primaryText: sceneColorSchema,
    secondaryText: sceneColorSchema,
    accent: sceneColorSchema,
  }),
  contrastRules: z.array(z.string().trim().min(8).max(320)).min(1).max(8),
  typography: z.object({
    primaryFontFamily: z.string().trim().min(1).max(120),
    fallbackFontFamily: z.string().trim().min(1).max(120),
    cyrillicSupported: z.literal(true),
  }),
  imageStyle: z.string().trim().min(12).max(600),
  imageTreatmentRules: z.array(z.string().trim().min(8).max(320)).min(1).max(8),
  recurringMotifs: z.array(z.string().trim().min(3).max(160)).max(8).default([]),
  slideNumberTreatment: z.string().trim().min(3).max(240),
  whitespaceRules: z.array(z.string().trim().min(8).max(320)).min(1).max(8),
  allowedCompositionTypes: z.array(compositionTypeV3Schema).min(1).max(8),
  adjacentSlideDiversityRules: z.array(z.string().trim().min(8).max(320)).min(1).max(8),
  forbiddenTechniques: z.array(z.string().trim().min(3).max(180)).min(1).max(12),
  referenceProfileIds: z.array(z.string().trim().min(3).max(120)).min(1).max(6),
  imagePromptFragment: z.string().trim().min(24).max(1800),
  topicHash: hashSchema,
  approvedSpeechHash: hashSchema,
  referenceSelectionHash: hashSchema,
});
export type DeckArtDirectionV3 = z.infer<typeof deckArtDirectionV3Schema>;

const anchorIdSchema = z.enum(["anchor:1", "anchor:2", "anchor:3", "anchor:4", "anchor:5", "anchor:6", "anchor:7"]);
const anchorSchema = z.object({
  id: anchorIdSchema,
  text: z.string().trim().min(3).max(88).refine((value) => !/[.…]$/.test(value), "anchor must be a complete phrase"),
  role: z.enum(["fact", "entity", "process", "comparison", "cause", "definition"]),
  priority: z.number().int().min(1).max(7),
  visualCue: z.string().trim().min(6).max(420),
  sourceTrace: z.string().trim().min(6).max(1200),
});
export type SlideSemanticAnchorV3 = z.infer<typeof anchorSchema>;

export const slideSemanticBriefV3Schema = z.object({
  version: z.literal(3),
  slideId: z.string().trim().min(1),
  slideOrder: z.number().int().positive(),
  kind: z.enum(["cover", "content"]),
  speechSectionHash: hashSchema,
  title: editableTextValueSchema,
  subtitle: editableTextValueSchema.optional(),
  anchors: z.array(anchorSchema).max(7),
  conclusion: editableTextValueSchema.optional(),
  visualNarrative: z.string().trim().min(12).max(1200),
  allowedCompositionTypes: z.array(compositionTypeV3Schema).min(1).max(8),
  contentHash: hashSchema,
}).superRefine((brief, context) => {
  const anchorIds = brief.anchors.map((anchor) => anchor.id);
  if (new Set(anchorIds).size !== anchorIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["anchors"], message: "semantic anchor IDs must be unique" });
  }
  if (brief.kind === "cover") {
    if (brief.anchors.length !== 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["anchors"], message: "a cover may not contain anchors" });
    return;
  }
  if (brief.subtitle) context.addIssue({ code: z.ZodIssueCode.custom, path: ["subtitle"], message: "a subtitle is allowed only on a cover" });
  if (brief.anchors.length < 4) context.addIssue({ code: z.ZodIssueCode.custom, path: ["anchors"], message: "a content slide requires four to seven anchors" });
});
export type SlideSemanticBriefV3 = z.infer<typeof slideSemanticBriefV3Schema>;

const normalizedZoneSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().positive().max(1),
  h: z.number().positive().max(1),
}).superRefine((zone, context) => {
  if (zone.x + zone.w > 1 || zone.y + zone.h > 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "normalized zone must remain within the slide" });
  }
});

const compositionTextZoneSchema = z.object({
  semanticId: aiSceneV3TextIdSchema,
  zone: normalizedZoneSchema,
  // The preview renderer and export use a fixed two-line native-overlay
  // contract. Keeping this on the plan prevents the paid layout step from
  // silently reducing a long title or anchor to a one-line box.
  maxLines: z.number().int().min(1).max(2),
});

type NormalizedZone = z.infer<typeof normalizedZoneSchema>;

function zoneContains(outer: NormalizedZone, inner: NormalizedZone) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w
    && inner.y + inner.h <= outer.y + outer.h;
}

function zonesOverlap(left: NormalizedZone, right: NormalizedZone) {
  return Math.min(left.x + left.w, right.x + right.w) > Math.max(left.x, right.x)
    && Math.min(left.y + left.h, right.y + right.h) > Math.max(left.y, right.y);
}

export const compositionPlanV3Schema = z.object({
  version: z.literal(3),
  slideId: z.string().trim().min(1),
  slideOrder: z.number().int().positive(),
  variant: z.enum(["A", "B", "C"]),
  compositionType: compositionTypeV3Schema,
  mainVisualSubject: z.string().trim().min(6).max(480),
  anchorVisualRegions: z.array(z.object({
    anchorId: anchorIdSchema,
    visualRegion: z.string().trim().min(6).max(420),
    evidence: z.string().trim().min(6).max(600),
  })).max(7),
  textZones: z.array(compositionTextZoneSchema).min(1).max(10),
  quietZones: z.array(normalizedZoneSchema).min(1).max(8),
  protectedObjectZones: z.array(normalizedZoneSchema).max(12).default([]),
  cropRules: z.array(z.string().trim().min(6).max(320)).min(1).max(6),
  variantDifference: z.string().trim().min(12).max(600),
}).superRefine((plan, context) => {
  const textIds = plan.textZones.map((entry) => entry.semanticId);
  if (new Set(textIds).size !== textIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["textZones"], message: "each semantic text ID may have one planned zone" });
  }
  const anchorIds = plan.anchorVisualRegions.map((entry) => entry.anchorId);
  if (new Set(anchorIds).size !== anchorIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["anchorVisualRegions"], message: "each anchor may map to one visual region" });
  }
  for (const [index, entry] of plan.textZones.entries()) {
    if (!plan.quietZones.some((quietZone) => zoneContains(quietZone, entry.zone))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["textZones", index, "zone"], message: "each text zone must be fully contained in a quiet zone" });
    }
    if (plan.protectedObjectZones.some((protectedZone) => zonesOverlap(protectedZone, entry.zone))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["textZones", index, "zone"], message: "text zones may not overlap protected object zones" });
    }
    for (const [otherIndex, other] of plan.textZones.entries()) {
      if (otherIndex > index && zonesOverlap(entry.zone, other.zone)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["textZones", index, "zone"], message: `text zone overlaps ${other.semanticId}` });
      }
    }
  }
});
export type CompositionPlanV3 = z.infer<typeof compositionPlanV3Schema>;

export const textLayoutV3Schema = z.object({
  version: z.literal(3),
  slideId: z.string().trim().min(1),
  entries: z.array(z.object({
    semanticId: aiSceneV3TextIdSchema,
    x: z.number().min(0).max(1280),
    y: z.number().min(0).max(720),
    w: z.number().positive().max(1280),
    h: z.number().positive().max(720),
    fontFamily: z.string().trim().min(1).max(120),
    fallbackFontFamily: z.string().trim().min(1).max(120),
    fontSize: z.number().positive().max(160),
    minimumFontSize: z.number().positive().max(160),
    fontWeight: z.number().int().min(100).max(900),
    lineHeight: z.number().min(0.8).max(3),
    letterSpacing: z.number().min(-8).max(24),
    color: sceneColorSchema,
    align: z.enum(["left", "center", "right"]),
    verticalAlign: z.enum(["top", "middle", "bottom"]),
    maxLines: z.number().int().positive().max(8),
    editable: z.boolean(),
    zoneReason: z.string().trim().min(6).max(600),
    contrastScore: z.number().min(0).max(100),
    placementConfidence: z.number().min(0).max(1),
  })).min(1).max(10),
}).superRefine((layout, context) => {
  const ids = layout.entries.map((entry) => entry.semanticId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["entries"], message: "each semantic text ID may have one layout entry" });
  }
  for (const [index, entry] of layout.entries.entries()) {
    const readableMinimum = aiSceneV3MinimumFontSize(entry.semanticId);
    if (entry.minimumFontSize > entry.fontSize) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["entries", index, "minimumFontSize"], message: "minimum font size may not exceed font size" });
    }
    if (entry.fontSize < readableMinimum || entry.minimumFontSize < readableMinimum) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["entries", index], message: `${entry.semanticId} requires a minimum readable size of ${readableMinimum}px` });
    }
    if (!entry.editable) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["entries", index, "editable"], message: "AI Scene v3 text must remain a native editable overlay" });
    }
    if (entry.x + entry.w > 1280 || entry.y + entry.h > 720) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["entries", index], message: "layout entry must stay within the 1280x720 canvas" });
    }
  }
});
export type TextLayoutV3 = z.infer<typeof textLayoutV3Schema>;

const qualityCheckSchema = z.object({ passed: z.boolean(), detail: z.string().trim().max(1200) });
export const candidateQualityReportV3Schema = z.object({
  version: z.literal(3),
  speechSectionHash: hashSchema,
  contentHash: hashSchema,
  hardChecks: z.object({
    semanticTextIds: qualityCheckSchema,
    noUnexpectedVisibleText: qualityCheckSchema,
    noBakedTextInBackground: qualityCheckSchema,
    noBrandMarks: qualityCheckSchema,
    trueSixteenByNine: qualityCheckSchema,
    textGeometry: qualityCheckSchema,
    textMinimumSize: qualityCheckSchema,
    textContrast: qualityCheckSchema,
    anchorVisualRegions: qualityCheckSchema,
    criticalVisualDefects: qualityCheckSchema,
    assetsSaved: qualityCheckSchema,
    exportCompatibility: qualityCheckSchema,
  }),
  scores: z.object({
    semanticClarity: z.number().min(0).max(100),
    visualQuality: z.number().min(0).max(100),
    textIntegration: z.number().min(0).max(100),
    styleConsistency: z.number().min(0).max(100),
    compositionStrength: z.number().min(0).max(100),
    referenceLevel: z.number().min(0).max(100),
    deckDiversity: z.number().min(0).max(100),
  }),
  weightedScore: z.number().min(0).max(100),
  passed: z.boolean(),
  diagnostics: z.array(z.string().trim().min(1).max(1200)).max(30).default([]),
  evidence: z.array(z.object({ kind: z.string().trim().min(1).max(80), detail: z.string().trim().min(1).max(1200) })).max(40).default([]),
});
export type CandidateQualityReportV3 = z.infer<typeof candidateQualityReportV3Schema>;

export const providerCapabilitySnapshotSchema = z.object({
  provider: z.literal("aitunnel"),
  model: z.string().trim().min(1),
  endpoint: z.string().url(),
  fetchedAt: z.string().datetime(),
  supportsGeneration: z.boolean(),
  supportsImageInput: z.boolean(),
  supportsEditing: z.boolean(),
  supportsCombinedResolutionAndAspectRatio: z.boolean(),
  maxInputReferences: z.number().int().nonnegative(),
  qualities: z.array(z.string().trim().min(1)).max(20),
  outputFormats: z.array(z.string().trim().min(1)).max(20),
  sizes: z.array(z.string().trim().regex(/^\d{3,5}x\d{3,5}$/)).max(50),
  aspectRatios: z.array(z.string().trim().min(1)).max(50),
  rawModelId: z.string().trim().min(1),
});
export type ProviderCapabilitySnapshot = z.infer<typeof providerCapabilitySnapshotSchema>;

const dimensionsSchema = z.object({ width: z.number().int().positive(), height: z.number().int().positive() });
const editableTextEntrySchema = z.object({ semanticId: aiSceneV3TextIdSchema, value: editableTextValueSchema });

export const aiSceneV3CandidateSchema = z.object({
  id: z.string().trim().min(1),
  variant: z.enum(["A", "B", "C"]),
  backgroundObjectKey: z.string().trim().min(1),
  renderedPreviewObjectKey: z.string().trim().min(1),
  compositionPlan: compositionPlanV3Schema,
  textLayout: textLayoutV3Schema,
  qualityReport: candidateQualityReportV3Schema,
  referenceIds: z.array(z.string().trim().min(1)).max(3),
  providerCapabilities: providerCapabilitySnapshotSchema,
  model: z.string().trim().min(1),
  quality: z.literal("xhigh"),
  requestDimensions: dimensionsSchema,
  returnedDimensions: dimensionsSchema,
  costRub: costRubSchema,
  durationMs: z.number().int().nonnegative(),
});
export type AiSceneV3Candidate = z.infer<typeof aiSceneV3CandidateSchema>;

export const candidateSetV3Schema = z.object({
  version: z.literal(3),
  candidateSetId: z.string().trim().min(1),
  slideId: z.string().trim().min(1),
  slideOrder: z.number().int().positive(),
  candidates: z.array(aiSceneV3CandidateSchema).min(2).max(3),
  selectedCandidateId: z.string().trim().min(1).optional(),
  selectionState: z.enum(["unselected", "auto_selected", "user_selected", "warning_override"]),
  selectionReason: z.string().trim().max(1200).default(""),
  editableTextValues: z.array(editableTextEntrySchema).min(1).max(10),
}).superRefine((candidateSet, context) => {
  const variants = candidateSet.candidates.map((candidate) => candidate.variant);
  if (new Set(variants).size !== variants.length || !variants.includes("A") || !variants.includes("B")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["candidates"], message: "a candidate set must contain one A and one B candidate" });
  }
  const candidateIds = new Set(candidateSet.candidates.map((candidate) => candidate.id));
  if (candidateSet.selectedCandidateId && !candidateIds.has(candidateSet.selectedCandidateId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["selectedCandidateId"], message: "selected candidate must belong to this candidate set" });
  }
  if (candidateSet.selectionState === "unselected" && candidateSet.selectedCandidateId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["selectionState"], message: "unselected sets may not name a selected candidate" });
  }
  if (candidateSet.selectionState !== "unselected" && !candidateSet.selectedCandidateId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["selectedCandidateId"], message: "a selected state requires a selected candidate" });
  }
  const textIds = candidateSet.editableTextValues.map((entry) => entry.semanticId);
  if (new Set(textIds).size !== textIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["editableTextValues"], message: "editable text values must have unique semantic IDs" });
  }
});
export type CandidateSetV3 = z.infer<typeof candidateSetV3Schema>;
