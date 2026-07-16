import { describe, expect, it } from "vitest";
import type { CanvasElement, CanvasShapeElement, Slide, SlideCanvas } from "@studydeck/shared";
import {
  CUSTOM_CANVAS_MARKER_SUFFIX,
  blocksFromSlideText,
  clamp,
  cloneCanvas,
  markCanvasAsCustom,
  nextZIndex,
  titleFromCanvas,
} from "./editor-geometry";

const shape: CanvasShapeElement = {
  id: "shape-1",
  type: "shape",
  shape: "rect",
  x: 0,
  y: 0,
  w: 120,
  h: 80,
  rotation: 0,
  zIndex: 4,
  opacity: 1,
  locked: false,
  fill: "#fff",
  stroke: "#000",
  strokeWidth: 1,
};

function canvas(elements: CanvasElement[] = [shape]): SlideCanvas {
  return { width: 1280, height: 720, background: "#fff", elements };
}

function slide(overrides: Partial<Slide> = {}): Slide {
  return {
    id: "slide-1",
    order: 1,
    title: "Исходный заголовок",
    thesis: "Тезис",
    bullets: [],
    speakerNotes: "",
    layout: "title-and-body",
    blocks: [],
    ...overrides,
  } as Slide;
}

describe("editor geometry invariants", () => {
  it("clamps non-finite and out-of-range coordinates", () => {
    expect(clamp(Number.NaN, 2, 8)).toBe(2);
    expect(clamp(-3, 2, 8)).toBe(2);
    expect(clamp(11, 2, 8)).toBe(8);
    expect(clamp(5, 2, 8)).toBe(5);
  });

  it("creates independent history snapshots and advances z-index", () => {
    const original = canvas();
    const snapshot = cloneCanvas(original);
    snapshot.elements[0].x = 99;

    expect(original.elements[0].x).toBe(0);
    expect(nextZIndex(original)).toBe(5);
  });

  it("adds the custom-canvas marker exactly once", () => {
    const marked = markCanvasAsCustom("slide-1", canvas());
    const marker = marked.elements.find((element) =>
      element.id.endsWith(CUSTOM_CANVAS_MARKER_SUFFIX),
    );

    expect(marker).toMatchObject({ opacity: 0, locked: true, zIndex: -1 });
    expect(markCanvasAsCustom("slide-1", marked)).toBe(marked);
  });

  it("keeps title and text blocks synchronized with the editing contract", () => {
    const withTitle = canvas([
      {
        ...shape,
        id: "title",
        type: "text",
        role: "title",
        text: "  Новый заголовок  ",
        runs: [{ text: "  Новый заголовок  " }],
        fontSize: 42,
        fontFamily: "Nunito",
        color: "#111",
        bold: true,
        italic: false,
        underline: false,
        align: "left",
        valign: "top",
      },
    ]);

    expect(titleFromCanvas(slide(), withTitle)).toBe("Новый заголовок");
    expect(blocksFromSlideText(slide({ bullets: [" Первый ", "", "Второй"] }))).toEqual([
      { type: "bullets", items: ["Первый", "Второй"] },
    ]);
    expect(blocksFromSlideText(slide({ bullets: [], thesis: "  Короткий тезис " }))).toEqual([
      { type: "callout", content: "Короткий тезис" },
    ]);
  });
});
