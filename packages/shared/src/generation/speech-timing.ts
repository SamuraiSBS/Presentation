/**
 * The single timing contract for newly generated Russian study speeches.
 * 130 words/minute leaves room for pauses and slide changes. Word boundaries
 * are inclusive: a narration at minWords or maxWords is valid.
 */
export const RUSSIAN_STUDENT_SPEECH_WORDS_PER_MINUTE = 130;

export type SpeechTimingProject = {
  slideCount: number;
  level?: string;
  scenario?: string;
  mode?: string;
};

export type SpeechTimingBudget = {
  slideCount: 6 | 8 | 10 | 12 | 14;
  label: string;
  wordsPerMinute: number;
  minMinutes: number;
  targetMinutes: number;
  maxMinutes?: number;
  minWords: number;
  targetWords: number;
  maxWords?: number;
  titleWordTarget: number;
  contentWordTarget: number;
  conclusionWordTarget: number;
};
export type SpeechTimingSectionBounds = { targetWords: number; minWords: number; maxWords: number };

type SpeechTimingPreset = Omit<SpeechTimingBudget, "minWords" | "targetWords" | "maxWords" | "wordsPerMinute">;

/** The spoken script stays concise even when the deck has more slides. */
export const RUSSIAN_STUDENT_SPEECH_WORD_RANGE = {
  minWords: 600,
  targetWords: 700,
  maxWords: 800,
} as const;

const rawPresets: readonly SpeechTimingPreset[] = [
  { slideCount: 6, label: "Короткое выступление", minMinutes: 4.6, targetMinutes: 5.4, maxMinutes: 6.2, titleWordTarget: 80, contentWordTarget: 130, conclusionWordTarget: 100 },
  { slideCount: 8, label: "Доклад на паре", minMinutes: 4.6, targetMinutes: 5.4, maxMinutes: 6.2, titleWordTarget: 70, contentWordTarget: 90, conclusionWordTarget: 90 },
  { slideCount: 10, label: "Обычная презентация", minMinutes: 4.6, targetMinutes: 5.4, maxMinutes: 6.2, titleWordTarget: 60, contentWordTarget: 70, conclusionWordTarget: 80 },
  { slideCount: 12, label: "Подробный доклад", minMinutes: 4.6, targetMinutes: 5.4, maxMinutes: 6.2, titleWordTarget: 55, contentWordTarget: 58, conclusionWordTarget: 65 },
  { slideCount: 14, label: "Защита проекта", minMinutes: 4.6, targetMinutes: 5.4, maxMinutes: 6.2, titleWordTarget: 50, contentWordTarget: 50, conclusionWordTarget: 50 },
];

function toBudget(preset: SpeechTimingPreset): SpeechTimingBudget {
  return {
    ...preset,
    wordsPerMinute: RUSSIAN_STUDENT_SPEECH_WORDS_PER_MINUTE,
    ...RUSSIAN_STUDENT_SPEECH_WORD_RANGE,
  };
}

/** UI options and generation budgets deliberately come from the same presets. */
export const RUSSIAN_STUDENT_SPEECH_TIMING_PRESETS = rawPresets.map(toBudget) as readonly SpeechTimingBudget[];

export function getRussianStudentSpeechTimingBudget(project: SpeechTimingProject): SpeechTimingBudget | null {
  const mode = String(project.mode || "").toLowerCase();
  const level = String(project.level || "").toLowerCase();
  // Timing is actionable only for newly authored standard study decks. Keep
  // legacy and special workflows on their existing contracts.
  if (/(?:legacy|display|export|import|defense)/.test(mode) || !(level.includes("university") || level === "general")) return null;
  return RUSSIAN_STUDENT_SPEECH_TIMING_PRESETS.find((preset) => preset.slideCount === project.slideCount) || null;
}

export function russianSpeechMinutesFromWords(words: number, wordsPerMinute = RUSSIAN_STUDENT_SPEECH_WORDS_PER_MINUTE) {
  return words / wordsPerMinute;
}

/** Inclusive local tolerance for independently generated narration sections. */
export function getRussianStudentSpeechSectionBounds(project: SpeechTimingProject, slideOrder: number): SpeechTimingSectionBounds | null {
  const budget = getRussianStudentSpeechTimingBudget(project);
  if (!budget || !Number.isInteger(slideOrder) || slideOrder < 1 || slideOrder > project.slideCount) return null;
  const targetWords = slideOrder === 1 ? budget.titleWordTarget : slideOrder === project.slideCount ? budget.conclusionWordTarget : budget.contentWordTarget;
  return { targetWords, minWords: Math.floor(targetWords * 0.7), maxWords: Math.ceil(targetWords * 1.3) };
}

/**
 * Acceptance bounds for independently generated sections. The raised floor
 * ensures that a sequence accepted section-by-section can still satisfy the
 * timing budget's whole-speech minimum.
 */
export function getFloorAwareSpeechTimingSectionBounds(budget: SpeechTimingBudget, slideOrder: number): SpeechTimingSectionBounds | null {
  if (!Number.isInteger(slideOrder) || slideOrder < 1 || slideOrder > budget.slideCount) return null;
  const targetWords = slideOrder === 1 ? budget.titleWordTarget : slideOrder === budget.slideCount ? budget.conclusionWordTarget : budget.contentWordTarget;
  const toleranceMin = Math.floor(targetWords * 0.7);
  return {
    targetWords,
    minWords: Math.max(toleranceMin, Math.ceil(targetWords * budget.minWords / budget.targetWords)),
    maxWords: Math.ceil(targetWords * 1.3),
  };
}
