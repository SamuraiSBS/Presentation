import { describe, expect, it } from "vitest";
import { buildDesignBrief, buildSlideTextPlans } from "./builders.js";
import { ensureDesignBriefDirections } from "../normalization/presentation.js";

const visualProject = (slideCount: number) => ({
  id: `visual-policy-${slideCount}`,
  title: "Porsche 911 history",
  prompt: "Explain the Porsche 911 generations and engineering changes.",
  scenario: "university_report",
  level: "university_student",
  mode: "with_sources",
  slideCount,
});

const visualResearch = {
  topic: "Porsche 911 history",
  angle: "Trace the model generations and engineering changes.",
  facts: [{ text: "Porsche 911 is a concrete automobile model with documented generations.", sourceId: "source-1", confidence: "high" as const }],
  warnings: [],
  vocabulary: [],
};

function visualNarrative(slideCount: number) {
  return Array.from({ length: slideCount }, (_, index) => ({
    slideOrder: index + 1,
    slideTitle: index === slideCount - 1 ? "Conclusion" : `Porsche 911 generation ${index + 1}`,
    slidePurpose: "Explain one grounded engineering change.",
    keyMessage: `Porsche 911 generation ${index + 1} changes the engineering story.`,
    audienceQuestion: "What changed and why does it matter?",
    transitionToNext: index === slideCount - 1 ? "" : "Continue to the next generation.",
  }));
}

describe("buildSlideTextPlans", () => {
  it("uses only the matching accepted speech section, not narrative or source text", () => {
    const plans = buildSlideTextPlans(
      {
        id: "grounded-plan",
        title: "Feedback study",
        prompt: "Explain feedback",
        scenario: "lesson",
        level: "university",
        mode: "with_sources",
        slideCount: 2,
      } as any,
      [
        "Слайд 1: Feedback loop",
        "Regular feedback lets a student notice a mistaken solution before the next attempt.",
        "The student then changes the study strategy using that mistake.",
        "",
        "Слайд 2: Control condition",
        "The control group keeps the original study strategy throughout the task.",
        "This condition makes the comparison with the feedback group explicit.",
      ].join("\n"),
      [
        { slideOrder: 1, slideTitle: "Planner title", slidePurpose: "Use a source-only claim", keyMessage: "Audience question must not leak", audienceQuestion: "What does the source say?", transitionToNext: "Continue" },
        { slideOrder: 2, slideTitle: "Another planner title", slidePurpose: "Use a foreign conclusion", keyMessage: "Foreign conclusion", audienceQuestion: "Why does this matter?", transitionToNext: "" },
      ] as any,
      { mainIdea: "Foreign deck story", audienceQuestion: "Foreign question", tone: "college_report", chapters: [], conclusion: "Foreign conclusion" } as any,
      [{ id: "source-1", label: "Source-only evidence", type: "WEB", size: 0, excerpt: "A source-only fact must not become slide text." }] as any,
      { acceptedFullNarration: true },
    );

    expect(plans[0]).toMatchObject({
      title: "Feedback loop",
      slideQuestion: "Regular feedback lets a student notice a mistaken solution before the next attempt.",
      coreClaim: "Regular feedback lets a student notice a mistaken solution before the next attempt.",
    });
    expect(plans[0].bullets.join(" ")).toContain("changes the study strategy");
    expect(JSON.stringify(plans[0])).not.toContain("source-only");
    expect(JSON.stringify(plans[0])).not.toContain("Audience question");
    expect(JSON.stringify(plans[0])).not.toContain("Foreign deck story");
    expect(plans[1].thesis).toContain("control group keeps the original study strategy");
    expect(plans[1].thesis).not.toContain("Feedback loop");
  });
});

describe("managed visual quota", () => {
  it.each([
    [6, 3, 2, 1],
    [8, 4, 2, 2],
    [10, 5, 3, 2],
    [12, 6, 4, 2],
    [14, 7, 5, 2],
  ])("normalizes a %s-slide planner result to the exact matrix", (slideCount, photos, diagrams, text) => {
    const brief = buildDesignBrief(visualProject(slideCount), visualResearch, visualNarrative(slideCount));
    const directions = brief.slideDirections;

    expect(directions).toHaveLength(slideCount);
    expect(directions.filter((direction) => direction.imageStrategy === "real_photo")).toHaveLength(photos);
    expect(directions.filter((direction) => direction.imageStrategy === "diagram")).toHaveLength(diagrams);
    expect(directions.filter((direction) => direction.imageStrategy === "none")).toHaveLength(text);
    expect(directions.at(-1)).toMatchObject({ imageStrategy: "none", visualPurpose: "text_only", layoutIntent: "summary", sceneTextMode: "takeaway" });
    for (const direction of directions) {
      if (direction.imageStrategy === "real_photo") expect(direction).toMatchObject({ visualPurpose: "photo" });
      if (direction.imageStrategy === "diagram") expect(direction).toMatchObject({ visualPurpose: expect.stringMatching(/diagram|timeline|comparison/) });
      expect(direction.visualPrompt).toBeTruthy();
    }
  });

  it("re-applies the exact matrix after an AI response is normalized", () => {
    const project = visualProject(8);
    const plans = visualNarrative(project.slideCount);
    const aiLikeBrief = buildDesignBrief(project, visualResearch, plans);
    const normalized = ensureDesignBriefDirections({
      ...aiLikeBrief,
      slideDirections: aiLikeBrief.slideDirections.map((direction) => ({
        ...direction,
        imageStrategy: "none" as const,
        visualPurpose: "text_only" as const,
        layoutIntent: "cards" as const,
      })),
    }, project, plans);

    expect(normalized.slideDirections.filter((direction) => direction.imageStrategy === "real_photo")).toHaveLength(4);
    expect(normalized.slideDirections.filter((direction) => direction.imageStrategy === "diagram")).toHaveLength(2);
    expect(normalized.slideDirections.filter((direction) => direction.imageStrategy === "none")).toHaveLength(2);
    expect(normalized.slideDirections.at(-1)?.imageStrategy).toBe("none");
  });
});
