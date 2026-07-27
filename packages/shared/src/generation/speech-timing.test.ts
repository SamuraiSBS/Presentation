import { describe, expect, it } from "vitest";
import { getFloorAwareSpeechTimingSectionBounds, getRussianStudentSpeechSectionBounds, getRussianStudentSpeechTimingBudget, RUSSIAN_STUDENT_SPEECH_WORDS_PER_MINUTE } from "./speech-timing.js";
import { assessFullSpeechContract } from "./narration-contract.js";

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
    [10, "Обычная презентация", 9, 10, 12, 1170, 1300, 1560],
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

  it("allocates the ten-slide target across title, content, and conclusion", () => {
    expect(getRussianStudentSpeechTimingBudget(project(10))).toMatchObject({
      titleWordTarget: 80,
      contentWordTarget: 140,
      conclusionWordTarget: 100,
    });
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
describe("Russian student speech section bounds", () => {
  const project = { slideCount: 10, level: "university_student", scenario: "report", mode: "create" };

  it("uses shared inclusive 30 percent bounds without changing the full-document gate", () => {
    expect(getRussianStudentSpeechSectionBounds(project, 1)).toEqual({ targetWords: 80, minWords: 56, maxWords: 104 });
    expect(getRussianStudentSpeechSectionBounds(project, 2)).toEqual({ targetWords: 140, minWords: 98, maxWords: 182 });
    expect(getRussianStudentSpeechSectionBounds(project, 10)).toEqual({ targetWords: 100, minWords: 70, maxWords: 130 });
    expect(getRussianStudentSpeechTimingBudget(project)).toMatchObject({ minWords: 1170, maxWords: 1560, targetWords: 1300 });
  });

  it("raises independent section floors from the shared whole-speech budget", () => {
    const budget = getRussianStudentSpeechTimingBudget(project)!;
    expect(getFloorAwareSpeechTimingSectionBounds(budget, 1)).toEqual({ targetWords: 80, minWords: 72, maxWords: 104 });
    expect(getFloorAwareSpeechTimingSectionBounds(budget, 2)).toEqual({ targetWords: 140, minWords: 126, maxWords: 182 });
    expect(getFloorAwareSpeechTimingSectionBounds(budget, 10)).toEqual({ targetWords: 100, minWords: 90, maxWords: 130 });
    expect(Array.from({ length: 10 }, (_, index) => getFloorAwareSpeechTimingSectionBounds(budget, index + 1)!.minWords).reduce((sum, words) => sum + words, 0)).toBe(1170);
    expect(budget).toMatchObject({ minWords: 1170, targetWords: 1300, maxWords: 1560 });
  });
});

describe("full ten-slide speech contract", () => {
  const fullSpeech = (wordsPerSection: number) => Array.from({ length: 10 }, (_, index) => {
    const words = Array.from({ length: wordsPerSection }, (_, word) => `fact${index + 1}_${word + 1}`);
    const split = Math.floor(words.length / 2);
    return `Слайд ${index + 1}: Тема ${index + 1}\n${words.slice(0, split).join(" ")}. ${words.slice(split).join(" ")}.`;
  }).join("\n\n");

  it("uses the canonical ten-section timing and quality gate for manual acceptance", () => {
    const contractProject = project(10);
    expect(assessFullSpeechContract(fullSpeech(117), contractProject)).toMatchObject({ applicable: true, isAccepted: true, totalWords: 1170, issueCodes: [] });
    expect(assessFullSpeechContract(fullSpeech(110), contractProject)).toMatchObject({ applicable: true, isAccepted: false, totalWords: 1100, issueCodes: ["whole_speech_below_minimum"] });
  });

  it("rejects a severe repeated sentence without exposing its diagnostics to the caller", () => {
    const repeated = Array.from({ length: 10 }, (_, index) => {
      const uniqueWords = Array.from({ length: 110 }, (_, word) => `detail${index + 1}_${word + 1}`);
      return `Слайд ${index + 1}: Тема ${index + 1}\nПовторяемая фраза содержит достаточно слов для проверки качества. ${uniqueWords.join(" ")}.`;
    }).join("\n\n");
    expect(assessFullSpeechContract(repeated, project(10))).toMatchObject({ applicable: true, isAccepted: false, issueCodes: expect.arrayContaining(["template_or_repetition"]) });
  });

  it("does not apply the v6 ten-slide contract to historical shapes", () => {
    expect(assessFullSpeechContract("Слайд 1: Кратко\nТекст.", project(6))).toMatchObject({ applicable: false, isAccepted: true });
  });
});
