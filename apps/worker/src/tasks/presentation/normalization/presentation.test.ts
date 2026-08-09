import { describe, expect, it } from "vitest";
import { normalizePresentation } from "./presentation.js";

const project = {
  id: "normalization-section-order",
  title: "Section order study",
  prompt: "Explain two independent mechanisms",
  scenario: "lesson",
  level: "university",
  mode: "with_sources",
  slideCount: 2,
};

describe("normalizePresentation narration section mapping", () => {
  it("keeps visible and spoken fallbacks bound to slide order when sections arrive in reverse order", () => {
    const generatedText = [
      "Слайд 2: Second accepted title",
      "SecondAnchor explains the second independent mechanism. SecondAnchor gives the consequence of the second mechanism.",
      "",
      "Слайд 1: First accepted title",
      "FirstAnchor explains the first independent mechanism. FirstAnchor gives the condition of the first mechanism.",
    ].join("\n");
    const presentation = normalizePresentation({
      slides: [
        { id: "slide-1", order: 1, title: "", thesis: "", bullets: [], blocks: [], speakerNotes: "" },
        { id: "slide-2", order: 2, title: "", thesis: "", bullets: [], blocks: [], speakerNotes: "" },
      ],
      // There is no matching item for slide 1. The old positional fallback
      // incorrectly donated this second-slide text to slide 1.
      speechScript: [{ slideOrder: 2, slideTitle: "Second accepted title", text: "SecondScriptAnchor must remain on slide two." }],
    }, project, [], "demo", generatedText);

    const firstVisible = [presentation.slides[0].title, presentation.slides[0].thesis, ...presentation.slides[0].bullets].join(" ");
    const secondVisible = [presentation.slides[1].title, presentation.slides[1].thesis, ...presentation.slides[1].bullets].join(" ");

    expect(firstVisible).toContain("FirstAnchor");
    expect(firstVisible).not.toMatch(/SecondAnchor|SecondScriptAnchor/);
    expect(secondVisible).toContain("SecondAnchor");
    expect(secondVisible).not.toContain("FirstAnchor");
    expect(presentation.slides[0].speakerNotes).toContain("FirstAnchor");
    expect(presentation.slides[0].speakerNotes).not.toMatch(/SecondAnchor|SecondScriptAnchor/);
    expect(presentation.slides[1].speakerNotes).toContain("SecondAnchor");
    expect(presentation.slides[1].speakerNotes).not.toContain("FirstAnchor");
    expect(presentation.speechScript[0].text).toContain("FirstAnchor");
    expect(presentation.speechScript[0].text).not.toMatch(/SecondAnchor|SecondScriptAnchor/);
    expect(presentation.speechScript[1].text).toContain("SecondAnchor");
    expect(presentation.speechScript[1].text).not.toContain("FirstAnchor");
  });

  it("keeps a sparse accepted section compact instead of filling it from project fallback text", () => {
    const generatedText = [
      "Слайд 1: Opening section",
      "OpeningAnchor frames the study.",
      "",
      "Слайд 2: Sparse mechanism",
      "SparseAnchor identifies the measured mechanism.",
      "",
      "Слайд 3: Closing section",
      "ClosingAnchor states the supported conclusion.",
    ].join("\n");
    const sparse = normalizePresentation({
      slides: [
        { id: "slide-1", order: 1, title: "", thesis: "", bullets: [], blocks: [], speakerNotes: "" },
        { id: "slide-2", order: 2, title: "", thesis: "", bullets: [], blocks: [], speakerNotes: "" },
        { id: "slide-3", order: 3, title: "", thesis: "", bullets: [], blocks: [], speakerNotes: "" },
      ],
      speechScript: [],
    }, {
      ...project,
      title: "ProjectDonor must not appear",
      prompt: "ProjectDonor must not refill a sparse slide",
      slideCount: 3,
    }, [], "demo", generatedText, [], false);

    const slide = sparse.slides[1];
    const visible = [slide.title, slide.thesis, ...slide.bullets, ...slide.blocks.flatMap((block) => block.type === "bullets" ? block.items : [block.content]), slide.visual.description].join(" ");
    expect(slide.bullets).toEqual([]);
    expect(visible).toContain("SparseAnchor");
    expect(visible).not.toContain("ProjectDonor");
  });
});
