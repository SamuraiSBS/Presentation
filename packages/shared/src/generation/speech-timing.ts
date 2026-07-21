/**
 * The single timing contract for newly generated Russian university speeches.
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

type SpeechTimingPreset = Omit<SpeechTimingBudget, "minWords" | "targetWords" | "maxWords" | "wordsPerMinute">;

const rawPresets: readonly SpeechTimingPreset[] = [
  { slideCount: 6, label: "Короткое выступление", minMinutes: 5, targetMinutes: 6, maxMinutes: 7, titleWordTarget: 80, contentWordTarget: 150, conclusionWordTarget: 100 },
  { slideCount: 8, label: "Доклад на паре", minMinutes: 7, targetMinutes: 8, maxMinutes: 9, titleWordTarget: 80, contentWordTarget: 140, conclusionWordTarget: 120 },
  { slideCount: 10, label: "Обычная презентация", minMinutes: 10, targetMinutes: 11, maxMinutes: 12, titleWordTarget: 90, contentWordTarget: 150, conclusionWordTarget: 140 },
  { slideCount: 12, label: "Подробный доклад", minMinutes: 12, targetMinutes: 13.5, maxMinutes: 15, titleWordTarget: 95, contentWordTarget: 150, conclusionWordTarget: 160 },
  // The UI promise is deliberately open-ended: this is a floor, not a hidden maximum.
  { slideCount: 14, label: "Защита проекта", minMinutes: 15, targetMinutes: 15, titleWordTarget: 100, contentWordTarget: 140, conclusionWordTarget: 170 },
];

function wordsForMinutes(minutes: number) {
  return minutes * RUSSIAN_STUDENT_SPEECH_WORDS_PER_MINUTE;
}

function toBudget(preset: SpeechTimingPreset): SpeechTimingBudget {
  return {
    ...preset,
    wordsPerMinute: RUSSIAN_STUDENT_SPEECH_WORDS_PER_MINUTE,
    minWords: wordsForMinutes(preset.minMinutes),
    targetWords: wordsForMinutes(preset.targetMinutes),
    ...(preset.maxMinutes === undefined ? {} : { maxWords: wordsForMinutes(preset.maxMinutes) }),
  };
}

/** UI options and generation budgets deliberately come from the same presets. */
export const RUSSIAN_STUDENT_SPEECH_TIMING_PRESETS = rawPresets.map(toBudget) as readonly SpeechTimingBudget[];

export function getRussianStudentSpeechTimingBudget(project: SpeechTimingProject): SpeechTimingBudget | null {
  const mode = String(project.mode || "").toLowerCase();
  const level = String(project.level || "").toLowerCase();
  // Timing is actionable only for a newly authored university-student deck.
  if (/(?:legacy|display|export|import|defense)/.test(mode) || !level.includes("university")) return null;
  return RUSSIAN_STUDENT_SPEECH_TIMING_PRESETS.find((preset) => preset.slideCount === project.slideCount) || null;
}

export function russianSpeechMinutesFromWords(words: number, wordsPerMinute = RUSSIAN_STUDENT_SPEECH_WORDS_PER_MINUTE) {
  return words / wordsPerMinute;
}
