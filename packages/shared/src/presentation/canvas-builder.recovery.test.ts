import { describe, expect, it } from "vitest";
import { auditSlideCanvas } from "./canvas-audit.js";
import { buildSlideCanvas, sanitizeRecoverySlideForCanvas } from "./canvas-builder.js";
import { slideSchema } from "./schemas.js";
import { PREMIUM_PRESENTATION_THEMES } from "./themes.js";

function recoverySlide(visual: Record<string, unknown>) {
  return slideSchema.parse({
    id: "solar-system-3",
    order: 3,
    title: "Солнечная система",
    slideKind: "content",
    layout: "process",
    thesis: "Планеты движутся по орбитам, а их свойства зависят от расстояния до Солнца.",
    bullets: ["Орбита определяет повторяемость движения и положение планеты в системе."],
    definition: null,
    keyConcepts: [],
    visual,
    highlights: [],
    placeholders: [],
    blocks: [],
    speakerNotes: "Эта часть объясняет устройство Солнечной системы и связь между орбитой и свойствами планет.",
    timingSeconds: 45,
    sourceRefs: [],
  });
}

describe("recovery canvas safety", () => {
  it("fits long Russian graph details into real card capacity without changing the source slide", () => {
    const detail = "Гравитационное взаимодействие задаёт устойчивое движение планеты по орбите и связывает её положение с наблюдаемыми свойствами в течение длительного периода.";
    const slide = recoverySlide({
      type: "process_diagram",
      title: "",
      description: "",
      leftLabel: "",
      rightLabel: "",
      items: [],
      rows: [],
      graph: {
        layoutDirection: "LR",
        nodes: [
          { id: "sun", label: "Солнце", detail },
          { id: "orbit", label: "Орбита", detail },
          { id: "planet", label: "Планета", detail },
          { id: "observation", label: "Наблюдение", detail },
        ],
        edges: [],
        fallback: "",
        title: "",
      },
    });

    const canvas = buildSlideCanvas(slide, PREMIUM_PRESENTATION_THEMES.studydeckEditorial, { recovery: true });

    expect(auditSlideCanvas(canvas)).toEqual([]);
    expect(slide.visual.graph?.nodes[0]?.detail).toBe(detail);
    expect(canvas.elements.filter((element) => element.type === "text").every((element) => !/…|\.\.\.$/u.test(element.text))).toBe(true);
  });

  it("keeps over-capacity rows and items readable or falls back to a safe text canvas", () => {
    const long = "Каждый пункт содержит законченное объяснение наблюдаемого явления и его значения для понимания темы.";
    const slide = recoverySlide({
      type: "comparison_diagram",
      title: "",
      description: "",
      leftLabel: "",
      rightLabel: "",
      graph: undefined,
      rows: Array.from({ length: 8 }, (_, index) => ({ label: `Пункт ${index + 1}`, left: long, right: long })),
      items: Array.from({ length: 8 }, (_, index) => ({ label: `Идея ${index + 1}`, text: long })),
    });

    const safeSlide = sanitizeRecoverySlideForCanvas(slide);
    const canvas = buildSlideCanvas(slide, PREMIUM_PRESENTATION_THEMES.studydeckEditorial, { recovery: true });

    expect(safeSlide.visual.rows).toHaveLength(3);
    expect(safeSlide.visual.items).toHaveLength(3);
    expect(auditSlideCanvas(canvas)).toEqual([]);
  });
});
