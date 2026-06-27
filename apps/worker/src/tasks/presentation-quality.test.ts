import { describe, expect, it } from "vitest";
import { presentationSchema, type PresentationDocument } from "@studydeck/shared";
import {
  applyQualityRepairs,
  critiquePresentationDeterministically,
  findGenericTextIssues,
  findLongSlideTextIssues,
  findNarrationMetaIssues,
  findRepeatedTitleIssues,
  hasMetaSlideLanguage,
  hasRepeatedSentenceStart,
  hasUnsupportedSpecificity,
  hasWeakConclusion,
  improvePresentationQuality,
  isGenericTitle,
  isVisibleTextTooLong,
} from "./presentation-quality.js";

const source = {
  id: "source-1",
  label: "Study source",
  type: "WEB",
  size: 0,
  excerpt: "The source explains distinct study points with enough grounding.",
};

function makePresentation(overrides: Partial<PresentationDocument> = {}) {
  const slides = overrides.slides || [
    makeSlide(1, "Why the topic matters", "The topic changes how students understand the problem.", [
      "It gives a clear starting point",
      "It connects the example with the conclusion",
    ]),
    makeSlide(2, "What changes in practice", "The practical part shows how the idea works in a real task.", [
      "Students compare two decisions",
      "The final answer becomes easier to explain",
    ]),
  ];

  return presentationSchema.parse({
    id: "presentation-1",
    title: "Quality deck",
    scenario: "lesson",
    level: "beginner",
    slideCount: slides.length,
    generationMode: "yandex",
    generatedText: slides.map((slide) => `Slide ${slide.order}: ${slide.title}\n${slide.speakerNotes}`).join("\n\n"),
    sources: [source],
    outline: slides.map((slide) => slide.title),
    narrativePlan: slides.map((slide) => ({
      slideOrder: slide.order,
      slideTitle: slide.title,
      slidePurpose: `Explain ${slide.title}.`,
      keyMessage: slide.thesis,
      audienceQuestion: "What should the audience understand?",
      transitionToNext: slide.order === slides.length ? "" : "Continue with the next concrete point.",
    })),
    speechScript: slides.map((slide) => ({
      slideOrder: slide.order,
      slideTitle: slide.title,
      text: slide.speakerNotes,
    })),
    slides,
    ...overrides,
  });
}

function makeSlide(order: number, title: string, thesis: string, bullets: string[]) {
  return {
    id: `slide-${order}`,
    order,
    title,
    slideKind: order === 1 ? "title" : "summary",
    layout: order === 1 ? "hero" : "summary",
    thesis,
    bullets,
    definition: null,
    keyConcepts: [],
    visual: {
      type: "illustration",
      title: "",
      description: `${title} classroom scene with concrete study details`,
      leftLabel: "",
      rightLabel: "",
      items: [],
      rows: [],
    },
    highlights: [],
    blocks: [{ type: "bullets" as const, items: bullets }],
    speakerNotes: `${title} starts with a concrete explanation. The example gives the audience a clear point. The details stay connected to the topic. The slide avoids generic transition wording. The ending prepares a grounded conclusion.`,
    timingSeconds: 45,
    sourceRefs: [{ sourceId: source.id, label: source.label, excerpt: source.excerpt, page: null }],
  };
}

describe("presentation quality checks", () => {
  it("exposes deterministic checks from the text quality plan", () => {
    const slide = makeSlide(2, "Dense point", "The thesis stays short.", [
      "This bullet tries to carry far too much visible slide text because it includes several ideas, examples, qualifications, and a conclusion all at once",
    ]);

    expect(isGenericTitle("\u0412\u0432\u0435\u0434\u0435\u043d\u0438\u0435")).toBe(true);
    expect(hasMetaSlideLanguage("\u041d\u0430 \u044d\u0442\u043e\u043c \u0441\u043b\u0430\u0439\u0434\u0435 \u0432\u0438\u0434\u043d\u0430 \u043c\u044b\u0441\u043b\u044c.")).toBe(true);
    expect(hasRepeatedSentenceStart([
      "The topic begins with context. The topic begins with a concrete example.",
      "The topic begins with a human conclusion.",
    ])).toBe(true);
    expect(hasUnsupportedSpecificity("The result grew by 42% in 2024.", [])).toBe(true);
    expect(isVisibleTextTooLong(slide as any)).toBe(true);
    expect(hasWeakConclusion(makeSlide(2, "Final note", "The result is clear.", ["One detail"]) as any, {
      id: "project-1",
      title: "Photosynthesis",
      prompt: "Explain photosynthesis",
      scenario: "lesson",
      level: "beginner",
      mode: "with_sources",
      slideCount: 2,
    })).toBe(true);
  });

  it("detects meta phrases in speaker notes", () => {
    const presentation = makePresentation({
      slides: [
        {
          ...makeSlide(1, "Energy balance", "Energy balance explains the main change.", ["Inputs shape the result"]),
          speakerNotes:
            "\u041d\u0430 \u044d\u0442\u043e\u043c \u0441\u043b\u0430\u0439\u0434\u0435 \u0432\u0438\u0434\u043d\u0430 \u0433\u043b\u0430\u0432\u043d\u0430\u044f \u043c\u044b\u0441\u043b\u044c. The rest of the narration gives a concrete explanation.",
        },
      ] as any,
    });

    expect(findNarrationMetaIssues(presentation)).toContainEqual(expect.objectContaining({
      slideId: "slide-1",
      category: "bad_narration",
      field: "speakerNotes",
    }));
  });

  it("detects generic visible title and thesis", () => {
    const presentation = makePresentation({
      slides: [
        {
          ...makeSlide(1, "\u0412\u0432\u0435\u0434\u0435\u043d\u0438\u0435", "\u0413\u043b\u0430\u0432\u043d\u0430\u044f \u0438\u0434\u0435\u044f \u0441\u0432\u044f\u0437\u0430\u043d\u0430 \u0441 \u0442\u0435\u043c\u043e\u0439.", ["The first point is concrete"]),
        },
      ] as any,
    });

    const issues = findGenericTextIssues(presentation);
    expect(issues.map((issue) => issue.field)).toEqual(expect.arrayContaining(["title", "thesis"]));
  });

  it("detects duplicated titles", () => {
    const presentation = makePresentation({
      slides: [
        makeSlide(1, "Shared title", "The first point explains one side.", ["First detail"]),
        makeSlide(2, "Shared title", "The second point explains another side.", ["Second detail"]),
      ] as any,
    });

    expect(findRepeatedTitleIssues(presentation)).toHaveLength(2);
  });

  it("detects overlong bullets", () => {
    const presentation = makePresentation({
      slides: [
        makeSlide(1, "Dense point", "The thesis stays short.", [
          "This bullet tries to carry far too much visible slide text because it includes several ideas, examples, qualifications, and a conclusion all at once",
        ]),
      ] as any,
    });

    expect(findLongSlideTextIssues(presentation)).toContainEqual(expect.objectContaining({
      slideId: "slide-1",
      category: "too_long",
      field: "bullets.0",
    }));
  });

  it("repairs only affected slides", () => {
    const presentation = makePresentation({
      slides: [
        makeSlide(1, "\u0412\u0432\u0435\u0434\u0435\u043d\u0438\u0435", "\u0413\u043b\u0430\u0432\u043d\u0430\u044f \u0438\u0434\u0435\u044f \u0441\u0432\u044f\u0437\u0430\u043d\u0430 \u0441 \u0442\u0435\u043c\u043e\u0439.", ["Generic point"]),
        makeSlide(2, "Specific conclusion", "The ending explains the practical result.", ["The result is clear"]),
      ] as any,
    });

    const repaired = applyQualityRepairs(presentation, {
      slides: [{ slideId: "slide-1", title: "Concrete opening", thesis: "Concrete opening explains the real topic." }],
    });

    expect(repaired.slides[0].title).toBe("Concrete opening");
    expect(repaired.slides[1]).toEqual(presentation.slides[1]);
    expect(() => presentationSchema.parse(repaired)).not.toThrow();
  });

  it("does not modify a valid presentation", async () => {
    const presentation = makePresentation();

    await expect(
      improvePresentationQuality(presentation, {
        id: "project-1",
        title: "Quality deck",
        prompt: "Explain a quality topic",
        scenario: "lesson",
        level: "beginner",
        mode: "with_sources",
        slideCount: 2,
      }, [source], "yandex"),
    ).resolves.toEqual(presentation);
  });

  it("keeps the best schema-valid deck when only non-blocking issues remain", async () => {
    const presentation = makePresentation({
      sources: [],
      slides: [
        {
          ...makeSlide(1, "\u0412\u0432\u0435\u0434\u0435\u043d\u0438\u0435", "\u0413\u043b\u0430\u0432\u043d\u0430\u044f \u0438\u0434\u0435\u044f \u0441\u0432\u044f\u0437\u0430\u043d\u0430 \u0441 \u0442\u0435\u043c\u043e\u0439.", [
            "This bullet tries to carry far too much visible slide text because it includes several ideas, examples, qualifications, and a conclusion all at once",
          ]),
          visual: { ...makeSlide(1, "x", "x", ["x"]).visual, description: "" },
          sourceRefs: [],
        },
      ] as any,
    });
    let repairCalls = 0;

    const result = await improvePresentationQuality(
      presentation,
      {
        id: "project-1",
        title: "Quality deck",
        prompt: "Explain a quality topic",
        scenario: "lesson",
        level: "beginner",
        mode: "with_sources",
        slideCount: 1,
      },
      [],
      "yandex",
      {
        maxRepairAttempts: 2,
        repair: async () => {
          repairCalls += 1;
          return { slides: [] };
        },
      },
    );

    expect(repairCalls).toBe(0);
    expect(() => presentationSchema.parse(result)).not.toThrow();
  });

  it("keeps final critique schema-valid", () => {
    const critique = critiquePresentationDeterministically(makePresentation());

    expect(critique.score).toBeGreaterThanOrEqual(0);
    expect(critique.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(critique.issues)).toBe(true);
  });
});
