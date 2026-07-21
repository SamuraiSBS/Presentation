import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditSlideCanvas, presentationSchema, PREMIUM_PRESENTATION_THEMES } from "@studydeck/shared";
import { prepareGenerationSources, repairPresentationLayout } from "./generation.js";
import { searchWebSources } from "./web-search.js";

vi.mock("../prisma.js", () => ({
  getPrisma: () => ({
    source: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
  }),
}));

vi.mock("../storage.js", () => ({
  readObjectBuffer: vi.fn(),
}));

vi.mock("./extract.js", () => ({
  extractTextFromSource: vi.fn(),
}));

vi.mock("./image-search.js", () => ({
  enrichPresentationImages: vi.fn(),
}));

vi.mock("./web-search.js", () => ({
  searchWebSources: vi.fn(),
}));

describe("prepareGenerationSources", () => {
  beforeEach(() => {
    vi.mocked(searchWebSources).mockReset();
  });

  it("uses existing extracted sources without network search", async () => {
    const sources = await prepareGenerationSources({
      id: "project-with-notes",
      prompt: "AI in education",
      mode: "standard",
      speechDraft: null,
      sources: [{
        id: "source-1",
        label: "Lecture notes",
        type: "TXT",
        size: 200,
        objectKey: null,
        url: null,
        excerpt: "AI helps universities personalize feedback and automate routine checks.",
        text: "",
      }],
    });

    expect(searchWebSources).not.toHaveBeenCalled();
    expect(sources).toEqual([
      expect.objectContaining({
        id: "source-1",
        label: "Lecture notes",
        type: "TXT",
        excerpt: "AI helps universities personalize feedback and automate routine checks.",
      }),
    ]);
  });

  it("uses accepted speech text when no uploaded or web sources are available", async () => {
    vi.mocked(searchWebSources).mockResolvedValue([]);

    const sources = await prepareGenerationSources({
      id: "project-caribbean-crisis",
      prompt: "Карибский кризис",
      mode: "with_sources",
      speechDraft: [
        "Слайд 1: Введение в Карибский кризис",
        "Карибский кризис был противостоянием СССР и США в 1962 году. Он стал одним из самых опасных моментов холодной войны. Размещение ракет на Кубе резко повысило риск прямого столкновения. Переговоры позволили сторонам выйти из кризиса. Этот пример показывает, насколько важны дипломатия и контроль над эскалацией.",
      ].join("\n"),
      sources: [],
    });

    expect(sources).toEqual([
      expect.objectContaining({
        id: "project-caribbean-crisis-accepted-speech",
        label: "Accepted speech text",
        type: "PROMPT",
      }),
    ]);
    expect(sources[0].excerpt).toContain("Карибский кризис был противостоянием СССР и США");
  });

  it("fails clearly when no source or accepted speech fallback exists", async () => {
    vi.mocked(searchWebSources).mockResolvedValue([]);

    await expect(prepareGenerationSources({
      id: "project-empty",
      prompt: "Short topic",
      mode: "with_sources",
      speechDraft: "",
      sources: [],
    })).rejects.toThrow("No source material was found for generation");
  });

  it("uses only approved stored web sources for presentation generation", async () => {
    const sources = await prepareGenerationSources({
      id: "project-approved-web",
      prompt: "Approved research",
      mode: "with_sources",
      speechDraft: "Слайд 1: Тема\nДостаточно длинный принятый текст выступления для презентации.",
      sources: [
        { id: "keep", label: "Approved", type: "WEB", size: 0, objectKey: null, url: "https://example.com/keep", excerpt: "Useful evidence", text: "Useful evidence", included: true },
        { id: "drop", label: "Excluded", type: "WEB", size: 0, objectKey: null, url: "https://example.com/drop", excerpt: "Weak evidence", text: "Weak evidence", included: false },
      ],
    }, { refreshWeb: false });

    expect(searchWebSources).not.toHaveBeenCalled();
    expect(sources.map((source) => source.id)).toEqual(["keep"]);
  });

  it("never performs factual web research for requirements-driven projects", async () => {
    const sources = await prepareGenerationSources({
      id: "defense-project",
      prompt: "Защита проекта",
      mode: "with_sources",
      workflow: "requirements_driven",
      speechDraft: "Слайд 1: Проект\nПодтверждённый автором текст проекта.",
      sources: [],
    });

    expect(searchWebSources).not.toHaveBeenCalled();
    expect(sources[0]).toMatchObject({ id: "defense-project-accepted-speech", type: "PROMPT" });
  });

  it("repairs an unsafe generated layout locally without another AI request", () => {
    const presentation = presentationSchema.parse({
      id: "layout-repair",
      title: "Layout repair",
      scenario: "lesson",
      level: "school",
      slideCount: 1,
      generationMode: "openai",
      generatedText: "Accepted narration remains available for the presenter.",
      presentationTheme: PREMIUM_PRESENTATION_THEMES.editorialMagazine,
      designBrief: {
        themeId: "editorialMagazine",
        mood: "serious",
        audienceFit: "University students",
        visualMetaphor: "An editorial narrative",
        colorIntent: "Warm editorial palette",
        typographyIntent: "Readable text",
        rhythm: { titleStyle: "editorial", density: "medium", imageFrequency: "balanced", sectionBreaks: true },
        slideDirections: [{ slideOrder: 1, visualRole: "explain", layoutIntent: "diagram", imageStrategy: "diagram", visualPrompt: "A simple explanatory diagram" }],
        visualDirection: "Editorial layout",
        layoutPrinciples: [],
        imageStrategy: "diagram",
      },
      sources: [],
      outline: ["Long layout claim"],
      narrativePlan: [{
        slideOrder: 1,
        slideTitle: "Long layout claim",
        slidePurpose: "Explain the central idea.",
        keyMessage: "The presentation keeps moving after a local layout repair.",
        audienceQuestion: "What happens after an unsafe canvas is detected?",
        transitionToNext: "",
      }],
      speechScript: [{ slideOrder: 1, slideTitle: "Long layout claim", text: "Accepted narration remains available for the presenter." }],
      slides: [{
        id: "slide-1",
        order: 1,
        title: "A deliberately long slide title that must not force the generator to fail",
        slideKind: "content",
        layout: "image-focus",
        thesis: "The local layout repair keeps presentation generation moving without asking the AI provider to create the slide again.",
        bullets: ["The original narration remains intact for the presenter and editor."],
        definition: null,
        keyConcepts: [],
        visual: {
          type: "illustration",
          title: "",
          description: "A long visual description used only to exercise the conservative layout fallback.",
          leftLabel: "",
          rightLabel: "",
          items: [],
          rows: [],
          image: { url: "https://example.com/image.jpg", alt: "Example image", query: "example", width: 1200, height: 800, byteSize: 1000, provider: "archive", warnings: [], objectKey: "image.jpg", sourceUrl: "https://example.com/image.jpg", contentType: "image/jpeg", sourceTitle: "Example" },
        },
        highlights: [],
        blocks: [],
        speakerNotes: "The local layout repair keeps presentation generation moving. The accepted narration remains available for the presenter and editor.",
        timingSeconds: 45,
        sourceRefs: [],
      }],
    });

    const repaired = repairPresentationLayout(presentation);

    expect(repaired.slides[0].layout).toBe("statement");
    expect(repaired.slides[0].visual.image).toBeUndefined();
    expect(repaired.presentationTheme?.themeId).toBe("academicClean");
    expect(repaired.designBrief).toBeUndefined();
    expect(repaired.slides.flatMap((slide) => auditSlideCanvas(slide.canvas!))).toEqual([]);
  });
});
