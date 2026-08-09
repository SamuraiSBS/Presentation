import { describe, expect, it } from "vitest";
import { buildSlideTextPlans } from "./builders.js";

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
