import { describe, expect, it } from "vitest";
import { ensureEditableCanvas, presentationSchema, type PresentationDocument } from "@studydeck/shared";
import {
  applyQualityRepairs,
  critiquePresentationDeterministically,
  findGenericTextIssues,
  findLayoutRhythmIssues,
  findLongSlideTextIssues,
  findNarrationMetaIssues,
  findRepeatedTitleIssues,
  findVisualDescriptionIssues,
  hasMetaSlideLanguage,
  hasRepeatedSentenceStart,
  hasUnsupportedSpecificity,
  hasWeakConclusion,
  improvePresentationQuality,
  isGenericTitle,
  isVisibleTextTooLong,
  scoreExportReadiness,
  scoreSlideBrevity,
  scoreUniversityTone,
  scoreVisualRhythm,
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

  return ensureEditableCanvas(presentationSchema.parse({
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
  }));
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
    speakerNotes: `${title} starts with a concrete explanation. The example gives the audience a clear point. The details stay connected to the topic. The narration avoids generic transition wording. The ending prepares a grounded conclusion. A university student can read this argument aloud without sounding scripted or simplistic.`,
    timingSeconds: 45,
    sourceRefs: [{ sourceId: source.id, label: source.label, excerpt: source.excerpt, page: null }],
  };
}

describe("presentation quality checks", () => {
  it("scores a strong university deck high across positive dimensions", () => {
    const critique = critiquePresentationDeterministically(makePresentation(), [source], {
      id: "project-1",
      title: "Quality deck",
      prompt: "Prepare a university seminar report about a quality topic",
      scenario: "university_report",
      level: "university_student",
      mode: "with_sources",
      slideCount: 2,
    });

    expect(critique.score).toBeGreaterThanOrEqual(82);
    expect(critique.dimensions).toBeDefined();
    expect(Object.values(critique.dimensions || {}).every((dimension) => dimension.score >= 78)).toBe(true);
  });

  it("penalizes school-oriented or childish copy", () => {
    const presentation = makePresentation({
      slides: [{
        ...makeSlide(1, "Урок для малышей", "Ребята узнают простой школьный ответ.", ["Весёлая задача для детей"]),
        speakerNotes: "Ребята, сегодня у нас школьный урок для малышей. Мы дадим детям очень простой ответ и повторим его всем классом. Эта весёлая задача не требует анализа. Каждый школьник легко запомнит правило. Затем класс дружно назовёт итог. Так материал останется понятным для детей.",
      }] as any,
    });

    expect(scoreUniversityTone(presentation, {
      id: "project-1", title: "University topic", prompt: "University report", scenario: "university_report",
      level: "university_student", mode: "with_sources", slideCount: 1,
    }).score).toBeLessThan(78);
  });

  it("penalizes overfilled slide text", () => {
    const presentation = makePresentation({
      slides: [makeSlide(1, "A title that contains far too many separate words to remain readable during a short spoken presentation", "This thesis contains several separate sentences. It also adds a second paragraph-sized thought that belongs in narration rather than on the slide.", [
        "This bullet tries to carry far too much visible slide text because it includes several ideas, examples, qualifications, and a conclusion all at once",
      ])] as any,
    });

    expect(scoreSlideBrevity(presentation).score).toBeLessThan(78);
  });

  it("penalizes repeated visual layout rhythm", () => {
    const slides = Array.from({ length: 5 }, (_, index) => ({
      ...makeSlide(index + 1, `Distinct topic ${index + 1}`, `Distinct thesis ${index + 1} explains one useful point.`, [`Distinct evidence ${index + 1}`]),
      slideKind: "content" as const,
      layout: "statement" as const,
    }));
    const presentation = makePresentation({ slides: slides as any });

    expect(scoreVisualRhythm(presentation).score).toBeLessThan(78);
  });

  it("flags repeated scene text modes and generic real-photo prompts", () => {
    const presentation = makePresentation({
      designBrief: {
        themeId: "academicClean",
        mood: "serious",
        audienceFit: "University report",
        visualMetaphor: "Modern visual story",
        colorIntent: "Readable contrast",
        typographyIntent: "Clear academic type",
        layoutPrinciples: ["Alternate modern scene text modes."],
        imageStrategy: "Use concrete documentary photos only when grounded.",
        rhythm: {
          titleStyle: "academic",
          density: "medium",
          imageFrequency: "balanced",
          sectionBreaks: true,
        },
        slideDirections: [1, 2, 3].map((order) => ({
          slideOrder: order,
          visualRole: order === 1 ? "hero" as const : "explain" as const,
          layoutIntent: "split_image_text" as const,
          imageStrategy: "real_photo" as const,
          sceneTextMode: "visual_labels" as const,
          visualPrompt: "educational presentation image",
        })),
      },
      slides: [1, 2, 3].map((order) => makeSlide(order, `Concrete topic ${order}`, `Concrete thesis ${order} explains a useful point.`, [`Grounded point ${order}`])) as any,
    });

    expect(findLayoutRhythmIssues(presentation)).toContainEqual(expect.objectContaining({
      field: "designBrief.slideDirections.sceneTextMode",
    }));
    expect(findVisualDescriptionIssues(presentation)).toContainEqual(expect.objectContaining({
      field: "designBrief.slideDirections.visualPrompt",
      severity: "major",
    }));
  });

  it("penalizes missing canvas and repairs export readiness without changing custom canvas", async () => {
    const base = makePresentation();
    const customCanvas = {
      ...base.slides[1].canvas!,
      version: 2,
      elements: [...base.slides[1].canvas!.elements, {
        id: "slide-2-custom-canvas-marker", type: "shape" as const, shape: "rect" as const,
        x: 0, y: 0, w: 10, h: 10, rotation: 0, zIndex: 99, opacity: 1, locked: false,
        fill: "#FFFFFF", stroke: "#FFFFFF", strokeWidth: 0,
      }],
    };
    const presentation = presentationSchema.parse({
      ...base,
      slides: [{ ...base.slides[0], canvas: undefined }, { ...base.slides[1], canvas: customCanvas }],
    });

    expect(scoreExportReadiness(presentation).score).toBeLessThan(100);
    const repaired = await improvePresentationQuality(presentation, {
      id: "project-1", title: "Quality deck", prompt: "University report", scenario: "university_report",
      level: "university_student", mode: "with_sources", slideCount: 2,
    }, [source], "yandex");
    expect(repaired.slides[0].canvas?.elements.length).toBeGreaterThan(0);
    expect(repaired.slides[1].canvas).toEqual(customCanvas);
    expect(() => presentationSchema.parse(repaired)).not.toThrow();
  });

  it("exposes deterministic checks from the text quality plan", () => {
    const slide = makeSlide(2, "Dense point", "The thesis stays short.", [
      "This bullet tries to carry far too much visible slide text because it includes several ideas, examples, qualifications, and a conclusion all at once",
    ]);

    expect(isGenericTitle("\u0412\u0432\u0435\u0434\u0435\u043d\u0438\u0435")).toBe(true);
    expect(hasMetaSlideLanguage("\u0413\u043b\u0430\u0432\u043d\u044b\u0435 \u0444\u0430\u043a\u0442\u043e\u0440\u044b \u0437\u0430\u0434\u0430\u044e\u0442 \u043b\u043e\u0433\u0438\u043a\u0443 \u043e\u0431\u044a\u044f\u0441\u043d\u0435\u043d\u0438\u044f.")).toBe(true);
    expect(hasMetaSlideLanguage("\u041d\u0430 \u044d\u0442\u043e\u043c \u0441\u043b\u0430\u0439\u0434\u0435 \u0432\u0438\u0434\u043d\u0430 \u043c\u044b\u0441\u043b\u044c.")).toBe(true);
    expect(hasMetaSlideLanguage("Пример нужен для того, чтобы общая мысль стала ближе к реальной жизни.")).toBe(true);
    expect(hasMetaSlideLanguage("Главная мысль показывает, к чему приводит вся история темы.")).toBe(true);
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

  it("detects generic explanation filler across visible slide fields", () => {
    const base = makePresentation();
    const bad = "\u0413\u043b\u0430\u0432\u043d\u044b\u0435 \u0444\u0430\u043a\u0442\u043e\u0440\u044b \u0437\u0430\u0434\u0430\u044e\u0442 \u043b\u043e\u0433\u0438\u043a\u0443 \u043e\u0431\u044a\u044f\u0441\u043d\u0435\u043d\u0438\u044f.";
    const presentation = {
      ...base,
      slides: [{
        ...base.slides[0],
        title: bad,
        thesis: bad,
        bullets: [bad],
        blocks: [{ type: "callout" as const, content: bad }],
      }, ...base.slides.slice(1)],
    };

    const fields = findGenericTextIssues(presentation).map((issue) => issue.field);
    expect(fields).toEqual(expect.arrayContaining(["title", "thesis", "bullets.0", "blocks.0.content"]));
  });

  it("detects generic explanation filler in narration and speech script", () => {
    const base = makePresentation();
    const bad = "\u0413\u043b\u0430\u0432\u043d\u044b\u0435 \u0444\u0430\u043a\u0442\u043e\u0440\u044b \u0437\u0430\u0434\u0430\u044e\u0442 \u043b\u043e\u0433\u0438\u043a\u0443 \u043e\u0431\u044a\u044f\u0441\u043d\u0435\u043d\u0438\u044f.";
    const presentation = {
      ...base,
      slides: [{ ...base.slides[0], speakerNotes: `${bad} The rest stays concrete.` }, ...base.slides.slice(1)],
      speechScript: [{ ...base.speechScript[0], text: `${bad} The rest stays concrete.` }, ...base.speechScript.slice(1)],
    };

    const fields = findNarrationMetaIssues(presentation).map((issue) => issue.field);
    expect(fields).toEqual(expect.arrayContaining(["speakerNotes", "speechScript"]));
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

  it("attempts bounded targeted repair when several weak dimensions remain", async () => {
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

    expect(repairCalls).toBe(2);
    expect(() => presentationSchema.parse(result)).not.toThrow();
  });

  it("keeps final critique schema-valid", () => {
    const critique = critiquePresentationDeterministically(makePresentation());

    expect(critique.score).toBeGreaterThanOrEqual(0);
    expect(critique.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(critique.issues)).toBe(true);
  });
});
