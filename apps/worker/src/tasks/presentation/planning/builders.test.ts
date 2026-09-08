import { describe, expect, it } from "vitest";
import { buildDesignBrief, buildSlideCards, buildSlideTextPlans, isSemanticSlideTextV2Enabled, planDeckCompositions } from "./builders.js";
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

  it("builds a semantic composition, thesis, and role-bearing support points", () => {
    const project = { ...visualProject(9), id: "semantic-plan", title: "Feedback study", prompt: "Explain feedback" };
    const narration = [
      "РЎР»Р°Р№Рґ 1: Opening claim\nFeedback changes how students learn from mistakes.",
      "РЎР»Р°Р№Рґ 2: Three factors\nThe study depends on three factors: motivation, feedback, and practice.",
      "РЎР»Р°Р№Рґ 3: Shared and different paths\nBoth approaches use the same feedback loop, but the experimental group changes its strategy while the control group keeps the original plan.",
      "РЎР»Р°Р№Рґ 4: From cause to effect\nBecause feedback arrives early, students correct mistakes; therefore later attempts improve.",
      "РЎР»Р°Р№Рґ 5: Practical sequence\nFirst, collect the mistake. Then compare the attempted solution with the target. Finally, explain the corrected strategy.",
      "РЎР»Р°Р№Рґ 6: Definition\nA feedback loop means a cycle in which a result changes the next attempt. The cycle makes the next decision easier to adjust.",
      "РЎР»Р°Р№Рґ 7: Concrete example\nFor example, a student revises a calculation after seeing where the first solution failed. The correction becomes evidence for the next attempt.",
      "РЎР»Р°Р№Рґ 8: Timeline\nIn 2020, the first study tested immediate feedback. In 2024, a later study measured how the approach changed revision habits.",
      "РЎР»Р°Р№Рґ 9: Conclusion\nFeedback is useful when it changes the next decision. The learner notices the error, adjusts the strategy, and carries the lesson forward.",
    ].join("\n\n");

    const canonicalNarration = narration.replace(/^\S+\s+(\d+):/gm, "$1:");
    const plans = buildSlideTextPlans(project as any, canonicalNarration, [], {} as any, [] as any, { acceptedFullNarration: true });

    expect(isSemanticSlideTextV2Enabled()).toBe(true);
    expect(isSemanticSlideTextV2Enabled("false")).toBe(false);
    expect(plans[1]).toMatchObject({ composition: "enumeration", supportPointMode: "labels" });
    expect(plans[1].supportPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "factor", text: "motivation." }),
      expect.objectContaining({ role: "factor", text: "feedback." }),
      expect.objectContaining({ role: "factor", text: "practice." }),
    ]));
    expect(plans[2].composition).toBe("comparison");
    expect(plans[2].thesis).toContain("same feedback loop");
    expect(plans[2].supportPoints.every((point) => point.role === "difference")).toBe(true);
    expect(plans[3]).toMatchObject({ composition: "cause_effect", supportPointMode: "labels" });
    expect(plans[3].supportPoints).toEqual(expect.arrayContaining([expect.objectContaining({ role: "effect" })]));
    expect(plans[4].composition).toBe("process");
    expect(plans[5].composition).toBe("definition");
    expect(plans[6].composition).toBe("example");
    expect(plans[7].composition).toBe("timeline");
    expect(plans[8].composition).toBe("summary");
    expect(plans[8].supportPoints.at(-1)?.role).toBe("takeaway");
  });

  it("does not manufacture support points when the matching speech section has one idea", () => {
    const project = { ...visualProject(3), id: "sparse-semantic-plan", title: "Feedback study", prompt: "Explain feedback" };
    const narration = [
      "РЎР»Р°Р№Рґ 1: Opening\nFeedback changes how students learn from mistakes.",
      "РЎР»Р°Р№Рґ 2: One idea\nThe measured result changes after immediate feedback.",
      "РЎР»Р°Р№Рґ 3: Conclusion\nThe result supports the conclusion.",
    ].join("\n\n");
    const canonicalNarration = narration.replace(/^\S+\s+(\d+):/gm, "$1:");
    const plans = buildSlideTextPlans(project as any, canonicalNarration, [], {} as any, [] as any, { acceptedFullNarration: true });

    expect(plans[1].supportPoints).toEqual([]);
    expect(plans[1].bullets).toEqual([]);
  });

  it("binds one canonical slide card to each accepted speech section", () => {
    const project = { ...visualProject(6), id: "slide-card-contract" };
    const narration = Array.from({ length: 6 }, (_, index) => [
      `${index + 1}: Section ${index + 1}`,
      `The accepted speech section ${index + 1} explains one concrete part of the topic and ends with a complete thought.`,
      "The speaker can use this section as the notes for the matching slide.",
    ].join("\n")).join("\n\n");
    const brief = buildDesignBrief(project, visualResearch, visualNarrative(project.slideCount));
    const presentation = {
      slides: Array.from({ length: project.slideCount }, (_, index) => ({
        order: index + 1,
        id: `slide-${index + 1}`,
        slideKind: index === project.slideCount - 1 ? "summary" : "content",
        title: `Section ${index + 1}`,
        thesis: `The accepted speech section ${index + 1} explains one concrete part of the topic.`,
        speakerNotes: "",
        visual: {
          type: "process_diagram",
          description: "A concrete explanatory visual for the slide topic.",
          items: [{ label: "Cause", text: "A real visual element" }, { label: "Effect", text: "A connected result" }],
          rows: [],
        },
      })),
    } as any;

    const cards = buildSlideCards(project as any, narration, presentation, brief);

    expect(cards).toHaveLength(6);
    expect(cards.map((card) => [card.slideOrder, card.speechSectionOrder])).toEqual([
      [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6],
    ]);
    expect(cards.every((card) => card.speakerNotes.includes(`accepted speech section ${card.slideOrder}`))).toBe(true);
    expect(cards.every((card) => /[.!?]$/u.test(card.screenThought))).toBe(true);
    expect(cards.every((card) => card.visualLabels.every((label) => label.split(/\s+/u).length <= 4))).toBe(true);
    expect(cards.every((card) => card.allowedBullets.length <= 3)).toBe(true);
    expect(new Set(cards.map((card) => card.composition)).size).toBeGreaterThanOrEqual(4);
    expect(cards.some((card, index) => index >= 2
      && cards[index - 2]!.composition === cards[index - 1]!.composition
      && cards[index - 1]!.composition === card.composition)).toBe(false);
  });

  it("assigns deck-wide variety without inventing comparison or timeline semantics", () => {
    const directions = Array.from({ length: 6 }, (_, index) => ({
      slideOrder: index + 1,
      visualRole: index === 5 ? "summary" as const : "explain" as const,
      layoutIntent: index === 5 ? "summary" as const : "cards" as const,
      imageStrategy: "none" as const,
      visualPrompt: `Plain explanation ${index + 1}`,
    }));
    const planned = planDeckCompositions({ slideCount: 6 }, directions as any, visualNarrative(6));

    expect(new Set(planned.map((direction) => direction.composition)).size).toBeGreaterThanOrEqual(4);
    expect(planned.some((direction) => direction.composition === "comparison" || direction.composition === "timeline")).toBe(false);
    expect(planned.some((direction, index) => index >= 2
      && planned[index - 2]!.composition === planned[index - 1]!.composition
      && planned[index - 1]!.composition === direction.composition)).toBe(false);
  });

  it("uses a process composition for evidence directions only when accepted narration describes an explanation", () => {
    const directions = Array.from({ length: 6 }, (_, index) => ({
      slideOrder: index + 1,
      visualRole: index === 5 ? "summary" as const : "evidence" as const,
      layoutIntent: index === 5 ? "summary" as const : "diagram" as const,
      imageStrategy: index === 5 ? "none" as const : "diagram" as const,
      visualPrompt: `Evidence ${index + 1}`,
    }));
    const narrative = directions.map((direction) => ({
      slideOrder: direction.slideOrder,
      slideTitle: `Section ${direction.slideOrder}`,
      keyMessage: direction.slideOrder === 2 ? "The system mechanism connects cause and effect." : "A source-grounded observation.",
      slidePurpose: "Explain the evidence.",
    }));

    const planned = planDeckCompositions({ slideCount: 6 }, directions as any, narrative as any);

    expect(planned[1]?.composition).toBe("process");
    expect(planned[2]?.composition).not.toBe("process");
    expect(planned.some((direction) => direction.composition === "comparison" || direction.composition === "timeline")).toBe(false);
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
