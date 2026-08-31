import { z } from "zod";
import { contentPlaceholderSchema } from "../defense/schemas.js";
import { sourceRefSchema } from "../projects/schemas.js";
import { PRESENTATION_FONT_FAMILY } from "./fonts.js";
const unsupportedGeneratedTextPatterns = [
  /слайд\s+должен/i,
  /на\s+этом\s+слайде\s+нужно/i,
  /этот\s+слайд\s+помогает/i,
  /продолжает\s+разговор\s+о\s+теме/i,
  /общая\s+логика\s+объяснения/i,
  /главный\s+акцент\s+здесь/i,
  /slide\s+should/i,
  /this\s+slide\s+helps/i,
];

const genericEducationalFillerPatterns = [
  /(?:главн[\p{L}\p{N}_]*\s+)?(?:фактор[\p{L}\p{N}_]*|факт[\p{L}\p{N}_]*|детал[\p{L}\p{N}_]+)\s+(?:зада[её]т|задают|стро[\p{L}\p{N}_]+|формир[\p{L}\p{N}_]+)\s+логик[\p{L}\p{N}_]+\s+объяснен[\p{L}\p{N}_]*/iu,
  /(?:связь\s+между\s+)?(?:факт[\p{L}\p{N}_]+|детал[\p{L}\p{N}_]+|фактор[\p{L}\p{N}_]+)\s+дела[\p{L}\p{N}_]+\s+(?:тем[\p{L}\p{N}_]+|материал|объяснен[\p{L}\p{N}_]+)\s+понятн[\p{L}\p{N}_]*/iu,
  /помога[\p{L}\p{N}_]+\s+объясн[\p{L}\p{N}_]+/iu,
  /станов[\p{L}\p{N}_]+\s+смысл[\p{L}\p{N}_]+/iu,
  /тема\s+становится\s+понятнее/i,
  /важно\s+понять\s+основные\s+моменты/i,
  /это\s+важно\s+для\s+понимания\s+темы/i,
  /данная\s+презентация\s+рассказывает/i,
  /in\s+this\s+presentation/i,
];

function hasUnsupportedGeneratedText(value: string) {
  return unsupportedGeneratedTextPatterns.some((pattern) => pattern.test(value));
}

function hasGenericEducationalFiller(value: string) {
  return genericEducationalFillerPatterns.some((pattern) => pattern.test(value));
}

export const visibleSlideTextSchema = (field: string, maxLength: number) =>
  z
    .string()
    .trim()
    .min(1, `${field} cannot be empty`)
    .max(maxLength, `${field} is too long for visible slide text`)
    .refine((value) => !hasUnsupportedGeneratedText(value), `${field} contains unsupported slide-instruction language`)
    .refine((value) => !hasGenericEducationalFiller(value), `${field} contains generic educational filler`);

export const speakerNotesTextSchema = z
  .string()
  .trim()
  .min(1, "speakerNotes cannot be empty")
  .refine((value) => !hasUnsupportedGeneratedText(value), "speakerNotes contains unsupported slide-instruction language");

export const slideBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("bullets"),
    items: z.array(visibleSlideTextSchema("bullet", 1000)).max(6),
  }),
  z.object({
    type: z.literal("callout"),
    content: visibleSlideTextSchema("callout", 1000),
  }),
  z.object({
    type: z.literal("quote"),
    content: visibleSlideTextSchema("quote", 1000),
  }),
]);
export type SlideBlock = z.infer<typeof slideBlockSchema>;

export const slideKindSchema = z.enum(["title", "section", "content", "summary"]);
export type SlideKind = z.infer<typeof slideKindSchema>;

export const slideLayoutSchema = z.enum([
  "hero",
  "bullets",
  "two-column",
  "summary",
  "statement",
  "quote",
  "definition",
  "timeline",
  "comparison",
  "process",
  "image-focus",
  "case-study",
  "question-answer",
  "myth-fact",
  "metrics",
  "evidence",
  "problem-solution",
  "explain-example",
]);
export type SlideLayout = z.infer<typeof slideLayoutSchema>;

export type SlideLayoutRequirement = "definition" | "comparison" | "sequence" | "metrics" | "sources";

export type SlideLayoutDefinition = {
  id: SlideLayout;
  label: string;
  description: string;
  kinds: SlideKind[];
  requirements: SlideLayoutRequirement[];
  fallback: SlideLayout;
};

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
  term: z.string().trim().max(80).default(""),
  text: z.string().trim().max(240).default(""),
});
export type SlideDefinition = z.infer<typeof slideDefinitionSchema>;

export const keyConceptSchema = z.object({
  label: visibleSlideTextSchema("key concept", 80),
  icon: z.string().default("dot"),
});
export type KeyConcept = z.infer<typeof keyConceptSchema>;

export const highlightSchema = z.object({
  text: visibleSlideTextSchema("highlight", 140),
  tone: z.enum(["accent", "success", "warning", "neutral"]).default("accent"),
});
export type Highlight = z.infer<typeof highlightSchema>;

export const presentationThemePresetSchema = z.enum([
  "moody",
  "bright",
  "academic",
  "tech",
  "nature",
  "history",
  "minimal",
]);
export type PresentationThemePreset = z.infer<typeof presentationThemePresetSchema>;

export const presentationThemeMoodSchema = z.enum(["dark", "light", "playful", "serious", "neutral"]);
export type PresentationThemeMood = z.infer<typeof presentationThemeMoodSchema>;

export const presentationThemeColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((value) => value.toUpperCase());

export const presentationThemeSchema = z.object({
  preset: presentationThemePresetSchema,
  themeId: z.string().optional(),
  mood: presentationThemeMoodSchema,
  colors: z.object({
    background: presentationThemeColorSchema,
    surface: presentationThemeColorSchema,
    surfaceAlt: presentationThemeColorSchema,
    text: presentationThemeColorSchema,
    muted: presentationThemeColorSchema,
    accent: presentationThemeColorSchema,
    accentAlt: presentationThemeColorSchema,
    line: presentationThemeColorSchema,
  }),
  fonts: z.object({
    heading: z.string().min(1),
    body: z.string().min(1),
    tone: z.enum(["strict", "rounded", "bookish", "technical", "neutral"]),
  }).transform((fonts) => ({
    ...fonts,
    heading: PRESENTATION_FONT_FAMILY,
    body: PRESENTATION_FONT_FAMILY,
  })),
});
export type PresentationTheme = z.infer<typeof presentationThemeSchema>;

export const slideVisualItemSchema = z.object({
  label: visibleSlideTextSchema("visual item label", 100),
  text: z.string().trim().max(180).default(""),
});
export type SlideVisualItem = z.infer<typeof slideVisualItemSchema>;

export const slideVisualRowSchema = z.object({
  label: z.string().trim().max(80).default(""),
  left: z.string().trim().max(160).default(""),
  right: z.string().trim().max(160).default(""),
});
export type SlideVisualRow = z.infer<typeof slideVisualRowSchema>;

export const slideVisualImageSchema = z.object({
  url: z.string().url(),
  sourceId: z.string().trim().min(1).max(128).optional(),
  objectKey: z.string().optional(),
  alt: z.string().default(""),
  query: z.string().default(""),
  sourceUrl: z.string().url().optional(),
  sourceTitle: z.string().default(""),
  provider: z.enum(["tavily", "user", "repository", "archive"]).default("tavily"),
  contentType: z.string().default(""),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  byteSize: z.number().int().nonnegative().optional(),
  warnings: z.array(z.string().trim().min(1).max(180)).max(6).default([]),
});
export type SlideVisualImage = z.infer<typeof slideVisualImageSchema>;

export const mermaidDiagramSourceSchema = z
  .string()
  .trim()
  .max(3000)
  .refine((value) => !/<\/?[a-z][\s\S]*>/i.test(value), "Mermaid source cannot contain HTML")
  .refine((value) => !/\b(?:script|javascript:|onerror|onload|iframe|foreignObject)\b/i.test(value), "Mermaid source contains unsafe content");

export const mermaidDiagramKindSchema = z.enum(["flowchart", "sequence", "timeline", "mindmap"]);
export type MermaidDiagramKind = z.infer<typeof mermaidDiagramKindSchema>;

export const mermaidDiagramSpecSchema = z.object({
  kind: mermaidDiagramKindSchema,
  source: mermaidDiagramSourceSchema,
  fallback: z.string().trim().max(1200).default(""),
  title: z.string().trim().max(90).default(""),
  caption: z.string().trim().max(160).default(""),
  safety: z.enum(["safe", "fallback"]).default("safe"),
});
export type MermaidDiagramSpec = z.infer<typeof mermaidDiagramSpecSchema>;

export const diagramGraphNodeSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  detail: z.string().trim().max(180).default(""),
});
export type DiagramGraphNode = z.infer<typeof diagramGraphNodeSchema>;

export const diagramGraphEdgeSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  source: z.string().trim().min(1).max(80),
  target: z.string().trim().min(1).max(80),
  label: z.string().trim().max(120).default(""),
});
export type DiagramGraphEdge = z.infer<typeof diagramGraphEdgeSchema>;

export const diagramGraphSpecSchema = z.object({
  layoutDirection: z.enum(["LR", "TB"]).default("LR"),
  nodes: z.array(diagramGraphNodeSchema).min(2).max(10),
  edges: z.array(diagramGraphEdgeSchema).max(16).default([]),
  fallback: z.string().trim().max(1200).default(""),
  title: z.string().trim().max(90).default(""),
});
export type DiagramGraphSpec = z.infer<typeof diagramGraphSpecSchema>;

export const slideVisualSchema = z.object({
  type: visualTypeSchema.default("none"),
  title: z.string().trim().max(100).default(""),
  description: z.string().trim().max(260).default(""),
  leftLabel: z.string().trim().max(80).default(""),
  rightLabel: z.string().trim().max(80).default(""),
  items: z.array(slideVisualItemSchema).max(8).default([]),
  rows: z.array(slideVisualRowSchema).max(8).default([]),
  image: slideVisualImageSchema.optional(),
  diagram: mermaidDiagramSpecSchema.optional(),
  graph: diagramGraphSpecSchema.optional(),
});
export type SlideVisual = z.infer<typeof slideVisualSchema>;

const canvasElementBaseSchema = z.object({
  id: z.string(),
  groupId: z.string().optional(),
  x: z.number().min(-1280).max(2560),
  y: z.number().min(-720).max(1440),
  w: z.number().positive().max(2560),
  h: z.number().positive().max(1440),
  rotation: z.number().default(0),
  zIndex: z.number().int().default(1),
  opacity: z.number().min(0).max(1).default(1),
  locked: z.boolean().default(false),
});

export const canvasTextRunSchema = z.object({
  text: z.string().max(500),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  color: presentationThemeColorSchema.optional(),
});
export type CanvasTextRun = z.infer<typeof canvasTextRunSchema>;

export const canvasTextElementSchema = canvasElementBaseSchema.extend({
  type: z.literal("text"),
  role: z.enum(["title", "body", "caption", "free"]).default("free"),
  typographyRole: z.enum(["deckTitle", "slideTitle", "mainClaim", "body", "supporting", "label", "sourceCredit", "slideNumber"]).optional(),
  text: z.string().max(1000).default(""),
  runs: z.array(canvasTextRunSchema).default([]),
  fontSize: z.number().int().min(8).max(160).default(28),
  autoFit: z.boolean().optional(),
  fontFamily: z.string().min(1).default(PRESENTATION_FONT_FAMILY),
  color: presentationThemeColorSchema.default("#161A1F"),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  underline: z.boolean().default(false),
  align: z.enum(["left", "center", "right"]).default("left"),
  valign: z.enum(["top", "middle", "bottom"]).default("top"),
});
export type CanvasTextElement = z.infer<typeof canvasTextElementSchema>;

export const canvasImageElementSchema = canvasElementBaseSchema.extend({
  type: z.literal("image"),
  url: z.string().default(""),
  objectKey: z.string().default(""),
  alt: z.string().default(""),
  contentType: z.string().default(""),
  fit: z.enum(["contain", "cover"]).default("cover"),
  sourceWidth: z.number().int().positive().optional(),
  sourceHeight: z.number().int().positive().optional(),
  byteSize: z.number().int().nonnegative().optional(),
});
export type CanvasImageElement = z.infer<typeof canvasImageElementSchema>;

export const canvasShapeElementSchema = canvasElementBaseSchema.extend({
  type: z.literal("shape"),
  shape: z.enum(["rect", "roundRect", "ellipse", "line"]).default("rect"),
  fill: presentationThemeColorSchema.default("#FFFFFF"),
  stroke: presentationThemeColorSchema.default("#DDE1E7"),
  strokeWidth: z.number().min(0).max(24).default(1),
});
export type CanvasShapeElement = z.infer<typeof canvasShapeElementSchema>;

export const canvasElementSchema = z.discriminatedUnion("type", [
  canvasTextElementSchema,
  canvasImageElementSchema,
  canvasShapeElementSchema,
]);
export type CanvasElement = z.infer<typeof canvasElementSchema>;

export const canvasGradientStopSchema = z.object({
  offset: z.number().min(0).max(1),
  color: presentationThemeColorSchema,
  opacity: z.number().min(0).max(1).default(1),
});

export const canvasGradientBlobSchema = z.object({
  x: z.number().min(-0.5).max(1.5),
  y: z.number().min(-0.5).max(1.5),
  size: z.number().min(0.05).max(2),
  color: presentationThemeColorSchema,
  opacity: z.number().min(0).max(1).default(0.35),
  blur: z.number().min(0).max(200).default(80),
});

export const canvasBackgroundStyleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("solid"),
    color: presentationThemeColorSchema,
  }),
  z.object({
    type: z.literal("gradient"),
    angle: z.number().min(-360).max(360).default(135),
    stops: z.array(canvasGradientStopSchema).min(2).max(8),
    blobs: z.array(canvasGradientBlobSchema).max(8).default([]),
  }),
]);
export type CanvasBackgroundStyle = z.infer<typeof canvasBackgroundStyleSchema>;

export const slideCanvasSchema = z.object({
  version: z.number().int().min(1).optional(),
  width: z.number().int().positive().default(1280),
  height: z.number().int().positive().default(720),
  background: presentationThemeColorSchema.default("#F7F8FA"),
  backgroundStyle: canvasBackgroundStyleSchema.optional(),
  elements: z.array(canvasElementSchema).max(80).default([]),
}).superRefine((canvas, context) => {
  for (const [index, element] of canvas.elements.entries()) {
    if (element.x + element.w < -1 || element.x > canvas.width + 1 || element.y + element.h < -1 || element.y > canvas.height + 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["elements", index],
        message: "canvas element is outside the export-safe slide bounds",
      });
    }
  }
});
export type SlideCanvas = z.infer<typeof slideCanvasSchema>;

export const slideSchema = z.object({
  id: z.string(),
  order: z.number().int().positive(),
  title: visibleSlideTextSchema("slide title", 1000),
  slideKind: slideKindSchema.default("content"),
  layout: slideLayoutSchema,
  thesis: z.string().trim().max(360).default(""),
  bullets: z.array(visibleSlideTextSchema("bullet", 1000)).max(5).default([]),
  definition: slideDefinitionSchema.nullable().default(null),
  keyConcepts: z.array(keyConceptSchema).max(5).default([]),
  visual: slideVisualSchema.default({ type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] }),
  highlights: z.array(highlightSchema).max(6).default([]),
  placeholders: z.array(contentPlaceholderSchema).max(50).default([]),
  blocks: z.array(slideBlockSchema),
  canvas: slideCanvasSchema.optional(),
  speakerNotes: speakerNotesTextSchema,
  timingSeconds: z.number().int().min(20).max(240),
  sourceRefs: z.array(sourceRefSchema),
});
export type Slide = z.infer<typeof slideSchema>;

export const speechScriptItemSchema = z.object({
  slideOrder: z.number().int().positive(),
  slideTitle: visibleSlideTextSchema("speech script slide title", 1000),
  text: speakerNotesTextSchema,
});
export type SpeechScriptItem = z.infer<typeof speechScriptItemSchema>;
