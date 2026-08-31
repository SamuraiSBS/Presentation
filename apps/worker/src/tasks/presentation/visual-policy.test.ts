import { describe, expect, it } from "vitest";
import type { Slide } from "@studydeck/shared";
import { hasSubstantiveVisual, isManagedSlideCount, visualQuotaForSlideCount } from "./visual-policy.js";

const baseSlide = (visual: Partial<Slide["visual"]>): Slide => ({
  id: "slide-1",
  order: 1,
  title: "A useful title",
  slideKind: "content",
  layout: "process",
  thesis: "A useful thesis",
  bullets: ["First point", "Second point"],
  definition: null,
  keyConcepts: [],
  visual: { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [], ...visual },
  highlights: [],
  blocks: [],
  placeholders: [],
  speakerNotes: "A spoken explanation.",
  timingSeconds: 40,
  sourceRefs: [],
});

describe("visual policy", () => {
  it("exposes the managed quota matrix", () => {
    expect([6, 8, 10, 12, 14].map((count) => visualQuotaForSlideCount(count))).toEqual([
      { photos: 3, diagrams: 2, text: 1 },
      { photos: 4, diagrams: 2, text: 2 },
      { photos: 5, diagrams: 3, text: 2 },
      { photos: 6, diagrams: 4, text: 2 },
      { photos: 7, diagrams: 5, text: 2 },
    ]);
    expect(isManagedSlideCount(10)).toBe(true);
    expect(isManagedSlideCount(9)).toBe(false);
    expect(visualQuotaForSlideCount(9)).toBeUndefined();
  });

  it("does not treat a bare process_diagram type as a fulfilled visual", () => {
    expect(hasSubstantiveVisual(baseSlide({ type: "process_diagram" }))).toBe(false);
    expect(hasSubstantiveVisual(baseSlide({ type: "process_diagram", items: [{ label: "One", text: "First point" }, { label: "Two", text: "Second point" }] }))).toBe(true);
  });

  it("requires structure for graph and Mermaid payloads", () => {
    expect(hasSubstantiveVisual(baseSlide({ type: "schema", graph: { layoutDirection: "LR", title: "", fallback: "", nodes: [{ id: "a", label: "A", detail: "" }, { id: "b", label: "B", detail: "" }], edges: [] } }))).toBe(false);
    expect(hasSubstantiveVisual(baseSlide({ type: "schema", graph: { layoutDirection: "LR", title: "", fallback: "", nodes: [{ id: "a", label: "A", detail: "" }, { id: "b", label: "B", detail: "" }], edges: [{ source: "a", target: "b", label: "" }] } }))).toBe(true);
    expect(hasSubstantiveVisual(baseSlide({ type: "process_diagram", diagram: { kind: "flowchart", source: "flowchart LR\n A[Start] --> B[Finish]", fallback: "", title: "", caption: "", safety: "safe" } }))).toBe(true);
  });
});
