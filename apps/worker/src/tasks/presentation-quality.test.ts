import { describe, expect, it } from "vitest";
import { auditSlideCanvas, ensureEditableCanvas, presentationSchema, type PresentationDocument } from "@studydeck/shared";
import {
  applyQualityRepairs,
  applyConclusionFallbacks,
  applySlideSpeechAlignmentFallbacks,
  applyTopicRelevanceFallbacks,
  applyVisualPlanFallbacks,
  applyVisibleTextIntegrityFallbacks,
  buildSlideSemanticContracts,
  findDeckWideDuplicateIssues,
  findIntraSlideDuplicateIssues,
  findSlideSpeechAlignmentIssues,
  findTopicRelevanceIssues,
  findVisualPlanIssues,
  findVisibleTextIntegrityIssues,
  findWeakConclusionIssues,
  critiquePresentationDeterministically,
  findGenericTextIssues,
  findLayoutRhythmIssues,
  findLongSlideTextIssues,
  findNarrationMetaIssues,
  findRepeatedTitleIssues,
  findSpeechTimingIssues,
  findVisualDescriptionIssues,
  findVisualFulfillmentIssues,
  findCanvasCanonicalContentIssues,
  findContentSlideContractIssues,
  productionQualityReleaseResult,
  findFactualRiskIssues,
  applySourceGroundingRepairs,
  applyEntityCategoryMismatchRepairs,
  findEntityCategoryMismatchIssues,
  findOffTopicVisualIssues,
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
import { preserveAcceptedGeneratedText, preserveAcceptedNarration } from "./presentation/quality/orchestration.js";

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
    blocks: [{ type: "callout" as const, content: `${title} gives the audience a focused explanation.` }],
    speakerNotes: `${title} starts with a concrete explanation. The example gives the audience a clear point. The details stay connected to the topic. The narration avoids generic transition wording. The ending prepares a grounded conclusion. A university student can read this argument aloud without sounding scripted or simplistic.`,
    timingSeconds: 45,
    sourceRefs: [{ sourceId: source.id, label: source.label, excerpt: source.excerpt, page: null }],
  };
}

describe("presentation quality checks", () => {
  it("enforces the content-slide thesis and support-point contract while allowing an explanatory diagram", () => {
    const valid = makePresentation({ slides: [{ ...makeSlide(1, "Evidence", "The experiment changed the measured result.", ["The control group kept the original condition.", "The observed difference supports the conclusion."]), slideKind: "content", layout: "bullets" }] as any });
    expect(findContentSlideContractIssues(valid)).toEqual([]);
    const sparse = presentationSchema.parse({ ...valid, slides: [{ ...valid.slides[0], bullets: [valid.slides[0].thesis] }] });
    expect(findContentSlideContractIssues(sparse)).toContainEqual(expect.objectContaining({ field: "contentContract" }));
    const diagram = presentationSchema.parse({ ...sparse, slides: [{ ...sparse.slides[0], layout: "statement", visual: { ...sparse.slides[0].visual, type: "process_diagram", items: [{ label: "Step one", text: "The first stage changes the input." }, { label: "Step two", text: "The second stage records the outcome." }] } }] });
    expect(findContentSlideContractIssues(diagram)).toEqual([]);
  });

  it("rebuilds sparse content only from accepted narration and leaves a custom canvas intact", () => {
    const base = makePresentation({ slides: [{ ...makeSlide(1, "Evidence", "A generic statement.", ["A generic statement."]), slideKind: "content", layout: "bullets", speakerNotes: "The experiment changed the measured result. The control group kept the original condition. The observed difference supports the conclusion." }] as any });
    const issues = findContentSlideContractIssues(base);
    const project = { id: "contract", title: "Experiment", prompt: "Explain the experiment", scenario: "lesson", level: "university", mode: "with_sources", slideCount: 1 } as const;
    const repaired = applyVisibleTextIntegrityFallbacks(base, issues, project);
    expect(repaired.slides[0].bullets).toEqual(["The control group kept the original condition.", "The observed difference supports the conclusion."]);
    expect(repaired.slides[0].speakerNotes).toBe(base.slides[0].speakerNotes);
    expect(repaired.generatedText).toBe(base.generatedText);
    const custom = presentationSchema.parse({ ...base, slides: [{ ...base.slides[0], canvas: { ...base.slides[0].canvas!, elements: [...base.slides[0].canvas!.elements, { id: "user-mark", type: "shape", shape: "rect", x: 1, y: 1, w: 10, h: 10, rotation: 0, zIndex: 99, opacity: 1, locked: false, fill: "#FFFFFF", stroke: "#FFFFFF", strokeWidth: 0 }] } }] });
    expect(applyVisibleTextIntegrityFallbacks(custom, issues, project).slides[0].canvas).toEqual(custom.slides[0].canvas);
  });
  it("uses selected slide-count bounds, including an open-ended fourteen-slide floor", () => {
    const presentation = (words: number) => ({
      speechScript: [{ slideOrder: 1, slideTitle: "Speech", text: Array.from({ length: words }, () => "слово").join(" ") }],
    }) as PresentationDocument;
    const project = (slideCount: number) => ({ id: `timing-${slideCount}`, title: "Тема", prompt: "Тема", scenario: "university_report", level: "university_student", mode: "with_sources", slideCount });

    expect(findSpeechTimingIssues(presentation(1287), project(10))).toHaveLength(1); // 9.9 min
    expect(findSpeechTimingIssues(presentation(1300), project(10))).toHaveLength(0);
    expect(findSpeechTimingIssues(presentation(1560), project(10))).toHaveLength(0);
    expect(findSpeechTimingIssues(presentation(1573), project(10))).toHaveLength(1); // 12.1 min
    expect(findSpeechTimingIssues(presentation(1300), project(12))).toHaveLength(1);
    expect(findSpeechTimingIssues(presentation(1560), project(12))).toHaveLength(0);
    expect(findSpeechTimingIssues(presentation(1950), project(14))).toHaveLength(0);
    expect(findSpeechTimingIssues(presentation(2600), project(14))).toHaveLength(0);
    expect(findSpeechTimingIssues(presentation(900), project(6))).toHaveLength(0);
    expect(findSpeechTimingIssues(presentation(900), project(7))).toHaveLength(0);
    expect(findSpeechTimingIssues(presentation(900), { ...project(10), mode: "export" })).toHaveLength(0);
  });

  it("flags courtesy-only and recap-only endings as weak conclusions", () => {
    const project = { id: "porsche-closing", title: "История Porsche 911", prompt: "Объясни развитие Porsche 911", scenario: "lesson", level: "university", mode: "with_sources", slideCount: 2 } as const;
    const thankYou = makePresentation({
      slides: [makeSlide(1, "Porsche 911", "Porsche 911 changed sports-car design.", ["Design remained recognizable"]), {
        ...makeSlide(2, "Спасибо за внимание", "Спасибо за внимание.", []),
        speakerNotes: "Спасибо за внимание.",
      }] as any,
    });
    const recap = presentationSchema.parse({
      ...thankYou,
      slides: [thankYou.slides[0], {
        ...thankYou.slides[1],
        title: "Что мы рассмотрели",
        thesis: "Мы рассмотрели историю Porsche 911.",
        bullets: ["Спасибо за внимание."],
      }],
    });

    expect(findWeakConclusionIssues(thankYou, project)).toContainEqual(expect.objectContaining({ category: "bad_narration" }));
    expect(findWeakConclusionIssues(recap, project)).toContainEqual(expect.objectContaining({ category: "bad_narration" }));
  });

  it("classifies a geopolitical ending in a Porsche deck as off-topic", () => {
    const project = { id: "porsche-off-topic", title: "История Porsche 911", prompt: "Подготовь учебную презентацию об истории Porsche 911", scenario: "lesson", level: "university", mode: "with_sources", slideCount: 2 } as const;
    const presentation = makePresentation({
      title: project.title,
      slides: [makeSlide(1, "Porsche 911", "Porsche 911 developed through design and engineering continuity.", ["The model kept a recognizable identity"]), {
        ...makeSlide(2, "Вывод", "Переговоры лидеров снизили риск международной эскалации.", [
          "Компромисс изменил баланс сил между союзниками.",
          "Дипломатия помогла избежать прямого конфликта.",
        ]),
      }] as any,
    });

    expect(findWeakConclusionIssues(presentation, project)).toContainEqual(expect.objectContaining({ category: "off_topic", severity: "major" }));
  });

  it("accepts a topic-specific synthesis without requiring the word итог", () => {
    const project = { id: "porsche-synthesis", title: "История Porsche 911", prompt: "Объясни развитие Porsche 911", scenario: "lesson", level: "university", mode: "with_sources", slideCount: 5 } as const;
    const slides = Array.from({ length: 5 }, (_, index) => ({
      ...makeSlide(index + 1, `Porsche 911 этап ${index + 1}`, `Porsche 911 объясняет инженерную деталь ${index + 1}.`, [`Инженерное решение ${index + 1} сохранило узнаваемость Porsche 911.`]),
      slideKind: index === 0 ? "title" as const : index === 4 ? "summary" as const : "content" as const,
      layout: index === 0 ? "hero" as const : index === 4 ? "summary" as const : "statement" as const,
    }));
    slides[4] = {
      ...slides[4],
      title: "Почему Porsche 911 остается ориентиром",
      thesis: "Porsche 911 остается ориентиром, потому что развитие техники не разрушило узнаваемую идею модели.",
      bullets: [
        "Дизайнерская преемственность связывает поколения Porsche 911.",
        "Инженерные изменения повышали возможности модели без отказа от ее характера.",
        "История Porsche 911 показывает, как традиция и развитие могут работать вместе.",
      ],
    };
    const presentation = makePresentation({
      title: project.title,
      slides: slides as any,
      narrativePlan: slides.map((slide, index) => ({
        slideOrder: slide.order,
        slideTitle: slide.title,
        slidePurpose: index === 4 ? "Синтезировать развитие модели." : `Раскрыть ${index % 2 ? "инженерную преемственность" : "дизайнерскую преемственность"} Porsche 911.`,
        keyMessage: index === 4 ? slides[4].thesis : index % 2 ? "Инженерные изменения сохраняли характер Porsche 911." : "Дизайнерская преемственность сохранила узнаваемость Porsche 911.",
        audienceQuestion: "Что важно запомнить?",
        transitionToNext: index === 4 ? "" : "Продолжить объяснение.",
      })),
    });

    expect(findWeakConclusionIssues(presentation, project)).toEqual([]);
  });

  it("rebuilds a weak new-generation summary from accepted narration and earlier beats", () => {
    const project = { id: "porsche-repair", title: "История Porsche 911", prompt: "Объясни развитие Porsche 911", scenario: "lesson", level: "university", mode: "with_sources", slideCount: 5 } as const;
    const slides = Array.from({ length: 5 }, (_, index) => ({
      ...makeSlide(index + 1, `Porsche 911 этап ${index + 1}`, `Porsche 911 раскрывает этап ${index + 1}.`, [`Деталь Porsche 911 ${index + 1} поддерживает общий вывод.`]),
      slideKind: index === 0 ? "title" as const : index === 4 ? "summary" as const : "content" as const,
      layout: index === 0 ? "hero" as const : index === 4 ? "summary" as const : "statement" as const,
    }));
    const acceptedFinalNarration = "Porsche 911 остается важной моделью, потому что узнаваемый дизайн развивался вместе с инженерными решениями. Каждое поколение сохраняло характер автомобиля и отвечало на новые технические задачи. Эта история показывает, почему преемственность может сочетаться с развитием.";
    const presentation = makePresentation({
      title: project.title,
      slides: slides.map((slide, index) => index === 4 ? {
        ...slide,
        title: "Спасибо за внимание",
        thesis: "Спасибо за внимание.",
        bullets: [],
        speakerNotes: acceptedFinalNarration,
      } : slide) as any,
      narrativePlan: slides.map((slide, index) => ({
        slideOrder: slide.order,
        slideTitle: index === 4 ? "Спасибо за внимание" : slide.title,
        slidePurpose: index === 4 ? "Собрать вывод." : `Раскрыть ${index % 2 ? "инженерную преемственность" : "дизайнерскую преемственность"} Porsche 911.`,
        keyMessage: index === 4 ? "Спасибо за внимание." : index % 2 ? "Инженерные решения развивали Porsche 911." : "Дизайнерская преемственность сохраняла Porsche 911 узнаваемым.",
        audienceQuestion: "Что важно запомнить?",
        transitionToNext: index === 4 ? "" : "Продолжить объяснение.",
      })),
    });
    const issues = findWeakConclusionIssues(presentation, project);
    const repaired = applyConclusionFallbacks(presentation, issues, project);
    const rebuilt = ensureEditableCanvas(repaired);

    expect(repaired.generatedText).toBe(presentation.generatedText);
    expect(repaired.slides.slice(0, 4)).toEqual(presentation.slides.slice(0, 4));
    expect(repaired.slides[4].speakerNotes).toBe(acceptedFinalNarration);
    expect(repaired.speechScript[4].text).toBe(acceptedFinalNarration);
    expect(repaired.slides[4].sourceRefs).toEqual(presentation.slides[4].sourceRefs);
    expect(repaired.slides[4].bullets.join(" ")).toMatch(/инженер|дизайнер|поколен|Porsche/iu);
    expect(findWeakConclusionIssues(repaired, project)).toEqual([]);
    expect(repaired.slideCount).toBe(5);
    expect(repaired.outline).toEqual(repaired.slides.map((slide) => slide.title));
    expect(repaired.narrativePlan).toHaveLength(5);
    expect(repaired.speechScript).toHaveLength(5);
    expect(auditSlideCanvas(rebuilt.slides[4].canvas!)).toEqual([]);
  });

  it("requires a matching source for precise visible claims and attaches one when the evidence matches", () => {
    const presentation = makePresentation({
      slides: [{
        ...makePresentation().slides[0],
        thesis: "The program began in 1964.",
        sourceRefs: [],
      }],
      slideCount: 1,
    });
    const datedSource = { ...source, excerpt: "The program began in 1964 and changed the curriculum." };

    expect(findFactualRiskIssues(presentation, [datedSource])).toHaveLength(1);

    const repaired = applySourceGroundingRepairs(presentation, [datedSource]);
    expect(repaired.slides[0].sourceRefs).toEqual([expect.objectContaining({ sourceId: datedSource.id })]);
    expect(findFactualRiskIssues(repaired, [datedSource])).toHaveLength(0);
    expect(findFactualRiskIssues({
      ...presentation,
      slides: [{ ...presentation.slides[0], sourceRefs: [{ sourceId: datedSource.id, label: datedSource.label, excerpt: datedSource.excerpt, page: null }] }],
    }, [datedSource])).toHaveLength(0);
  });

  it("generalizes unsupported precision without inventing a citation", () => {
    const presentation = makePresentation({
      slides: [{
        ...makePresentation().slides[0],
        thesis: "The program began in 1964.",
        sourceRefs: [],
      }],
      sources: [],
      slideCount: 1,
    });

    const repaired = applySourceGroundingRepairs(presentation, []);

    expect(repaired.slides[0].thesis).not.toContain("1964");
    expect(repaired.slides[0].sourceRefs).toEqual([]);
  });
  it("repairs leaked visible text from accepted narration without changing canonical speech or a custom canvas", async () => {
    const base = makePresentation();
    const accepted = "Porsche 911 remains influential because its recognizable design developed together with long-term engineering. Modern sports cars still balance performance, everyday use, and a durable identity through this example. The model helps explain how continuity can coexist with technical change.";
    const customCanvas = {
      ...base.slides[0].canvas!,
      elements: [...base.slides[0].canvas!.elements, {
        id: "custom-alignment-marker", type: "shape" as const, shape: "rect" as const,
        x: 4, y: 4, w: 8, h: 8, rotation: 0, zIndex: 99, opacity: 1, locked: false,
        fill: "#FFFFFF", stroke: "#FFFFFF", strokeWidth: 0,
      }],
    };
    const presentation = presentationSchema.parse({
      ...base,
      generatedText: `Slide 1: Porsche 911 today\n${accepted}\n\nSlide 2: ${base.slides[1].title}\n${base.slides[1].speakerNotes}`,
      narrativePlan: [{
        ...base.narrativePlan[0],
        slideTitle: "Porsche 911 today",
        keyMessage: "Porsche 911 combines durable design with engineering continuity.",
      }, base.narrativePlan[1]],
      slides: [{
        ...base.slides[0],
        canvas: customCanvas,
        title: "International crisis",
        thesis: "Diplomatic negotiations determined the global conflict.",
        bullets: ["Leaders managed international escalation", "The conflict changed the balance of power"],
        blocks: [{ type: "bullets", items: ["Negotiations reduced the risk of escalation"] }],
        speakerNotes: accepted,
      }, base.slides[1]],
      speechScript: [{ slideOrder: 1, slideTitle: "International crisis", text: accepted }, base.speechScript[1]],
    });
    const project = {
      id: "semantic-porsche", title: "History of Porsche 911", prompt: "Explain Porsche 911 for a university lesson",
      scenario: "lesson", level: "university_student", mode: "with_sources", slideCount: 2,
    } as const;

    expect(buildSlideSemanticContracts(presentation)[0].acceptedNarration).toBe(accepted);
    expect(findSlideSpeechAlignmentIssues(presentation)).toContainEqual(expect.objectContaining({
      slideId: "slide-1", category: "off_topic", field: "visibleText",
    }));

    const repaired = applySlideSpeechAlignmentFallbacks(presentation, findSlideSpeechAlignmentIssues(presentation), project);
    expect(repaired.generatedText).toBe(presentation.generatedText);
    expect(repaired.slides[0].speakerNotes).toBe(accepted);
    expect(repaired.speechScript[0].text).toBe(accepted);
    expect(repaired.slides[0].title).not.toBe("International crisis");
    expect(repaired.slides[0].thesis.split(/\s+/).length).toBeGreaterThan(3);
    expect(repaired.slides[0].thesis.split(/\s+/).length).toBeLessThanOrEqual(26);
    expect(repaired.slides[0].thesis.length).toBeLessThan(220);
    expect(repaired.slides[0].canvas).toEqual(customCanvas);
    expect(findSlideSpeechAlignmentIssues(repaired)).toHaveLength(0);

    const secondPass = await improvePresentationQuality(repaired, project, [source], "demo");
    expect(findSlideSpeechAlignmentIssues(secondPass)).toHaveLength(0);
  });

  it("restores a shifted speech-script item by slide order and accepts compact synonymous visible copy", () => {
    const base = makePresentation();
    const acceptedFirst = "Porsche 911 became a durable sports-car reference through design continuity and engineering development. The model also shows how technical change can preserve a recognizable identity.";
    const acceptedSecond = "The conclusion connects Porsche 911 with the wider history of sports-car engineering. This perspective explains why continuity matters when evaluating later technical changes.";
    const presentation = presentationSchema.parse({
      ...base,
      generatedText: `Slide 1: Porsche 911 legacy\n${acceptedFirst}\n\nSlide 2: Engineering conclusion\n${acceptedSecond}`,
      slides: [{ ...base.slides[0], title: "Porsche legacy", speakerNotes: acceptedFirst }, { ...base.slides[1], title: "Engineering conclusion", speakerNotes: acceptedSecond }],
      narrativePlan: [{ ...base.narrativePlan[0], slideTitle: "Porsche legacy", keyMessage: "Porsche 911 is a lasting sports-car reference." }, { ...base.narrativePlan[1], slideTitle: "Engineering conclusion", keyMessage: "Engineering continuity explains the conclusion." }],
      speechScript: [{ slideOrder: 2, slideTitle: "Porsche legacy", text: acceptedFirst }],
    });
    const project = { id: "shifted-script", title: "Porsche 911", prompt: "Explain Porsche engineering continuity", scenario: "lesson", level: "university_student", mode: "with_sources", slideCount: 2 } as const;

    const issues = findSlideSpeechAlignmentIssues(presentation);
    expect(issues).toContainEqual(expect.objectContaining({ category: "bad_narration", field: "speechScript" }));
    const repaired = applySlideSpeechAlignmentFallbacks(presentation, issues, project);
    expect(repaired.speechScript).toEqual([
      { slideOrder: 1, slideTitle: "Porsche legacy", text: acceptedFirst },
      { slideOrder: 2, slideTitle: "Engineering conclusion", text: acceptedSecond },
    ]);
    expect(findSlideSpeechAlignmentIssues(repaired)).toHaveLength(0);
  });

  it("detects and silently repairs cross-topic visible text without changing accepted narration or custom canvas", async () => {
    const base = makePresentation();
    const acceptedNotes = "Porsche 911 remains influential because the model connects recognizable design with long-term engineering development. Its modern impact is visible in how sports cars balance performance, everyday use, and a durable identity. The example helps compare continuity in the model line with changing technical expectations.";
    const customCanvas = {
      ...base.slides[0].canvas!,
      elements: [...base.slides[0].canvas!.elements, {
        id: "slide-1-custom-canvas-marker", type: "shape" as const, shape: "rect" as const,
        x: 0, y: 0, w: 12, h: 12, rotation: 0, zIndex: 99, opacity: 1, locked: false,
        fill: "#FFFFFF", stroke: "#FFFFFF", strokeWidth: 0,
      }],
    };
    const presentation = presentationSchema.parse({
      ...base,
      title: "История Porsche 911",
      generatedText: `Слайд 1: Современное влияние Porsche 911\n${acceptedNotes}\n\nСлайд 2: Вывод\n${base.slides[1].speakerNotes}`,
      narrativePlan: [{
        slideOrder: 1,
        slideTitle: "Современное влияние Porsche 911",
        slidePurpose: "Показать современное значение модели.",
        keyMessage: "Porsche 911 сохраняет влияние благодаря сочетанию дизайна и инженерной преемственности.",
        audienceQuestion: "Почему модель остается значимой?",
        transitionToNext: "Перейдем к выводу.",
      }, base.narrativePlan[1]],
      speechScript: [{ ...base.speechScript[0], slideTitle: "Современное влияние Porsche 911", text: acceptedNotes }, base.speechScript[1]],
      slides: [{
        ...base.slides[0],
        canvas: customCanvas,
        title: "Современное влияние модели",
        thesis: "Porsche 911 показывает, почему локальный конфликт стал мировым кризисом.",
        bullets: ["Решения лидеров усиливали международную напряженность", "Переговоры определяли развязку кризиса"],
        blocks: [{ type: "bullets", items: ["Локальный конфликт изменил мировой баланс сил", "Лидеры искали компромисс на переговорах"] }],
        speakerNotes: acceptedNotes,
      }, base.slides[1]],
    });
    const project = {
      id: "porsche-project", title: "История Porsche 911", prompt: "Подготовь учебную презентацию об истории Porsche 911",
      scenario: "lesson", level: "university_student", mode: "with_sources", slideCount: 2,
    } as const;

    const issues = findTopicRelevanceIssues(presentation, project);
    expect(issues).toContainEqual(expect.objectContaining({ slideId: "slide-1", severity: "major", category: "off_topic" }));
    const repaired = applyTopicRelevanceFallbacks(presentation, issues, project);
    expect(repaired.slides[0].thesis).not.toContain("конфликт");
    expect(repaired.slides[0].speakerNotes).toBe(acceptedNotes);
    expect(repaired.speechScript[0].text).toBe(acceptedNotes);
    expect(repaired.slides[0].canvas).toEqual(customCanvas);
    expect(findTopicRelevanceIssues(repaired, project)).toHaveLength(0);
    expect(() => presentationSchema.parse(repaired)).not.toThrow();

    const demoRepaired = await improvePresentationQuality(presentation, project, [source], "demo");
    expect(findTopicRelevanceIssues(demoRepaired, project)).toHaveLength(0);
    expect(() => presentationSchema.parse(demoRepaired)).not.toThrow();
  });

  it("does not flag a real conflict topic or a short title slide as off-topic", () => {
    const conflict = makePresentation({
      title: "Карибский кризис",
      slides: [{
        ...makeSlide(1, "Карибский кризис", "Международный конфликт поставил мир перед риском прямого столкновения.", [
          "Переговоры снизили риск эскалации",
          "Решения лидеров изменили ход кризиса",
        ]),
        speakerNotes: "Карибский кризис стал опасным международным конфликтом между сверхдержавами. Решения лидеров и переговоры помогли снизить риск эскалации. Этот пример показывает значение дипломатии в условиях мирового кризиса. История объясняет, почему взаимный контроль оставался необходимым после развязки.",
      }] as any,
    });
    const project = { id: "conflict", title: "Карибский кризис", prompt: "Объясни международный конфликт и переговоры", scenario: "lesson", level: "university_student", mode: "with_sources", slideCount: 1 };
    expect(findTopicRelevanceIssues(conflict, project)).toHaveLength(0);

    const titleOnly = makePresentation({ slides: [{ ...makeSlide(1, "Porsche 911", "История спортивного автомобиля.", []) }] as any });
    expect(findTopicRelevanceIssues(titleOnly, { ...project, title: "История Porsche 911", prompt: "Porsche 911" })).toHaveLength(0);
  });
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

  it("repairs an under-visualized concrete deck without changing its summary direction", () => {
    const slides = Array.from({ length: 6 }, (_, index) => ({
      ...makeSlide(index + 1, index === 5 ? "Porsche 911 conclusion" : `Porsche 911 generation ${index + 1}`, `Porsche 911 point ${index + 1} explains a distinct engineering detail.`, [`Engineering detail ${index + 1}`]),
      slideKind: index === 5 ? "summary" as const : "content" as const,
      layout: index === 5 ? "summary" as const : "statement" as const,
      visual: { type: "none" as const, title: "", description: "Concrete Porsche 911 study visual", leftLabel: "", rightLabel: "", items: [], rows: [] },
    }));
    const directions = slides.map((slide) => ({
      slideOrder: slide.order,
      visualRole: slide.slideKind === "summary" ? "summary" as const : "explain" as const,
      layoutIntent: slide.slideKind === "summary" ? "summary" as const : "cards" as const,
      imageStrategy: "none" as const,
      sceneTextMode: slide.slideKind === "summary" ? "takeaway" as const : "talk_sentences" as const,
      visualPrompt: `Text-led explanation for ${slide.title}`,
    }));
    const presentation = makePresentation({
      title: "Porsche 911 history",
      slides: slides as any,
      designBrief: {
        themeId: "studydeckEditorial", mood: "serious", audienceFit: "University report", visualMetaphor: "Porsche model history",
        colorIntent: "Readable contrast", typographyIntent: "Academic typography", layoutPrinciples: ["Use useful visuals"],
        imageStrategy: "Use diagrams when no relevant photo is available.", rhythm: { titleStyle: "academic", density: "low", imageFrequency: "frequent", sectionBreaks: true },
        slideDirections: directions,
      },
    });
    const project = { id: "porsche", title: "Porsche 911 history", prompt: "Explain a sports car model", scenario: "university_report", level: "university_student", mode: "with_sources", slideCount: 6 };

    expect(findVisualPlanIssues(presentation, project)).toContainEqual(expect.objectContaining({ message: expect.stringContaining("visual coverage") }));
    expect(findVisualPlanIssues(presentation, project)).toContainEqual(expect.objectContaining({ message: expect.stringContaining("Three consecutive") }));

    const repaired = applyVisualPlanFallbacks(presentation, findVisualPlanIssues(presentation, project));
    const contentDirections = repaired.designBrief!.slideDirections.slice(0, 5);
    expect(contentDirections.filter((direction) => direction.imageStrategy === "diagram" || direction.imageStrategy === "real_photo")).toHaveLength(3);
    expect(repaired.designBrief!.slideDirections.at(-1)).toMatchObject({ imageStrategy: "none", layoutIntent: "summary" });
    expect(findVisualPlanIssues(repaired, project)).toHaveLength(0);
  });

  it("flags duplicate Tavily object keys but leaves uploaded evidence untouched", () => {
    const slides = [1, 2, 3].map((order) => ({
      ...makeSlide(order, `Porsche 911 ${order}`, `Porsche 911 point ${order} stays specific.`, [`Distinct point ${order}`]),
      slideKind: "content" as const,
      visual: {
        type: "image" as const, title: "", description: "Porsche 911 reference photograph", leftLabel: "", rightLabel: "", items: [], rows: [],
        image: { url: `https://example.com/${order}.jpg`, objectKey: "projects/porsche/images/reused.jpg", provider: order === 3 ? "user" as const : "tavily" as const, alt: "Porsche 911 reference", query: "Porsche 911", sourceTitle: "Porsche archive", contentType: "image/jpeg", warnings: [] },
      },
    }));
    const presentation = makePresentation({ title: "Porsche 911 history", slides: slides as any });
    const issues = findVisualPlanIssues(presentation, { id: "porsche", title: "Porsche 911 history", prompt: "Explain the model", scenario: "lesson", level: "university_student", mode: "with_sources", slideCount: 3 });
    expect(issues).toContainEqual(expect.objectContaining({ slideId: "slide-2", field: "visual.image.objectKey" }));
    expect(issues).not.toContainEqual(expect.objectContaining({ slideId: "slide-3", field: "visual.image.objectKey" }));
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

  it("preserves accepted narration when a visual-quality repair proposes replacement speech", () => {
    const presentation = makePresentation();

    const repaired = applyQualityRepairs(presentation, {
      slides: [{
        slideId: "slide-1",
        title: "Improved opening title",
        speakerNotes: "This replacement note is intentionally too short.",
      }],
      speechScript: [{
        slideOrder: 1,
        slideTitle: "Improved opening title",
        text: "This replacement script is intentionally too short.",
      }],
    });

    expect(repaired.slides[0].title).toBe("Improved opening title");
    expect(repaired.slides[0].speakerNotes).toBe(presentation.slides[0].speakerNotes);
    expect(repaired.speechScript[0].text).toBe(presentation.speechScript[0].text);
    expect(repaired.speechScript[0].slideTitle).toBe("Improved opening title");
  });

  it("restores validated accepted narration after a later presentation repair", () => {
    const presentation = makePresentation();
    const acceptedNotes = [
      "The opening defines the central analytical question for the university discussion and identifies why the evidence matters. It connects the first documented point to the research task so the audience can follow the reasoning. This framing supports the later conclusion without using a stock transition.",
      "The conclusion links the practical finding to the analytical question and explains why the outcome matters for the proposed decision. It compares the final implication with the starting evidence instead of repeating a generic summary. This ending leaves the audience with a specific result to defend.",
    ];
    const acceptedNarration = presentation.slides.map((slide, index) =>
      `\u0421\u043b\u0430\u0439\u0434 ${slide.order}: ${slide.title}\n${acceptedNotes[index]}`,
    ).join("\n\n");
    const regressed = presentationSchema.parse({
      ...presentation,
      generatedText: "A later repair replaced the accepted narration.",
      slides: presentation.slides.map((slide) => ({ ...slide, speakerNotes: "Too short." })),
      speechScript: presentation.speechScript.map((item) => ({ ...item, text: "Too short." })),
    });
    const project = {
      id: "project-1",
      title: "Quality deck",
      prompt: "Prepare a university seminar report about a quality topic",
      scenario: "university_report",
      level: "university_student",
      mode: "with_sources",
      slideCount: 2,
    } as const;

    const restored = preserveAcceptedNarration(regressed, acceptedNarration, project);

    expect(restored.generatedText).toBe(acceptedNarration);
    expect(restored.slides.map((slide) => slide.speakerNotes)).toEqual(acceptedNotes);
    expect(restored.speechScript.map((item) => item.text)).toEqual(acceptedNotes);
  });

  it("restores the accepted narration text instead of retaining a divergent generatedText", () => {
    const presentation = makePresentation({ generatedText: "An altered generated text." });
    const acceptedNarration = "\u0421\u043b\u0430\u0439\u0434 1: Accepted\nA complete accepted narration with enough words for the first slide. It remains the canonical speech text.\n\n\u0421\u043b\u0430\u0439\u0434 2: Conclusion\nA complete accepted narration with enough words for the final slide. It remains the canonical speech text.";

    expect(preserveAcceptedGeneratedText(presentation, acceptedNarration).generatedText).toBe(acceptedNarration);
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

  it("finds unfinished visible slots but permits short labels", () => {
    const base = makePresentation();
    const presentation = {
      ...base,
      slides: [{
        ...base.slides[0],
        thesis: "Porsche 911 \u043f\u043e\u043a\u0430\u0437\u0430\u043b.",
        bullets: ["\u042d\u0442\u043e \u043f\u043e\u0437\u0432\u043e\u043b\u0438\u0442 \u043c\u043e\u0434\u0435\u043b\u0438 \u043e\u0441\u0442\u0430\u0432\u0430\u0442\u044c\u0441\u044f \u043e\u0434\u043d\u043e\u0439 \u0438\u0437 \u0441\u0430\u043c\u044b\u0445 \u0436\u0435\u043b\u0430\u043d\u043d\u044b\u0445 \u0432."],
        blocks: [{ type: "callout" as const, content: "\u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0430\u044f \u0432\u0434\u043e\u0445\u043d\u043e\u0432\u043b\u044f\u0442\u044c \u0438 \u0443\u0434\u0438\u0432\u043b\u044f\u0442\u044c \u0441\u0432\u043e\u0438\u043c\u0438." }],
        visual: { ...base.slides[0].visual, leftLabel: "1963", rightLabel: "Carrera RS" },
      }],
    };

    const fields = findVisibleTextIntegrityIssues(presentation).map((issue) => issue.field);
    expect(fields).toEqual(expect.arrayContaining(["thesis", "bullets.0", "blocks.0.content"]));
    expect(fields).not.toEqual(expect.arrayContaining(["visual.leftLabel", "visual.rightLabel"]));
  });

  it("removes repeated slide copy through accepted narration without losing schema, sources, speech, or a custom canvas", () => {
    const base = makePresentation();
    const customCanvas = {
      ...base.slides[0].canvas!,
      elements: [...base.slides[0].canvas!.elements, {
        id: "custom-duplicate-marker", type: "shape" as const, shape: "rect" as const,
        x: 2, y: 2, w: 5, h: 5, rotation: 0, zIndex: 99, opacity: 1, locked: false,
        fill: "#FFFFFF", stroke: "#FFFFFF", strokeWidth: 0,
      }],
    };
    const presentation = presentationSchema.parse({
      ...base,
      slides: [{
        ...base.slides[0],
        canvas: customCanvas,
        thesis: "The Porsche 911 combines design continuity with engineering change.",
        bullets: ["The Porsche 911 combines design continuity with engineering change."],
      }, base.slides[1]],
    });
    const project = { id: "duplicate", title: "Porsche 911", prompt: "Explain Porsche 911", scenario: "lesson", level: "university_student", mode: "with_sources", slideCount: 2 } as const;
    const issues = findIntraSlideDuplicateIssues(presentation);

    expect(issues).toContainEqual(expect.objectContaining({ slideId: "slide-1", field: "bullets.0", category: "duplicate" }));
    const repaired = applyVisibleTextIntegrityFallbacks(presentation, issues, project);
    expect(() => presentationSchema.parse(repaired)).not.toThrow();
    expect(findIntraSlideDuplicateIssues(repaired)).toHaveLength(0);
    expect(repaired.slides[0].speakerNotes).toBe(presentation.slides[0].speakerNotes);
    expect(repaired.speechScript).toEqual(presentation.speechScript.map((item) => ({ ...item, slideTitle: repaired.slides[item.slideOrder - 1].title })));
    expect(repaired.slides[0].sourceRefs).toEqual(presentation.slides[0].sourceRefs);
    expect(repaired.slides[0].canvas).toEqual(customCanvas);
  });

  it("detects a repeated central message on non-adjacent slides and permits distinct timeline stages", () => {
    const duplicateDeck = makePresentation({
      slides: [
        makeSlide(1, "Origins", "The Porsche 911 combined design continuity with engineering change.", ["The early model shaped the later identity"]),
        makeSlide(2, "Context", "A separate historical context explains the first market conditions.", ["The audience compares another cause"]),
        makeSlide(3, "Legacy", "The Porsche 911 combined design continuity with engineering change.", ["The early model shaped the later identity"]),
      ] as any,
    });
    expect(findDeckWideDuplicateIssues(duplicateDeck)).toContainEqual(expect.objectContaining({ slideId: "slide-3", category: "duplicate" }));

    const timeline = makePresentation({
      slides: [
        makeSlide(1, "1963 launch", "The first generation introduced the Porsche 911 as a new sports car.", ["The launch established the original design"]),
        makeSlide(2, "1973 update", "The Carrera RS changed performance through a lighter construction.", ["The update created a distinct engineering stage"]),
        makeSlide(3, "1989 transition", "The 964 generation added a new technical platform.", ["The later stage changed the production approach"]),
      ] as any,
    });
    expect(findDeckWideDuplicateIssues(timeline)).toHaveLength(0);
  });

  it("flags and safely repairs BMW 328 as a BMW M model without inventing a source", () => {
    const bmwSource = { ...source, id: "bmw-history", label: "BMW history", excerpt: "BMW 328 was an early BMW sports car. BMW M began in 1972." };
    const presentation = makePresentation({
      sources: [bmwSource],
      slides: [makeSlide(1, "BMW 328", "BMW 328 — BMW M model from 1936.", ["BMW M began in 1972."]), makeSlide(2, "BMW M", "BMW M developed later.", ["The division formed a separate performance line."])] as any,
    });
    const repaired = applyEntityCategoryMismatchRepairs(presentation);
    expect(findEntityCategoryMismatchIssues(presentation)).toHaveLength(1);
    expect(findEntityCategoryMismatchIssues(repaired)).toHaveLength(0);
    expect(repaired.slides[0].sourceRefs).toEqual(presentation.slides[0].sourceRefs);
    expect(repaired.slides[0].thesis).toContain("ранняя модель BMW");
  });

  it("flags a politics visual in an automotive deck and replaces it from the accepted story", () => {
    const project = { id: "bmw-topic", title: "История BMW", prompt: "Автомобили BMW и их развитие", scenario: "lesson", level: "university", mode: "with_sources", slideCount: 2 } as const;
    const presentation = makePresentation({
      title: project.title,
      slides: [{ ...makeSlide(1, "BMW 328", "BMW 328 показывает ранний этап истории марки.", ["Автомобиль задал важный ориентир для марки."]), visual: { ...makeSlide(1, "x", "x", []).visual, description: "Уроки для политики: переговоры мировых лидеров и дипломатия" } }, makeSlide(2, "BMW M", "BMW M развивает спортивное направление марки.", ["Подразделение стало отдельной частью истории BMW."])] as any,
    });
    const issues = findOffTopicVisualIssues(presentation, project);
    expect(issues).toContainEqual(expect.objectContaining({ slideId: "slide-1", category: "off_topic", field: "visual.description" }));
    const repaired = applyTopicRelevanceFallbacks(presentation, issues, project);
    expect(repaired.slides[0].visual.description).not.toContain("политики");
  });

  it("blocks an unfulfilled image and rejects generated canvas text that diverges from canonical fields", () => {
    const base = makePresentation();
    const invalid = presentationSchema.parse({
      ...base,
      slides: base.slides.map((slide, index) => index === 0 ? {
        ...slide,
        visual: { ...slide.visual, type: "image", image: undefined },
        canvas: {
          ...slide.canvas!,
          elements: slide.canvas!.elements.map((element) => element.id === `${slide.id}-title` && element.type === "text"
            ? { ...element, text: "Wrong title" }
            : element),
        },
      } : slide),
    });
    expect(findVisualFulfillmentIssues(invalid)).toContainEqual(expect.objectContaining({ severity: "blocker", field: "visual.image.url" }));
    expect(findCanvasCanonicalContentIssues(invalid)).toContainEqual(expect.objectContaining({ severity: "blocker", field: "canvas" }));
    expect(productionQualityReleaseResult(invalid, invalid.sources, {
      id: "quality", title: invalid.title, prompt: invalid.title, scenario: invalid.scenario, level: invalid.level, mode: "with_sources", slideCount: invalid.slideCount,
    }).finalDisposition).toBe("rejected");
  });

  it("blocks image-focus layouts until a real photo URL has been fulfilled", () => {
    const base = makePresentation();
    const invalid = presentationSchema.parse({
      ...base,
      slides: base.slides.map((slide, index) => index === 0 ? { ...slide, layout: "image-focus" as const } : slide),
    });
    expect(findVisualFulfillmentIssues(invalid)).toContainEqual(expect.objectContaining({
      slideId: "slide-1",
      severity: "blocker",
      field: "visual.image.url",
    }));
  });
});
