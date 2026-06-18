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
]);
export type SlideLayout = z.infer<typeof slideLayoutSchema>;

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
  blocks: z.array(slideBlockSchema).optional(),
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

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
