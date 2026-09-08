import { describe, expect, it } from "vitest";
import { compileSlideCardToSlide, slideLayoutForCard } from "./slide-card.js";
import { slideCardSchema, slideSchema } from "./schemas.js";

function baseSlide() {
  return slideSchema.parse({
    id: "slide-2",
    order: 2,
    title: "Provider title",
    slideKind: "content",
    layout: "bullets",
    thesis: "Provider thesis.",
    bullets: ["Provider bullet."],
    visual: { type: "none" },
    blocks: [],
    speakerNotes: "Provider notes.",
    timingSeconds: 55,
    sourceRefs: [],
  });
}

describe("SlideCard compiler", () => {
  it("maps a card to the canonical slide and builds a grounded diagram", () => {
    const card = slideCardSchema.parse({
      slideOrder: 2,
      speechSectionOrder: 2,
      title: "Feedback loop",
      screenThought: "Feedback changes the next study decision.",
      allowedBullets: ["The learner notices the mistake.", "The learner adjusts the strategy."],
      visualLabels: [],
      speakerNotes: "Feedback changes the next study decision. The learner notices the mistake. The learner adjusts the strategy.",
      slideRole: "explain",
      composition: "relationship_map",
      visualStory: "A connected diagram shows how feedback changes the next decision.",
      visualStrategy: "diagram",
      validationCriteria: ["Use the accepted speech section."],
    });

    const compiled = compileSlideCardToSlide(card, baseSlide());

    expect(compiled).toMatchObject({
      title: card.title,
      thesis: card.screenThought,
      bullets: card.allowedBullets,
      speakerNotes: card.speakerNotes,
      layout: "process",
      showSourceAttribution: false,
      blocks: [],
    });
    expect(compiled.visual.graph?.nodes.map((node) => node.label)).toEqual([
      "The learner notices the mistake",
      "The learner adjusts the strategy",
    ]);
    expect(compiled.visual.graph?.edges).toHaveLength(1);
    expect(compiled.visual.title).toBe("");
    expect(compiled.canvas).toBeUndefined();
  });

  it("maps image and conclusion compositions to concrete renderer layouts", () => {
    expect(slideLayoutForCard({ composition: "image_text_column" }, { slideKind: "content" })).toBe("image-focus");
    expect(slideLayoutForCard({ composition: "visual_conclusion" }, { slideKind: "summary" })).toBe("summary");
    expect(slideLayoutForCard({ composition: "full_screen_image" }, { slideKind: "title" })).toBe("hero");
  });
});
