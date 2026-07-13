import { describe, expect, it } from "vitest";
import { parseSpeechDraft, serializeSpeechSections } from "../lib/speech-review";
import { isStaleExport } from "../lib/export-revision";

describe("speech review sections", () => {
  it("parses and serializes a slide-by-slide narration without losing structure", () => {
    const source = "Слайд 1: Введение\nПервый раздел речи.\n\nСлайд 2 — Выводы\nВторой раздел речи.";
    const sections = parseSpeechDraft(source, 2);

    expect(sections).toEqual([
      { order: 1, title: "Введение", text: "Первый раздел речи." },
      { order: 2, title: "Выводы", text: "Второй раздел речи." },
    ]);
    expect(serializeSpeechSections(sections)).toContain("Слайд 2: Выводы");
  });
});

describe("revision-safe exports", () => {
  it("marks a ready export stale when its presentation revision differs", () => {
    expect(isStaleExport({ status: "ready", presentationRevision: 3 }, 4)).toBe(true);
    expect(isStaleExport({ status: "ready", presentationRevision: 4 }, 4)).toBe(false);
  });
});
