import type { DesignBrief } from "../generation/schemas.js";
import { designBriefSchema } from "../generation/schemas.js";
import type { PresentationTheme } from "./schemas.js";
import { presentationThemeSchema } from "./schemas.js";
import { PRESENTATION_FONT_FAMILY } from "./fonts.js";
export const PREMIUM_PRESENTATION_THEMES = {
  studydeckEditorial: {
    preset: "minimal",
    themeId: "studydeckEditorial",
    mood: "serious",
    colors: {
      background: "#F7F7F5",
      surface: "#FFFFFF",
      surfaceAlt: "#ECEBE7",
      text: "#191714",
      muted: "#5F5A54",
      accent: "#FF8A00",
      accentAlt: "#7B3DFF",
      line: "#D7D4CE",
    },
    fonts: {
      heading: PRESENTATION_FONT_FAMILY,
      body: PRESENTATION_FONT_FAMILY,
      tone: "bookish",
    },
  },
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
      heading: PRESENTATION_FONT_FAMILY,
      body: PRESENTATION_FONT_FAMILY,
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
      heading: PRESENTATION_FONT_FAMILY,
      body: PRESENTATION_FONT_FAMILY,
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
      heading: PRESENTATION_FONT_FAMILY,
      body: PRESENTATION_FONT_FAMILY,
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
      heading: PRESENTATION_FONT_FAMILY,
      body: PRESENTATION_FONT_FAMILY,
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
      heading: PRESENTATION_FONT_FAMILY,
      body: PRESENTATION_FONT_FAMILY,
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
      heading: PRESENTATION_FONT_FAMILY,
      body: PRESENTATION_FONT_FAMILY,
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
      heading: PRESENTATION_FONT_FAMILY,
      body: PRESENTATION_FONT_FAMILY,
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

export function resolveThemeFromDesignBrief(brief: DesignBrief, fallback: PresentationTheme = PREMIUM_PRESENTATION_THEMES.studydeckEditorial): PresentationTheme {
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
