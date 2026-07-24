import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditSlideCanvas, presentationSchema, PREMIUM_PRESENTATION_THEMES } from "@studydeck/shared";
import { prepareGenerationSources, repairPresentationLayout } from "./generation.js";
import { searchWebSources } from "./web-search.js";
import { readObjectBuffer } from "../storage.js";
import { extractTextFromSource } from "./extract.js";

const { reserveCostEnvelope, settleCostEnvelope, failCostEnvelope, costEnvelope, prismaMock } = vi.hoisted(() => ({
  reserveCostEnvelope: vi.fn(),
  settleCostEnvelope: vi.fn(),
  failCostEnvelope: vi.fn(),
  costEnvelope: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  prismaMock: {
    source: { create: vi.fn(), deleteMany: vi.fn(), update: vi.fn() },
    costEnvelope: undefined as unknown,
    operationalEvent: { create: vi.fn().mockResolvedValue({}) },
  },
}));

prismaMock.costEnvelope = costEnvelope;

vi.mock("../prisma.js", () => ({
  getPrisma: () => prismaMock,
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

vi.mock("../cost-envelope.js", () => ({
  reserveCostEnvelope,
  settleCostEnvelope,
  failCostEnvelope,
}));

describe("prepareGenerationSources", () => {
  beforeEach(() => {
    vi.mocked(searchWebSources).mockReset();
    vi.mocked(readObjectBuffer).mockReset();
    vi.mocked(extractTextFromSource).mockReset();
    reserveCostEnvelope.mockReset();
    settleCostEnvelope.mockReset();
    failCostEnvelope.mockReset();
    costEnvelope.findUnique.mockReset();
    costEnvelope.findUniqueOrThrow.mockReset();
    costEnvelope.update.mockReset();
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

  it("keeps uploaded material when refreshing web research fails", async () => {
    vi.mocked(searchWebSources).mockRejectedValue(new Error("Tavily search failed: 503 unavailable"));

    const sources = await prepareGenerationSources({
      id: "project-web-fallback",
      prompt: "AI in education",
      mode: "with_sources",
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

    expect(sources).toEqual([
      expect.objectContaining({ id: "source-1", label: "Lecture notes" }),
    ]);
  });

  it("keeps the previous web research when a refresh fails", async () => {
    vi.mocked(searchWebSources).mockRejectedValue(new Error("Tavily search failed: 503 unavailable"));

    const sources = await prepareGenerationSources({
      id: "project-stored-web-fallback",
      prompt: "AI in education",
      mode: "with_sources",
      speechDraft: null,
      sources: [{
        id: "web-source-1",
        label: "Previously saved research",
        type: "WEB",
        size: 0,
        objectKey: null,
        url: "https://example.com/research",
        excerpt: "Previously verified research remains available during a temporary outage.",
        text: "Previously verified research remains available during a temporary outage.",
      }],
    });

    expect(sources).toEqual([
      expect.objectContaining({ id: "web-source-1", label: "Previously saved research" }),
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

  it("keeps a cached source excerpt when its uploaded object can no longer be read", async () => {
    vi.mocked(readObjectBuffer).mockRejectedValue(new Error("MinIO read timed out"));

    const sources = await prepareGenerationSources({
      id: "project-cached-upload",
      prompt: "AI in education",
      mode: "standard",
      speechDraft: "Accepted speech remains available.",
      sources: [{
        id: "source-cached-upload",
        label: "Lecture notes",
        type: "PDF",
        size: 200,
        objectKey: "projects/project-cached-upload/source.pdf",
        url: null,
        excerpt: "Previously extracted notes about AI feedback for university students.",
        text: "",
      }],
    });

    expect(sources).toEqual([
      expect.objectContaining({
        id: "source-cached-upload",
        excerpt: "Previously extracted notes about AI feedback for university students.",
      }),
    ]);
    expect(searchWebSources).not.toHaveBeenCalled();
  });

  it("uses the project brief when web research returns no acceptable sources", async () => {
    vi.mocked(searchWebSources).mockResolvedValue([]);

    const sources = await prepareGenerationSources({
      id: "project-empty",
      prompt: "Short topic",
      mode: "with_sources",
      speechDraft: "",
      sources: [],
    });

    expect(sources).toEqual([
      expect.objectContaining({ id: "project-empty-project-prompt", type: "PROMPT", label: "Project brief" }),
    ]);
    expect(searchWebSources).toHaveBeenCalledWith({ prompt: "Short topic", title: undefined });
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

  it("creates one persisted mandatory snapshot and reuses it on BullMQ replay", async () => {
    const policySnapshot = { buckets: { sources: "0.50000000" } };
    const snapshot = {
      version: 1,
      capturedAt: "2026-07-24T10:00:00.000Z",
      provenance: { provider: "tavily", queryAt: "2026-07-24T10:00:00.000Z" },
      sources: [
        { sourceId: "saved-1", title: "One", url: "https://nasa.gov/one", evidenceExcerpt: "Evidence one" },
        { sourceId: "saved-2", title: "Two", url: "https://esa.int/two", evidenceExcerpt: "Evidence two" },
        { sourceId: "saved-3", title: "Three", url: "https://example.edu/three", evidenceExcerpt: "Evidence three" },
      ],
    };
    costEnvelope.findUnique.mockResolvedValueOnce({ sourceSnapshot: null, policySnapshot });
    costEnvelope.findUniqueOrThrow.mockResolvedValue({ policySnapshot });
    reserveCostEnvelope.mockResolvedValue({ status: "reserved" });
    settleCostEnvelope.mockResolvedValue({ status: "settled" });
    const created = ["saved-1", "saved-2", "saved-3"].map((id, index) => ({ id, label: ["One", "Two", "Three"][index], type: "WEB", size: 0, objectKey: null, excerpt: `Evidence ${["one", "two", "three"][index]}`, url: [`https://nasa.gov/one`, `https://esa.int/two`, `https://example.edu/three`][index] }));
    vi.mocked(prismaMock.source.create).mockImplementation(async () => created.shift());
    vi.mocked(searchWebSources).mockResolvedValue([
      { id: "web-1", label: "One", type: "WEB", size: 0, excerpt: "Evidence one", url: "https://nasa.gov/one" },
      { id: "web-2", label: "Two", type: "WEB", size: 0, excerpt: "Evidence two", url: "https://esa.int/two" },
      { id: "web-3", label: "Three", type: "WEB", size: 0, excerpt: "Evidence three", url: "https://example.edu/three" },
    ]);

    const project = { id: "project-snapshot", prompt: "Saturn", mode: "standard", speechDraft: null, sources: [] };
    const first = await prepareGenerationSources(project, { refreshWeb: true, costEnvelopeId: "envelope-1" });
    expect(first.map((source) => source.id)).toEqual(["saved-1", "saved-2", "saved-3"]);
    expect(searchWebSources).toHaveBeenCalledTimes(1);
    expect(reserveCostEnvelope).toHaveBeenCalledWith(expect.objectContaining({ bucket: "sources", idempotencyKey: "envelope-1:mandatory-source-search" }));

    costEnvelope.findUnique.mockResolvedValueOnce({ sourceSnapshot: snapshot, policySnapshot });
    const replay = await prepareGenerationSources(project, { refreshWeb: true, costEnvelopeId: "envelope-1" });
    expect(replay.map((source) => source.id)).toEqual(["saved-1", "saved-2", "saved-3"]);
    expect(searchWebSources).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate Tavily work when a concurrent retry owns the source reservation", async () => {
    const policySnapshot = { buckets: { sources: "0.50000000" } };
    costEnvelope.findUnique.mockResolvedValue({ sourceSnapshot: null, policySnapshot });
    costEnvelope.findUniqueOrThrow.mockResolvedValue({ policySnapshot });
    reserveCostEnvelope.mockResolvedValue({ status: "reserved", idempotent: true });

    await expect(prepareGenerationSources({ id: "project-in-flight", prompt: "Saturn", mode: "standard", speechDraft: null, sources: [] }, { refreshWeb: true, costEnvelopeId: "envelope-in-flight" }))
      .rejects.toThrow("already in progress");
    expect(searchWebSources).not.toHaveBeenCalled();
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
    expect(repaired.slides[0].visual.type).not.toBe("image");
    expect(repaired.presentationTheme?.themeId).toBe("academicClean");
    expect(repaired.designBrief).toBeUndefined();
    expect(repaired.slides.flatMap((slide) => auditSlideCanvas(slide.canvas!))).toEqual([]);
  });
});
