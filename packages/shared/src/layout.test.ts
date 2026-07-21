import { describe, expect, it } from "vitest";
import {
  auditSlideCanvas,
  buildSlideCanvas,
  hasMeasurableValue,
  metricLead,
  presentationSchema,
  resolvePresentationTheme,
  SLIDE_LAYOUT_DEFINITIONS,
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
    expect(canvas.elements.some((element) => element.id.includes("-source-credit"))).toBe(true);
  });

  it("keeps the full layout and theme matrix inside the slide with real gradient backgrounds", () => {
    const themeTopics = [
      "Трагедия и кризис",
      "Веселый детский праздник",
      "История древнего мира",
      "Программирование и данные",
      "Природа и экология",
      "Neutral topic alpha",
      "Neutral topic beta",
    ];
    const source = presentationSchema.parse(deckWithLayout("evidence")).slides[0];

    for (const topic of themeTopics) {
      const theme = resolvePresentationTheme({ title: topic });
      for (const definition of SLIDE_LAYOUT_DEFINITIONS) {
        const slideKind = definition.id === "hero" ? "title" : definition.id === "summary" ? "summary" : "content";
        const canvas = buildSlideCanvas({
          ...source,
          id: `${theme.preset}-${definition.id}`,
          order: 2,
          slideKind,
          layout: definition.id,
          title: "Очень длинный заголовок для проверки безопасной композиции",
          thesis: "Развернутый тезис содержит достаточно текста, чтобы проверить уменьшение шрифта и отсутствие выхода за пределы слайда.",
          bullets: [
            "Первый развернутый пункт с важным объяснением",
            "Второй развернутый пункт с конкретным примером",
            "Третий развернутый пункт показывает итог",
          ],
        }, theme);

        expect(canvas.backgroundStyle?.type, `${theme.preset}/${definition.id}`).toBe("gradient");
        expect(auditSlideCanvas(canvas), `${theme.preset}/${definition.id}`).toEqual([]);
        expect(canvas.elements.some((element) => element.id.startsWith(`${theme.preset}-${definition.id}-bg`)), `${theme.preset}/${definition.id}`).toBe(false);
        for (const element of canvas.elements) {
          expect(element.x, element.id).toBeGreaterThanOrEqual(0);
          expect(element.y, element.id).toBeGreaterThanOrEqual(0);
          expect(element.x + element.w, element.id).toBeLessThanOrEqual(canvas.width);
          expect(element.y + element.h, element.id).toBeLessThanOrEqual(canvas.height);
          if (element.type === "text" && element.groupId) {
            expect(element.valign, element.id).toBe("middle");
          }
          if (element.type === "text" && !element.id.endsWith("-quote-mark")) {
            const backplate = canvas.elements.find((candidate) => candidate.id === `${element.id}-backplate`);
            const containingShape = canvas.elements.find((candidate) =>
              candidate.type === "shape" &&
              candidate.shape !== "line" &&
              element.x >= candidate.x &&
              element.y >= candidate.y &&
              element.x + element.w <= candidate.x + candidate.w &&
              element.y + element.h <= candidate.y + candidate.h,
            );
            expect(backplate || containingShape, `${element.id} must have a text backplate`).toBeTruthy();
          }
        }
      }
    }
  });

  it("grows mini text plaques and keeps their text inside the rounded rectangle", () => {
    const deck = presentationSchema.parse(deckWithLayout("problem-solution"));
    const slide = {
      ...deck.slides[0],
      slideKind: "title" as const,
      bullets: [
        "Сибирская и русская голубая известны выразительным характером",
        "Длинная подпись должна переноситься без обрезания текста",
        "Плашка растет по высоте вместе с содержимым",
      ],
    };
    const canvas = buildSlideCanvas(slide, resolvePresentationTheme(deck));

    for (let index = 0; index < 3; index += 1) {
      const shape = canvas.elements.find((element) => element.id === `${slide.id}-mini-${index}-shape`);
      const text = canvas.elements.find((element) => element.id === `${slide.id}-mini-${index}`);
      expect(shape).toMatchObject({ type: "shape", shape: "roundRect" });
      expect(text).toMatchObject({ type: "text" });
      if (shape?.type === "shape" && text?.type === "text") {
        expect(shape.h).toBeGreaterThanOrEqual(50);
        expect(text.x).toBeGreaterThanOrEqual(shape.x);
        expect(text.y).toBeGreaterThanOrEqual(shape.y);
        expect(text.x + text.w).toBeLessThanOrEqual(shape.x + shape.w);
        expect(text.y + text.h).toBeLessThanOrEqual(shape.y + shape.h);
      }
    }
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
