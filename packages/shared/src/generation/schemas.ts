import { z } from "zod";
import {
  mermaidDiagramKindSchema,
  mermaidDiagramSourceSchema,
  presentationThemeMoodSchema,
  presentationThemePresetSchema,
  slideLayoutSchema,
  speakerNotesTextSchema,
  visibleSlideTextSchema,
  visualTypeSchema,
} from "../presentation/schemas.js";
import type { PresentationThemePreset } from "../presentation/schemas.js";
export const generationProgressStageSchema = z.enum([
  "queued",
  "extracting_sources",
  "extracting_requirements",
  "classifying_assets",
  "researching",
  "drafting_speech",
  "building_defense_plan",
  "building_slides",
  "selecting_visuals",
  "checking_compliance",
  "polishing",
  "saving",
  "saving_report",
  "completed",
  "failed",
]);
export type GenerationProgressStage = z.infer<typeof generationProgressStageSchema>;

export const generationJobKindSchema = z.enum(["narration", "presentation", "requirements_analysis", "compliance"]);
export type GenerationJobKind = z.infer<typeof generationJobKindSchema>;

export const entityAssertionSchema = z.object({
  subject: z.string().trim().min(1).max(160),
  relation: z.string().trim().min(1).max(160),
  object: z.string().trim().min(1).max(160),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  sourceIds: z.array(z.string().trim().min(1)).default([]),
});
export type EntityAssertion = z.infer<typeof entityAssertionSchema>;

export const factualTopicProfileSchema = z.object({
  topicTerms: z.array(z.string().trim().min(1)).default([]),
  allowedEntities: z.array(z.string().trim().min(1)).default([]),
  timeRange: z.string().trim().default(""),
  domainAnchors: z.array(z.string().trim().min(1)).default([]),
});
export type FactualTopicProfile = z.infer<typeof factualTopicProfileSchema>;

export const slideNarrativeSchema = z.object({
  slideOrder: z.number().int().positive(),
  slideTitle: visibleSlideTextSchema("narrative slide title", 1000),
  slidePurpose: z.string().trim().min(1),
  keyMessage: z.string().trim().min(1),
  audienceQuestion: z.string().trim().min(1),
  transitionToNext: z.string().trim().default(""),
  // Optional for stored legacy documents; new planning always writes them.
  storyJob: z.string().trim().min(1).optional(),
  supportedFactSourceIds: z.array(z.string().trim().min(1)).optional(),
  entityAssertions: z.array(entityAssertionSchema).optional(),
  // New narration planning fields. Optional keeps persisted legacy decks readable.
  bridgeFromPrevious: z.string().trim().optional(),
  evidenceOrExplanation: z.string().trim().optional(),
  whyItMatters: z.string().trim().optional(),
  speechWordTarget: z.number().int().positive().optional(),
});
export type SlideNarrative = z.infer<typeof slideNarrativeSchema>;

export const deckStorySchema = z.object({
  mainIdea: z.string(),
  audienceQuestion: z.string(),
  tone: z.enum(["school_report", "college_report", "exam_explanation", "teacher_explainer"]),
  chapters: z.array(z.object({
    title: z.string(),
    purpose: z.string(),
    slideOrders: z.array(z.number().int().positive()),
  })),
  conclusion: z.string(),
  factualTopicProfile: factualTopicProfileSchema.default({
    topicTerms: [],
    allowedEntities: [],
    timeRange: "",
    domainAnchors: [],
  }),
});
export type DeckStory = z.infer<typeof deckStorySchema>;

export const slideTextCompositionSchema = z.enum([
  "statement",
  "enumeration",
  "comparison",
  "cause_effect",
  "process",
  "definition",
  "example",
  "timeline",
  "summary",
]);
export type SlideTextComposition = z.infer<typeof slideTextCompositionSchema>;

export const slideSupportPointRoleSchema = z.enum([
  "factor",
  "common",
  "difference",
  "cause",
  "effect",
  "step",
  "example",
  "evidence",
  "takeaway",
]);
export type SlideSupportPointRole = z.infer<typeof slideSupportPointRoleSchema>;

export const slideSupportPointSchema = z.object({
  text: visibleSlideTextSchema("slide plan support point", 140),
  role: slideSupportPointRoleSchema,
});
export type SlideSupportPoint = z.infer<typeof slideSupportPointSchema>;

export const slideTextPlanSchema = z.object({
  slideOrder: z.number().int().positive(),
  slideQuestion: z.string().trim().min(1),
  coreClaim: z.string().trim().min(1),
  evidenceOrExample: z.string().default(""),
  listenerTakeaway: z.string().trim().min(1),
  title: visibleSlideTextSchema("slide plan title", 90),
  thesis: z.string().trim().min(1).max(360),
  bullets: z.array(visibleSlideTextSchema("slide plan bullet", 140)).max(3),
  // Optional defaults keep persisted pipeline artifacts and older tests
  // readable while new generations receive an explicit semantic contract.
  composition: slideTextCompositionSchema.default("statement"),
  supportPoints: z.array(slideSupportPointSchema).max(5).default([]),
  supportPointMode: z.enum(["sentences", "labels"]).default("sentences"),
  speakerNotes: speakerNotesTextSchema,
  supportedFactSourceIds: z.array(z.string().trim().min(1)).optional(),
  entityAssertions: z.array(entityAssertionSchema).optional(),
});
export type SlideTextPlan = z.infer<typeof slideTextPlanSchema>;

export const researchBriefSchema = z.object({
  topic: z.string().trim().min(1).max(180),
  angle: z.string().trim().min(1).max(360),
  facts: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(500),
        sourceId: z.string().optional(),
        confidence: z.enum(["high", "medium", "low"]).default("medium"),
      }),
    )
    .default([]),
  warnings: z.array(z.string()).default([]),
  vocabulary: z
    .array(
      z.object({
        term: z.string().trim().min(1).max(80),
        explanation: z.string().trim().min(1).max(260),
      }),
    )
    .default([]),
});
export type ResearchBrief = z.infer<typeof researchBriefSchema>;

const legacyThemeToPremiumThemeId: Record<PresentationThemePreset, string> = {
  moody: "darkLecture",
  bright: "softClassroom",
  academic: "academicClean",
  tech: "darkLecture",
  nature: "scienceBoard",
  history: "timelineDocumentary",
  minimal: "academicClean",
};

export const sceneTextModeSchema = z.enum(["hero_phrase", "talk_sentences", "visual_labels", "takeaway"]);
export type SceneTextMode = z.infer<typeof sceneTextModeSchema>;

export const visualPurposeSchema = z.enum(["photo", "illustration", "diagram", "timeline", "comparison", "metric", "text_only"]);
export type VisualPurpose = z.infer<typeof visualPurposeSchema>;

export const designBriefSlideDirectionSchema = z.object({
  slideOrder: z.number().int().positive(),
  visualRole: z.enum(["hero", "problem", "context", "explain", "compare", "sequence", "evidence", "quote", "visual_statement", "reflect", "summary"]),
  layoutIntent: z.enum(["full_bleed_image", "split_image_text", "statement", "cards", "timeline", "diagram", "comparison", "evidence_board", "quote_spread", "metric", "summary"]),
  imageStrategy: z.enum(["real_photo", "generated_illustration", "diagram", "none"]),
  // This is the slide-level contract used to audit a generated deck.  The
  // existing visualRole remains the narrative job; visualPurpose says what
  // the audience should actually see and why.
  visualPurpose: visualPurposeSchema.optional(),
  visualRationale: z.string().trim().max(240).optional(),
  sceneTextMode: sceneTextModeSchema.optional(),
  visualPrompt: z.string().default(""),
});
export type DesignBriefSlideDirection = z.infer<typeof designBriefSlideDirectionSchema>;

const designBriefObjectSchema = z.object({
  themeId: z.string(),
  themePreset: presentationThemePresetSchema.optional(),
  mood: z.enum(["dark", "light", "playful", "serious", "neutral"]),
  audienceFit: z.string(),
  visualMetaphor: z.string(),
  colorIntent: z.string(),
  typographyIntent: z.string(),
  rhythm: z.object({
    titleStyle: z.enum(["bold", "quiet", "editorial", "academic"]),
    density: z.enum(["low", "medium", "high"]),
    imageFrequency: z.enum(["rare", "balanced", "frequent"]),
    sectionBreaks: z.boolean(),
  }),
  slideDirections: z.array(designBriefSlideDirectionSchema).default([]),
  visualDirection: z.string().optional(),
  layoutPrinciples: z.array(z.string()).default([]),
  imageStrategy: z.string().default(""),
});

export const designBriefSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object") return value;
  const candidate = value as Record<string, unknown>;
  if (candidate.themeId && candidate.rhythm && candidate.slideDirections) return candidate;
  const themePreset = presentationThemePresetSchema.safeParse(candidate.themePreset);
  const mood = presentationThemeMoodSchema.safeParse(candidate.mood);
  const visualDirection = String(candidate.visualDirection || "");
  const imageStrategy = String(candidate.imageStrategy || "");
  const layoutPrinciples = Array.isArray(candidate.layoutPrinciples)
    ? candidate.layoutPrinciples.map((item) => String(item)).filter(Boolean)
    : [];
  return {
    themeId: String(candidate.themeId || (themePreset.success ? legacyThemeToPremiumThemeId[themePreset.data] : "academicClean")),
    themePreset: themePreset.success ? themePreset.data : undefined,
    mood: mood.success ? mood.data : "neutral",
    audienceFit: String(candidate.audienceFit || "Clear study presentation for the requested audience."),
    visualMetaphor: String(candidate.visualMetaphor || visualDirection || "Structured study path."),
    colorIntent: String(candidate.colorIntent || "Use a readable palette with one clear accent."),
    typographyIntent: String(candidate.typographyIntent || "Use legible study-report typography."),
    rhythm: candidate.rhythm || {
      titleStyle: "academic",
      density: "medium",
      imageFrequency: imageStrategy.toLowerCase().includes("image") ? "balanced" : "rare",
      sectionBreaks: true,
    },
    slideDirections: Array.isArray(candidate.slideDirections) ? candidate.slideDirections : [],
    visualDirection,
    layoutPrinciples,
    imageStrategy,
  };
}, designBriefObjectSchema);
export type DesignBrief = z.infer<typeof designBriefSchema>;

export const slideBlueprintSchema = z.object({
  slideOrder: z.number().int().positive(),
  purpose: z.string().trim().min(1),
  title: visibleSlideTextSchema("slide blueprint title", 90),
  visualStrategy: z.string().trim().min(1).max(260),
  layoutCandidate: slideLayoutSchema,
  textDensity: z.enum(["low", "medium", "high"]).default("medium"),
});
export type SlideBlueprint = z.infer<typeof slideBlueprintSchema>;

export const visualStrategySchema = z.object({
  slideOrder: z.number().int().positive(),
  visualType: visualTypeSchema.default("none"),
  role: z.enum(["explain", "evidence", "compare", "sequence", "emotion", "summary", "none"]).default("none"),
  rationale: z.string().trim().max(260).default(""),
  searchQuery: z.string().trim().max(160).default(""),
});
export type VisualStrategy = z.infer<typeof visualStrategySchema>;

export const diagramSpecSchema = z.object({
  slideOrder: z.number().int().positive(),
  kind: z.enum(["process", "comparison", "cause_effect", "timeline", "mind_map", "none"]).default("none"),
  mermaidKind: mermaidDiagramKindSchema.optional(),
  mermaidSource: mermaidDiagramSourceSchema.optional(),
  fallback: z.string().trim().max(1200).default(""),
  title: z.string().trim().max(90).default(""),
  nodes: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  links: z
    .array(
      z.object({
        from: z.string().trim().min(1).max(80),
        to: z.string().trim().min(1).max(80),
        label: z.string().trim().max(80).default(""),
      }),
    )
    .max(12)
    .default([]),
});
export type DiagramSpec = z.infer<typeof diagramSpecSchema>;

export const qualityIssueSchema = z.object({
  slideId: z.string().optional(),
  severity: z.enum(["blocker", "major", "minor"]),
  category: z.enum([
    "generic_text",
    "off_topic",
    "too_long",
    "duplicate",
    "bad_narration",
    "bad_visual",
    "factual_risk",
    "schema_risk",
  ]),
  field: z.string().optional(),
  message: z.string(),
  repairInstruction: z.string().optional(),
});
export type QualityIssue = z.infer<typeof qualityIssueSchema>;

export const qualityDimensionScoreSchema = z.object({
  score: z.number().min(0).max(100),
  reason: z.string().default(""),
});
export type QualityDimensionScore = z.infer<typeof qualityDimensionScoreSchema>;

export const qualityDimensionsSchema = z.object({
  speechNaturalness: qualityDimensionScoreSchema,
  universityTone: qualityDimensionScoreSchema,
  slideBrevity: qualityDimensionScoreSchema,
  visualRhythm: qualityDimensionScoreSchema,
  sourceGrounding: qualityDimensionScoreSchema,
  exportReadiness: qualityDimensionScoreSchema,
});
export type QualityDimensions = z.infer<typeof qualityDimensionsSchema>;

export const qualityCritiqueSchema = z
  .object({
    score: z.number().min(0).max(100).default(100),
    summary: z.string().default("No quality issues found."),
    dimensions: qualityDimensionsSchema.optional(),
    issues: z.array(qualityIssueSchema).default([]),
    passed: z.boolean().optional(),
  })
  .transform((value) => ({
    ...value,
    passed: value.passed ?? (value.score >= 80 && !value.issues.some((issue) => issue.severity === "blocker")),
  }));
export type QualityCritique = z.infer<typeof qualityCritiqueSchema>;

export const generationPipelineArtifactsSchema = z.object({
  researchBrief: researchBriefSchema,
  narrativePlan: z.array(slideNarrativeSchema),
  deckStory: deckStorySchema.optional(),
  designBrief: designBriefSchema,
  slideBlueprints: z.array(slideBlueprintSchema).default([]),
  slideTextPlans: z.array(slideTextPlanSchema).default([]),
  visualStrategies: z.array(visualStrategySchema).default([]),
  diagramSpecs: z.array(diagramSpecSchema).default([]),
  qualityCritique: qualityCritiqueSchema.optional(),
});
export type GenerationPipelineArtifacts = z.infer<typeof generationPipelineArtifactsSchema>;

export const generationBriefSchema = z.object({
  audience: z.enum(["general", "school_student", "university_student"]).default("general"),
  speechStyle: z.enum(["easy_professional"]).default("easy_professional"),
  slideDensity: z.enum(["brief_slides_full_speech"]).default("brief_slides_full_speech"),
  visualStrategy: z.enum(["images_and_diagrams"]).default("images_and_diagrams"),
  exportTarget: z.enum(["web_and_pptx_pdf"]).default("web_and_pptx_pdf"),
});
export type GenerationBrief = z.infer<typeof generationBriefSchema>;
