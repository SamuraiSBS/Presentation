import { z } from "zod";

export const planCodeSchema = z.enum(["free", "student", "pro"]);
export type PlanCode = z.infer<typeof planCodeSchema>;

export const scenarioSchema = z.enum([
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

export const jobStatusSchema = z.enum(["queued", "active", "completed", "failed"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const generationProgressStageSchema = z.enum([
  "queued",
  "researching",
  "drafting_speech",
  "building_slides",
  "selecting_visuals",
  "polishing",
  "saving",
  "completed",
  "failed",
]);
export type GenerationProgressStage = z.infer<typeof generationProgressStageSchema>;

export const generationJobKindSchema = z.enum(["narration", "presentation"]);
export type GenerationJobKind = z.infer<typeof generationJobKindSchema>;

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

const visibleSlideTextSchema = (field: string, maxLength: number) =>
  z
    .string()
    .trim()
    .min(1, `${field} cannot be empty`)
    .max(maxLength, `${field} is too long for visible slide text`)
    .refine((value) => !hasUnsupportedGeneratedText(value), `${field} contains unsupported slide-instruction language`)
    .refine((value) => !hasGenericEducationalFiller(value), `${field} contains generic educational filler`);

const speakerNotesTextSchema = z
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

export const SLIDE_LAYOUT_DEFINITIONS: SlideLayoutDefinition[] = [
  { id: "hero", label: "Титульный", description: "Название и вводный тезис", kinds: ["title", "section"], requirements: [], fallback: "hero" },
  { id: "summary", label: "Итоги", description: "Главные выводы презентации", kinds: ["summary"], requirements: [], fallback: "summary" },
  { id: "statement", label: "Главный тезис", description: "Одна сильная мысль", kinds: ["content"], requirements: [], fallback: "bullets" },
  { id: "bullets", label: "Список", description: "Короткие тезисы", kinds: ["content"], requirements: [], fallback: "statement" },
  { id: "two-column", label: "Две колонки", description: "Два связанных блока", kinds: ["content"], requirements: ["comparison"], fallback: "bullets" },
  { id: "quote", label: "Цитата", description: "Центральная формулировка", kinds: ["content"], requirements: [], fallback: "statement" },
  { id: "definition", label: "Определение", description: "Термин и объяснение", kinds: ["content"], requirements: ["definition"], fallback: "explain-example" },
  { id: "timeline", label: "Хронология", description: "События на временной оси", kinds: ["content"], requirements: ["sequence"], fallback: "process" },
  { id: "comparison", label: "Сравнение", description: "Сравнение по нескольким критериям", kinds: ["content"], requirements: ["comparison"], fallback: "bullets" },
  { id: "process", label: "Процесс", description: "Последовательность шагов", kinds: ["content"], requirements: ["sequence"], fallback: "bullets" },
  { id: "image-focus", label: "Изображение", description: "Визуальный пример и пояснение", kinds: ["content"], requirements: [], fallback: "statement" },
  { id: "case-study", label: "Кейс", description: "Ситуация, действие, результат", kinds: ["content"], requirements: ["sequence"], fallback: "process" },
  { id: "question-answer", label: "Вопрос и ответ", description: "Вопрос с ясным ответом", kinds: ["content"], requirements: [], fallback: "statement" },
  { id: "myth-fact", label: "Миф и факт", description: "Исправление заблуждения", kinds: ["content"], requirements: ["comparison"], fallback: "statement" },
  { id: "metrics", label: "Показатели", description: "Только реальные числа и величины", kinds: ["content"], requirements: ["metrics"], fallback: "statement" },
  { id: "evidence", label: "Тезис и доказательства", description: "Тезис, факты и компактные источники", kinds: ["content"], requirements: [], fallback: "bullets" },
  { id: "problem-solution", label: "Проблема и решение", description: "Проблема, причина и решение", kinds: ["content"], requirements: ["sequence"], fallback: "process" },
  { id: "explain-example", label: "Объяснение и пример", description: "Понятие, объяснение, пример и оговорка", kinds: ["content"], requirements: [], fallback: "definition" },
];

const HIDDEN_SLIDE_LAYOUTS = new Set<SlideLayout>([
  "bullets",
  "case-study",
  "comparison",
  "definition",
  "evidence",
  "explain-example",
  "myth-fact",
  "problem-solution",
  "question-answer",
]);

export function slideLayoutDefinition(layout: SlideLayout) {
  return SLIDE_LAYOUT_DEFINITIONS.find((item) => item.id === layout) || SLIDE_LAYOUT_DEFINITIONS[0];
}

export function slideLayoutOptions(kind: SlideKind) {
  return SLIDE_LAYOUT_DEFINITIONS.filter((item) => item.id !== "two-column" && !HIDDEN_SLIDE_LAYOUTS.has(item.id) && item.kinds.includes(kind));
}

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
  }),
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
  objectKey: z.string().optional(),
  alt: z.string().default(""),
  query: z.string().default(""),
  sourceUrl: z.string().url().optional(),
  sourceTitle: z.string().default(""),
  provider: z.literal("tavily").default("tavily"),
  contentType: z.string().default(""),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  byteSize: z.number().int().nonnegative().optional(),
  warnings: z.array(z.string().trim().min(1).max(180)).max(6).default([]),
});
export type SlideVisualImage = z.infer<typeof slideVisualImageSchema>;

const mermaidDiagramSourceSchema = z
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
  text: z.string().max(1000).default(""),
  runs: z.array(canvasTextRunSchema).default([]),
  fontSize: z.number().int().min(8).max(160).default(28),
  autoFit: z.boolean().optional(),
  fontFamily: z.string().min(1).default("Arial"),
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

export const slideNarrativeSchema = z.object({
  slideOrder: z.number().int().positive(),
  slideTitle: visibleSlideTextSchema("narrative slide title", 1000),
  slidePurpose: z.string().trim().min(1),
  keyMessage: z.string().trim().min(1),
  audienceQuestion: z.string().trim().min(1),
  transitionToNext: z.string().trim().default(""),
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
});
export type DeckStory = z.infer<typeof deckStorySchema>;

export const slideTextPlanSchema = z.object({
  slideOrder: z.number().int().positive(),
  slideQuestion: z.string().trim().min(1),
  coreClaim: z.string().trim().min(1),
  evidenceOrExample: z.string().default(""),
  listenerTakeaway: z.string().trim().min(1),
  title: visibleSlideTextSchema("slide plan title", 90),
  thesis: z.string().trim().min(1).max(360),
  bullets: z.array(visibleSlideTextSchema("slide plan bullet", 140)).max(3),
  speakerNotes: speakerNotesTextSchema,
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

export const designBriefSlideDirectionSchema = z.object({
  slideOrder: z.number().int().positive(),
  visualRole: z.enum(["hero", "problem", "context", "explain", "compare", "sequence", "evidence", "quote", "visual_statement", "reflect", "summary"]),
  layoutIntent: z.enum(["full_bleed_image", "split_image_text", "statement", "cards", "timeline", "diagram", "comparison", "evidence_board", "quote_spread", "metric", "summary"]),
  imageStrategy: z.enum(["real_photo", "generated_illustration", "diagram", "none"]),
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

export const presentationSchema = z.object({
  id: z.string(),
  title: z.string(),
  scenario: z.string(),
  level: z.string(),
  slideCount: z.number().int().positive(),
  generationMode: z.enum(["openai", "yandex", "demo", "demo-fallback"]),
  generatedText: z.string().default(""),
  sources: z.array(sourceSchema),
  outline: z.array(z.string()),
  narrativePlan: z.array(slideNarrativeSchema).default([]),
  presentationTheme: presentationThemeSchema.optional(),
  designBrief: designBriefSchema.optional(),
  speechScript: z.array(speechScriptItemSchema),
  slides: z.array(slideSchema),
});
export type PresentationDocument = z.infer<typeof presentationSchema>;

const PRESENTATION_THEME_PRESETS = {
  moody: {
    preset: "moody",
    mood: "dark",
    colors: {
      background: "#14151C",
      surface: "#20222D",
      surfaceAlt: "#2D2634",
      text: "#F5F1EA",
      muted: "#C8C0B7",
      accent: "#C86B5C",
      accentAlt: "#8EA4D2",
      line: "#3B3D49",
    },
    fonts: {
      heading: "Georgia",
      body: "Arial",
      tone: "strict",
    },
  },
  bright: {
    preset: "bright",
    mood: "playful",
    colors: {
      background: "#F7FBFF",
      surface: "#FFFFFF",
      surfaceAlt: "#E9F7F2",
      text: "#15231F",
      muted: "#4D625B",
      accent: "#FF8A00",
      accentAlt: "#16A085",
      line: "#CFE3DC",
    },
    fonts: {
      heading: "Trebuchet MS",
      body: "Arial",
      tone: "rounded",
    },
  },
  academic: {
    preset: "academic",
    mood: "serious",
    colors: {
      background: "#F5F7FB",
      surface: "#FFFFFF",
      surfaceAlt: "#E8EEF8",
      text: "#172033",
      muted: "#536074",
      accent: "#315D9B",
      accentAlt: "#8C5D2B",
      line: "#D7DEEA",
    },
    fonts: {
      heading: "Georgia",
      body: "Arial",
      tone: "bookish",
    },
  },
  tech: {
    preset: "tech",
    mood: "neutral",
    colors: {
      background: "#101820",
      surface: "#172331",
      surfaceAlt: "#20364A",
      text: "#F1F7FB",
      muted: "#B8CAD8",
      accent: "#38BDF8",
      accentAlt: "#A3E635",
      line: "#315064",
    },
    fonts: {
      heading: "Aptos Display",
      body: "Aptos",
      tone: "technical",
    },
  },
  nature: {
    preset: "nature",
    mood: "light",
    colors: {
      background: "#F3F8F1",
      surface: "#FFFFFF",
      surfaceAlt: "#E4F0DF",
      text: "#17261B",
      muted: "#50634D",
      accent: "#2F7D4E",
      accentAlt: "#C07A2D",
      line: "#CEDFC8",
    },
    fonts: {
      heading: "Verdana",
      body: "Arial",
      tone: "neutral",
    },
  },
  history: {
    preset: "history",
    mood: "serious",
    colors: {
      background: "#F8F6F1",
      surface: "#FFFFFF",
      surfaceAlt: "#EDE6DA",
      text: "#211B16",
      muted: "#675A4E",
      accent: "#9A3F32",
      accentAlt: "#2E5F6E",
      line: "#DDD2C2",
    },
    fonts: {
      heading: "Georgia",
      body: "Arial",
      tone: "bookish",
    },
  },
  minimal: {
    preset: "minimal",
    mood: "neutral",
    colors: {
      background: "#F7F8FA",
      surface: "#FFFFFF",
      surfaceAlt: "#ECEFF3",
      text: "#161A1F",
      muted: "#59616B",
      accent: "#5B5BD6",
      accentAlt: "#14866D",
      line: "#DDE1E7",
    },
    fonts: {
      heading: "Arial",
      body: "Arial",
      tone: "neutral",
    },
  },
} satisfies Record<PresentationThemePreset, PresentationTheme>;

export const PREMIUM_PRESENTATION_THEMES = {
  editorialMagazine: {
    preset: "history",
    themeId: "editorialMagazine",
    mood: "serious",
    colors: {
      background: "#F7F3EC",
      surface: "#FFFFFF",
      surfaceAlt: "#EFE7DA",
      text: "#171412",
      muted: "#6E6258",
      accent: "#C24E2C",
      accentAlt: "#1F5B68",
      line: "#DED2C4",
    },
    fonts: {
      heading: "Georgia",
      body: "Arial",
      tone: "bookish",
    },
  },
  academicClean: {
    preset: "academic",
    themeId: "academicClean",
    mood: "serious",
    colors: {
      background: "#F6F8FB",
      surface: "#FFFFFF",
      surfaceAlt: "#EAF0F6",
      text: "#172033",
      muted: "#667085",
      accent: "#2F6BFF",
      accentAlt: "#1B9A77",
      line: "#D9E2EC",
    },
    fonts: {
      heading: "Arial",
      body: "Arial",
      tone: "strict",
    },
  },
  darkLecture: {
    preset: "moody",
    themeId: "darkLecture",
    mood: "dark",
    colors: {
      background: "#101318",
      surface: "#181D24",
      surfaceAlt: "#202733",
      text: "#F3F6FA",
      muted: "#9AA7B7",
      accent: "#FFB020",
      accentAlt: "#4DA3FF",
      line: "#303846",
    },
    fonts: {
      heading: "Aptos Display",
      body: "Aptos",
      tone: "technical",
    },
  },
  timelineDocumentary: {
    preset: "history",
    themeId: "timelineDocumentary",
    mood: "serious",
    colors: {
      background: "#F4EFE6",
      surface: "#FFFDF8",
      surfaceAlt: "#E7DDCC",
      text: "#1F1A14",
      muted: "#756B5D",
      accent: "#8D3B2F",
      accentAlt: "#2E5E73",
      line: "#D5C7B3",
    },
    fonts: {
      heading: "Georgia",
      body: "Arial",
      tone: "bookish",
    },
  },
  scienceBoard: {
    preset: "nature",
    themeId: "scienceBoard",
    mood: "light",
    colors: {
      background: "#F3FAF8",
      surface: "#FFFFFF",
      surfaceAlt: "#E4F2EF",
      text: "#10201D",
      muted: "#58706B",
      accent: "#0E9F87",
      accentAlt: "#4C6FFF",
      line: "#CFE2DE",
    },
    fonts: {
      heading: "Aptos Display",
      body: "Aptos",
      tone: "technical",
    },
  },
  startupPitch: {
    preset: "minimal",
    themeId: "startupPitch",
    mood: "neutral",
    colors: {
      background: "#F8FAFC",
      surface: "#FFFFFF",
      surfaceAlt: "#EEF2FF",
      text: "#111827",
      muted: "#64748B",
      accent: "#2563EB",
      accentAlt: "#F97316",
      line: "#D8DEE9",
    },
    fonts: {
      heading: "Arial",
      body: "Arial",
      tone: "strict",
    },
  },
  softClassroom: {
    preset: "bright",
    themeId: "softClassroom",
    mood: "playful",
    colors: {
      background: "#FFF8EF",
      surface: "#FFFFFF",
      surfaceAlt: "#FCEBD8",
      text: "#241A12",
      muted: "#7C6858",
      accent: "#F28C38",
      accentAlt: "#5B8DEF",
      line: "#EAD8C3",
    },
    fonts: {
      heading: "Trebuchet MS",
      body: "Arial",
      tone: "rounded",
    },
  },
} satisfies Record<string, PresentationTheme>;

export type PremiumPresentationThemeId = keyof typeof PREMIUM_PRESENTATION_THEMES;

export const PREMIUM_PRESENTATION_THEME_IDS = Object.keys(PREMIUM_PRESENTATION_THEMES) as PremiumPresentationThemeId[];

export function resolvePremiumPresentationTheme(themeId: string | undefined, fallback: PresentationTheme): PresentationTheme {
  if (!themeId) return fallback;
  return PREMIUM_PRESENTATION_THEMES[themeId as PremiumPresentationThemeId] || fallback;
}

export function resolveThemeFromDesignBrief(brief: DesignBrief, fallback: PresentationTheme = PREMIUM_PRESENTATION_THEMES.academicClean): PresentationTheme {
  return resolvePremiumPresentationTheme(brief.themeId, fallback);
}

const DARK_THEME_WORDS = [
  "war",
  "Р’РѕР№РЅ",
  "РІРѕР№РЅ",
  "РєСЂРёР·Рё",
  "death",
  "tragedy",
  "crisis",
  "crime",
  "dystopia",
  "catastrophe",
  "disaster",
  "conflict",
  "violence",
  "война",
  "смерть",
  "трагедия",
  "кризис",
  "преступ",
  "антиутоп",
  "катастроф",
  "конфликт",
  "насили",
  "разруш",
];

const BRIGHT_THEME_WORDS = [
  "fun",
  "happy",
  "holiday",
  "festival",
  "children",
  "creative",
  "game",
  "celebration",
  "весел",
  "радост",
  "празд",
  "дет",
  "творч",
  "игр",
  "улыб",
];

const TECH_THEME_WORDS = [
  "science",
  "technology",
  "programming",
  "ai",
  "data",
  "physics",
  "chemistry",
  "math",
  "engineering",
  "наук",
  "технолог",
  "программ",
  "данн",
  "физик",
  "хими",
  "математ",
  "инженер",
  "нейро",
];

const NATURE_THEME_WORDS = [
  "nature",
  "biology",
  "ecology",
  "climate",
  "animal",
  "plant",
  "environment",
  "природ",
  "биолог",
  "эколог",
  "климат",
  "растен",
  "окружающ",
];

const HISTORY_THEME_WORDS = [
  "history",
  "literature",
  "culture",
  "empire",
  "revolution",
  "century",
  "истори",
  "литератур",
  "культур",
  "импери",
  "революц",
  "век",
  "писател",
  "поэт",
];

const SCIENCE_PREMIUM_THEME_WORDS = [
  "biology",
  "chemistry",
  "physics",
  "medicine",
  "ecology",
  "climate",
  "science",
  "biotech",
  "cell",
  "molecule",
];

const BUSINESS_PREMIUM_THEME_WORDS = [
  "business",
  "startup",
  "product",
  "economics",
  "market",
  "marketing",
  "finance",
  "metrics",
  "revenue",
  "project defense",
];

const TIMELINE_PREMIUM_THEME_WORDS = [
  "history",
  "timeline",
  "chronology",
  "biography",
  "politics",
  "revolution",
  "empire",
  "century",
  "documentary",
];

const CULTURE_PREMIUM_THEME_WORDS = [
  "literature",
  "culture",
  "art",
  "poetry",
  "writer",
  "author",
  "biography",
  "society",
  "essay",
  "novel",
];

const FRIENDLY_PREMIUM_THEME_WORDS = [
  "children",
  "younger",
  "simple",
  "friendly",
  "beginner",
  "school",
  "lesson",
  "explain simpler",
];

const SERIOUS_TECH_PREMIUM_THEME_WORDS = [
  "technology",
  "programming",
  "ai",
  "data",
  "engineering",
  "analysis",
  "cyber",
  "algorithm",
];

const NEUTRAL_PREMIUM_THEME_IDS: PremiumPresentationThemeId[] = ["academicClean", "editorialMagazine", "scienceBoard", "softClassroom"];

export function resolvePresentationTheme(input: {
  title?: string;
  prompt?: string;
  scenario?: string;
  level?: string;
  presentationTheme?: unknown;
  designBrief?: unknown;
}): PresentationTheme {
  const existing = presentationThemeSchema.safeParse(input.presentationTheme);
  if (existing.success) {
    return resolvePremiumPresentationTheme(existing.data.themeId, existing.data);
  }

  const designBrief = designBriefSchema.safeParse(input.designBrief);
  if (designBrief.success) {
    return resolveThemeFromDesignBrief(designBrief.data);
  }

  const text = normalizeThemeText([input.title, input.prompt, input.scenario, input.level].filter(Boolean).join(" "));
  if (matchesThemeWords(text, SCIENCE_PREMIUM_THEME_WORDS) || matchesThemeWords(text, NATURE_THEME_WORDS)) return PREMIUM_PRESENTATION_THEMES.scienceBoard;
  if (matchesThemeWords(text, BUSINESS_PREMIUM_THEME_WORDS)) return PREMIUM_PRESENTATION_THEMES.startupPitch;
  if (matchesThemeWords(text, TIMELINE_PREMIUM_THEME_WORDS)) return PREMIUM_PRESENTATION_THEMES.timelineDocumentary;
  if (matchesThemeWords(text, DARK_THEME_WORDS)) {
    return PREMIUM_PRESENTATION_THEMES.darkLecture;
  }
  if (matchesThemeWords(text, SERIOUS_TECH_PREMIUM_THEME_WORDS) || matchesThemeWords(text, TECH_THEME_WORDS)) {
    return { ...PREMIUM_PRESENTATION_THEMES.darkLecture, preset: "tech" };
  }
  if (matchesThemeWords(text, CULTURE_PREMIUM_THEME_WORDS) || matchesThemeWords(text, HISTORY_THEME_WORDS)) return PREMIUM_PRESENTATION_THEMES.editorialMagazine;
  if (matchesThemeWords(text, FRIENDLY_PREMIUM_THEME_WORDS) || matchesThemeWords(text, BRIGHT_THEME_WORDS)) return PREMIUM_PRESENTATION_THEMES.softClassroom;

  const themeId = NEUTRAL_PREMIUM_THEME_IDS[stableThemeHash(text || "studydeck") % NEUTRAL_PREMIUM_THEME_IDS.length];
  return PREMIUM_PRESENTATION_THEMES[themeId];
}

function normalizeThemeText(value: string) {
  return value.toLowerCase().replace(/ё/g, "е");
}

function matchesThemeWords(text: string, words: string[]) {
  return words.some((word) => text.includes(normalizeThemeText(word)));
}

function stableThemeHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export const generationBriefSchema = z.object({
  audience: z.enum(["university_student"]).default("university_student"),
  speechStyle: z.enum(["easy_professional"]).default("easy_professional"),
  slideDensity: z.enum(["brief_slides_full_speech"]).default("brief_slides_full_speech"),
  visualStrategy: z.enum(["images_and_diagrams"]).default("images_and_diagrams"),
  exportTarget: z.enum(["web_and_pptx_pdf"]).default("web_and_pptx_pdf"),
});
export type GenerationBrief = z.infer<typeof generationBriefSchema>;

export const createProjectInputSchema = z.object({
  title: z.string().min(2).max(140),
  prompt: z.string().min(18).max(12000),
  scenario: scenarioSchema,
  level: z.string().min(2).max(80),
  mode: z.enum(["fast_draft", "with_sources", "explain_simpler"]),
  slideCount: z.number().int().min(4).max(20),
  generationBrief: generationBriefSchema.optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

export const updateSlideInputSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  thesis: z.string().max(360).optional(),
  bullets: z.array(z.string().trim().min(1).max(1000)).max(5).optional(),
  layout: slideLayoutSchema.optional(),
  visual: slideVisualSchema.optional(),
  blocks: z.array(slideBlockSchema).optional(),
  canvas: slideCanvasSchema.optional(),
  speakerNotes: z.string().max(5000).optional(),
});
export type UpdateSlideInput = z.infer<typeof updateSlideInputSchema>;

export const updateNarrationInputSchema = z.object({
  speechDraft: z.string().min(50).max(60000),
  accept: z.boolean().default(false),
});
export type UpdateNarrationInput = z.infer<typeof updateNarrationInputSchema>;

export const generatePresentationInputSchema = updateNarrationInputSchema.partial();
export type GeneratePresentationInput = z.infer<typeof generatePresentationInputSchema>;

export const exportTypeSchema = z.enum(["pdf", "pptx"]);
export type ExportType = z.infer<typeof exportTypeSchema>;

const READABLE_BODY_FONT_SIZE = 30;
const READABLE_PLAQUE_FONT_SIZE = 24;
const MIN_GENERATED_BODY_FONT_SIZE = 22;
const MIN_GENERATED_CAPTION_FONT_SIZE = 18;
const PLAQUE_PADDING_X = 18;
const PLAQUE_PADDING_Y = 12;
const CANVAS_SAFE_BOTTOM = 680;

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

export function ensureEditableCanvas(document: PresentationDocument): PresentationDocument {
  const theme = resolvePresentationTheme({
    title: document.title,
    scenario: document.scenario,
    level: document.level,
    presentationTheme: document.presentationTheme,
    designBrief: document.designBrief,
  });

  return {
    ...document,
    presentationTheme: theme,
    slides: document.slides.map((slide) => {
      const designDirection = document.designBrief?.slideDirections.find((direction) => direction.slideOrder === slide.order);
      const generatedCanvas = buildSlideCanvas(slide, theme, { designDirection });
      const hasExplicitCustomCanvas = slide.canvas?.elements.some(
        (element) => element.id === `${slide.id}-custom-canvas-marker`,
      );
      return {
        ...slide,
        canvas: hasExplicitCustomCanvas
          ? slide.canvas
          : hasCustomSlideCanvas(slide, theme, generatedCanvas)
          ? upgradeCustomCanvas(slide.canvas!, generatedCanvas, theme)
          : generatedCanvas,
      };
    }),
  };
}

type BuildSlideCanvasOptions = {
  designDirection?: DesignBriefSlideDirection;
};

export function buildSlideCanvas(slide: Slide, theme: PresentationTheme, options: BuildSlideCanvasOptions = {}): SlideCanvas {
  const visual = slide.visual || { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] };
  const background = theme.colors.background;
  const backgroundStyle = slideBackgroundStyle(slide, theme);
  const text = theme.colors.text;
  const muted = theme.colors.muted;
  const elements: CanvasElement[] = backgroundElements(slide, theme);
  const designDirection = options.designDirection;
  const premium = Boolean(designDirection);

  if (slide.slideKind === "title" || slide.slideKind === "section") {
    if (premium) {
      addPremiumHeroCanvas(slide, theme, elements, designDirection);
      return { version: 2, width: 1280, height: 720, background, backgroundStyle, elements: finalizeGeneratedElements(elements, theme) };
    }

    const isTitleSlide = slide.slideKind === "title";
    if (visual.image) {
      elements.push(imageElement(`${slide.id}-image-bg`, visual.image, 0, 0, 1280, 720, 1, 0.1, "cover"));
    }

    const bodyText = slide.thesis || slideBodyText(slide);
    const bodyY = isTitleSlide ? 306 : 376;
    const bodyFontSize = isTitleSlide ? READABLE_BODY_FONT_SIZE : fittedFontSize(bodyText, 28, 20, 110);
    const bodyHeight = isTitleSlide ? Math.max(112, estimatedTextHeight(bodyText, bodyFontSize, 860)) : 112;

    elements.push(
      textElement(`${slide.id}-title`, slide.title, 178, isTitleSlide ? 118 : 188, 924, 148, 5, {
        role: "title",
        fontSize: fittedFontSize(slide.title, 58, 38, 148),
        fontFamily: theme.fonts.heading,
        color: text,
        bold: true,
        align: "center",
        valign: "middle",
      }),
      textElement(`${slide.id}-body`, bodyText, 210, bodyY, 860, bodyHeight, 5, {
        role: "body",
        fontSize: bodyFontSize,
        autoFit: !isTitleSlide,
        fontFamily: theme.fonts.body,
        color: muted,
        align: "center",
        valign: "middle",
      }),
    );

    if (isTitleSlide) addTitleMiniPointGrid(slide, theme, elements, Math.max(430, bodyY + bodyHeight + 36));
    else addMiniPointRow(slide, theme, elements, 296, 512);

    return { version: 2, width: 1280, height: 720, background, backgroundStyle, elements: finalizeGeneratedElements(elements, theme) };
  }

  const directed = premium ? addPremiumDirectedCanvas(slide, theme, elements, designDirection) : false;
  if (directed) {
    addFallbackImageCanvas(slide, elements);
    return { version: 2, width: 1280, height: 720, background, backgroundStyle, elements: finalizeGeneratedElements(elements, theme) };
  }

  if (slide.slideKind === "summary") addSummaryCanvas(slide, theme, elements);
  else if (slide.layout === "statement") addStatementCanvas(slide, theme, elements);
  else if (slide.layout === "quote") addQuoteCanvas(slide, theme, elements);
  else if (slide.layout === "definition") addDefinitionCanvas(slide, theme, elements);
  else if (slide.layout === "timeline" || slide.layout === "process") addSequenceCanvas(slide, theme, elements);
  else if (slide.layout === "comparison" || slide.layout === "two-column") addComparisonCanvas(slide, theme, elements);
  else if (slide.layout === "image-focus" && visual.image) addImageFocusCanvas(slide, theme, elements);
  else if (slide.layout === "case-study") addPanelGridCanvas(slide, theme, elements, ["Ситуация", "Действие", "Результат"]);
  else if (slide.layout === "question-answer") addQuestionAnswerCanvas(slide, theme, elements);
  else if (slide.layout === "myth-fact") addMythFactCanvas(slide, theme, elements);
  else if (slide.layout === "metrics") addMetricsCanvas(slide, theme, elements);
  else if (slide.layout === "evidence") addEvidenceCanvas(slide, theme, elements);
  else if (slide.layout === "problem-solution") addProblemSolutionCanvas(slide, theme, elements);
  else if (slide.layout === "explain-example") addExplainExampleCanvas(slide, theme, elements);
  else addDefaultContentCanvas(slide, theme, elements);

  addFallbackImageCanvas(slide, elements);

  return { version: 2, width: 1280, height: 720, background, backgroundStyle, elements: finalizeGeneratedElements(elements, theme) };
}

function addPremiumHeroCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[], direction?: DesignBriefSlideDirection) {
  const image = slide.visual?.image;
  const editorial = theme.themeId === "editorialMagazine" || direction?.layoutIntent === "full_bleed_image";
  if (image) {
    elements.push(imageElement(`${slide.id}-premium-image-bg`, image, editorial ? 0 : 710, 0, editorial ? 1280 : 570, 720, 1, editorial ? 0.24 : 0.82, "cover"));
    elements.push(shapeElement(`${slide.id}-premium-image-wash`, "rect", 0, 0, editorial ? 1280 : 760, 720, 2, theme.colors.background, theme.colors.background, 0, editorial ? 0.68 : 0.92));
  }

  const leftAligned = editorial || direction?.layoutIntent === "split_image_text";
  const titleX = leftAligned ? 86 : 156;
  const titleW = leftAligned ? 720 : 968;
  const bodyText = slide.thesis || slideBodyText(slide);
  const bodyY = leftAligned ? 372 : 364;
  const isTitleSlide = slide.slideKind === "title";
  const bodyFontSize = isTitleSlide ? READABLE_BODY_FONT_SIZE : fittedFontSize(bodyText, 30, 19, 112);
  const bodyHeight = isTitleSlide ? Math.max(112, estimatedTextHeight(bodyText, bodyFontSize, titleW)) : 112;
  elements.push(
    shapeElement(`${slide.id}-premium-accent`, "rect", titleX, leftAligned ? 126 : 108, 138, 6, 3, theme.colors.accent, theme.colors.accent, 0, 1),
    textElement(`${slide.id}-title`, slide.title, titleX, leftAligned ? 162 : 156, titleW, 172, 5, {
      role: "title",
      fontSize: fittedFontSize(slide.title, leftAligned ? 62 : 64, 36, 172),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
      align: leftAligned ? "left" : "center",
      valign: "middle",
    }),
    textElement(`${slide.id}-body`, bodyText, titleX, bodyY, titleW, bodyHeight, 5, {
      role: "body",
      fontSize: bodyFontSize,
      autoFit: !isTitleSlide,
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
      align: leftAligned ? "left" : "center",
      valign: "middle",
    }),
  );

  if (isTitleSlide) addTitleMiniPointGrid(slide, theme, elements, Math.max(512, bodyY + bodyHeight + 36));
  else addMiniPointRow(slide, theme, elements, leftAligned ? 86 : 296, 544);
}

function addPremiumDirectedCanvas(
  slide: Slide,
  theme: PresentationTheme,
  elements: CanvasElement[],
  direction?: DesignBriefSlideDirection,
) {
  if (slide.slideKind === "summary" || direction?.layoutIntent === "summary") {
    addSummaryCanvas(slide, theme, elements);
    return true;
  }

  const intent = direction?.layoutIntent;
  if ((intent === "full_bleed_image" || intent === "split_image_text") && slide.visual?.image) {
    addPremiumSplitImageCanvas(slide, theme, elements, intent === "full_bleed_image");
    return true;
  }
  if (intent === "cards" || (theme.themeId === "startupPitch" && slide.layout === "bullets")) {
    addPremiumCardsCanvas(slide, theme, elements);
    return true;
  }
  if (intent === "timeline") {
    addSequenceCanvas(slide, theme, elements);
    return true;
  }
  if (intent === "comparison") {
    addComparisonCanvas(slide, theme, elements);
    return true;
  }
  if (intent === "evidence_board") {
    addEvidenceCanvas(slide, theme, elements);
    return true;
  }
  if (intent === "quote_spread") {
    addQuoteCanvas(slide, theme, elements);
    return true;
  }
  if (intent === "diagram" || direction?.imageStrategy === "diagram") {
    addDirectedDiagramCanvas(slide, theme, elements, direction);
    return true;
  }
  if (intent === "metric") {
    addMetricsCanvas(slide, theme, elements);
    return true;
  }
  if (intent === "statement") {
    addStatementCanvas(slide, theme, elements);
    return true;
  }
  return false;
}

function addDirectedDiagramCanvas(
  slide: Slide,
  theme: PresentationTheme,
  elements: CanvasElement[],
  direction?: DesignBriefSlideDirection,
) {
  const visualType = slide.visual?.type || "none";
  const sceneText = `${slide.title} ${slide.thesis} ${direction?.visualPrompt || ""}`;
  if (slide.visual?.graph?.nodes.length) {
    addGraphCanvas(slide, theme, elements);
    return;
  }
  if (
    visualType === "process_diagram" ||
    slide.layout === "process" ||
    slide.layout === "timeline" ||
    /process|workflow|cycle|stage|step|timeline|процесс|цикл|этап|шаг|хронолог/iu.test(sceneText)
  ) {
    addSequenceCanvas(slide, theme, elements);
    return;
  }
  if (visualType === "comparison_diagram" || slide.visual?.rows.length || /compare|comparison|versus|сравнен/iu.test(sceneText)) {
    addComparisonCanvas(slide, theme, elements);
    return;
  }
  if (slide.sourceRefs.length > 0 && direction?.visualRole === "evidence") {
    addEvidenceCanvas(slide, theme, elements);
    return;
  }
  if (slide.layout === "problem-solution" || /cause|effect|problem|solution|причин|следств|проблем|решен/iu.test(sceneText)) {
    addProblemSolutionCanvas(slide, theme, elements);
    return;
  }
  const items = uniqueCanvasItems(sequenceItems(slide)).slice(0, 3);
  if (items.length < 2) {
    addStatementCanvas(slide, theme, elements);
    return;
  }
  addPanelGridCanvas(slide, theme, elements, items.map((_, index) => String(index + 1).padStart(2, "0")));
}

function addGraphCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  const graph = slide.visual?.graph;
  if (!graph?.nodes.length) return;

  const nodes = graph.nodes.slice(0, 8);
  const direction = graph.layoutDirection || "LR";
  const left = 100;
  const top = 190;
  const width = 1080;
  const height = 360;
  const nodeWidth = direction === "TB" ? 520 : Math.max(188, Math.min(300, (width - (nodes.length - 1) * 22) / nodes.length));
  const nodeHeight = direction === "TB" ? Math.max(74, Math.min(108, (height - (nodes.length - 1) * 16) / nodes.length)) : 126;
  const positions = new Map<string, { x: number; y: number; w: number; h: number }>();

  nodes.forEach((node, index) => {
    const x = direction === "TB" ? left + (width - nodeWidth) / 2 : left + index * (nodeWidth + 22);
    const y = direction === "TB" ? top + index * (nodeHeight + 16) : top + (index % 2 === 0 ? 0 : 92);
    positions.set(node.id, { x, y, w: nodeWidth, h: nodeHeight });
  });

  graph.edges.slice(0, 12).forEach((edge, index) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) return;
    const x1 = direction === "TB" ? source.x + source.w / 2 : source.x + source.w;
    const y1 = direction === "TB" ? source.y + source.h : source.y + source.h / 2;
    const x2 = direction === "TB" ? target.x + target.w / 2 : target.x;
    const y2 = direction === "TB" ? target.y : target.y + target.h / 2;
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const w = Math.max(2, Math.abs(x2 - x1));
    const h = Math.max(2, Math.abs(y2 - y1));
    elements.push(shapeElement(`${slide.id}-graph-edge-${index}`, "line", x, y, w, h, 1, theme.colors.line, theme.colors.accent, 3, 0.75));
    if (edge.label) {
      elements.push(textElement(`${slide.id}-graph-edge-${index}-label`, edge.label, x + w / 2 - 70, y + h / 2 - 15, 140, 30, 3, {
        role: "caption",
        fontSize: MIN_GENERATED_CAPTION_FONT_SIZE,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
        align: "center",
        valign: "middle",
      }));
    }
  });

  nodes.forEach((node, index) => {
    const box = positions.get(node.id);
    if (!box) return;
    elements.push(
      shapeElement(`${slide.id}-graph-node-${index}`, "roundRect", box.x, box.y, box.w, box.h, 2, theme.colors.surface, theme.colors.accent, 2, 1),
      textElement(`${slide.id}-graph-node-${index}-label`, node.label, box.x + 18, box.y + 18, box.w - 36, node.detail ? 34 : box.h - 36, 4, {
        role: "body",
        fontSize: 20,
        autoFit: false,
        fontFamily: theme.fonts.heading,
        color: theme.colors.text,
        bold: true,
        align: "center",
        valign: "middle",
      }),
    );
    if (node.detail) {
      elements.push(textElement(`${slide.id}-graph-node-${index}-detail`, node.detail, box.x + 18, box.y + 58, box.w - 36, box.h - 74, 4, {
        role: "caption",
        fontSize: MIN_GENERATED_CAPTION_FONT_SIZE,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
        align: "center",
      }));
    }
  });
}

function addPremiumSplitImageCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[], fullBleed: boolean) {
  const image = slide.visual?.image;
  const bodyText = slide.thesis || slideBodyText(slide);
  const bodyY = 310;
  const bodyHeight = Math.max(148, estimatedTextHeight(bodyText, READABLE_BODY_FONT_SIZE, 548));
  if (image) {
    elements.push(imageElement(`${slide.id}-premium-image`, image, fullBleed ? 0 : 700, 0, fullBleed ? 1280 : 580, 720, 1, fullBleed ? 0.34 : 0.9, "cover"));
    elements.push(shapeElement(`${slide.id}-premium-copy-wash`, "rect", 0, 0, fullBleed ? 740 : 710, 720, 2, theme.colors.background, theme.colors.background, 0, fullBleed ? 0.84 : 0.96));
  }
  elements.push(
    shapeElement(`${slide.id}-premium-rule`, "rect", 84, 122, 92, 5, 3, theme.colors.accent, theme.colors.accent, 0, 1),
    textElement(`${slide.id}-title`, slide.title, 84, 154, 560, 118, 5, {
      role: "title",
      fontSize: fittedFontSize(slide.title, 44, 28, 118),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
    }),
    textElement(`${slide.id}-body`, bodyText, 84, bodyY, 548, bodyHeight, 5, {
      role: "body",
      fontSize: READABLE_BODY_FONT_SIZE,
      autoFit: false,
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }),
  );
  addMiniPointRow(slide, theme, elements, 84, Math.max(548, bodyY + bodyHeight + 36), { rightBoundary: 672, maxBottom: 680 });
}

function addPremiumCardsCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  const items = uniqueCanvasItems(sequenceItems(slide)).slice(0, 4);
  const columns = Math.max(1, items.length);
  const cardWidth = columns === 1 ? 820 : (1096 - (columns - 1) * 22) / columns;
  const totalWidth = columns * cardWidth + (columns - 1) * 22;
  const startX = (1280 - totalWidth) / 2;
  elements.push(textElement(`${slide.id}-premium-kicker`, slide.thesis || slide.visual?.title || "", 92, 184, 1096, 56, 4, {
    role: "body",
    fontSize: MIN_GENERATED_BODY_FONT_SIZE,
    fontFamily: theme.fonts.body,
    color: theme.colors.muted,
    align: "center",
  }));
  items.forEach((item, index) => {
    const x = startX + index * (cardWidth + 22);
    const cardText = compactSummaryPoint(item, 12) || item;
    elements.push(
      shapeElement(`${slide.id}-premium-card-${index}`, "roundRect", x, 270, cardWidth, 248, 2, index % 2 ? theme.colors.surface : theme.colors.surfaceAlt, theme.colors.line, 1, 1),
      textElement(`${slide.id}-premium-card-${index}-label`, String(index + 1).padStart(2, "0"), x + 22, 294, cardWidth - 44, 36, 4, {
        role: "caption",
        fontSize: 24,
        fontFamily: theme.fonts.heading,
        color: theme.colors.accent,
        bold: true,
      }),
      textElement(`${slide.id}-premium-card-${index}-text`, cardText, x + 22, 356, cardWidth - 44, 128, 4, {
        role: "body",
        fontSize: MIN_GENERATED_BODY_FONT_SIZE,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });
}

function finalizeGeneratedElements(elements: CanvasElement[], theme: PresentationTheme) {
  const withBackplates = addStandaloneTextBackplates(elements, theme);
  const linked = linkContainedElements(withBackplates);
  const clamped = clampCanvasElements(repairUnsafeGeneratedElements(linked));
  return sortCanvasElements(syncGroupedTextContainers(syncTextBackplates(clamped)));
}

export function auditSlideCanvas(canvas: SlideCanvas) {
  const issues: string[] = [];
  const ids = new Set<string>();
  const visible = sortCanvasElements(canvas.elements).filter((element) => element.opacity > 0.02);

  if (canvas.width <= 0 || canvas.height <= 0) issues.push("canvas has invalid dimensions");

  visible.forEach((element) => {
    if (ids.has(element.id)) issues.push(`${element.id} duplicates another canvas element id`);
    ids.add(element.id);
    if (element.x < 0 || element.y < 0 || element.x + element.w > canvas.width || element.y + element.h > canvas.height) {
      issues.push(`${element.id} is outside the slide bounds`);
    }
    if (element.type !== "text") return;

    const minFontSize = minimumReadableFontSize(element);
    if (element.fontSize < minFontSize) issues.push(`${element.id} uses ${element.fontSize}px text below the ${minFontSize}px readable minimum`);
    if (estimatedTextHeight(element.text, element.fontSize, element.w) > element.h * 1.14) {
      issues.push(`${element.id} text does not fit its box`);
    }
    const container = element.groupId
      ? visible.find((candidate): candidate is CanvasShapeElement =>
          candidate.type === "shape" && candidate.groupId === element.groupId && candidate.id !== element.id,
        )
      : undefined;
    if (container && !shapeContainsElement(container, element)) {
      issues.push(`${element.id} extends outside ${container.id}`);
    }
  });

  visible.forEach((element, index) => {
    for (const other of visible.slice(index + 1)) {
      if (!elementsVisuallyOverlap(element, other)) continue;
      if (isAllowedCanvasOverlap(element, other)) continue;
      issues.push(`${element.id} overlaps ${other.id}`);
    }
  });

  return issues;
}

function repairUnsafeGeneratedElements(elements: CanvasElement[]) {
  const optionalPlaquesUnsafe = elements.some((element) =>
    /-mini-\d+(?:-shape)?$/.test(element.id) && element.y + element.h > CANVAS_SAFE_BOTTOM,
  );
  if (!optionalPlaquesUnsafe) return elements;
  return elements.filter((element) => !/-mini-\d+(?:-shape)?$/.test(element.id));
}

function minimumReadableFontSize(element: CanvasTextElement) {
  if (/-source-\d+$/.test(element.id)) return 14;
  if (element.role === "title") return 28;
  if (element.role === "body") return MIN_GENERATED_BODY_FONT_SIZE;
  if (element.role === "caption" && /^\d{1,2}$/.test(cleanCanvasText(element.text))) return 16;
  if (element.role === "caption") return MIN_GENERATED_CAPTION_FONT_SIZE;
  return 16;
}

function elementsVisuallyOverlap(left: CanvasElement, right: CanvasElement) {
  const overlapX = Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x);
  const overlapY = Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y);
  if (overlapX <= 1 || overlapY <= 1) return false;
  const overlapArea = overlapX * overlapY;
  const smallerArea = Math.max(1, Math.min(left.w * left.h, right.w * right.h));
  return overlapArea / smallerArea > 0.08;
}

function isAllowedCanvasOverlap(left: CanvasElement, right: CanvasElement) {
  if (left.groupId && left.groupId === right.groupId) {
    if (left.type === "shape" && right.type === "text") return shapeContainsElement(left, right);
    if (right.type === "shape" && left.type === "text") return shapeContainsElement(right, left);
  }
  if (isTextBackplatePair(left, right) || isTextBackplatePair(right, left)) return true;
  if (isDecorativeRuleBehindText(left, right) || isDecorativeRuleBehindText(right, left)) return true;
  if (isSoftBackgroundBehindText(left, right) || isSoftBackgroundBehindText(right, left)) return true;
  if (left.type === "shape" && right.type === "shape") return true;
  if (left.type === "image" && right.type === "shape") return right.opacity >= 0.65 && right.zIndex > left.zIndex;
  if (right.type === "image" && left.type === "shape") return left.opacity >= 0.65 && left.zIndex > right.zIndex;
  return false;
}

function shapeContainsElement(shape: CanvasShapeElement, element: CanvasElement) {
  const tolerance = 2;
  return element.x >= shape.x - tolerance && element.y >= shape.y - tolerance
    && element.x + element.w <= shape.x + shape.w + tolerance
    && element.y + element.h <= shape.y + shape.h + tolerance;
}

function isTextBackplatePair(shape: CanvasElement, text: CanvasElement) {
  return shape.type === "shape" && text.type === "text" && shape.id === `${text.id}-backplate`;
}

function isDecorativeRuleBehindText(shape: CanvasElement, text: CanvasElement) {
  return shape.type === "shape" && text.type === "text" && shape.zIndex < text.zIndex && (shape.h <= 8 || shape.w <= 8);
}

function isSoftBackgroundBehindText(background: CanvasElement, text: CanvasElement) {
  if (text.type !== "text" || background.zIndex >= text.zIndex) return false;
  if (background.type === "image") return background.opacity <= 0.4;
  return background.type === "shape" && /wash|bg|background/i.test(background.id) && background.opacity >= 0.55;
}

function addStandaloneTextBackplates(elements: CanvasElement[], theme: PresentationTheme) {
  const resizedElements = reflowTextPlaques(resizeTextPlaques(elements));
  const containers = resizedElements.filter((element): element is CanvasShapeElement =>
    element.type === "shape" && element.shape !== "line",
  );
  const result: CanvasElement[] = [];

  resizedElements.forEach((element) => {
    if (element.type !== "text" || element.id.endsWith("-quote-mark")) {
      result.push(element);
      return;
    }

    const centerX = element.x + element.w / 2;
    const centerY = element.y + element.h / 2;
    const alreadyContained = containers.some((shape) =>
      centerX >= shape.x &&
      centerX <= shape.x + shape.w &&
      centerY >= shape.y &&
      centerY <= shape.y + shape.h,
    );
    if (alreadyContained) {
      result.push(element);
      return;
    }

    const fittedElement = fitCanvasTextElement(element);
    const paddingX = fittedElement.role === "title" ? 26 : 18;
    const paddingY = fittedElement.role === "title" ? 16 : 12;
    const backplate = shapeElement(
      `${fittedElement.id}-backplate`,
      "roundRect",
      fittedElement.x - paddingX,
      fittedElement.y - paddingY,
      fittedElement.w + paddingX * 2,
      fittedElement.h + paddingY * 2,
      Math.max(1, fittedElement.zIndex - 1),
      theme.colors.surface,
      theme.colors.line,
      1,
      0.92,
      true,
    );
    result.push(backplate, fittedElement);
  });

  return result;
}

function syncTextBackplates(elements: CanvasElement[]) {
  const textByBackplateId = new Map(
    elements
      .filter((element): element is CanvasTextElement => element.type === "text")
      .map((element) => [`${element.id}-backplate`, element]),
  );

  return elements.map((element) => {
    if (element.type !== "shape") return element;
    const text = textByBackplateId.get(element.id);
    if (!text) return element;
    const paddingX = text.role === "title" ? 26 : 18;
    const paddingY = text.role === "title" ? 16 : 12;
    const left = Math.min(text.x, Math.max(0, text.x - paddingX));
    const top = Math.min(text.y, Math.max(0, text.y - paddingY));
    const right = Math.max(text.x + text.w, Math.min(1280, text.x + text.w + paddingX));
    const bottom = Math.max(text.y + text.h, Math.min(720, text.y + text.h + paddingY));
    return {
      ...element,
      x: left,
      y: top,
      w: right - left,
      h: bottom - top,
    };
  });
}

function syncGroupedTextContainers(elements: CanvasElement[]) {
  const textsByGroupId = new Map<string, CanvasTextElement[]>();
  elements.forEach((element) => {
    if (element.type !== "text" || !element.groupId) return;
    textsByGroupId.set(element.groupId, [...(textsByGroupId.get(element.groupId) || []), element]);
  });

  return elements.map((element) => {
    if (element.type !== "shape" || !element.groupId) return element;
    const texts = textsByGroupId.get(element.groupId);
    if (!texts?.length) return element;
    const left = Math.min(element.x, ...texts.map((text) => text.x));
    const top = Math.min(element.y, ...texts.map((text) => text.y));
    const right = Math.max(element.x + element.w, ...texts.map((text) => text.x + text.w));
    const bottom = Math.max(element.y + element.h, ...texts.map((text) => text.y + text.h));
    const x = Math.max(0, Math.min(left, ...texts.map((text) => text.x)));
    const y = Math.max(0, Math.min(top, ...texts.map((text) => text.y)));
    const safeRight = Math.min(1280, Math.max(right, ...texts.map((text) => text.x + text.w)));
    const safeBottom = Math.min(720, Math.max(bottom, ...texts.map((text) => text.y + text.h)));
    return {
      ...element,
      x,
      y,
      w: safeRight - x,
      h: safeBottom - y,
    };
  });
}

function linkContainedElements(elements: CanvasElement[]) {
  const containers = elements
    .filter((element): element is CanvasShapeElement =>
      element.type === "shape" &&
      element.shape !== "line" &&
      element.w <= 1200 &&
      element.h <= 420 &&
      element.w >= 36 &&
      element.h >= 30,
    )
    .sort((left, right) => left.w * left.h - right.w * right.h);

  const assigned = elements.map((element) => {
    if (element.type !== "text") return element;
    const centerX = element.x + element.w / 2;
    const centerY = element.y + element.h / 2;
    const container = containers.find((shape) =>
      shape.id !== element.id &&
      centerX >= shape.x &&
      centerX <= shape.x + shape.w &&
      centerY >= shape.y &&
      centerY <= shape.y + shape.h,
    );
    if (!container) return element;
    const groupId = `group:${container.id}`;
    return {
      ...element,
      groupId,
      align: "center" as const,
      valign: "middle" as const,
    };
  });
  return assigned.map((element) => {
    if (element.type !== "shape") return element;
    const groupId = `group:${element.id}`;
    return assigned.some((candidate) => candidate.id !== element.id && candidate.groupId === groupId)
      ? { ...element, groupId }
      : element;
  });
}

function clampCanvasElements(elements: CanvasElement[]) {
  const canvasWidth = 1280;
  const canvasHeight = 720;
  const groupBounds = new Map<string, { x: number; y: number; right: number; bottom: number }>();

  elements.forEach((element) => {
    if (!element.groupId) return;
    const current = groupBounds.get(element.groupId);
    const next = {
      x: current ? Math.min(current.x, element.x) : element.x,
      y: current ? Math.min(current.y, element.y) : element.y,
      right: current ? Math.max(current.right, element.x + element.w) : element.x + element.w,
      bottom: current ? Math.max(current.bottom, element.y + element.h) : element.y + element.h,
    };
    groupBounds.set(element.groupId, next);
  });

  const groupOffsets = new Map<string, { dx: number; dy: number }>();
  groupBounds.forEach((bounds, groupId) => {
    const dx = Math.min(0, canvasWidth - bounds.right) + Math.max(0, -bounds.x);
    const dy = Math.min(0, canvasHeight - bounds.bottom) + Math.max(0, -bounds.y);
    groupOffsets.set(groupId, { dx, dy });
  });

  return elements.map((element) => {
    const offset = element.groupId ? groupOffsets.get(element.groupId) : undefined;
    const moved = offset ? { ...element, x: element.x + offset.dx, y: element.y + offset.dy } : element;
    return {
      ...moved,
      x: clamp(moved.x, 0, Math.max(0, canvasWidth - moved.w)),
      y: clamp(moved.y, 0, Math.max(0, canvasHeight - moved.h)),
      w: Math.min(moved.w, canvasWidth),
      h: Math.min(moved.h, canvasHeight),
    } as CanvasElement;
  });
}

export function sortCanvasElements(elements: CanvasElement[]) {
  return [...elements].sort((left, right) => left.zIndex - right.zIndex);
}

export function hasCustomSlideCanvas(slide: Slide, theme: PresentationTheme, generatedCanvas = buildSlideCanvas(slide, theme)) {
  if (!slide.canvas) return false;
  if (slide.canvas.elements.some((element) => element.id === `${slide.id}-custom-canvas-marker`)) return true;
  if (isLegacySummaryStoryCanvas(slide)) return false;
  if (isLegacySummaryCanvas(slide)) return false;
  if (isLegacyFullscreenImageCanvas(slide)) return false;
  if (isLegacyTitleMiniRowCanvas(slide)) return false;
  if (isPreviousGeneratedTextLayoutCanvas(slide)) return false;
  if (sameCanvas(slide.canvas, generatedCanvas) || sameCanvasStructure(slide.canvas, generatedCanvas)) return false;
  if (sameCanvasStructure(slide.canvas, legacyGeneratedCanvas(generatedCanvas))) return false;
  if (isLegacyLeanTitleCanvas(slide)) return false;
  const imageWasEnrichedAfterCanvas = Boolean(slide.visual?.image)
    && !slide.canvas.elements.some((element) => element.type === "image")
    && generatedCanvas.elements.some((element) => element.type === "image")
    && slide.canvas.elements.every((element) => isKnownGeneratedCanvasElementId(slide.id, element.id));
  if (imageWasEnrichedAfterCanvas) return false;
  if (isHistoricalGeneratedCanvas(slide, generatedCanvas)) return false;
  if ((slide.canvas.version || 1) >= 2) return true;
  return !hasAutoGeneratedCanvasMarker(slide);
}

function isHistoricalGeneratedCanvas(slide: Slide, generatedCanvas: SlideCanvas) {
  if (!slide.canvas || !slide.canvas.elements.length) return false;
  if (!slide.canvas.elements.every((element) => isKnownGeneratedCanvasElementId(slide.id, element.id))) return false;

  const currentById = new Map(generatedCanvas.elements.map((element) => [element.id, element]));
  const storedIds = new Set(slide.canvas.elements.map((element) => element.id));
  if (storedIds.size !== currentById.size || [...storedIds].some((id) => !currentById.has(id))) return true;

  let changedElements = 0;
  for (const stored of slide.canvas.elements) {
    const current = currentById.get(stored.id);
    if (!current || generatedElementSignature(stored) !== generatedElementSignature(current)) changedElements += 1;
  }
  return changedElements >= 3;
}

function generatedElementSignature(element: CanvasElement) {
  const base = [element.type, element.x, element.y, element.w, element.h, element.zIndex, element.opacity];
  if (element.type === "text") return [...base, element.text, element.fontSize, element.autoFit, element.align, element.valign].join("|");
  if (element.type === "image") return [...base, element.objectKey, element.fit].join("|");
  return [...base, element.shape, element.strokeWidth].join("|");
}

function upgradeCustomCanvas(canvas: SlideCanvas, generatedCanvas: SlideCanvas, theme: PresentationTheme): SlideCanvas {
  const elements = canvas.elements
    .filter((element) => !isLegacyBackgroundElement(element.id))
    .map((element) => {
      if (element.type !== "text") return element;
      const isPlaque = /-mini-\d+$/.test(element.id);
      const fontSize = isPlaque
        ? element.fontSize === 15
          ? READABLE_PLAQUE_FONT_SIZE
          : element.fontSize
        : element.fontSize === 24
          ? READABLE_BODY_FONT_SIZE
          : element.fontSize;
      return {
        ...element,
        fontSize,
        autoFit: element.autoFit ?? false,
        h: Math.max(element.h, estimatedTextHeight(element.text, fontSize, element.w)),
        valign: element.valign || "top",
      };
    });
  return {
    ...canvas,
    background: generatedCanvas.background,
    backgroundStyle: generatedCanvas.backgroundStyle,
    elements: sortCanvasElements(linkContainedElements(addStandaloneTextBackplates(elements, theme))),
  };
}

function isLegacyBackgroundElement(id: string) {
  return /-bg(?:-|$)/.test(id) || /-bg-theme-/.test(id);
}

function hasAutoGeneratedCanvasMarker(slide: Slide) {
  if (!slide.canvas) return false;
  return slide.canvas.elements.some((element) =>
    element.id === `${slide.id}-panel` ||
    element.id === `${slide.id}-accent` ||
    element.id === `${slide.id}-bg` ||
    element.id === `${slide.id}-image-bg` ||
    element.id === `${slide.id}-title` ||
    element.id === `${slide.id}-body` ||
    element.id === `${slide.id}-bg-title-accent` ||
    element.id.startsWith(`${slide.id}-bg-`) ||
    (element.id === `${slide.id}-image` && element.type === "image" && element.x === 0 && element.y === 0 && element.w === 1280 && element.h === 720) ||
    element.id.startsWith(`${slide.id}-chip-`),
  );
}

function isLegacyFullscreenImageCanvas(slide: Slide) {
  if (!slide.canvas) return false;
  return slide.canvas.elements.some((element) =>
    element.id === `${slide.id}-image` &&
    element.type === "image" &&
    element.x === 0 &&
    element.y === 0 &&
    element.w === 1280 &&
    element.h === 720,
  );
}

function isLegacyLeanTitleCanvas(slide: Slide) {
  if (!slide.canvas || slide.slideKind !== "title") return false;
  const elementIds = slide.canvas.elements.map((element) => element.id);
  if (elementIds.some((id) => id.includes("-panel") || id.includes("-mini-"))) return false;
  if (!slide.canvas.elements.every((element) => isKnownGeneratedCanvasElementId(slide.id, element.id))) return false;

  const title = slide.canvas.elements.find((element) => element.id === `${slide.id}-title`);
  const body = slide.canvas.elements.find((element) => element.id === `${slide.id}-body`);
  return (
    title?.type === "text" &&
    body?.type === "text" &&
    title.text === slide.title &&
    title.x === 112 &&
    title.y === 206 &&
    title.w === 1056 &&
    title.h === 116 &&
    body.x === 158 &&
    body.y === 346 &&
    body.w === 964 &&
    body.h === 120
  );
}

function isLegacyTitleMiniRowCanvas(slide: Slide) {
  if (!slide.canvas || slide.slideKind !== "title") return false;
  if (!slide.canvas.elements.some((element) => element.id === `${slide.id}-mini-0-shape`)) return false;
  if (!slide.canvas.elements.every((element) => isKnownGeneratedCanvasElementId(slide.id, element.id))) return false;

  const title = slide.canvas.elements.find((element) => element.id === `${slide.id}-title`);
  const body = slide.canvas.elements.find((element) => element.id === `${slide.id}-body`);
  const miniShapes = slide.canvas.elements
    .filter((element): element is CanvasShapeElement =>
      element.type === "shape" && new RegExp(`^${escapeRegExp(slide.id)}-mini-\\d+-shape$`).test(element.id),
    )
    .sort((left, right) => left.x - right.x);

  return (
    title?.type === "text" &&
    body?.type === "text" &&
    title.text === slide.title &&
    title.x === 178 &&
    title.y === 188 &&
    title.w === 924 &&
    title.h === 148 &&
    body.x === 210 &&
    body.y === 356 &&
    body.w === 860 &&
    body.h >= 112 &&
    miniShapes.length > 0 &&
    miniShapes.every((shape) => shape.y === 512) &&
    miniShapes.slice(1).every((shape, index) => miniShapes[index].x + miniShapes[index].w < shape.x)
  );
}

function isLegacySummaryCanvas(slide: Slide) {
  if (!slide.canvas || slide.slideKind !== "summary") return false;
  const summaryPrefix = `${slide.id}-summary-`;
  const items = sequenceItems(slide).slice(0, 6);
  const columns = items.length > 3 ? 3 : Math.max(items.length, 1);
  const cardWidth = 340;
  const gap = 24;
  const startX = (1280 - columns * cardWidth - (columns - 1) * gap) / 2;

  const matchesLegacyGeometry = items.every((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = startX + column * (cardWidth + gap);
    const y = 176 + row * 148;
    const card = slide.canvas!.elements.find((element) => element.id === `${summaryPrefix}${index}-card`);
    const number = slide.canvas!.elements.find((element) => element.id === `${summaryPrefix}${index}-num`);
    const text = slide.canvas!.elements.find((element) => element.id === `${summaryPrefix}${index}`);
    return (
      card?.type === "shape" &&
      card.x === x &&
      card.y === y &&
      card.w === cardWidth &&
      card.h === 118 &&
      number?.type === "text" &&
      number.text === String(index + 1) &&
      number.x === x + 16 &&
      number.y === y + 25 &&
      text?.type === "text" &&
      text.text === item &&
      text.x === x + 66 &&
      text.y === y + 18 &&
      text.w === cardWidth - 86 &&
      text.h === 78
    );
  });
  if (!items.length || !matchesLegacyGeometry) return false;

  return slide.canvas.elements.every((element) => {
    const id = element.id.endsWith("-backplate") ? element.id.slice(0, -"-backplate".length) : element.id;
    return (
      id === `${slide.id}-custom-canvas-marker` ||
      id === `${slide.id}-title` ||
      id === `${slide.id}-image` ||
      new RegExp(`^${escapeRegExp(summaryPrefix)}\\d+(?:-card|-num-bg|-num)?$`).test(id)
    );
  });
}

function isLegacySummaryStoryCanvas(slide: Slide) {
  if (!slide.canvas || slide.slideKind !== "summary") return false;
  if (!slide.canvas.elements.some((element) => element.id === `${slide.id}-summary-conclusion`)) return false;
  const generatedOnly = slide.canvas.elements.every((element) =>
    element.id === `${slide.id}-custom-canvas-marker` || isKnownGeneratedCanvasElementId(slide.id, element.id),
  );
  if (!generatedOnly) return false;

  const supportLabel = slide.canvas.elements.find((element) => element.id === `${slide.id}-summary-support-label`);
  const finalLabel = slide.canvas.elements.find((element) => element.id === `${slide.id}-summary-final-label`);
  return (
    (supportLabel?.type === "text" && supportLabel.fontSize < READABLE_PLAQUE_FONT_SIZE) ||
    (finalLabel?.type === "text" && finalLabel.fontSize < READABLE_PLAQUE_FONT_SIZE)
  );
}

function isPreviousGeneratedTextLayoutCanvas(slide: Slide) {
  if (!slide.canvas) return false;
  if (!slide.canvas.elements.every((element) => isKnownGeneratedCanvasElementId(slide.id, element.id))) return false;

  const title = slide.canvas.elements.find((element) => element.id === `${slide.id}-title`);
  if (title?.type !== "text" || title.text !== slide.title) return false;

  if (slide.slideKind === "summary") {
    const conclusion = slide.canvas.elements.find((element) => element.id === `${slide.id}-summary-conclusion`);
    return conclusion?.type === "text" && conclusion.y === 184 && conclusion.w === 640 && conclusion.h === 270;
  }

  const body = slide.canvas.elements.find((element) => element.id === `${slide.id}-body`);
  const bodyText = slide.thesis || slideBodyText(slide);
  if (body?.type !== "text" || body.text !== bodyText || body.autoFit !== undefined) return false;

  const previousTitleGrid = slide.slideKind === "title"
    && title.x === 178 && title.y === 118 && title.w === 924 && title.h === 148
    && body.x === 210 && body.y === 282 && body.w === 860 && body.h >= 112;
  const previousPremiumHero = slide.slideKind === "title"
    && slide.canvas.elements.some((element) => element.id.startsWith(`${slide.id}-premium-`))
    && ((body.x === 156 && body.y === 364 && body.w === 968) || (body.x === 86 && body.y === 372 && body.w === 720));
  const previousImageFocus = slide.layout === "image-focus"
    && body.x === 79 && body.y === 192 && body.w === 504 && body.h >= 230;
  const previousPremiumImageFocus = slide.layout === "image-focus"
    && slide.canvas.elements.some((element) => element.id.startsWith(`${slide.id}-premium-`))
    && title.x === 84 && title.y === 154 && title.w === 560
    && body.x === 84 && body.y === 310 && body.w === 548 && body.h >= 148;

  return previousTitleGrid || previousPremiumHero || previousImageFocus || previousPremiumImageFocus;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isKnownGeneratedCanvasElementId(slideId: string, elementId: string) {
  if (elementId.endsWith("-backplate")) {
    return isKnownGeneratedCanvasElementId(slideId, elementId.slice(0, -"-backplate".length));
  }
  if (
    elementId === `${slideId}-bg` ||
    elementId === `${slideId}-accent` ||
    elementId === `${slideId}-panel` ||
    elementId === `${slideId}-title` ||
    elementId === `${slideId}-body` ||
    elementId === `${slideId}-image` ||
    elementId === `${slideId}-image-bg` ||
    elementId === `${slideId}-image-caption`
  ) {
    return true;
  }

  return (
    elementId.startsWith(`${slideId}-bg-`) ||
    elementId.startsWith(`${slideId}-chip-`) ||
    elementId.startsWith(`${slideId}-statement`) ||
    elementId.startsWith(`${slideId}-quote`) ||
    elementId.startsWith(`${slideId}-definition`) ||
    elementId.startsWith(`${slideId}-sequence`) ||
    elementId.startsWith(`${slideId}-step-`) ||
    elementId.startsWith(`${slideId}-comparison-`) ||
    elementId.startsWith(`${slideId}-panel-`) ||
    elementId.startsWith(`${slideId}-answer-`) ||
    elementId.startsWith(`${slideId}-myth-`) ||
    elementId.startsWith(`${slideId}-seq-`) ||
    elementId.startsWith(`${slideId}-left-`) ||
    elementId.startsWith(`${slideId}-right-`) ||
    elementId.startsWith(`${slideId}-qa-`) ||
    elementId.startsWith(`${slideId}-metric-`) ||
    elementId.startsWith(`${slideId}-evidence-`) ||
    elementId.startsWith(`${slideId}-source-`) ||
    elementId.startsWith(`${slideId}-problem-`) ||
    elementId.startsWith(`${slideId}-explain-`) ||
    elementId.startsWith(`${slideId}-summary-`) ||
    elementId.startsWith(`${slideId}-mini-`) ||
    elementId.startsWith(`${slideId}-card-`) ||
    elementId.startsWith(`${slideId}-premium-`) ||
    elementId.startsWith(`${slideId}-visual-`)
  );
}

function legacyGeneratedCanvas(canvas: SlideCanvas): SlideCanvas {
  return {
    ...canvas,
    elements: canvas.elements
      .filter((element) => !element.id.endsWith("-backplate"))
      .map((element) => {
        if (element.id.includes("-mini-") && element.type === "shape") {
          return { ...element, h: 50 };
        }
        if (element.id.includes("-mini-") && element.type === "text") {
          return { ...element, h: 36 };
        }
        return element;
      }),
  };
}

function sameCanvas(left: SlideCanvas, right: SlideCanvas) {
  return JSON.stringify(normalizeCanvasForComparison(left)) === JSON.stringify(normalizeCanvasForComparison(right));
}

function normalizeCanvasForComparison(canvas: SlideCanvas) {
  return {
    ...canvas,
    elements: sortCanvasElements(canvas.elements),
  };
}

function sameCanvasStructure(left: SlideCanvas, right: SlideCanvas) {
  return JSON.stringify(normalizeCanvasStructureForComparison(left)) === JSON.stringify(normalizeCanvasStructureForComparison(right));
}

function normalizeCanvasStructureForComparison(canvas: SlideCanvas) {
  return {
    width: canvas.width,
    height: canvas.height,
    elements: sortCanvasElements(canvas.elements).map((element) => {
      const rest: Record<string, unknown> = { ...element };
      delete rest.fill;
      delete rest.stroke;
      delete rest.color;
      delete rest.background;
      delete rest.opacity;
      return rest;
    }),
  };
}

function backgroundElements(slide: Slide, theme: PresentationTheme): CanvasElement[] {
  void slide;
  void theme;
  return [];
}

export function slideBackgroundStyle(slide: Pick<Slide, "order" | "slideKind">, theme: PresentationTheme): CanvasBackgroundStyle {
  const variant = slideBackgroundVariant(slide);
  const dark = theme.mood === "dark";
  const configurations: Record<string, { angle: number; blobs: Array<{ x: number; y: number; size: number; color: string; opacity: number; blur: number }> }> = {
    title: { angle: 145, blobs: [{ x: 0.18, y: 0.76, size: 0.66, color: theme.colors.accent, opacity: dark ? 0.46 : 0.3, blur: 92 }, { x: 0.76, y: 0.24, size: 0.58, color: theme.colors.accentAlt, opacity: dark ? 0.38 : 0.24, blur: 110 }] },
    section: { angle: 115, blobs: [{ x: 0.12, y: 0.18, size: 0.52, color: theme.colors.accentAlt, opacity: 0.24, blur: 105 }, { x: 0.82, y: 0.8, size: 0.72, color: theme.colors.accent, opacity: 0.28, blur: 120 }] },
    summary: { angle: 160, blobs: [{ x: 0.5, y: 1.02, size: 0.9, color: theme.colors.accentAlt, opacity: 0.26, blur: 125 }] },
    v0: { angle: 125, blobs: [{ x: 0.2, y: 0.84, size: 0.7, color: theme.colors.accent, opacity: 0.22, blur: 120 }] },
    v1: { angle: 90, blobs: [{ x: 0.86, y: 0.26, size: 0.62, color: theme.colors.accentAlt, opacity: 0.25, blur: 112 }] },
    v2: { angle: 35, blobs: [{ x: 0.1, y: 0.15, size: 0.55, color: theme.colors.accent, opacity: 0.2, blur: 100 }, { x: 0.9, y: 0.82, size: 0.62, color: theme.colors.accentAlt, opacity: 0.2, blur: 115 }] },
    v3: { angle: 180, blobs: [{ x: 0.5, y: 0.6, size: 0.82, color: theme.colors.accentAlt, opacity: 0.2, blur: 130 }] },
    v4: { angle: 105, blobs: [{ x: 0.15, y: 0.2, size: 0.7, color: theme.colors.accent, opacity: 0.18, blur: 120 }, { x: 0.82, y: 0.82, size: 0.7, color: theme.colors.accentAlt, opacity: 0.2, blur: 120 }] },
    v5: { angle: 155, blobs: [{ x: 0.78, y: 0.18, size: 0.6, color: theme.colors.accent, opacity: 0.22, blur: 110 }] },
  };
  const config = configurations[variant] || configurations.v0;
  return {
    type: "gradient",
    angle: config.angle,
    stops: [
      { offset: 0, color: theme.colors.background, opacity: 1 },
      { offset: 0.52, color: theme.colors.surfaceAlt, opacity: dark ? 0.64 : 0.52 },
      { offset: 1, color: theme.colors.background, opacity: 1 },
    ],
    blobs: config.blobs,
  };
}

export function canvasBackgroundCss(style: CanvasBackgroundStyle | undefined, fallback: string) {
  if (!style || style.type === "solid") return style?.color || fallback;
  const layers = style.blobs.map((blob) => {
    const radius = Math.max(8, blob.size * 58);
    return `radial-gradient(circle at ${blob.x * 100}% ${blob.y * 100}%, ${hexWithAlpha(blob.color, blob.opacity)} 0%, ${hexWithAlpha(blob.color, blob.opacity * 0.68)} ${radius * 0.36}%, transparent ${radius}%)`;
  });
  const stops = style.stops
    .map((stop) => `${hexWithAlpha(stop.color, stop.opacity)} ${stop.offset * 100}%`)
    .join(", ");
  layers.push(`linear-gradient(${style.angle}deg, ${stops})`);
  return layers.join(", ");
}

function hexWithAlpha(color: string, opacity: number) {
  const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, "0");
  return `${color}${alpha}`;
}

function addDefaultContentCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  const image = slide.visual?.image;
  const hasImage = Boolean(image);
  const body = [slide.visual?.title, slideBodyText(slide)].filter(Boolean).join("\n\n");
  elements.push(
    textElement(`${slide.id}-title`, slide.title, hasImage ? 78 : 101, 56, hasImage ? 528 : 1075, hasImage ? 104 : 112, 4, {
      role: "title",
      fontSize: fittedFontSize(slide.title, hasImage ? 38 : 46, 28, hasImage ? 104 : 112),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
      align: hasImage ? "left" : "center",
    }),
    textElement(`${slide.id}-body`, body, hasImage ? 78 : 144, hasImage ? 197 : 300, hasImage ? 514 : 992, hasImage ? 336 : 160, 4, {
      role: "body",
      fontSize: fittedFontSize(body, hasImage ? READABLE_BODY_FONT_SIZE : 26, MIN_GENERATED_BODY_FONT_SIZE, hasImage ? 336 : 160),
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
      align: hasImage ? "left" : "center",
    }),
  );
  if (image) {
    elements.push(imageElement(`${slide.id}-image`, image, 645, 65, 566, 562, 3, 1, "cover"));
  }
}

function addStatementCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements, { centered: true, fontSize: 42 });
  elements.push(
    textElement(`${slide.id}-statement`, slideBodyText(slide), 130, 196, 1018, 274, 4, {
      role: "body",
      fontSize: fittedFontSize(slideBodyText(slide), 40, 25, 274),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
      align: "center",
    }),
  );
  addMiniPointRow(slide, theme, elements, 296, 544);
}

function addQuoteCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  elements.push(
    textElement(`${slide.id}-quote-mark`, "“", 68, 190, 64, 88, 4, {
      role: "caption",
      fontSize: 74,
      fontFamily: theme.fonts.heading,
      color: theme.colors.accent,
      bold: true,
      align: "center",
    }),
    textElement(`${slide.id}-quote`, quoteText(slide), 154, 188, 972, 250, 4, {
      role: "body",
      fontSize: fittedFontSize(quoteText(slide), 36, 23, 250),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
      italic: true,
      align: "center",
    }),
  );
  const bullets = slide.bullets || [];
  if (bullets[0]) {
    elements.push(textElement(`${slide.id}-quote-note`, bullets[0], 202, 466, 876, 60, 4, {
      role: "caption",
      fontSize: 20,
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
      align: "center",
    }));
  }
}

function addDefinitionCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  const definition = slide.definition || { term: slide.title, text: slide.thesis || slideBodyText(slide) };
  elements.push(
    shapeElement(`${slide.id}-definition-card`, "roundRect", 86, 164, 1109, 331, 2, theme.colors.surfaceAlt, theme.colors.line, 1, 1),
    textElement(`${slide.id}-definition-term`, definition.term, 120, 194, 1038, 80, 4, {
      role: "title",
      fontSize: 38,
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
    }),
    textElement(`${slide.id}-definition-text`, definition.text, 120, 293, 1038, 130, 4, {
      role: "body",
      fontSize: fittedFontSize(definition.text, READABLE_BODY_FONT_SIZE, MIN_GENERATED_BODY_FONT_SIZE, 130),
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }),
  );
}

function addSequenceCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  if (slide.thesis) {
    elements.push(textElement(`${slide.id}-kicker`, slide.thesis, 78, 188, 1124, 64, 4, {
      role: "body",
      fontSize: MIN_GENERATED_BODY_FONT_SIZE,
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }));
  }
  const detailedItems = slide.visual.items.filter((item) => item.label || item.text).slice(0, 5);
  const items = detailedItems.length
    ? detailedItems
    : sequenceItems(slide).slice(0, 5).map((text, index) => ({ label: `Шаг ${index + 1}`, text }));
  const width = 1123 / Math.max(items.length, 1);
  elements.push(shapeElement(`${slide.id}-sequence-line`, "rect", 100, 300, 1076, 4, 2, theme.colors.line, theme.colors.line, 0, 1));
  items.forEach((item, index) => {
    const x = 79 + index * width;
    const bodyWidth = width - 52;
    const bodyFontSize = bodyWidth >= 480 ? MIN_GENERATED_BODY_FONT_SIZE : 18;
    const bodyText = sentencePreview(item.text || item.label, bodyWidth >= 480 ? 86 : 62);
    const bodyHeight = Math.max(104, estimatedTextHeight(bodyText, bodyFontSize, bodyWidth));
    elements.push(
      shapeElement(`${slide.id}-step-${index}-num-bg`, "ellipse", x + 18, 280, 43, 43, 3, theme.colors.text, theme.colors.text, 0, 1),
      textElement(`${slide.id}-step-${index}-num`, String(index + 1), x + 18, 288, 43, 24, 4, {
        role: "caption",
        fontSize: 16,
        fontFamily: theme.fonts.body,
        color: theme.colors.background,
        bold: true,
        align: "center",
      }),
      textElement(`${slide.id}-step-${index}-label`, item.label, x + 18, 344, width - 52, 46, 4, {
        role: "caption",
        fontSize: 18,
        fontFamily: theme.fonts.heading,
        color: theme.colors.text,
        bold: true,
      }),
      textElement(`${slide.id}-step-${index}`, bodyText, x + 18, 414, bodyWidth, bodyHeight, 4, {
        role: "body",
        fontSize: bodyFontSize,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });
}

function addComparisonCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  const rows = comparisonRows(slide).slice(0, 3);
  const leftLabel = slide.visual?.leftLabel || "Первое";
  const rightLabel = slide.visual?.rightLabel || "Второе";
  elements.push(
    textElement(`${slide.id}-comparison-criterion-label`, "Критерий", 86, 196, 222, 42, 4, labelText(theme)),
    textElement(`${slide.id}-comparison-left-label`, leftLabel, 329, 196, 420, 42, 4, labelText(theme)),
    textElement(`${slide.id}-comparison-right-label`, rightLabel, 770, 196, 425, 42, 4, labelText(theme)),
  );
  rows.forEach((row, index) => {
    const y = 248 + index * 126;
    addComparisonCell(slide, theme, elements, `criterion-${index}`, 86, y, row.label || `Критерий ${index + 1}`, 222);
    addComparisonCell(slide, theme, elements, `left-${index}`, 329, y, row.left || row.label, 420);
    addComparisonCell(slide, theme, elements, `right-${index}`, 770, y, row.right || row.label, 425);
  });
}

function addImageFocusCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  const image = slide.visual?.image;
  const bodyText = slide.thesis || slideBodyText(slide);
  const bodyY = 200;
  const bodyHeight = Math.max(230, estimatedTextHeight(bodyText, READABLE_BODY_FONT_SIZE, 504));
  addSlideTitle(slide, theme, elements, { width: 528, fontSize: 38 });
  elements.push(textElement(`${slide.id}-body`, bodyText, 79, bodyY, 504, bodyHeight, 4, {
    role: "body",
    fontSize: READABLE_BODY_FONT_SIZE,
    autoFit: false,
    fontFamily: theme.fonts.body,
    color: theme.colors.muted,
  }));
  if (image) elements.push(imageElement(`${slide.id}-image`, image, 638, 69, 571, 552, 3, 1, "cover"));
  addMiniPointRow(slide, theme, elements, 79, Math.max(520, bodyY + bodyHeight + 36), { rightBoundary: 610, maxBottom: 680 });
}

function addSummaryCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  const items = sequenceItems(slide).slice(0, 5);
  const mainConclusion = slide.thesis || items[0] || slideBodyText(slide);
  const supportingItems = items.filter((item) => item !== mainConclusion).slice(0, 3).map((item) => compactSummaryPoint(item, 7));
  const finalThoughtSource = items.filter((item) => item !== mainConclusion).slice(3, 4)[0];
  const finalThought = finalThoughtSource ? compactSummaryPoint(finalThoughtSource, 14) : "";
  const conclusionFontSize = fittedFontSize(mainConclusion, 44, 25, 230);
  const conclusionHeight = Math.min(230, Math.max(150, estimatedTextHeight(mainConclusion, conclusionFontSize, 640)));

  elements.push(
    textElement(`${slide.id}-summary-conclusion`, mainConclusion, 70, 196, 640, conclusionHeight, 4, {
      role: "body",
      fontSize: conclusionFontSize,
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
    }),
    shapeElement(`${slide.id}-summary-accent`, "rect", 70, 470, 640, 5, 3, theme.colors.accent, theme.colors.accent, 0, 1),
  );

  if (supportingItems.length) {
    elements.push(
      textElement(`${slide.id}-summary-support-label`, "Ключевые мысли", 790, 200, 398, 34, 4, {
        role: "caption",
        fontSize: READABLE_PLAQUE_FONT_SIZE,
        autoFit: false,
        fontFamily: theme.fonts.heading,
        color: theme.colors.text,
        bold: true,
      }),
    );
  }

  let supportY = 264;
  let supportBottom = supportY;
  supportingItems.forEach((item, index) => {
    const itemHeight = Math.max(55, estimatedTextHeight(item, READABLE_PLAQUE_FONT_SIZE, 362));
    const y = supportY;
    elements.push(
      shapeElement(`${slide.id}-summary-support-${index}-dot`, "ellipse", 792, y + 8, 12, 12, 3, theme.colors.accentAlt, theme.colors.accentAlt, 0, 1),
      textElement(`${slide.id}-summary-support-${index}`, item, 826, y, 362, itemHeight, 4, {
        role: "body",
        fontSize: READABLE_PLAQUE_FONT_SIZE,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
    supportBottom = y + itemHeight + PLAQUE_PADDING_Y;
    supportY += itemHeight + 28;
  });

  const finalThoughtY = Math.max(536, supportBottom + 12);
  if (finalThought && finalThoughtY + 112 <= 696) {
    elements.push(
      shapeElement(`${slide.id}-summary-final-bg`, "roundRect", 70, finalThoughtY, 1140, 112, 2, theme.colors.surfaceAlt, theme.colors.line, 1, 0.92),
      textElement(`${slide.id}-summary-final-label`, "Что стоит запомнить", 94, finalThoughtY + 22, 270, 68, 4, {
        role: "caption",
        fontSize: READABLE_PLAQUE_FONT_SIZE,
        autoFit: false,
        fontFamily: theme.fonts.heading,
        color: theme.colors.text,
        bold: true,
        valign: "middle",
      }),
      textElement(`${slide.id}-summary-final`, finalThought, 390, finalThoughtY + 18, 790, 76, 4, {
        role: "body",
        fontSize: READABLE_PLAQUE_FONT_SIZE,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
        valign: "middle",
      }),
    );
  }
}

function addPanelGridCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[], labels: string[]) {
  addSlideTitle(slide, theme, elements);
  const items = uniqueCanvasItems(sequenceItems(slide)).slice(0, Math.max(1, labels.length));
  const count = Math.max(1, items.length);
  const gap = 22;
  const availableWidth = count === 1 ? 860 : 1104;
  const width = (availableWidth - gap * (count - 1)) / count;
  const startX = (1280 - availableWidth) / 2;
  items.forEach((item, index) => {
    const x = startX + index * (width + gap);
    const value = compactSummaryPoint(item, count >= 3 ? 14 : 18) || item;
    elements.push(
      shapeElement(`${slide.id}-panel-${index}`, "roundRect", x, 192, width, 286, 2, index % 2 ? theme.colors.surface : theme.colors.surfaceAlt, theme.colors.line, 1, 1),
      textElement(`${slide.id}-panel-${index}-label`, labels[index] || String(index + 1).padStart(2, "0"), x + 24, 218, width - 48, 36, 4, {
        ...labelText(theme),
        fontSize: MIN_GENERATED_CAPTION_FONT_SIZE,
      }),
      textElement(`${slide.id}-panel-${index}-text`, value, x + 24, 278, width - 48, 154, 4, {
        role: "body",
        fontSize: MIN_GENERATED_BODY_FONT_SIZE,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });
}

function addQuestionAnswerCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements, { centered: true, fontSize: 42 });
  elements.push(
    shapeElement(`${slide.id}-answer-card`, "roundRect", 149, 204, 979, 211, 2, theme.colors.surfaceAlt, theme.colors.line, 1, 1),
    textElement(`${slide.id}-answer-label`, "Ответ", 187, 228, 902, 32, 4, labelText(theme)),
    textElement(`${slide.id}-answer-text`, slide.thesis || slideBodyText(slide), 187, 283, 902, 82, 4, {
      role: "body",
      fontSize: READABLE_BODY_FONT_SIZE,
      autoFit: false,
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }),
  );
  slide.bullets.slice(0, 3).forEach((item, index) => {
    const x = 149 + index * 333;
    elements.push(
      shapeElement(`${slide.id}-answer-support-${index}-card`, "roundRect", x - 12, 450, 318, 142, 2, theme.colors.surface, theme.colors.line, 1, 0.94),
    );
    elements.push(
      textElement(`${slide.id}-answer-support-${index}-label`, ["Почему", "Пример", "Что это меняет"][index], x, 464, 294, 28, 4, labelText(theme)),
      textElement(`${slide.id}-answer-support-${index}`, item, x, 501, 294, 76, 4, {
        role: "body",
        fontSize: 16,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });
}

function addMythFactCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  const items = slide.visual.items.slice(0, 2);
  const fallback = sequenceItems(slide);
  const content = [0, 1].map((index) => {
    const item = items[index];
    return item ? [item.label, item.text].filter(Boolean).join(". ") : fallback[index] || slide.thesis;
  });

  ["Миф", "Факт"].forEach((label, index) => {
    const x = 88 + index * 552;
    elements.push(
      shapeElement(`${slide.id}-myth-fact-${index}`, "roundRect", x, 178, 534, 208, 2, index ? theme.colors.surface : theme.colors.surfaceAlt, theme.colors.line, 1, 1),
      textElement(`${slide.id}-myth-fact-${index}-label`, label, x + 24, 203, 486, 34, 4, labelText(theme)),
      textElement(`${slide.id}-myth-fact-${index}-text`, content[index], x + 24, 255, 486, 94, 4, {
        role: "body",
        fontSize: 18,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });

  slide.bullets.slice(0, 2).forEach((item, index) => {
    const x = 88 + index * 552;
    elements.push(
      textElement(`${slide.id}-myth-context-${index}-label`, index ? "Проверка" : "Почему в это верят", x, 420, 534, 30, 4, labelText(theme)),
      textElement(`${slide.id}-myth-context-${index}`, item, x, 482, 534, 82, 4, {
        role: "body",
        fontSize: 16,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });
}

function addMetricsCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  const items = sequenceItems(slide).filter(hasMeasurableValue).slice(0, 4);
  if (!items.length) {
    addStatementCanvas(slide, theme, elements);
    return;
  }
  addSlideTitle(slide, theme, elements);
  items.forEach((item, index) => {
    const x = 86 + index * 288;
    elements.push(
      shapeElement(`${slide.id}-metric-${index}-card`, "roundRect", x, 192, 261, 226, 2, theme.colors.surface, theme.colors.line, 1, 1),
      textElement(`${slide.id}-metric-${index}-lead`, metricLead(item), x + 17, 219, 226, 54, 4, {
        role: "title",
        fontSize: 38,
        fontFamily: theme.fonts.heading,
        color: theme.colors.accentAlt,
        bold: true,
      }),
      textElement(`${slide.id}-metric-${index}-text`, item, x + 17, 296, 226, 76, 4, {
        role: "body",
        fontSize: 16,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });
}

function addEvidenceCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  const thesis = sentencePreview(slide.thesis || slideBodyText(slide), 180);
  const evidence = sequenceItems(slide).filter((item) => !isDuplicateCanvasText(item, thesis)).slice(0, 4);
  elements.push(
    textElement(`${slide.id}-evidence-thesis`, thesis, 86, 196, 1108, 104, 4, {
      role: "body",
      fontSize: fittedFontSize(thesis, 34, 25, 105),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
    }),
    shapeElement(`${slide.id}-evidence-divider`, "rect", 86, 320, 1108, 3, 2, theme.colors.accent, theme.colors.accent, 0, 1),
  );
  evidence.forEach((item, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 86 + column * 560;
    const y = 348 + row * 104;
    elements.push(
      shapeElement(`${slide.id}-evidence-${index}-dot`, "ellipse", x, y + 4, 28, 28, 3, theme.colors.accentAlt, theme.colors.accentAlt, 0, 1),
      textElement(`${slide.id}-evidence-${index}`, item, x + 44, y, 500, 72, 4, {
        role: "body",
        fontSize: fittedFontSize(item, 24, MIN_GENERATED_BODY_FONT_SIZE, 72),
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });
  addSourceRefsCanvas(slide, theme, elements);
}

function addProblemSolutionCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  const items = sequenceItems(slide);
  const labels = ["Проблема", "Причина", "Решение"];
  labels.forEach((label, index) => {
    const x = 86 + index * 370;
    const value = items[index] || slide.thesis || slideBodyText(slide);
    elements.push(
      textElement(`${slide.id}-problem-${index}-label`, label, x, 180, 330, 34, 4, labelText(theme)),
      shapeElement(`${slide.id}-problem-${index}-line`, "rect", x, 229, 330, 3, 2, index === 2 ? theme.colors.accentAlt : theme.colors.line, theme.colors.line, 0, 1),
      textElement(`${slide.id}-problem-${index}-text`, value, x, 258, 330, 190, 4, {
        role: "body",
        fontSize: fittedFontSize(value, 21, 16, 190),
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });
}

function addExplainExampleCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  const items = sequenceItems(slide);
  const definition = slide.definition || { term: slide.title, text: slide.thesis || items[0] || slideBodyText(slide) };
  const example = items[1] || items[0] || slide.thesis;
  const caveat = items[2] || slide.bullets[1] || "Пример помогает понять идею, но не заменяет её точное определение.";
  elements.push(
    textElement(`${slide.id}-explain-term`, definition.term, 86, 192, 416, 72, 4, {
      role: "title",
      fontSize: fittedFontSize(definition.term, 35, 25, 72),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
    }),
    textElement(`${slide.id}-explain-definition`, definition.text, 86, 284, 416, 168, 4, {
      role: "body",
      fontSize: fittedFontSize(definition.text, 23, 17, 168),
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }),
    shapeElement(`${slide.id}-explain-divider`, "rect", 548, 192, 3, 358, 2, theme.colors.line, theme.colors.line, 0, 1),
    textElement(`${slide.id}-explain-example-label`, "Пример", 596, 192, 564, 34, 4, labelText(theme)),
    textElement(`${slide.id}-explain-example`, example, 596, 248, 564, 126, 4, {
      role: "body",
      fontSize: fittedFontSize(example, 22, 17, 126),
      fontFamily: theme.fonts.body,
      color: theme.colors.text,
      bold: true,
    }),
    textElement(`${slide.id}-explain-caveat-label`, "Важно помнить", 596, 404, 564, 34, 4, labelText(theme)),
    textElement(`${slide.id}-explain-caveat`, caveat, 596, 460, 564, 82, 4, {
      role: "body",
      fontSize: fittedFontSize(caveat, 17, 14, 82),
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }),
  );
}

function addSourceRefsCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  compactSourceRefs(slide.sourceRefs, 3).forEach((ref, index) => {
    elements.push(textElement(`${slide.id}-source-${index}`, ref, 86 + index * 370, 575, 344, 48, 4, {
      role: "caption",
      fontSize: 14,
      autoFit: false,
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }));
  });
}

function addFallbackImageCanvas(slide: Slide, elements: CanvasElement[]) {
  if (slide.slideKind === "summary") return;
  const image = slide.visual?.image;
  if (!image) return;
  if (elements.some((element) => element.type === "image")) return;
  const candidate = imageElement(`${slide.id}-image`, image, 840, 180, 340, 362, 3, 0.94, "contain");
  if (elements.some((element) => element.type === "text" && elementsVisuallyOverlap(element, candidate))) return;
  elements.push(candidate);
}

function addSlideTitle(
  slide: Slide,
  theme: PresentationTheme,
  elements: CanvasElement[],
  options: { centered?: boolean; width?: number; fontSize?: number } = {},
) {
  elements.push(textElement(`${slide.id}-title`, slide.title, options.centered ? 101 : 69, 56, options.width || (options.centered ? 1075 : 1142), 104, 4, {
    role: "title",
    fontSize: fittedFontSize(slide.title, options.fontSize || 40, 27, 104),
    fontFamily: theme.fonts.heading,
    color: theme.colors.text,
    bold: true,
    align: options.centered ? "center" : "left",
  }));
}

function addMiniPointRow(
  slide: Slide,
  theme: PresentationTheme,
  elements: CanvasElement[],
  x: number,
  y: number,
  options: { rightBoundary?: number; maxBottom?: number } = {},
) {
  const labels = uniqueCanvasItems((slide.bullets || []).slice(0, 3).map((item, index) => miniChipText(item, slide, index)));
  if (!labels.length) return;
  const gap = 18;
  const rightBoundary = options.rightBoundary || 1232;
  const desiredWidths = labels.map((label) => plaqueWidth(label, READABLE_PLAQUE_FONT_SIZE));
  const desiredWidth = desiredWidths.reduce((total, width) => total + width, 0) + gap * Math.max(0, desiredWidths.length - 1);
  const availableWidth = rightBoundary - x;
  const fittedWidth = desiredWidth > availableWidth
    ? Math.max(150, Math.floor((availableWidth - gap * Math.max(0, labels.length - 1)) / labels.length))
    : 0;
  const widths = desiredWidths.map((width) => fittedWidth || width);
  const rowHeight = Math.max(...labels.map((label, index) => plaqueHeight(label, READABLE_PLAQUE_FONT_SIZE, widths[index] - PLAQUE_PADDING_X * 2)));
  if (y + rowHeight > (options.maxBottom || 680)) return;
  let chipX = x;

  labels.forEach((label, index) => {
    const chipWidth = widths[index];
    const textWidth = chipWidth - PLAQUE_PADDING_X * 2;
    elements.push(
      shapeElement(`${slide.id}-mini-${index}-shape`, "roundRect", chipX, y, chipWidth, rowHeight, 3, theme.colors.surface, theme.colors.accent, 1, 1),
      textElement(`${slide.id}-mini-${index}`, label, chipX + PLAQUE_PADDING_X, y + PLAQUE_PADDING_Y, textWidth, rowHeight - PLAQUE_PADDING_Y * 2, 4, {
        role: "caption",
        fontSize: READABLE_PLAQUE_FONT_SIZE,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.text,
        bold: true,
        align: "center",
      }),
    );
    chipX += chipWidth + gap;
  });
}

function addTitleMiniPointGrid(slide: Slide, theme: PresentationTheme, elements: CanvasElement[], topY = 430) {
  const labels = uniqueCanvasItems((slide.bullets || []).slice(0, 3).map((item, index) => miniChipText(item, slide, index)));
  if (!labels.length) return;

  const gap = 18;
  const columnWidth = 280;
  const rowWidth = labels.length === 1 ? 538 : columnWidth * 2 + gap;
  const topHeights = labels.slice(0, 2).map((label) => plaqueHeight(label, READABLE_PLAQUE_FONT_SIZE, columnWidth - PLAQUE_PADDING_X * 2));
  const topHeight = Math.max(...topHeights);
  const bottomHeight = labels.length === 3
    ? plaqueHeight(labels[2], READABLE_PLAQUE_FONT_SIZE, rowWidth - PLAQUE_PADDING_X * 2)
    : 0;
  const gridBottom = topY + topHeight + (labels.length === 3 ? gap + bottomHeight : 0);
  const useSingleRow = labels.length === 3 && gridBottom > 680;
  const singleRowWidth = 280;
  const singleRowHeight = useSingleRow
    ? Math.max(...labels.map((label) => plaqueHeight(label, READABLE_PLAQUE_FONT_SIZE, singleRowWidth - PLAQUE_PADDING_X * 2)))
    : 0;
  if (!useSingleRow && gridBottom > CANVAS_SAFE_BOTTOM) return;
  if (useSingleRow && topY + singleRowHeight > 680) return;
  const effectiveRowWidth = useSingleRow ? labels.length * singleRowWidth + gap * (labels.length - 1) : rowWidth;
  const startX = (1280 - effectiveRowWidth) / 2;

  labels.forEach((label, index) => {
    const isSingleBottom = !useSingleRow && labels.length === 3 && index === 2;
    const chipWidth = isSingleBottom || labels.length === 1 ? rowWidth : columnWidth;
    const chipX = isSingleBottom || labels.length === 1 ? startX : startX + index * ((useSingleRow ? singleRowWidth : columnWidth) + gap);
    const chipY = isSingleBottom ? topY + topHeight + gap : topY;
    const textWidth = chipWidth - PLAQUE_PADDING_X * 2;
    const chipHeight = useSingleRow ? singleRowHeight : plaqueHeight(label, READABLE_PLAQUE_FONT_SIZE, textWidth);
    elements.push(
      shapeElement(`${slide.id}-mini-${index}-shape`, "roundRect", chipX, chipY, chipWidth, chipHeight, 3, theme.colors.surface, theme.colors.accent, 1, 1),
      textElement(`${slide.id}-mini-${index}`, label, chipX + PLAQUE_PADDING_X, chipY + PLAQUE_PADDING_Y, textWidth, chipHeight - PLAQUE_PADDING_Y * 2, 4, {
        role: "caption",
        fontSize: READABLE_PLAQUE_FONT_SIZE,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.text,
        bold: true,
        align: "center",
        valign: "middle",
      }),
    );
  });
}

function addComparisonCell(
  slide: Slide,
  theme: PresentationTheme,
  elements: CanvasElement[],
  id: string,
  x: number,
  y: number,
  value: string,
  width = 533,
) {
  const compactValue = compactSummaryPoint(value, width < 300 ? 5 : 14) || value;
  elements.push(
    shapeElement(`${slide.id}-comparison-${id}-card`, "roundRect", x, y, width, 108, 2, theme.colors.surface, theme.colors.line, 1, 1),
    textElement(`${slide.id}-comparison-${id}-text`, compactValue, x + 19, y + 16, width - 38, 76, 4, {
      role: "body",
      fontSize: MIN_GENERATED_BODY_FONT_SIZE,
      autoFit: false,
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }),
  );
}

function labelText(theme: PresentationTheme): Partial<CanvasTextElement> {
  return {
    role: "caption",
    fontSize: MIN_GENERATED_CAPTION_FONT_SIZE,
    fontFamily: theme.fonts.heading,
    color: theme.colors.text,
    bold: true,
  };
}

function slideBackgroundVariant(slide: Pick<Slide, "order" | "slideKind">) {
  if (slide.slideKind === "title") return "title";
  if (slide.slideKind === "section") return "section";
  if (slide.slideKind === "summary") return "summary";
  return `v${(slide.order - 1) % 6}`;
}

function shapeElement(
  id: string,
  shape: CanvasShapeElement["shape"],
  x: number,
  y: number,
  w: number,
  h: number,
  zIndex: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
  opacity = 1,
  locked = false,
): CanvasShapeElement {
  const fallbackFill = fill === "transparent" ? "#FFFFFF" : fill;
  const fallbackStroke = stroke === "transparent" ? fallbackFill : stroke;
  return {
    id,
    type: "shape",
    shape,
    x,
    y,
    w,
    h,
    rotation: 0,
    zIndex,
    opacity,
    locked,
    fill: fallbackFill,
    stroke: fallbackStroke,
    strokeWidth,
  };
}

function textElement(
  id: string,
  value: string,
  x: number,
  y: number,
  w: number,
  h: number,
  zIndex: number,
  options: Partial<CanvasTextElement>,
): CanvasTextElement {
  const text = cleanCanvasText(value);
  return fitCanvasTextElement({
    id,
    type: "text",
    role: options.role || "free",
    x,
    y,
    w,
    h,
    rotation: 0,
    zIndex,
    opacity: 1,
    locked: false,
    text,
    runs: [{ text }],
    fontSize: options.fontSize || 28,
    autoFit: options.autoFit,
    fontFamily: options.fontFamily || "Arial",
    color: options.color || "#161A1F",
    bold: Boolean(options.bold),
    italic: Boolean(options.italic),
    underline: Boolean(options.underline),
    align: options.align || "left",
    valign: options.valign || "top",
    groupId: options.groupId,
  });
}

function fitCanvasTextElement(element: CanvasTextElement): CanvasTextElement {
  const minimum = minimumReadableFontSize(element);
  const requestedFontSize = Math.max(element.fontSize, minimum);
  if (element.autoFit === false) {
    return {
      ...element,
      fontSize: requestedFontSize,
      h: Math.max(element.h, estimatedTextHeight(element.text, requestedFontSize, element.w)),
    };
  }
  let fontSize = requestedFontSize;
  while (fontSize > minimum && estimatedTextHeight(element.text, fontSize, element.w) > element.h) {
    fontSize -= 1;
  }
  return {
    ...element,
    fontSize,
    h: Math.max(element.h, estimatedTextHeight(element.text, fontSize, element.w)),
  };
}

function resizeTextPlaques(elements: CanvasElement[]) {
  const plaqueSizes = new Map<string, { width: number; height: number }>();
  elements.forEach((element) => {
    if (element.type !== "text" || !/-mini-\d+$/.test(element.id)) return;
    const width = plaqueWidth(element.text, element.fontSize);
    plaqueSizes.set(`${element.id}-shape`, {
      width,
      height: plaqueHeight(element.text, element.fontSize, width - PLAQUE_PADDING_X * 2),
    });
  });

  return elements.map((element) => {
    if (element.type === "shape") {
      const size = plaqueSizes.get(element.id);
      return size ? {
        ...element,
        w: Math.max(element.w, size.width),
        h: Math.max(element.h, size.height),
      } : element;
    }
    if (element.type === "text" && /-mini-\d+$/.test(element.id)) {
      const size = plaqueSizes.get(`${element.id}-shape`);
      return size ? {
        ...element,
        w: Math.max(element.w, size.width - PLAQUE_PADDING_X * 2),
        h: Math.max(element.h, size.height - PLAQUE_PADDING_Y * 2),
      } : element;
    }
    return element;
  });
}

function reflowTextPlaques(elements: CanvasElement[]) {
  const plaqueShapes = elements
    .filter((element): element is CanvasShapeElement =>
      element.type === "shape" && /-mini-\d+-shape$/.test(element.id),
    )
    .sort((left, right) => left.y - right.y || left.x - right.x);
  if (!plaqueShapes.length) return elements;

  const rows = new Map<number, CanvasShapeElement[]>();
  plaqueShapes.forEach((shape) => {
    const rowKey = Math.round(shape.y);
    rows.set(rowKey, [...(rows.get(rowKey) || []), shape]);
  });

  const updates = new Map<string, Partial<CanvasElement>>();
  rows.forEach((row) => {
    const sorted = [...row].sort((left, right) => left.x - right.x);
    const startX = Math.max(48, Math.min(...sorted.map((shape) => shape.x)));
    const rowTop = Math.min(...sorted.map((shape) => shape.y));
    const rowBottom = Math.max(...sorted.map((shape) => shape.y + shape.h));
    const imageBoundary = elements
      .filter((element): element is CanvasImageElement =>
        element.type === "image" &&
        element.x > startX &&
        element.y < rowBottom &&
        element.y + element.h > rowTop,
      )
      .reduce((boundary, image) => Math.min(boundary, image.x - 28), 1232);
    const rightBoundary = Math.max(startX + 150, imageBoundary);
    const gap = 18;
    const availableWidth = rightBoundary - startX;
    const desiredWidth = sorted.reduce((total, shape) => total + shape.w, 0) + gap * Math.max(0, sorted.length - 1);
    const fittedWidth = desiredWidth > availableWidth
      ? Math.max(150, Math.floor((availableWidth - gap * Math.max(0, sorted.length - 1)) / sorted.length))
      : 0;
    const rowHeight = Math.max(...sorted.map((shape) => {
      const text = elements.find((element): element is CanvasTextElement =>
        element.type === "text" && `${element.id}-shape` === shape.id,
      );
      const width = fittedWidth || shape.w;
      return text ? plaqueHeight(text.text, text.fontSize, width - PLAQUE_PADDING_X * 2) : shape.h;
    }));

    let nextX = startX;
    sorted.forEach((shape) => {
      const width = fittedWidth || shape.w;
      const textId = shape.id.replace(/-shape$/, "");
      updates.set(shape.id, { x: nextX, y: rowTop, w: width, h: rowHeight });
      updates.set(textId, {
        x: nextX + PLAQUE_PADDING_X,
        y: rowTop + PLAQUE_PADDING_Y,
        w: width - PLAQUE_PADDING_X * 2,
        h: rowHeight - PLAQUE_PADDING_Y * 2,
        align: "center",
        valign: "middle",
      });
      nextX += width + gap;
    });
  });

  return elements.map((element) => {
    const update = updates.get(element.id);
    return update ? { ...element, ...update } as CanvasElement : element;
  });
}

function estimatedTextHeight(value: string, fontSize: number, width: number) {
  const safeWidth = Math.max(1, width);
  const averageCharacterWidth = fontSize * 0.54;
  const charactersPerLine = Math.max(1, Math.floor(safeWidth / averageCharacterWidth));
  const lines = estimatedWrappedLineCount(cleanCanvasText(value), charactersPerLine);
  return Math.ceil(lines * fontSize * 1.14);
}

function estimatedWrappedLineCount(value: string, charactersPerLine: number) {
  const words = value.split(/\s+/).filter(Boolean);
  if (!words.length) return 1;

  let lines = 1;
  let currentLineLength = 0;

  words.forEach((word) => {
    const separator = currentLineLength ? 1 : 0;
    if (currentLineLength + separator + word.length <= charactersPerLine) {
      currentLineLength += separator + word.length;
      return;
    }

    if (currentLineLength) lines += 1;
    const fullLines = Math.floor(word.length / charactersPerLine);
    lines += Math.max(0, fullLines - (word.length % charactersPerLine === 0 ? 1 : 0));
    currentLineLength = word.length % charactersPerLine || charactersPerLine;
  });

  return lines;
}

function estimatedPlaqueTextHeight(value: string, fontSize: number, width: number) {
  const safeWidth = Math.max(1, width);
  const charactersPerLine = Math.max(1, Math.floor(safeWidth / (fontSize * 0.75)));
  const lines = cleanCanvasText(value)
    .split("\n")
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
  return Math.ceil(lines * fontSize * 1.28);
}

function plaqueHeight(value: string, fontSize: number, width: number) {
  const wordCount = cleanCanvasText(value).split(/\s+/).filter(Boolean).length;
  const contentHeight = estimatedPlaqueTextHeight(value, fontSize, width) + 40;
  const longLabelMinimum = wordCount >= 6 ? 104 : wordCount >= 5 ? 88 : wordCount >= 4 ? 72 : 58;
  return Math.max(58, contentHeight, longLabelMinimum);
}

function plaqueWidth(value: string, fontSize: number) {
  const estimatedSingleLineWidth = cleanCanvasText(value).length * fontSize * 0.58 + PLAQUE_PADDING_X * 2;
  return Math.max(220, Math.min(330, Math.ceil(estimatedSingleLineWidth)));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function imageElement(
  id: string,
  image: NonNullable<SlideVisual["image"]>,
  x: number,
  y: number,
  w: number,
  h: number,
  zIndex: number,
  opacity: number,
  fit: CanvasImageElement["fit"],
): CanvasImageElement {
  return {
    id,
    type: "image",
    x,
    y,
    w,
    h,
    rotation: 0,
    zIndex,
    opacity,
    locked: false,
    url: image.url,
    objectKey: image.objectKey || "",
    alt: image.alt || "",
    contentType: image.contentType || "",
    fit,
    sourceWidth: image.width,
    sourceHeight: image.height,
    byteSize: image.byteSize,
  };
}

function quoteText(slide: Slide) {
  const quote = (slide.blocks || []).find((block): block is Extract<SlideBlock, { type: "quote" }> => block.type === "quote");
  return quote?.content || slide.thesis || slideBodyText(slide);
}

function sequenceItems(slide: Slide) {
  const visualItems = (slide.visual?.items || []).map((item) => item.label || item.text).filter(Boolean);
  const graphItems = (slide.visual?.graph?.nodes || []).map((node) => node.detail || node.label).filter(Boolean);
  const diagramItems = splitCanvasSentences(slide.visual?.graph?.fallback || slide.visual?.diagram?.fallback || "").slice(0, 5);
  const blockItems = (slide.blocks || []).flatMap((block) => (block.type === "bullets" ? block.items : [block.content]));
  const bullets = slide.bullets || [];
  return (visualItems.length ? visualItems : graphItems.length ? graphItems : diagramItems.length ? diagramItems : bullets.length ? bullets : blockItems.length ? blockItems : [slide.thesis || slide.title]).filter(Boolean);
}

function uniqueCanvasItems(items: string[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = cleanCanvasText(item).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function comparisonRows(slide: Slide) {
  if (slide.visual?.rows?.length) return slide.visual.rows;
  const bullets = slide.bullets || [];
  return [
    {
      label: slide.title,
      left: bullets[0] || slide.thesis,
      right: bullets[1] || slideBodyText(slide),
    },
  ];
}

export function hasMeasurableValue(text: string) {
  return /(?:^|[\s(])(?:\d{1,4}(?:[.,]\d+)?\s*(?:%|°[CFСФ]?|км|м|см|мм|кг|г|мл|л|₽|\$|€|млн|млрд|тыс\.?|лет|год(?:а|ов)?|век(?:а|ов)?|мин(?:ут[аы]?)?|сек(?:унд[аы]?)?|ч(?:ас(?:а|ов)?)?)|\d{4}\s*(?:г\.?|год(?:а)?)?)(?=$|[\s,.;:)])/iu.test(text);
}

export function metricLead(text: string) {
  return text.match(/(?:\d{1,4}(?:[.,]\d+)?\s*(?:%|°[CFСФ]?|км|м|см|мм|кг|г|мл|л|₽|\$|€|млн|млрд|тыс\.?|лет|год(?:а|ов)?|век(?:а|ов)?|мин(?:ут[аы]?)?|сек(?:унд[аы]?)?|ч(?:ас(?:а|ов)?)?)|\d{4}\s*(?:г\.?|год(?:а)?)?)/iu)?.[0] || "";
}

export function fittedFontSize(value: string, preferred: number, minimum: number, boxHeight: number) {
  const text = cleanCanvasText(value);
  const pressure = Math.max(text.length / 54, text.split(/\s+/).length / 9, text.split("\n").length);
  const heightPressure = Math.max(1, 120 / Math.max(boxHeight, 1));
  return Math.max(minimum, Math.round(preferred / Math.max(1, pressure * 0.72, heightPressure)));
}

export function compactSourceRefs(sourceRefs: SourceRef[], limit = 3) {
  return sourceRefs.slice(0, limit).map((ref) => {
    const location = ref.page ? `, ${ref.page}` : "";
    const excerpt = sentencePreview(ref.excerpt, 86);
    return [sentencePreview(ref.label, 42) + location, excerpt].filter(Boolean).join(" — ");
  });
}

function isDuplicateCanvasText(left: string, right: string) {
  const normalize = (value: string) => cleanCanvasText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
  return Boolean(normalize(left) && normalize(left) === normalize(right));
}

function miniChipText(value: string, slide: Slide, index: number) {
  const bullets = slide.bullets || [];
  const primary = compactChipSentence(value, 12)
    || (!looksLikeChipFragment(value) ? compactSummaryPoint(value, 10) : "");
  if (primary) return primary;
  const candidates = [
    bullets[index + 1],
    slide.thesis,
    slide.title,
    slideBodyText(slide),
  ];
  const complete = candidates.map((candidate) => compactChipSentence(candidate, 12)).find(Boolean);
  if (complete) return complete;
  const source = candidates.find((candidate) => phraseWords(candidate).length >= 5) || candidates.find(Boolean) || "";
  const words = phraseWords(source);
  const fallback = words.join(" ");
  return fallback && words.length <= 12 && !looksLikeChipFragment(fallback) ? `${fallback}.` : compactChipSentence(slide.title, 12);
}

function compactSummaryPoint(value: string, maxWords: number) {
  const text = cleanCanvasText(value);
  if (!text) return "";
  const sentences = text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const complete = sentences.find((sentence) => {
    const count = phraseWords(sentence).length;
    return count >= 3 && count <= maxWords && !looksLikeChipFragment(sentence);
  });
  if (complete) return /[.!?]$/.test(complete) ? complete : `${complete}.`;

  const source = sentences[0] || text;
  const clause = source
    .split(/[,;:–—]\s*/)
    .map((part) => part.trim())
    .find((part) => {
      const count = phraseWords(part).length;
      return count >= 3 && count <= maxWords && !looksLikeChipFragment(part);
    });
  if (clause) return /[.!?]$/.test(clause) ? clause : `${clause}.`;

  const words = phraseWords(source).slice(0, maxWords);
  while (words.length > 3 && /^(и|или|но|а|что|чтобы|когда|если|and|or|but|that)$/iu.test(words.at(-1) || "")) {
    words.pop();
  }
  return words.length ? `${words.join(" ")}.` : "";
}

function compactChipSentence(value: string, maxWords: number) {
  const text = cleanCanvasText(value);
  if (!text) return "";
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const source = sentences.find((sentence) => !looksLikeChipFragment(sentence)) || (!/[.!?]/.test(text) && !looksLikeChipFragment(text) ? text : "");
  if (!source) return "";
  const words = phraseWords(source);
  if (!words.length) return "";
  if (words.length > maxWords) return "";
  const sentence = words.join(" ");
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function looksLikeChipFragment(value: string) {
  const text = cleanCanvasText(value).replace(/[.!?]+$/g, "").toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const last = words.at(-1) || "";
  if (words.length < 2) return true;
  if (/[,;:\-–—]$/.test(text)) return true;
  const hasPredicateSetup = /(?:^|[^\p{L}])(\u044d\u0442\u043e|\u044d\u0442\u0430|\u044d\u0442\u043e\u0442|\u044d\u0442\u0438|\u044f\u0432\u043b\u044f\u0435\u0442\u0441\u044f|\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u0441\u044f|\u043e\u0441\u0442\u0430\u0435\u0442\u0441\u044f|\u043e\u0441\u0442\u0430\u0451\u0442\u0441\u044f|\u0431\u044b\u043b\u0430|\u0431\u044b\u043b|\u0431\u044b\u043b\u043e|\u0431\u0443\u0434\u0435\u0442|\u0441\u0442\u0430\u043b\u0430|\u0441\u0442\u0430\u043b|\u0441\u0442\u0430\u043b\u043e)(?=$|[^\p{L}])/iu.test(text);
  return hasPredicateSetup && /(\u0430\u044f|\u044f\u044f|\u044b\u0439|\u0438\u0439|\u043e\u0439|\u043e\u0435|\u0435\u0435|\u044b\u0435|\u0438\u0435|\u0443\u044e|\u044e\u044e|\u043e\u0433\u043e|\u0435\u0433\u043e|\u043e\u043c\u0443|\u0435\u043c\u0443|\u044b\u043c|\u0438\u043c|\u044b\u0445|\u0438\u0445)$/.test(last);
}

function phraseWords(value: string) {
  return cleanCanvasText(value)
    .replace(/\.{3,}|…/g, "")
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%№+-]+$/gu, ""))
    .filter(Boolean);
}

function slideBodyText(slide: Slide) {
  const text = [
    slide.thesis,
    ...(slide.bullets || []),
    slide.definition ? `${slide.definition.term}: ${slide.definition.text}` : "",
    slide.visual?.graph?.fallback || "",
    slide.visual?.diagram?.fallback || "",
    ...(slide.blocks || []).flatMap((block) => (block.type === "bullets" ? block.items : [block.content])),
  ]
    .filter(Boolean)
    .join(" ");
  return sentencePreview(text || slide.title, 360);
}

function splitCanvasSentences(value: string) {
  return cleanCanvasText(value)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sentencePreview(value: string, maxLength: number) {
  const text = cleanCanvasText(value);
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 3);
  const preview = sentences.length ? sentences.join(" ") : text;
  return preview.length > maxLength ? `${preview.slice(0, maxLength - 3).trim()}...` : preview;
}

function cleanCanvasText(value: unknown) {
  return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
