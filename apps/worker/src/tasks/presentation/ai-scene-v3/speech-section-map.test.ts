import { describe, expect, it } from "vitest";
import { mapAiSceneV3SpeechSections } from "./speech-section-map.js";

describe("AI Scene v3 strict speech map", () => {
  const slides = [
    { id: "s1", order: 1, title: "Солнечная система", speakerNotes: "Введение в строение Солнечной системы." },
    { id: "s2", order: 2, title: "Планеты", speakerNotes: "Планеты движутся вокруг Солнца по орбитам и отличаются размерами." },
  ];

  it("keeps every approved section in its original slide order", () => {
    const sections = mapAiSceneV3SpeechSections({ slides, speechScript: [
      { slideOrder: 1, slideTitle: "Солнечная система", text: "Введение в строение Солнечной системы." },
      { slideOrder: 2, slideTitle: "Планеты", text: "Планеты движутся вокруг Солнца по орбитам и отличаются размерами." },
    ] });
    expect(sections.map((section) => section.kind)).toEqual(["cover", "content"]);
    expect(sections[1]?.text).toContain("орбитам");
  });

  it("rejects moved or altered speech instead of repairing it", () => {
    expect(() => mapAiSceneV3SpeechSections({ slides, speechScript: [
      { slideOrder: 1, slideTitle: "Солнечная система", text: "Введение в строение Солнечной системы." },
      { slideOrder: 2, slideTitle: "Планеты", text: "Другой текст." },
    ] })).toThrow("ai_scene_v3_speech_section_content_mismatch:2");
  });

  it("keeps a selected real content slide as content even in a one-slide probe", () => {
    const sections = mapAiSceneV3SpeechSections({ slides: [slides[1]!], speechScript: [{ slideOrder: 2, slideTitle: "Планеты", text: "Планеты движутся вокруг Солнца по орбитам и отличаются размерами." }] });
    expect(sections[0]?.kind).toBe("content");
  });
});
