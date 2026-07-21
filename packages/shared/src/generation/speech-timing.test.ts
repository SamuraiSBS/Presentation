import { describe, expect, it } from "vitest";
import { getRussianStudentSpeechTimingBudget, RUSSIAN_STUDENT_SPEECH_WORDS_PER_MINUTE } from "./speech-timing.js";

const project = (slideCount: number, overrides: Record<string, string> = {}) => ({
  slideCount,
  level: "university_student",
  mode: "with_sources",
  ...overrides,
});

describe("Russian student speech timing", () => {
  it.each([
    [6, "Короткое выступление", 5, 6, 7, 650, 780, 910],
    [8, "Доклад на паре", 7, 8, 9, 910, 1040, 1170],
    [10, "Обычная презентация", 10, 11, 12, 1300, 1430, 1560],
    [12, "Подробный доклад", 12, 13.5, 15, 1560, 1755, 1950],
  ])("maps %i slides to its visible timing contract", (slideCount, label, minMinutes, targetMinutes, maxMinutes, minWords, targetWords, maxWords) => {
    expect(getRussianStudentSpeechTimingBudget(project(slideCount))).toMatchObject({ label, minMinutes, targetMinutes, maxMinutes, minWords, targetWords, maxWords, wordsPerMinute: RUSSIAN_STUDENT_SPEECH_WORDS_PER_MINUTE });
  });

  it("keeps fourteen slides open-ended after the fifteen-minute floor", () => {
    const budget = getRussianStudentSpeechTimingBudget(project(14));
    expect(budget).toMatchObject({ minMinutes: 15, targetMinutes: 15, minWords: 1950, targetWords: 1950 });
    expect(budget?.maxMinutes).toBeUndefined();
    expect(budget?.maxWords).toBeUndefined();
  });

  it.each([4, 7, 9, 11, 13, 20])("does not invent a preset for %i slides", (slideCount) => {
    expect(getRussianStudentSpeechTimingBudget(project(slideCount))).toBeNull();
  });

  it("excludes legacy, imported/exported, defense, and non-university documents", () => {
    expect(getRussianStudentSpeechTimingBudget(project(10, { mode: "export" }))).toBeNull();
    expect(getRussianStudentSpeechTimingBudget(project(10, { mode: "import" }))).toBeNull();
    expect(getRussianStudentSpeechTimingBudget(project(10, { mode: "defense" }))).toBeNull();
    expect(getRussianStudentSpeechTimingBudget(project(10, { level: "school" }))).toBeNull();
  });
});
