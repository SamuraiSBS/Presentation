import { describe, expect, it } from "vitest";
import { COST_ENVELOPE_LIMIT_RUB, ensureEditableCanvas, presentationSchema } from "@studydeck/shared";
import { evaluateEconomicReleaseGate } from "./economic-release-gate.js";

const sources = [1, 2, 3].map((index) => ({ id: `source-${index}`, label: `Источник ${index}`, type: "WEB", size: 0, url: `https://example.edu/${index}`, excerpt: `Источник ${index} подтверждает учебный тезис.` }));
const narration = Array.from({ length: 10 }, (_, index) => `Слайд ${index + 1}: Тема ${index + 1}\n${Array.from({ length: 130 }, () => "обоснованный").join(" ")}`).join("\n\n");

function document() {
  const slides = Array.from({ length: 10 }, (_, index) => ({
    id: `slide-${index + 1}`,
    order: index + 1,
    title: `Тема ${index + 1}`,
    slideKind: index === 0 ? "title" : index === 9 ? "summary" : "content",
    layout: index === 0 ? "hero" : index === 9 ? "summary" : "bullets",
    thesis: `Тезис ${index + 1} объясняет тему без неподтверждённых чисел.`,
    bullets: ["Первый связанный аргумент.", "Второй связанный аргумент."], definition: null, keyConcepts: [],
    visual: { type: "process_diagram", title: "", description: `Схема по теме ${index + 1}`, leftLabel: "", rightLabel: "", items: [{ label: "Шаг", text: "Связанный элемент" }], rows: [] },
    highlights: [], blocks: [], speakerNotes: Array.from({ length: 130 }, () => "обоснованный").join(" "), timingSeconds: 60,
    sourceRefs: [{ sourceId: sources[index % 3].id, label: sources[index % 3].label, excerpt: sources[index % 3].excerpt, page: null }],
  }));
  return ensureEditableCanvas(presentationSchema.parse({
    id: "economic-release", title: "Экономный запуск", scenario: "university_report", level: "university_student", slideCount: 10,
    generationMode: "yandex", generatedText: narration, sources, outline: slides.map((slide) => slide.title),
    narrativePlan: slides.map((slide) => ({ slideOrder: slide.order, slideTitle: slide.title, slidePurpose: "Объяснить тезис.", keyMessage: slide.thesis, audienceQuestion: "Что важно понять?", transitionToNext: "Далее." })),
    speechScript: slides.map((slide) => ({ slideOrder: slide.order, slideTitle: slide.title, text: slide.speakerNotes })), slides,
  }));
}

const project = { id: "project-1", title: "Экономный запуск", prompt: "Тема", scenario: "university_report", level: "university_student", mode: "with_sources", slideCount: 10, mandatorySourceSnapshot: true };
const envelope = { limitRub: "10", reservedRub: "0", settledRub: "9", status: "active", sourceSnapshot: { version: 1, capturedAt: "2026-07-24T00:00:00.000Z", provenance: { provider: "tavily", queryAt: "2026-07-24T00:00:00.000Z" }, sources: sources.map((source) => ({ sourceId: source.id, title: source.label, url: source.url, evidenceExcerpt: source.excerpt })) }, reservations: [{ status: "settled" as const, reason: null }], imageSearchQueries: 2 };

describe("economic release gate", () => {
  it("releases a complete ten-slide bounded economic run", () => {
    expect(evaluateEconomicReleaseGate({ presentation: document(), sources, project, envelope })).toEqual({ passed: true, categories: [] });
  });

  it("releases a bounded run at the requested six-slide plan size", () => {
    const full = document();
    const sixSlidePresentation = { ...full, slideCount: 6, slides: full.slides.slice(0, 6), speechScript: full.speechScript.slice(0, 6) };
    expect(evaluateEconomicReleaseGate({
      presentation: sixSlidePresentation,
      sources,
      project: { ...project, slideCount: 6 },
      envelope,
    })).toEqual({ passed: true, categories: [] });
  });

  it("releases a v10 envelope when settled plus reserved spend remains within its persisted cap", () => {
    expect(evaluateEconomicReleaseGate({
      presentation: document(),
      sources,
      project,
      envelope: { ...envelope, limitRub: COST_ENVELOPE_LIMIT_RUB, settledRub: "11.78768000" },
    })).toEqual({ passed: true, categories: [] });
  });

  it("still rejects actual cost-envelope overruns", () => {
    const result = evaluateEconomicReleaseGate({
      presentation: document(),
      sources,
      project,
      envelope: { ...envelope, limitRub: COST_ENVELOPE_LIMIT_RUB, reservedRub: "16", settledRub: "12" },
    });
    expect(result).toEqual(expect.objectContaining({ passed: false, categories: expect.arrayContaining(["cost_envelope"]) }));
  });

  it("rejects unresolved spending and visual overruns before persistence", () => {
    const result = evaluateEconomicReleaseGate({ presentation: document(), sources, project, envelope: { ...envelope, reservations: [{ status: "reserved", reason: null }], imageSearchQueries: 3 } });
    expect(result).toEqual(expect.objectContaining({ passed: false, categories: expect.arrayContaining(["paid_stage_unresolved", "visual_cap"]) }));
  });

  it("releases accepted-artifact local recovery after a cap-blocked envelope", () => {
    expect(evaluateEconomicReleaseGate({
      presentation: document(),
      sources,
      project: { ...project, acceptedNarrationRecovery: true },
      envelope: { ...envelope, status: "exhausted" },
    })).toEqual({ passed: true, categories: [] });
  });
});
