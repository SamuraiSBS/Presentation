import { z } from "zod";

export const planCodeSchema = z.enum(["free", "student", "pro"]);
export type PlanCode = z.infer<typeof planCodeSchema>;

export const scenarioSchema = z.enum([
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
  "queued",
  "generating",
  "ready",
  "failed",
]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

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
});
export type Source = z.infer<typeof sourceSchema>;

export const sourceRefSchema = z.object({
  sourceId: z.string(),
  label: z.string(),
  excerpt: z.string(),
  page: z.string().nullable().default(null),
});
export type SourceRef = z.infer<typeof sourceRefSchema>;

export const slideBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("bullets"),
    items: z.array(z.string()).max(6),
  }),
  z.object({
    type: z.literal("callout"),
    content: z.string(),
  }),
  z.object({
    type: z.literal("quote"),
    content: z.string(),
  }),
]);
export type SlideBlock = z.infer<typeof slideBlockSchema>;

export const slideKindSchema = z.enum(["title", "section", "content", "summary"]);
export type SlideKind = z.infer<typeof slideKindSchema>;

export const visualTypeSchema = z.enum([
  "process_diagram",
  "comparison_diagram",
  "cause_effect_diagram",
  "before_after_table",
  "pros_cons_table",
  "timeline",
  "mind_map",
  "illustration",
  "schema",
  "image",
  "none",
]);
export type VisualType = z.infer<typeof visualTypeSchema>;

export const slideDefinitionSchema = z.object({
  term: z.string().default(""),
  text: z.string().default(""),
});
export type SlideDefinition = z.infer<typeof slideDefinitionSchema>;

export const keyConceptSchema = z.object({
  label: z.string(),
  icon: z.string().default("dot"),
});
export type KeyConcept = z.infer<typeof keyConceptSchema>;

export const highlightSchema = z.object({
  text: z.string(),
  tone: z.enum(["accent", "success", "warning", "neutral"]).default("accent"),
});
export type Highlight = z.infer<typeof highlightSchema>;

export const slideVisualItemSchema = z.object({
  label: z.string(),
  text: z.string().default(""),
});
export type SlideVisualItem = z.infer<typeof slideVisualItemSchema>;

export const slideVisualRowSchema = z.object({
  label: z.string().default(""),
  left: z.string().default(""),
  right: z.string().default(""),
});
export type SlideVisualRow = z.infer<typeof slideVisualRowSchema>;

export const slideVisualImageSchema = z.object({
  url: z.string().url(),
  objectKey: z.string().optional(),
  alt: z.string().default(""),
  query: z.string().default(""),
  sourceUrl: z.string().url().optional(),
  sourceTitle: z.string().default(""),
  provider: z.literal("tavily").default("tavily"),
  contentType: z.string().default(""),
});
export type SlideVisualImage = z.infer<typeof slideVisualImageSchema>;

export const slideVisualSchema = z.object({
  type: visualTypeSchema.default("none"),
  title: z.string().default(""),
  description: z.string().default(""),
  leftLabel: z.string().default(""),
  rightLabel: z.string().default(""),
  items: z.array(slideVisualItemSchema).max(8).default([]),
  rows: z.array(slideVisualRowSchema).max(8).default([]),
  image: slideVisualImageSchema.optional(),
});
export type SlideVisual = z.infer<typeof slideVisualSchema>;

export const slideSchema = z.object({
  id: z.string(),
  order: z.number().int().positive(),
  title: z.string(),
  slideKind: slideKindSchema.default("content"),
  layout: z.enum(["hero", "bullets", "two-column", "summary"]),
  thesis: z.string().default(""),
  bullets: z.array(z.string()).max(5).default([]),
  definition: slideDefinitionSchema.nullable().default(null),
  keyConcepts: z.array(keyConceptSchema).max(5).default([]),
  visual: slideVisualSchema.default({ type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] }),
  highlights: z.array(highlightSchema).max(6).default([]),
  blocks: z.array(slideBlockSchema),
  speakerNotes: z.string(),
  timingSeconds: z.number().int().min(20).max(240),
  sourceRefs: z.array(sourceRefSchema),
});
export type Slide = z.infer<typeof slideSchema>;

export const speechScriptItemSchema = z.object({
  slideOrder: z.number().int().positive(),
  slideTitle: z.string(),
  text: z.string(),
});
export type SpeechScriptItem = z.infer<typeof speechScriptItemSchema>;

export const presentationSchema = z.object({
  id: z.string(),
  title: z.string(),
  scenario: z.string(),
  level: z.string(),
  slideCount: z.number().int().positive(),
  generationMode: z.enum(["openai", "yandex", "demo", "demo-fallback"]),
  sources: z.array(sourceSchema),
  outline: z.array(z.string()),
  speechScript: z.array(speechScriptItemSchema),
  slides: z.array(slideSchema),
});
export type PresentationDocument = z.infer<typeof presentationSchema>;

export const createProjectInputSchema = z.object({
  title: z.string().min(2).max(140),
  prompt: z.string().min(18).max(12000),
  scenario: scenarioSchema,
  level: z.string().min(2).max(80),
  mode: z.enum(["fast_draft", "with_sources", "explain_simpler"]),
  slideCount: z.number().int().min(4).max(20),
});
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

export const updateSlideInputSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  blocks: z.array(slideBlockSchema).optional(),
  speakerNotes: z.string().max(5000).optional(),
});
export type UpdateSlideInput = z.infer<typeof updateSlideInputSchema>;

export const exportTypeSchema = z.enum(["pdf", "pptx"]);
export type ExportType = z.infer<typeof exportTypeSchema>;

export const planLimits = {
  free: {
    monthlyPresentations: 3,
    maxSlides: 10,
    maxProjectBytes: 50 * 1024 * 1024,
    exports: ["pdf"],
  },
  student: {
    monthlyPresentations: 60,
    maxSlides: 14,
    maxProjectBytes: 100 * 1024 * 1024,
    exports: ["pdf", "pptx"],
  },
  pro: {
    monthlyPresentations: 200,
    maxSlides: 20,
    maxProjectBytes: 250 * 1024 * 1024,
    exports: ["pdf", "pptx"],
  },
} as const;

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
