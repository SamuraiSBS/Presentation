import { describe, expect, it } from "vitest";
import { assessFullSpeechContract } from "./narration-contract.js";
import {
  getFloorAwareSpeechTimingSectionBounds,
  getRussianStudentSpeechSectionBounds,
  getRussianStudentSpeechTimingBudget,
  RUSSIAN_STUDENT_SPEECH_WORD_RANGE,
  RUSSIAN_STUDENT_SPEECH_WORDS_PER_MINUTE,
} from "./speech-timing.js";

const project = (slideCount: number, overrides: Record<string, string> = {}) => ({
  slideCount,
  level: "university_student",
  mode: "with_sources",
  ...overrides,
});

function distributedWords(slideCount: number, totalWords: number) {
  const base = Math.floor(totalWords / slideCount);
  return Array.from({ length: slideCount }, (_, index) => base + (index < totalWords % slideCount ? 1 : 0));
}

function fullSpeech(wordsBySlide: readonly number[]) {
  return wordsBySlide.map((count, index) => {
    const words = Array.from({ length: count }, (_, word) => `fact${index + 1}_${word + 1}`);
    const split = Math.floor(words.length / 2);
    return `Слайд ${index + 1}: Тема ${index + 1}\n${words.slice(0, split).join(" ")}. ${words.slice(split).join(" ")}.`;
  }).join("\n\n");
}

describe("Russian student speech timing", () => {
  it.each([
    [6, 80, 130, 100],
    [8, 70, 90, 90],
    [10, 60, 70, 80],
    [12, 55, 58, 65],
    [14, 50, 50, 50],
  ])("uses the 600-800 word contract for %i slides", (slideCount, titleWordTarget, contentWordTarget, conclusionWordTarget) => {
    const budget = getRussianStudentSpeechTimingBudget(project(slideCount));
    expect(budget).toMatchObject({
      minWords: 600,
      targetWords: 700,
      maxWords: 800,
      wordsPerMinute: RUSSIAN_STUDENT_SPEECH_WORDS_PER_MINUTE,
      titleWordTarget,
      contentWordTarget,
      conclusionWordTarget,
    });
    expect(titleWordTarget + contentWordTarget * (slideCount - 2) + conclusionWordTarget).toBe(700);
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
  it("scales the per-section guidance while preserving the shared whole-speech range", () => {
    const budget = getRussianStudentSpeechTimingBudget(project(12))!;
    expect(getRussianStudentSpeechSectionBounds(project(12), 1)).toEqual({ targetWords: 55, minWords: 38, maxWords: 72 });
    expect(getRussianStudentSpeechSectionBounds(project(12), 12)).toEqual({ targetWords: 65, minWords: 45, maxWords: 85 });
    expect(getFloorAwareSpeechTimingSectionBounds(budget, 1)).toEqual({ targetWords: 55, minWords: 48, maxWords: 72 });
    expect(getFloorAwareSpeechTimingSectionBounds(budget, 12)).toEqual({ targetWords: 65, minWords: 56, maxWords: 85 });
    expect(budget).toMatchObject(RUSSIAN_STUDENT_SPEECH_WORD_RANGE);
  });
});

describe("full speech contract", () => {
  it.each([6, 8, 10, 12])("accepts exactly %i canonical sections inside the common 600-800-word range", (slideCount) => {
    const assessment = assessFullSpeechContract(fullSpeech(distributedWords(slideCount, 700)), project(slideCount));
    expect(assessment).toMatchObject({ applicable: true, isAccepted: true, totalWords: 700, issueCodes: [] });
  });

  it("rejects a 12-slide speech below the common floor", () => {
    const assessment = assessFullSpeechContract(fullSpeech(distributedWords(12, 599)), project(12));
    expect(assessment).toMatchObject({ applicable: true, isAccepted: false, totalWords: 599, issueCodes: ["whole_speech_below_minimum"] });
  });

  it("keeps non-preset historical shapes outside the new contract", () => {
    expect(assessFullSpeechContract("Слайд 1: Кратко\nТекст.", project(7))).toMatchObject({ applicable: false, isAccepted: true });
  });
});
