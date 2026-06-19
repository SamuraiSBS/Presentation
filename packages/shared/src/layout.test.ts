import { describe, expect, it } from "vitest";
import {
  buildSlideCanvas,
  hasMeasurableValue,
  metricLead,
  presentationSchema,
  resolvePresentationTheme,
  slideLayoutSchema,
} from "./index.js";

describe("slide layouts", () => {
  it.each(["evidence", "problem-solution", "explain-example"] as const)("accepts %s in the presentation schema", (layout) => {
    expect(slideLayoutSchema.parse(layout)).toBe(layout);
    expect(() => presentationSchema.parse(deckWithLayout(layout))).not.toThrow();
  });

  it("builds a new canvas when the editor changes the layout", () => {
    const deck = presentationSchema.parse(deckWithLayout("evidence"));
    const canvas = buildSlideCanvas(deck.slides[0], resolvePresentationTheme(deck));

    expect(canvas.elements.some((element) => element.id.includes("-evidence-thesis"))).toBe(true);
    expect(canvas.elements.some((element) => element.id.includes("-source-0"))).toBe(true);
  });
});

describe("measurable values", () => {
  it("recognizes real quantities without treating list order as a metric", () => {
    expect(hasMeasurableValue("Доля выросла до 37%")).toBe(true);
    expect(hasMeasurableValue("Событие произошло в 1917 году")).toBe(true);
    expect(hasMeasurableValue("Первый шаг - собрать материал")).toBe(false);
    expect(metricLead("Доля выросла до 37%")).toBe("37%");
    expect(metricLead("Первый шаг - собрать материал")).toBe("");
  });
});

function deckWithLayout(layout: "evidence" | "problem-solution" | "explain-example") {
  return {
    id: "deck-1",
    title: "Учебная презентация",
    scenario: "lesson",
    level: "beginner",
    slideCount: 1,
    generationMode: "demo",
    generatedText: "Слайд 1: Учебная презентация\nМатериал объясняет тему.",
    sources: [{ id: "src-1", label: "Учебник", type: "PDF", excerpt: "Короткое подтверждение тезиса." }],
    outline: ["Учебная презентация"],
    narrativePlan: [],
    speechScript: [{ slideOrder: 1, slideTitle: "Учебная презентация", text: "Материал объясняет тему." }],
    slides: [{
      id: "slide-1",
      order: 1,
      title: "Почему это важно",
      slideKind: "content",
      layout,
      thesis: "Главный тезис подтверждается фактами и понятным примером.",
      bullets: ["Первый подтверждающий факт", "Конкретный учебный пример", "Важная оговорка"],
      definition: { term: "Понятие", text: "Простое объяснение понятия." },
      keyConcepts: [],
      visual: {
        type: "process_diagram",
        title: "",
        description: "",
        leftLabel: "",
        rightLabel: "",
        items: [
          { label: "Проблема", text: "" },
          { label: "Причина", text: "" },
          { label: "Решение", text: "" },
        ],
        rows: [],
      },
      highlights: [],
      blocks: [{ type: "bullets", items: ["Первый подтверждающий факт", "Конкретный учебный пример", "Важная оговорка"] }],
      speakerNotes: "Материал объясняет тему.",
      timingSeconds: 45,
      sourceRefs: [{ sourceId: "src-1", label: "Учебник", excerpt: "Короткое подтверждение тезиса.", page: "с. 12" }],
    }],
  };
}
