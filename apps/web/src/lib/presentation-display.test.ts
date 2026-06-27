import { describe, expect, it } from "vitest";
import { sanitizePresentationForDisplay, sanitizeProjectForDisplay, useStoredImageUrls } from "./presentation-display";

const forbiddenNarrationFragments = [
  'Слайд "',
  "объясняет часть темы",
  "опорные пункты",
  "Затем стоит показать связь",
  "После этого можно закрепить",
  "основной смысл раскрывается",
  "рассказе про",
  "Примеры. Поэтому",
];
const forbiddenSlideTextFragments = [
  "Главная идея связана с темой",
  "Материал стоит разбирать",
  "смысловым частым",
  "смысловым частям",
  "Ключевые понятия помогают удержать структуру",
  "Пример или визуальная схема",
  "На слайде показано",
  "Этот слайд помогает",
  "Этот раздел объясняет",
  "Здесь собраны основные факты",
  "на картинке",
  "на изображении",
  "как показано на картинке",
];

describe("sanitizePresentationForDisplay", () => {
  it("derives structured fields for legacy slides", () => {
    const document = sanitizePresentationForDisplay({
      id: "presentation-1",
      title: "Legacy deck",
      scenario: "lesson",
      level: "beginner",
      slideCount: 2,
      generationMode: "demo",
      generatedText: "Слайд 1: Legacy title\nLegacy thesis.\n\nСлайд 2: Legacy summary\nFinal takeaway.",
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
    expect(document.generatedText).toContain("Слайд 1: Legacy title\nLegacy thesis.");
    expect(document.slides[0].thesis).toContain("Legacy thesis");
    expect(document.slides[1].slideKind).toBe("summary");
    expect(document.slides[1].bullets).toEqual(["First takeaway", "Second takeaway", "Third takeaway"]);
    expect(document.slides[1].visual.type).toBe("none");
    expect(document.presentationTheme?.preset).toBeTruthy();
  });

  it("preserves a saved presentation theme during display cleanup", () => {
    const document = sanitizePresentationForDisplay({
      id: "presentation-1",
      title: "Saved theme",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Saved theme"],
      presentationTheme: {
        preset: "tech",
        mood: "neutral",
        colors: {
          background: "#101820",
          surface: "#172331",
          surfaceAlt: "#20364A",
          text: "#F1F7FB",
          muted: "#B8CAD8",
          accent: "#38BDF8",
          accentAlt: "#A3E635",
          line: "#315064",
        },
        fonts: {
          heading: "Aptos Display",
          body: "Aptos",
          tone: "technical",
        },
      },
      speechScript: [{ slideOrder: 1, slideTitle: "Saved theme", text: "Narration." }],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "Saved theme",
          slideKind: "title",
          layout: "hero",
          thesis: "Intro.",
          bullets: [],
          definition: null,
          keyConcepts: [],
          visual: { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] },
          highlights: [],
          blocks: [{ type: "callout", content: "Intro." }],
          speakerNotes: "Intro notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
    });

    expect(document.presentationTheme?.preset).toBe("tech");
    expect(document.presentationTheme?.colors.accent).toBe("#38BDF8");
  });

  it("renders premium theme and canvas direction from a design brief", () => {
    const document = sanitizePresentationForDisplay({
      id: "presentation-premium",
      title: "Scientific systems",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "yandex",
      sources: [],
      outline: ["Scientific systems"],
      designBrief: {
        themeId: "scienceBoard",
        mood: "serious",
        audienceFit: "Students",
        visualMetaphor: "A laboratory board",
        colorIntent: "Cool and precise",
        typographyIntent: "Academic and readable",
        rhythm: {
          titleStyle: "academic",
          density: "medium",
          imageFrequency: "balanced",
          sectionBreaks: true,
        },
        slideDirections: [{
          slideOrder: 1,
          visualRole: "hero",
          layoutIntent: "diagram",
          imageStrategy: "diagram",
          visualPrompt: "A clean scientific system diagram",
        }],
      },
      speechScript: [{ slideOrder: 1, slideTitle: "Scientific systems", text: "Narration." }],
      slides: [{
        id: "slide-premium",
        order: 1,
        title: "Scientific systems",
        layout: "hero",
        blocks: [{ type: "callout", content: "A system connects several interacting parts." }],
        speakerNotes: "Narration.",
        timingSeconds: 45,
        sourceRefs: [],
      }],
    } as any);

    expect(document.presentationTheme?.themeId).toBe("scienceBoard");
    expect(document.slides[0].canvas?.elements.some((element) => element.id.includes("premium"))).toBe(true);
  });

  it("hides weak saved visual blocks but keeps useful visuals and images", () => {
    const document = sanitizePresentationForDisplay({
      id: "presentation-1",
      title: "Visual cleanup",
      scenario: "lesson",
      level: "beginner",
      slideCount: 4,
      generationMode: "demo",
      sources: [],
      outline: ["Title", "Weak schema", "Useful process", "Image slide"],
      speechScript: [],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "Title",
          slideKind: "title",
          layout: "hero",
          thesis: "Intro.",
          bullets: [],
          definition: null,
          keyConcepts: [],
          visual: { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] },
          highlights: [],
          blocks: [{ type: "callout", content: "Intro." }],
          speakerNotes: "Intro notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
        {
          id: "slide-2",
          order: 2,
          title: "Weak schema",
          slideKind: "content",
          layout: "bullets",
          thesis: "A weak schema has no concrete nodes.",
          bullets: ["First", "Second", "Third"],
          definition: null,
          keyConcepts: [],
          visual: { type: "schema", title: "Schema", description: "searchable scene", leftLabel: "", rightLabel: "", items: [], rows: [] },
          highlights: [],
          blocks: [{ type: "bullets", items: ["First", "Second", "Third"] }],
          speakerNotes: "Weak schema notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
        {
          id: "slide-3",
          order: 3,
          title: "Useful process",
          slideKind: "content",
          layout: "bullets",
          thesis: "A useful process has concrete steps.",
          bullets: ["Collect material", "Explain result", "Check output"],
          definition: null,
          keyConcepts: [],
          visual: {
            type: "process_diagram",
            title: "Process",
            description: "",
            leftLabel: "",
            rightLabel: "",
            items: [
              { label: "Collect material", text: "Gather facts." },
              { label: "Explain result", text: "Turn facts into an explanation." },
            ],
            rows: [],
          },
          highlights: [],
          blocks: [{ type: "bullets", items: ["Collect material", "Explain result", "Check output"] }],
          speakerNotes: "Useful process notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
        {
          id: "slide-4",
          order: 4,
          title: "Image slide",
          slideKind: "summary",
          layout: "summary",
          thesis: "Images should still be shown.",
          bullets: ["First", "Second", "Third"],
          definition: null,
          keyConcepts: [],
          visual: {
            type: "image",
            title: "Visual example",
            description: "students studying",
            leftLabel: "",
            rightLabel: "",
            items: [],
            rows: [],
            image: {
              url: "https://example.com/image.jpg",
              objectKey: "projects/project-1/images/slide-4.jpg",
              alt: "Students studying",
              query: "students studying",
              sourceTitle: "Example",
              provider: "tavily",
              contentType: "image/jpeg",
            },
          },
          highlights: [],
          blocks: [{ type: "bullets", items: ["First", "Second", "Third"] }],
          speakerNotes: "Image notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
    });

    expect(document.slides[1].visual.type).toBe("none");
    expect(document.slides[1].visual.description).toBe("searchable scene");
    expect(document.slides[2].visual.type).toBe("process_diagram");
    expect(document.slides[2].visual.items).toHaveLength(2);
    expect(document.slides[3].visual.type).toBe("image");
    expect(document.slides[3].layout).toBe("summary");
    expect(document.slides[3].visual.image?.url).toBe("https://example.com/image.jpg");
    expect(document.slides[3].visual.image?.objectKey).toBe("projects/project-1/images/slide-4.jpg");
    expect(document.slides[3].canvas?.elements.some((element) => element.type === "image" && element.url === "https://example.com/image.jpg")).toBe(true);
  });

  it("uses stored image assets for web display instead of external hotlinks", () => {
    const project = sanitizeProjectForDisplay({
      id: "project-1",
      presentation: {
        document: {
          id: "presentation-1",
          title: "Stored images",
          scenario: "lesson",
          level: "beginner",
          slideCount: 1,
          generationMode: "demo",
          sources: [],
          outline: ["Stored images"],
          speechScript: [],
          slides: [
            {
              id: "slide-1",
              order: 1,
              title: "Stored images",
              slideKind: "title",
              layout: "hero",
              thesis: "The image is stored in MinIO.",
              bullets: [],
              definition: null,
              keyConcepts: [],
              visual: {
                type: "image",
                title: "",
                description: "Stored image",
                leftLabel: "",
                rightLabel: "",
                items: [],
                rows: [],
                image: {
                  url: "https://external.example.com/image.jpg",
                  objectKey: "projects/project-1/images/slide-1.jpg",
                  alt: "Stored image",
                  query: "stored image",
                  sourceTitle: "External source",
                  provider: "tavily",
                  contentType: "image/jpeg",
                },
              },
              highlights: [],
              blocks: [{ type: "callout", content: "The image is stored in MinIO." }],
              speakerNotes: "Stored image notes.",
              timingSeconds: 45,
              sourceRefs: [],
            },
          ],
        },
      },
    } as any);

    const slide = project.presentation?.document.slides[0];
    expect(slide?.visual.image?.url).toBe("/api/projects/project-1/slides/slide-1/assets/visual-image");
    expect(slide?.canvas?.elements.find((element: { type: string; url?: string }) => element.type === "image")?.url)
      .toMatch(/^\/api\/projects\/project-1\/slides\/slide-1\/assets\//);

    const sanitizedAgain = sanitizeProjectForDisplay(project as any);
    expect(sanitizedAgain.presentation?.document.slides[0].visual.image?.url)
      .toBe("/api/projects/project-1/slides/slide-1/assets/visual-image");
    expect(sanitizedAgain.presentation?.document.slides[0].canvas?.elements.some((element: { type: string }) => element.type === "image"))
      .toBe(true);
  });

  it("restores a generated image when legacy canvas cleanup removed its background image", () => {
    const sanitized = sanitizePresentationForDisplay({
      id: "presentation-1",
      title: "Legacy stored image",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Legacy stored image"],
      speechScript: [],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "Legacy stored image",
          slideKind: "title",
          layout: "hero",
          thesis: "The old canvas lost its image element.",
          bullets: [],
          definition: null,
          keyConcepts: [],
          visual: {
            type: "image",
            title: "",
            description: "Stored image",
            leftLabel: "",
            rightLabel: "",
            items: [],
            rows: [],
            image: {
              url: "https://external.example.com/image.jpg",
              objectKey: "projects/project-1/images/slide-1.jpg",
              alt: "Stored image",
              query: "stored image",
              sourceTitle: "",
              provider: "tavily",
              contentType: "image/jpeg",
            },
          },
          highlights: [],
          blocks: [{ type: "callout", content: "The old canvas lost its image element." }],
          speakerNotes: "Image notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
    });
    const withoutCanvasImage = {
      ...sanitized,
      slides: sanitized.slides.map((slide) => ({
        ...slide,
        canvas: slide.canvas
          ? { ...slide.canvas, elements: slide.canvas.elements.filter((element) => element.type !== "image") }
          : slide.canvas,
      })),
    };

    const restored = useStoredImageUrls(withoutCanvasImage, "project-1");
    const image = restored.slides[0].canvas?.elements.find((element) => element.type === "image");

    expect(image?.url).toBe("/api/projects/project-1/slides/slide-1/assets/visual-image");
    expect(image?.objectKey).toBe("projects/project-1/images/slide-1.jpg");
  });

  it("removes keyword chips from slides prepared for display", () => {
    const document = sanitizePresentationForDisplay({
      id: "presentation-1",
      title: "Chip cleanup",
      scenario: "lesson",
      level: "beginner",
      slideCount: 2,
      generationMode: "demo",
      sources: [],
      outline: ["Title", "Summary"],
      speechScript: [],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "Title",
          slideKind: "title",
          layout: "hero",
          thesis: "Intro.",
          bullets: [],
          definition: null,
          keyConcepts: [{ label: "influence", icon: "idea" }],
          visual: { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] },
          highlights: [{ text: "culture", tone: "accent" }],
          blocks: [{ type: "callout", content: "Intro." }],
          speakerNotes: "Intro notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
        {
          id: "slide-2",
          order: 2,
          title: "Summary",
          slideKind: "summary",
          layout: "summary",
          thesis: "Summary.",
          bullets: ["First", "Second", "Third"],
          definition: null,
          keyConcepts: [{ label: "markets", icon: "map" }],
          visual: { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] },
          highlights: [{ text: "finance", tone: "warning" }],
          blocks: [{ type: "bullets", items: ["First", "Second", "Third"] }],
          speakerNotes: "Summary notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
    });

    expect(document.slides.every((slide) => slide.keyConcepts.length === 0)).toBe(true);
    expect(document.slides.every((slide) => slide.highlights.length === 0)).toBe(true);
  });

  it("removes generic filler and unsupported image references from saved slide text", () => {
    const document = sanitizePresentationForDisplay({
      id: "presentation-1",
      title: "Экология города",
      scenario: "lesson",
      level: "beginner",
      slideCount: 2,
      generatedText: "Слайд 1: Экология города\nIntro.\n\nСлайд 2: Воздух и транспорт\nТелефоны Samsung нужно раскрыть через конкретные факты.",
      generationMode: "yandex",
      sources: [],
      outline: ["Экология города", "Воздух и транспорт"],
      speechScript: [],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "Экология города",
          slideKind: "title",
          layout: "hero",
          thesis: "Городская среда зависит от транспорта, воздуха и поведения жителей.",
          bullets: [],
          definition: null,
          keyConcepts: [],
          visual: { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] },
          highlights: [],
          blocks: [{ type: "callout", content: "Городская среда зависит от транспорта, воздуха и поведения жителей." }],
          speakerNotes: "Intro notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
        {
          id: "slide-2",
          order: 2,
          title: "Воздух и транспорт",
          slideKind: "summary",
          layout: "summary",
          thesis: "Главная идея связана с темой: экология города.",
          bullets: [
            "Материал стоит разбирать по смысловым частям",
            "Ключевые понятия помогают удержать структуру",
            "Как показано на картинке, воздух становится чище",
          ],
          definition: null,
          keyConcepts: [],
          visual: {
            type: "image",
            title: "Визуальный пример",
            description: "Как показано на изображении, на картинке есть транспорт.",
            leftLabel: "",
            rightLabel: "",
            items: [{ label: "Материал стоит разбирать по смысловым частям", text: "" }],
            rows: [],
          },
          highlights: [],
          blocks: [{ type: "callout", content: "На слайде показано, что несуществующая тема раскрывается через картинку." }],
          speakerNotes: "Summary notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
    });

    const visibleText = [
      ...document.slides.flatMap((slide) => [
        slide.thesis,
        ...slide.bullets,
        ...slide.blocks.flatMap((block) => (block.type === "bullets" ? block.items : [block.content])),
        slide.visual.description,
      ]),
    ].join("\n");

    expect(document.slides[1].thesis).toContain("Воздух и транспорт");
    expect(document.slides[1].bullets.length).toBeGreaterThanOrEqual(1);
    expect(document.slides[1].visual.items).toEqual([]);
    expect(document.generatedText).not.toContain("нужно раскрыть через конкретные факты");
    expectNoForbiddenSlideText(visibleText);
  });

  it("replaces saved template narration with publicistic display text", () => {
    const templateNarration =
      'Слайд "Новая волна" объясняет часть темы "Русское кино" через одну главную мысль: кино стало разнообразнее. Сначала важно разобрать опорный пункт: появились онлайн-платформы. Затем стоит показать связь с другим элементом темы: зрители стали смотреть фильмы иначе. После этого можно закрепить объяснение через деталь: фестивальное кино стало заметнее. Примеры. Поэтому текст на слайде оставляет только опорные пункты, а основной смысл раскрывается в рассказе про "Новая волна".';

    const document = sanitizePresentationForDisplay({
      id: "presentation-1",
      title: "Русское кино",
      scenario: "school_report",
      level: "8-11 класс",
      slideCount: 1,
      generationMode: "yandex",
      sources: [],
      outline: ["Новая волна"],
      speechScript: [{ slideOrder: 1, slideTitle: "Новая волна", text: templateNarration }],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "Новая волна",
          slideKind: "title",
          layout: "hero",
          thesis: "Кино стало разнообразнее после появления онлайн-платформ.",
          bullets: ["Появились онлайн-платформы", "Зрительские привычки изменились", "Авторское кино стало заметнее"],
          definition: null,
          keyConcepts: [],
          visual: { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] },
          highlights: [],
          blocks: [{ type: "callout", content: "Кино стало разнообразнее после появления онлайн-платформ." }],
          speakerNotes: templateNarration,
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
    });

    expect(document.slides[0].speakerNotes).not.toBe(templateNarration);
    expect(document.speechScript[0].text).toBe(document.slides[0].speakerNotes);
    expect(document.slides[0].speakerNotes).toContain("Тема");
    expectNoForbiddenNarration([document.slides[0].speakerNotes, document.speechScript[0].text].join("\n"));
  });
});

function expectNoForbiddenNarration(text: string) {
  for (const fragment of forbiddenNarrationFragments) {
    expect(text).not.toContain(fragment);
  }
}

function expectNoForbiddenSlideText(text: string) {
  const lower = text.toLowerCase();
  for (const fragment of forbiddenSlideTextFragments) {
    expect(lower).not.toContain(fragment.toLowerCase());
  }
}
