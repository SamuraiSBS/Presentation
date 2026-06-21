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
  { id: "comparison", label: "Сравнение", description: "Сравнение по нескольким критериям", kinds: ["content"], requirements: ["comparison"], fallback: "evidence" },
  { id: "process", label: "Процесс", description: "Последовательность шагов", kinds: ["content"], requirements: ["sequence"], fallback: "bullets" },
  { id: "image-focus", label: "Изображение", description: "Визуальный пример и пояснение", kinds: ["content"], requirements: [], fallback: "statement" },
  { id: "case-study", label: "Кейс", description: "Ситуация, действие, результат", kinds: ["content"], requirements: ["sequence"], fallback: "problem-solution" },
  { id: "question-answer", label: "Вопрос и ответ", description: "Вопрос с ясным ответом", kinds: ["content"], requirements: [], fallback: "statement" },
  { id: "myth-fact", label: "Миф и факт", description: "Исправление заблуждения", kinds: ["content"], requirements: ["comparison"], fallback: "comparison" },
  { id: "metrics", label: "Показатели", description: "Только реальные числа и величины", kinds: ["content"], requirements: ["metrics"], fallback: "statement" },
  { id: "evidence", label: "Тезис и доказательства", description: "Тезис, факты и компактные источники", kinds: ["content"], requirements: [], fallback: "bullets" },
  { id: "problem-solution", label: "Проблема и решение", description: "Проблема, причина и решение", kinds: ["content"], requirements: ["sequence"], fallback: "process" },
  { id: "explain-example", label: "Объяснение и пример", description: "Понятие, объяснение, пример и оговорка", kinds: ["content"], requirements: [], fallback: "definition" },
];

export function slideLayoutDefinition(layout: SlideLayout) {
  return SLIDE_LAYOUT_DEFINITIONS.find((item) => item.id === layout) || SLIDE_LAYOUT_DEFINITIONS[0];
}

export function slideLayoutOptions(kind: SlideKind) {
  return SLIDE_LAYOUT_DEFINITIONS.filter((item) => item.id !== "two-column" && item.kinds.includes(kind));
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

const canvasElementBaseSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  rotation: z.number().default(0),
  zIndex: z.number().int().default(1),
  opacity: z.number().min(0).max(1).default(1),
  locked: z.boolean().default(false),
});

export const canvasTextRunSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  color: presentationThemeColorSchema.optional(),
});
export type CanvasTextRun = z.infer<typeof canvasTextRunSchema>;

export const canvasTextElementSchema = canvasElementBaseSchema.extend({
  type: z.literal("text"),
  role: z.enum(["title", "body", "caption", "free"]).default("free"),
  text: z.string().default(""),
  runs: z.array(canvasTextRunSchema).default([]),
  fontSize: z.number().int().min(8).max(160).default(28),
  fontFamily: z.string().min(1).default("Arial"),
  color: presentationThemeColorSchema.default("#161A1F"),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  underline: z.boolean().default(false),
  align: z.enum(["left", "center", "right"]).default("left"),
});
export type CanvasTextElement = z.infer<typeof canvasTextElementSchema>;

export const canvasImageElementSchema = canvasElementBaseSchema.extend({
  type: z.literal("image"),
  url: z.string().default(""),
  objectKey: z.string().default(""),
  alt: z.string().default(""),
  contentType: z.string().default(""),
  fit: z.enum(["contain", "cover"]).default("cover"),
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

export const slideCanvasSchema = z.object({
  width: z.number().int().positive().default(1280),
  height: z.number().int().positive().default(720),
  background: presentationThemeColorSchema.default("#F7F8FA"),
  elements: z.array(canvasElementSchema).max(80).default([]),
});
export type SlideCanvas = z.infer<typeof slideCanvasSchema>;

export const slideSchema = z.object({
  id: z.string(),
  order: z.number().int().positive(),
  title: z.string(),
  slideKind: slideKindSchema.default("content"),
  layout: slideLayoutSchema,
  thesis: z.string().default(""),
  bullets: z.array(z.string()).max(5).default([]),
  definition: slideDefinitionSchema.nullable().default(null),
  keyConcepts: z.array(keyConceptSchema).max(5).default([]),
  visual: slideVisualSchema.default({ type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] }),
  highlights: z.array(highlightSchema).max(6).default([]),
  blocks: z.array(slideBlockSchema),
  canvas: slideCanvasSchema.optional(),
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

export const slideNarrativeSchema = z.object({
  slideOrder: z.number().int().positive(),
  slideTitle: z.string(),
  slidePurpose: z.string(),
  keyMessage: z.string(),
  audienceQuestion: z.string(),
  transitionToNext: z.string(),
});
export type SlideNarrative = z.infer<typeof slideNarrativeSchema>;

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

const DARK_THEME_WORDS = [
  "war",
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

const NEUTRAL_THEME_PRESETS: PresentationThemePreset[] = ["academic", "nature", "history", "minimal"];

export function resolvePresentationTheme(input: {
  title?: string;
  prompt?: string;
  scenario?: string;
  level?: string;
  presentationTheme?: unknown;
}): PresentationTheme {
  const existing = presentationThemeSchema.safeParse(input.presentationTheme);
  if (existing.success) {
    return existing.data;
  }

  const text = normalizeThemeText([input.title, input.prompt, input.scenario, input.level].filter(Boolean).join(" "));
  if (matchesThemeWords(text, DARK_THEME_WORDS)) return PRESENTATION_THEME_PRESETS.moody;
  if (matchesThemeWords(text, BRIGHT_THEME_WORDS)) return PRESENTATION_THEME_PRESETS.bright;
  if (matchesThemeWords(text, TECH_THEME_WORDS)) return PRESENTATION_THEME_PRESETS.tech;
  if (matchesThemeWords(text, NATURE_THEME_WORDS)) return PRESENTATION_THEME_PRESETS.nature;
  if (matchesThemeWords(text, HISTORY_THEME_WORDS)) return PRESENTATION_THEME_PRESETS.history;

  const preset = NEUTRAL_THEME_PRESETS[stableThemeHash(text || "studydeck") % NEUTRAL_THEME_PRESETS.length];
  return PRESENTATION_THEME_PRESETS[preset];
}

function normalizeThemeText(value: string) {
  return value.toLowerCase().replace(/ё/g, "е");
}

function matchesThemeWords(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function stableThemeHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

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
  layout: slideLayoutSchema.optional(),
  blocks: z.array(slideBlockSchema).optional(),
  canvas: slideCanvasSchema.optional(),
  speakerNotes: z.string().max(5000).optional(),
});
export type UpdateSlideInput = z.infer<typeof updateSlideInputSchema>;

export const updateNarrationInputSchema = z.object({
  speechDraft: z.string().min(50).max(60000),
});
export type UpdateNarrationInput = z.infer<typeof updateNarrationInputSchema>;

export const generatePresentationInputSchema = updateNarrationInputSchema.partial();
export type GeneratePresentationInput = z.infer<typeof generatePresentationInputSchema>;

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

export function ensureEditableCanvas(document: PresentationDocument): PresentationDocument {
  const theme = resolvePresentationTheme({
    title: document.title,
    scenario: document.scenario,
    level: document.level,
    presentationTheme: document.presentationTheme,
  });

  return {
    ...document,
    presentationTheme: theme,
    slides: document.slides.map((slide) => {
      const generatedCanvas = buildSlideCanvas(slide, theme);
      return {
        ...slide,
        canvas: hasCustomSlideCanvas(slide, theme, generatedCanvas) ? slide.canvas : generatedCanvas,
      };
    }),
  };
}

export function buildSlideCanvas(slide: Slide, theme: PresentationTheme): SlideCanvas {
  const visual = slide.visual || { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] };
  const background = theme.colors.background;
  const text = theme.colors.text;
  const muted = theme.colors.muted;
  const elements: CanvasElement[] = backgroundElements(slide, theme);

  if (slide.slideKind === "title" || slide.slideKind === "section") {
    elements.push(
      shapeElement(`${slide.id}-panel`, "roundRect", 66, 54, 1148, 612, 2, theme.colors.surface, theme.colors.surface, 0, 0.9, true),
    );

    if (visual.image) {
      elements.push(imageElement(`${slide.id}-image-bg`, visual.image, 66, 54, 1148, 612, 3, 0.14, "contain"));
    }

    elements.push(
      textElement(`${slide.id}-title`, slide.title, 112, 188, 1056, 148, 5, {
        role: "title",
        fontSize: fittedFontSize(slide.title, 58, 38, 148),
        fontFamily: theme.fonts.heading,
        color: text,
        bold: true,
        align: "center",
      }),
      textElement(`${slide.id}-body`, slide.thesis || slideBodyText(slide), 158, 366, 964, 110, 5, {
        role: "body",
        fontSize: fittedFontSize(slide.thesis || slideBodyText(slide), 28, 20, 110),
        fontFamily: theme.fonts.body,
        color: muted,
        align: "center",
      }),
    );

    addMiniPointRow(slide, theme, elements, 296, 506);

    return { width: 1280, height: 720, background, elements: sortCanvasElements(elements) };
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

  return { width: 1280, height: 720, background, elements: sortCanvasElements(elements) };
}

export function sortCanvasElements(elements: CanvasElement[]) {
  return [...elements].sort((left, right) => left.zIndex - right.zIndex);
}

export function hasCustomSlideCanvas(slide: Slide, theme: PresentationTheme, generatedCanvas = buildSlideCanvas(slide, theme)) {
  if (!slide.canvas) return false;
  if (isLegacyFullscreenImageCanvas(slide)) return false;
  if (sameCanvas(slide.canvas, generatedCanvas) || sameCanvasStructure(slide.canvas, generatedCanvas)) return false;
  if (isLegacyLeanTitleCanvas(slide)) return false;
  if (!hasAutoGeneratedCanvasMarker(slide)) return true;
  return true;
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

function isKnownGeneratedCanvasElementId(slideId: string, elementId: string) {
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
    elementId.startsWith(`${slideId}-seq-`) ||
    elementId.startsWith(`${slideId}-left-`) ||
    elementId.startsWith(`${slideId}-right-`) ||
    elementId.startsWith(`${slideId}-qa-`) ||
    elementId.startsWith(`${slideId}-metric-`) ||
    elementId.startsWith(`${slideId}-evidence-`) ||
    elementId.startsWith(`${slideId}-source-`) ||
    elementId.startsWith(`${slideId}-problem-`) ||
    elementId.startsWith(`${slideId}-explain-`) ||
    elementId.startsWith(`${slideId}-mini-`) ||
    elementId.startsWith(`${slideId}-card-`) ||
    elementId.startsWith(`${slideId}-visual-`)
  );
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
  const elements: CanvasElement[] = [
    shapeElement(`${slide.id}-bg`, "rect", 0, 0, 1280, 720, 0, theme.colors.background, theme.colors.background, 0, 1, true),
  ];
  if (theme.preset === "academic") {
    elements.push(
      shapeElement(`${slide.id}-bg-theme-margin`, "rect", 84, 34, 2, 652, 1, theme.colors.line, theme.colors.line, 0, 0.55),
      shapeElement(`${slide.id}-bg-theme-note`, "rect", 1100, 58, 118, 34, 1, theme.colors.surfaceAlt, theme.colors.surfaceAlt, 0, 0.72),
    );
  } else if (theme.preset === "tech") {
    for (let x = 40; x < 1280; x += 80) {
      elements.push(shapeElement(`${slide.id}-bg-theme-grid-${x}`, "rect", x, 0, 1, 720, 1, theme.colors.line, theme.colors.line, 0, 0.2));
    }
  } else if (theme.preset === "history") {
    elements.push(shapeElement(`${slide.id}-bg-theme-archive`, "rect", 24, 22, 1232, 676, 1, theme.colors.background, theme.colors.line, 2, 0.82));
  } else if (theme.preset === "nature") {
    elements.push(
      shapeElement(`${slide.id}-bg-theme-cycle-a`, "ellipse", 1050, 46, 128, 128, 1, theme.colors.surfaceAlt, theme.colors.line, 1, 0.42),
      shapeElement(`${slide.id}-bg-theme-cycle-b`, "ellipse", 1114, 108, 86, 86, 1, theme.colors.accentAlt, theme.colors.accentAlt, 0, 0.18),
    );
  }
  const soft = 0.3;
  const medium = 0.42;
  const variant = slideBackgroundVariant(slide);

  if (variant === "title") {
    elements.push(
      shapeElement(`${slide.id}-bg-title-accent`, "rect", 0, 0, 394, 720, 1, theme.colors.accent, theme.colors.accent, 0, medium),
      shapeElement(`${slide.id}-bg-title-alt`, "rect", 1037, 0, 243, 230, 1, theme.colors.accentAlt, theme.colors.accentAlt, 0, soft),
    );
    return elements;
  }

  if (variant === "section") {
    elements.push(
      shapeElement(`${slide.id}-bg-section-side`, "rect", 0, 0, 206, 720, 1, theme.colors.surfaceAlt, theme.colors.surfaceAlt, 0, medium),
      shapeElement(`${slide.id}-bg-section-line`, "rect", 0, 331, 1280, 18, 1, theme.colors.accent, theme.colors.accent, 0, soft),
    );
    return elements;
  }

  if (variant === "summary") {
    elements.push(
      shapeElement(`${slide.id}-bg-summary-band`, "rect", 0, 571, 1280, 149, 1, theme.colors.surfaceAlt, theme.colors.surfaceAlt, 0, medium),
      shapeElement(`${slide.id}-bg-summary-side`, "rect", 1003, 0, 277, 720, 1, theme.colors.accentAlt, theme.colors.accentAlt, 0, soft),
    );
    return elements;
  }

  if (variant === "v1") {
    elements.push(
      shapeElement(`${slide.id}-bg-v1-side`, "rect", 811, 0, 469, 720, 1, theme.colors.surfaceAlt, theme.colors.surfaceAlt, 0, medium),
      shapeElement(`${slide.id}-bg-v1-mark`, "rect", 888, 538, 322, 40, 1, theme.colors.accentAlt, theme.colors.accentAlt, 0, soft),
    );
    return elements;
  }

  if (variant === "v2") {
    for (let x = 34; x < 1268; x += 120) {
      elements.push(shapeElement(`${slide.id}-bg-v2-grid-${x}`, "rect", x, 24, 3, 672, 1, theme.colors.line, theme.colors.line, 0, 0.28));
    }
    elements.push(shapeElement(`${slide.id}-bg-v2-corner`, "rect", 0, 0, 307, 106, 1, theme.colors.accent, theme.colors.accent, 0, soft));
    return elements;
  }

  if (variant === "v3") {
    elements.push(
      shapeElement(`${slide.id}-bg-v3-frame`, "rect", 27, 24, 1226, 672, 1, "transparent", theme.colors.line, 2, 0.82),
      shapeElement(`${slide.id}-bg-v3-inner`, "rect", 53, 50, 1174, 620, 1, "transparent", theme.colors.accent, 2, 0.38),
    );
    return elements;
  }

  if (variant === "v4") {
    elements.push(
      shapeElement(`${slide.id}-bg-v4-left`, "rect", 0, 0, 365, 720, 1, theme.colors.surfaceAlt, theme.colors.surfaceAlt, 0, medium),
      shapeElement(`${slide.id}-bg-v4-right`, "rect", 941, 0, 339, 720, 1, theme.colors.accentAlt, theme.colors.accentAlt, 0, soft),
    );
    return elements;
  }

  if (variant === "v5") {
    elements.push(
      shapeElement(`${slide.id}-bg-v5-top`, "rect", 0, 0, 1280, 120, 1, theme.colors.surfaceAlt, theme.colors.surfaceAlt, 0, medium),
      shapeElement(`${slide.id}-bg-v5-side`, "rect", 1080, 0, 200, 720, 1, theme.colors.accent, theme.colors.accent, 0, soft),
    );
    return elements;
  }

  elements.push(
    shapeElement(`${slide.id}-bg-v0-band`, "rect", 0, 490, 1280, 230, 1, theme.colors.surfaceAlt, theme.colors.surfaceAlt, 0, medium),
    shapeElement(`${slide.id}-bg-v0-mark`, "rect", 19, 19, 211, 17, 1, theme.colors.accent, theme.colors.accent, 0, soft),
  );
  return elements;
}

function addDefaultContentCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  const image = slide.visual?.image;
  const hasImage = Boolean(image);
  elements.push(
    textElement(`${slide.id}-title`, slide.title, hasImage ? 78 : 101, 56, hasImage ? 528 : 1075, hasImage ? 104 : 112, 4, {
      role: "title",
      fontSize: hasImage ? 38 : 46,
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
      align: hasImage ? "left" : "center",
    }),
    textElement(`${slide.id}-body`, slideBodyText(slide), hasImage ? 78 : 144, hasImage ? 197 : 300, hasImage ? 514 : 992, hasImage ? 336 : 160, 4, {
      role: "body",
      fontSize: hasImage ? 24 : 26,
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
    textElement(`${slide.id}-quote-mark`, "“", 96, 164, 64, 88, 4, {
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
      fontSize: fittedFontSize(definition.text, 24, 17, 130),
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }),
  );
}

function addSequenceCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  if (slide.thesis) {
    elements.push(textElement(`${slide.id}-kicker`, slide.thesis, 78, 144, 1124, 56, 4, {
      role: "body",
      fontSize: 19,
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }));
  }
  const detailedItems = slide.visual.items.filter((item) => item.label || item.text).slice(0, 5);
  const items = detailedItems.length
    ? detailedItems
    : sequenceItems(slide).slice(0, 5).map((text, index) => ({ label: `Шаг ${index + 1}`, text }));
  const width = 1123 / Math.max(items.length, 1);
  elements.push(shapeElement(`${slide.id}-sequence-line`, "rect", 100, 256, 1076, 4, 2, theme.colors.line, theme.colors.line, 0, 1));
  items.forEach((item, index) => {
    const x = 79 + index * width;
    elements.push(
      shapeElement(`${slide.id}-step-${index}-num-bg`, "ellipse", x + 18, 236, 43, 43, 3, theme.colors.text, theme.colors.text, 0, 1),
      textElement(`${slide.id}-step-${index}-num`, String(index + 1), x + 18, 244, 43, 24, 4, {
        role: "caption",
        fontSize: 16,
        fontFamily: theme.fonts.body,
        color: theme.colors.background,
        bold: true,
        align: "center",
      }),
      textElement(`${slide.id}-step-${index}-label`, item.label, x + 18, 300, width - 52, 46, 4, {
        role: "caption",
        fontSize: 18,
        fontFamily: theme.fonts.heading,
        color: theme.colors.text,
        bold: true,
      }),
      textElement(`${slide.id}-step-${index}`, item.text || item.label, x + 18, 352, width - 52, 104, 4, {
        role: "body",
        fontSize: 16,
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
    textElement(`${slide.id}-comparison-criterion-label`, "Критерий", 86, 164, 222, 42, 4, labelText(theme)),
    textElement(`${slide.id}-comparison-left-label`, leftLabel, 329, 164, 420, 42, 4, labelText(theme)),
    textElement(`${slide.id}-comparison-right-label`, rightLabel, 770, 164, 425, 42, 4, labelText(theme)),
  );
  rows.forEach((row, index) => {
    const y = 209 + index * 117;
    addComparisonCell(slide, theme, elements, `criterion-${index}`, 86, y, row.label || `Критерий ${index + 1}`, 222);
    addComparisonCell(slide, theme, elements, `left-${index}`, 329, y, row.left || row.label, 420);
    addComparisonCell(slide, theme, elements, `right-${index}`, 770, y, row.right || row.label, 425);
  });
}

function addImageFocusCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  const image = slide.visual?.image;
  addSlideTitle(slide, theme, elements, { width: 528, fontSize: 38 });
  elements.push(textElement(`${slide.id}-body`, slide.thesis || slideBodyText(slide), 79, 192, 504, 230, 4, {
    role: "body",
    fontSize: 24,
    fontFamily: theme.fonts.body,
    color: theme.colors.muted,
  }));
  if (image) elements.push(imageElement(`${slide.id}-image`, image, 638, 69, 571, 552, 3, 1, "cover"));
  addMiniPointRow(slide, theme, elements, 79, 520);
}

function addSummaryCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  const items = sequenceItems(slide).slice(0, 6);
  const columns = items.length > 3 ? 3 : Math.max(items.length, 1);
  const cardW = 340;
  const gap = 24;
  const startX = (1280 - columns * cardW - (columns - 1) * gap) / 2;
  items.forEach((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = startX + column * (cardW + gap);
    const y = 176 + row * 148;
    elements.push(
      shapeElement(`${slide.id}-summary-${index}-card`, "roundRect", x, y, cardW, 118, 2, theme.colors.surface, theme.colors.line, 1, 1),
      shapeElement(`${slide.id}-summary-${index}-num-bg`, "ellipse", x + 16, y + 18, 38, 38, 3, theme.colors.text, theme.colors.text, 0, 1),
      textElement(`${slide.id}-summary-${index}-num`, String(index + 1), x + 16, y + 25, 38, 22, 4, {
        role: "caption",
        fontSize: 14,
        fontFamily: theme.fonts.body,
        color: theme.colors.background,
        bold: true,
        align: "center",
      }),
      textElement(`${slide.id}-summary-${index}`, item, x + 66, y + 18, cardW - 86, 78, 4, {
        role: "body",
        fontSize: 18,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });
}

function addPanelGridCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[], labels: string[]) {
  addSlideTitle(slide, theme, elements);
  const items = sequenceItems(slide);
  const width = 1104 / labels.length;
  labels.forEach((label, index) => {
    const x = 88 + index * width;
    elements.push(
      shapeElement(`${slide.id}-panel-${index}`, "roundRect", x, 192, width - 18, 240, 2, index % 2 ? theme.colors.surface : theme.colors.surfaceAlt, theme.colors.line, 1, 1),
      textElement(`${slide.id}-panel-${index}-label`, label, x + 22, 215, width - 62, 36, 4, labelText(theme)),
      textElement(`${slide.id}-panel-${index}-text`, items[index] || slide.thesis || slideBodyText(slide), x + 22, 274, width - 62, 112, 4, {
        role: "body",
        fontSize: 18,
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
      fontSize: 24,
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }),
  );
  slide.bullets.slice(0, 3).forEach((item, index) => {
    const x = 149 + index * 333;
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
      textElement(`${slide.id}-myth-context-${index}-label`, index ? "Проверка" : "Почему в это верят", x, 430, 534, 30, 4, labelText(theme)),
      textElement(`${slide.id}-myth-context-${index}`, item, x, 469, 534, 82, 4, {
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
    textElement(`${slide.id}-evidence-thesis`, thesis, 86, 158, 1108, 104, 4, {
      role: "body",
      fontSize: fittedFontSize(thesis, 34, 25, 105),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
    }),
    shapeElement(`${slide.id}-evidence-divider`, "rect", 86, 282, 1108, 3, 2, theme.colors.accent, theme.colors.accent, 0, 1),
  );
  evidence.forEach((item, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 86 + column * 560;
    const y = 315 + row * 112;
    elements.push(
      shapeElement(`${slide.id}-evidence-${index}-dot`, "ellipse", x, y + 4, 28, 28, 3, theme.colors.accentAlt, theme.colors.accentAlt, 0, 1),
      textElement(`${slide.id}-evidence-${index}`, item, x + 44, y, 500, 72, 4, {
        role: "body",
        fontSize: fittedFontSize(item, 19, 15, 72),
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
    textElement(`${slide.id}-explain-term`, definition.term, 86, 164, 416, 72, 4, {
      role: "title",
      fontSize: fittedFontSize(definition.term, 35, 25, 72),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
    }),
    textElement(`${slide.id}-explain-definition`, definition.text, 86, 252, 416, 168, 4, {
      role: "body",
      fontSize: fittedFontSize(definition.text, 23, 17, 168),
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }),
    shapeElement(`${slide.id}-explain-divider`, "rect", 548, 164, 3, 358, 2, theme.colors.line, theme.colors.line, 0, 1),
    textElement(`${slide.id}-explain-example-label`, "Пример", 596, 164, 564, 34, 4, labelText(theme)),
    textElement(`${slide.id}-explain-example`, example, 596, 220, 564, 126, 4, {
      role: "body",
      fontSize: fittedFontSize(example, 22, 17, 126),
      fontFamily: theme.fonts.body,
      color: theme.colors.text,
      bold: true,
    }),
    textElement(`${slide.id}-explain-caveat-label`, "Важно помнить", 596, 382, 564, 34, 4, labelText(theme)),
    textElement(`${slide.id}-explain-caveat`, caveat, 596, 438, 564, 82, 4, {
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
      fontSize: fittedFontSize(ref, 13, 10, 48),
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }));
  });
}

function addFallbackImageCanvas(slide: Slide, elements: CanvasElement[]) {
  const image = slide.visual?.image;
  if (!image) return;
  if (elements.some((element) => element.type === "image")) return;
  elements.push(imageElement(`${slide.id}-image`, image, 840, 132, 340, 410, 3, 0.94, "contain"));
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

function addMiniPointRow(slide: Slide, theme: PresentationTheme, elements: CanvasElement[], x: number, y: number) {
  (slide.bullets || []).slice(0, 3).forEach((item, index) => {
    const chipX = x + index * 230;
    const label = miniChipText(item);
    elements.push(
      shapeElement(`${slide.id}-mini-${index}-shape`, "roundRect", chipX, y, 204, 50, 3, theme.colors.surface, theme.colors.accent, 1, 1),
      textElement(`${slide.id}-mini-${index}`, label, chipX + 10, y + 7, 184, 36, 4, {
        role: "caption",
        fontSize: 15,
        fontFamily: theme.fonts.body,
        color: theme.colors.text,
        bold: true,
        align: "center",
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
  elements.push(
    shapeElement(`${slide.id}-comparison-${id}-card`, "roundRect", x, y, width, 92, 2, theme.colors.surface, theme.colors.line, 1, 1),
    textElement(`${slide.id}-comparison-${id}-text`, value, x + 19, y + 15, width - 38, 54, 4, {
      role: "body",
      fontSize: 18,
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }),
  );
}

function labelText(theme: PresentationTheme): Partial<CanvasTextElement> {
  return {
    role: "caption",
    fontSize: 16,
    fontFamily: theme.fonts.heading,
    color: theme.colors.text,
    bold: true,
  };
}

function slideBackgroundVariant(slide: Slide) {
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
  return {
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
    fontFamily: options.fontFamily || "Arial",
    color: options.color || "#161A1F",
    bold: Boolean(options.bold),
    italic: Boolean(options.italic),
    underline: Boolean(options.underline),
    align: options.align || "left",
  };
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
  };
}

function quoteText(slide: Slide) {
  const quote = (slide.blocks || []).find((block): block is Extract<SlideBlock, { type: "quote" }> => block.type === "quote");
  return quote?.content || slide.thesis || slideBodyText(slide);
}

function sequenceItems(slide: Slide) {
  const visualItems = (slide.visual?.items || []).map((item) => item.label || item.text).filter(Boolean);
  const blockItems = (slide.blocks || []).flatMap((block) => (block.type === "bullets" ? block.items : [block.content]));
  const bullets = slide.bullets || [];
  return (visualItems.length ? visualItems : bullets.length ? bullets : blockItems.length ? blockItems : [slide.thesis || slide.title]).filter(Boolean);
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

function miniChipText(value: string) {
  return sentencePreview(value, 28);
}

function slideBodyText(slide: Slide) {
  const text = [
    slide.thesis,
    ...(slide.bullets || []),
    slide.definition ? `${slide.definition.term}: ${slide.definition.text}` : "",
    ...(slide.blocks || []).flatMap((block) => (block.type === "bullets" ? block.items : [block.content])),
  ]
    .filter(Boolean)
    .join(" ");
  return sentencePreview(text || slide.title, 360);
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
