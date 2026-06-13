import { describe, expect, it } from "vitest";
import { createProjectInputSchema, planLimits, presentationSchema } from "./index";

describe("shared contracts", () => {
  it("validates project input limits", () => {
    expect(() =>
      createProjectInputSchema.parse({
        title: "AI in education",
        prompt: "Сделай понятную презентацию по теме искусственного интеллекта в образовании",
        scenario: "school_report",
        level: "8-11 класс",
        mode: "with_sources",
        slideCount: 10,
      }),
    ).not.toThrow();
  });

  it("keeps free plan export limited to pdf", () => {
    expect(planLimits.free.exports).toEqual(["pdf"]);
  });

  it("requires a structured presentation document", () => {
    expect(() => presentationSchema.parse({ id: "x" })).toThrow();
  });

  it("parses structured slide fields", () => {
    const parsed = presentationSchema.parse({
      id: "presentation-1",
      title: "Structured deck",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Core idea"],
      speechScript: [{ slideOrder: 1, slideTitle: "Core idea", text: "Narration." }],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "Core idea",
          slideKind: "content",
          layout: "bullets",
          thesis: "A slide should teach one clear idea.",
          bullets: ["Use one thesis", "Keep bullets short", "Add a visual cue"],
          definition: { term: "Thesis", text: "The main claim of a slide." },
          keyConcepts: [{ label: "Structure", icon: "layers" }],
          visual: {
            type: "process_diagram",
            title: "How it works",
            items: [
              { label: "Read", text: "Find the idea" },
              { label: "Group", text: "Pick points" },
            ],
          },
          highlights: [{ text: "one idea", tone: "accent" }],
          blocks: [{ type: "callout", content: "Fallback body." }],
          speakerNotes: "Explain the structure.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
    });

    expect(parsed.slides[0].thesis).toBe("A slide should teach one clear idea.");
    expect(parsed.slides[0].visual.type).toBe("process_diagram");
    expect(parsed.slides[0].highlights[0].tone).toBe("accent");
  });

  it("keeps old slide documents valid with structured defaults", () => {
    const parsed = presentationSchema.parse({
      id: "presentation-1",
      title: "Legacy deck",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Legacy slide"],
      speechScript: [{ slideOrder: 1, slideTitle: "Legacy slide", text: "Narration." }],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "Legacy slide",
          layout: "bullets",
          blocks: [{ type: "callout", content: "Legacy body." }],
          speakerNotes: "Legacy notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
    });

    expect(parsed.slides[0].slideKind).toBe("content");
    expect(parsed.slides[0].thesis).toBe("");
    expect(parsed.slides[0].bullets).toEqual([]);
    expect(parsed.slides[0].visual.type).toBe("none");
  });
});
