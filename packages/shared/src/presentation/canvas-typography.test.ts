import { describe, expect, it } from "vitest";
import { auditSlideCanvas } from "./canvas-audit.js";
import { compactCanvasTextToFit, minimumReadableFontSize } from "./canvas-helpers.js";

const body = {
  id: "body-1",
  type: "text" as const,
  role: "body" as const,
  x: 80,
  y: 120,
  w: 520,
  h: 108,
  rotation: 0,
  zIndex: 2,
  opacity: 1,
  locked: false,
  text: "Короткое пояснение.",
  runs: [],
  fontSize: 27,
  fontFamily: "Arial",
  color: "#161A1F",
  bold: false,
  italic: false,
  underline: false,
  align: "left" as const,
  valign: "top" as const,
};

describe("generated canvas typography", () => {
  it("keeps the complete body text for upstream reflow instead of creating an ellipsis", () => {
    const longText = "Длинносоставноеэлектромеханическоеиспытание показывает, почему три подробных русских пункта нужно сократить до ясного вывода для аудитории. Второй пункт добавляет контекст, который лучше оставить в речи докладчика. Третий пункт повторяет объяснение и не должен уменьшать шрифт до нечитаемого размера.";
    const compact = compactCanvasTextToFit(longText, 27, 280, 62);

    expect(minimumReadableFontSize(body)).toBe(27);
    expect(compact).toBe(longText);
  });

  it("flags a narrow comparison column and an unsafe decorative rule over text", () => {
    const canvas = {
      version: 2,
      width: 1280,
      height: 720,
      background: "#F7F8FA",
      elements: [
        { ...body, id: "comparison-left", w: 160 },
        {
          id: "comparison-rule", type: "shape" as const, shape: "line" as const,
          x: 90, y: 158, w: 420, h: 3, rotation: 0, zIndex: 1, opacity: 1, locked: false,
          fill: "#315D9B", stroke: "#315D9B", strokeWidth: 1,
        },
      ],
    };

    const issues = auditSlideCanvas(canvas);
    expect(issues).toContainEqual(expect.stringContaining("comparison-left uses a 160px text column"));
    expect(issues).toContainEqual(expect.stringContaining("comparison-rule overlaps comparison-left"));
  });

  it("allows source credits and slide numbers below the body minimum", () => {
    expect(minimumReadableFontSize({ ...body, id: "slide-1-source-0", role: "caption", text: "Источник" })).toBe(14);
    expect(minimumReadableFontSize({ ...body, id: "slide-number", role: "caption", text: "1" })).toBe(16);
  });

  it("keeps an explicit source credit inside the canvas bounds without applying body-text limits", () => {
    const sourceCredit = {
      ...body,
      id: "slide-1-source-credit",
      role: "caption" as const,
      typographyRole: "sourceCredit" as const,
      text: "Sources: [1] Archive · Photo: collection",
      x: 72,
      y: 684,
      w: 1136,
      h: 20,
      fontSize: 14,
    };
    const issues = auditSlideCanvas({ version: 2, width: 1280, height: 720, background: "#F7F8FA", elements: [sourceCredit] });

    expect(issues).toEqual([]);
  });
});
