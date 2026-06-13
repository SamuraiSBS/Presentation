import { describe, expect, it } from "vitest";
import { sanitizePresentationForDisplay } from "./presentation-display";

describe("sanitizePresentationForDisplay", () => {
  it("derives structured fields for legacy slides", () => {
    const document = sanitizePresentationForDisplay({
      id: "presentation-1",
      title: "Legacy deck",
      scenario: "lesson",
      level: "beginner",
      slideCount: 2,
      generationMode: "demo",
      sources: [],
      outline: ["Legacy title", "Legacy summary"],
      speechScript: [{ slideOrder: 1, slideTitle: "Legacy title", text: "Narration." }],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "Legacy title",
          layout: "hero",
          blocks: [{ type: "callout", content: "Legacy thesis. Second detail." }],
          speakerNotes: "Legacy notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
        {
          id: "slide-2",
          order: 2,
          title: "Legacy summary",
          layout: "summary",
          blocks: [{ type: "bullets", items: ["First takeaway", "Second takeaway", "Third takeaway"] }],
          speakerNotes: "Summary notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
    } as any);

    expect(document.slides[0].slideKind).toBe("title");
    expect(document.slides[0].thesis).toContain("Legacy thesis");
    expect(document.slides[1].slideKind).toBe("summary");
    expect(document.slides[1].bullets).toEqual(["First takeaway", "Second takeaway", "Third takeaway"]);
    expect(document.slides[1].visual.type).not.toBe("none");
  });
});
