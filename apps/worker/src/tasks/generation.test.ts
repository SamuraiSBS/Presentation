import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditSlideCanvas, presentationSchema, PREMIUM_PRESENTATION_THEMES } from "@studydeck/shared";
import { handleGenerationJob, hasAcceptedNarrationRecoveryArtifacts, prepareGenerationSources, repairPresentationLayout } from "./generation.js";
import { searchWebSources } from "./web-search.js";
import { readObjectBuffer } from "../storage.js";
import { extractTextFromSource } from "./extract.js";

const mandatorySourceSnapshot = {
  version: 1,
  capturedAt: "2026-07-29T12:00:00.000Z",
  provenance: { provider: "tavily" as const, queryAt: "2026-07-29T12:00:00.000Z" },
  sources: [
    { sourceId: "snapshot-1", title: "Source one", url: "https://example.edu/one", evidenceExcerpt: "Grounded evidence one." },
    { sourceId: "snapshot-2", title: "Source two", url: "https://example.edu/two", evidenceExcerpt: "Grounded evidence two." },
    { sourceId: "snapshot-3", title: "Source three", url: "https://example.edu/three", evidenceExcerpt: "Grounded evidence three." },
  ],
};

const { reserveCostEnvelope, settleCostEnvelope, failCostEnvelope, finalizeFailedCostEnvelope, captureGenerationError, generateNarrationDraft, generatePresentationFromNarration, buildLocalPresentationFromAcceptedNarration, enrichPresentationImages, materializePlannedVisuals, productionQualityReleaseResult, costEnvelope, prismaMock } = vi.hoisted(() => ({
  reserveCostEnvelope: vi.fn(),
  settleCostEnvelope: vi.fn(),
  failCostEnvelope: vi.fn(),
  finalizeFailedCostEnvelope: vi.fn(),
  captureGenerationError: vi.fn(),
  generateNarrationDraft: vi.fn(),
  generatePresentationFromNarration: vi.fn(),
  buildLocalPresentationFromAcceptedNarration: vi.fn(),
  enrichPresentationImages: vi.fn(),
  materializePlannedVisuals: vi.fn((presentation) => presentation),
  productionQualityReleaseResult: vi.fn(),
  costEnvelope: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  prismaMock: {
    source: { create: vi.fn(), deleteMany: vi.fn(), update: vi.fn() },
    costEnvelope: undefined as unknown,
    operationalEvent: { create: vi.fn().mockResolvedValue({}) },
    project: { update: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    generationJob: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    presentation: { findUnique: vi.fn(), upsert: vi.fn() },
    userActivityEvent: { create: vi.fn() },
    $transaction: vi.fn(),
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
  enrichPresentationImages,
}));

vi.mock("./web-search.js", () => ({
  searchWebSources: vi.fn(),
}));

vi.mock("./presentation.js", () => ({
  generateNarrationDraft,
  generatePresentationFromNarration,
  buildLocalPresentationFromAcceptedNarration,
}));

vi.mock("./presentation-quality.js", () => ({
  materializePlannedVisuals,
  productionQualityReleaseResult,
  findSpeechTimingIssues: () => [],
  findFactualRiskIssues: () => [],
}));

vi.mock("../cost-envelope.js", () => ({
  reserveCostEnvelope,
  settleCostEnvelope,
  failCostEnvelope,
  finalizeFailedCostEnvelope,
}));

vi.mock("../observability.js", () => ({
  captureGenerationError,
  errorLogFields: () => ({}),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  withTraceSpan: async (_name: string, _context: unknown, callback: () => Promise<unknown>) => callback(),
}));

describe("prepareGenerationSources", () => {
  beforeEach(() => {
    vi.mocked(searchWebSources).mockReset();
    vi.mocked(readObjectBuffer).mockReset();
    vi.mocked(extractTextFromSource).mockReset();
    reserveCostEnvelope.mockReset();
    settleCostEnvelope.mockReset();
    failCostEnvelope.mockReset();
    finalizeFailedCostEnvelope.mockReset();
    captureGenerationError.mockReset();
    generateNarrationDraft.mockReset();
    generatePresentationFromNarration.mockReset();
    buildLocalPresentationFromAcceptedNarration.mockReset();
    enrichPresentationImages.mockReset();
    materializePlannedVisuals.mockReset();
    materializePlannedVisuals.mockImplementation((presentation) => presentation);
    costEnvelope.findUnique.mockReset();
    costEnvelope.findUniqueOrThrow.mockReset();
    costEnvelope.update.mockReset();
    prismaMock.source.create.mockReset();
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

  it("allows the explicitly enabled accepted-speech presentation path without a source snapshot", async () => {
    const previous = process.env.ALLOW_PRESENTATION_WITHOUT_SOURCE_SNAPSHOT;
    process.env.ALLOW_PRESENTATION_WITHOUT_SOURCE_SNAPSHOT = "true";
    costEnvelope.findUnique.mockResolvedValue({ sourceSnapshot: null, policySnapshot: { buckets: { sources: "0.50000000" } } });

    try {
      const sources = await prepareGenerationSources({
        id: "project-accepted-speech",
        prompt: "Explain photosynthesis",
        mode: "fast_draft",
        speechDraft: "Accepted narration provides the complete instructional context for this controlled staging presentation.",
        sources: [],
      }, { refreshWeb: false, costEnvelopeId: "envelope-accepted-speech" });

      expect(sources).toEqual([expect.objectContaining({ type: "PROMPT", label: "Accepted speech text" })]);
      expect(searchWebSources).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.ALLOW_PRESENTATION_WITHOUT_SOURCE_SNAPSHOT;
      else process.env.ALLOW_PRESENTATION_WITHOUT_SOURCE_SNAPSHOT = previous;
    }
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
    expect(reserveCostEnvelope).toHaveBeenCalledWith(expect.objectContaining({ bucket: "sources", idempotencyKey: "envelope-1:mandatory-source-search:1" }));
    expect(settleCostEnvelope).toHaveBeenCalledWith({
      envelopeId: "envelope-1",
      idempotencyKey: "envelope-1:mandatory-source-search:1",
      actualRub: "0.50000000",
    });
    expect(failCostEnvelope).not.toHaveBeenCalled();

    costEnvelope.findUnique.mockResolvedValueOnce({ sourceSnapshot: snapshot, policySnapshot });
    const replay = await prepareGenerationSources(project, { refreshWeb: true, costEnvelopeId: "envelope-1" });
    expect(replay.map((source) => source.id)).toEqual(["saved-1", "saved-2", "saved-3"]);
    expect(searchWebSources).toHaveBeenCalledTimes(1);
    expect(settleCostEnvelope).toHaveBeenCalledTimes(1);
  });

  it("settles one chargeable but insufficient mandatory search, exhausts the envelope, and never starts narration", async () => {
    const policySnapshot = { buckets: { sources: "1.50000000" } };
    costEnvelope.findUnique.mockResolvedValue({ sourceSnapshot: null, policySnapshot });
    costEnvelope.findUniqueOrThrow.mockResolvedValue({ policySnapshot });
    reserveCostEnvelope.mockResolvedValue({ status: "reserved", idempotent: false });
    settleCostEnvelope.mockResolvedValue({ status: "settled" });
    prismaMock.source.create
      .mockResolvedValueOnce({ id: "saved-1", label: "One", type: "WEB", size: 0, objectKey: null, excerpt: "Evidence one", url: "https://nasa.gov/one" })
      .mockResolvedValueOnce({ id: "saved-2", label: "Two", type: "WEB", size: 0, objectKey: null, excerpt: "Evidence two", url: "https://esa.int/two" });
    vi.mocked(searchWebSources).mockResolvedValue([
      { id: "web-1", label: "One", type: "WEB", size: 0, excerpt: "Evidence one", url: "https://nasa.gov/one" },
      { id: "web-2", label: "Two", type: "WEB", size: 0, excerpt: "Evidence two", url: "https://esa.int/two" },
    ]);

    const project = { id: "project-insufficient", prompt: "private project prompt", mode: "with_sources", speechDraft: null, sources: [] };
    await expect(prepareGenerationSources(project, { refreshWeb: true, costEnvelopeId: "envelope-insufficient" }))
      .rejects.toThrow("Mandatory source research did not return enough relevant sources");

    expect(settleCostEnvelope).toHaveBeenCalledTimes(3);
    expect(settleCostEnvelope).toHaveBeenLastCalledWith({
      envelopeId: "envelope-insufficient",
      idempotencyKey: "envelope-insufficient:mandatory-source-search:3",
      actualRub: "0.50000000",
      reason: "mandatory_source_search_insufficient",
      exhaustEnvelope: true,
    });
    expect(failCostEnvelope).not.toHaveBeenCalled();
    expect(captureGenerationError).not.toHaveBeenCalled();
    expect(generateNarrationDraft).not.toHaveBeenCalled();

  });

  it("retries bounded pre-success HTTP failures without raw provider telemetry", async () => {
    const policySnapshot = { buckets: { sources: "1.50000000" } };
    const rawProviderDetail = "Tavily 503: private project prompt; raw source excerpt";
    costEnvelope.findUnique.mockResolvedValue({ sourceSnapshot: null, policySnapshot });
    costEnvelope.findUniqueOrThrow.mockResolvedValue({ policySnapshot });
    reserveCostEnvelope.mockResolvedValue({ status: "reserved", idempotent: false });
    failCostEnvelope.mockResolvedValue({ status: "provider_error" });
    vi.mocked(searchWebSources).mockRejectedValue(new Error(rawProviderDetail));

    const project = { id: "project-provider-failure", prompt: "private project prompt", mode: "with_sources", speechDraft: null, sources: [] };
    await expect(prepareGenerationSources(project, { refreshWeb: true, costEnvelopeId: "envelope-provider-failure" }))
      .rejects.toThrow("mandatory_source_search_provider_failure");

    expect(settleCostEnvelope).not.toHaveBeenCalled();
    expect(failCostEnvelope).toHaveBeenCalledWith({
      envelopeId: "envelope-provider-failure",
      idempotencyKey: "envelope-provider-failure:mandatory-source-search:3",
      reason: "mandatory_source_search_failed",
      exhaustEnvelope: true,
    });
    expect(captureGenerationError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "mandatory_source_search_provider_failure" }),
      expect.objectContaining({ projectId: "project-provider-failure", stage: "researching", provider: expect.any(String) }),
    );
    expect(JSON.stringify(captureGenerationError.mock.calls)).not.toContain(rawProviderDetail);
    expect(JSON.stringify(captureGenerationError.mock.calls)).not.toContain(project.prompt);

    expect(searchWebSources).toHaveBeenCalledTimes(3);
    expect(failCostEnvelope).toHaveBeenCalledTimes(3);
  });

  it("combines bounded source-search refinements into one mandatory snapshot", async () => {
    const policySnapshot = { buckets: { sources: "1.50000000" } };
    costEnvelope.findUnique.mockResolvedValue({ sourceSnapshot: null, policySnapshot });
    costEnvelope.findUniqueOrThrow.mockResolvedValue({ policySnapshot });
    reserveCostEnvelope.mockResolvedValue({ status: "reserved", idempotent: false });
    settleCostEnvelope.mockResolvedValue({ status: "settled" });
    prismaMock.source.create
      .mockResolvedValueOnce({ id: "saved-1", label: "One", type: "WEB", size: 0, objectKey: null, excerpt: "Evidence one", url: "https://nasa.gov/one" })
      .mockResolvedValueOnce({ id: "saved-2", label: "Two", type: "WEB", size: 0, objectKey: null, excerpt: "Evidence two", url: "https://esa.int/two" })
      .mockResolvedValueOnce({ id: "saved-3", label: "Three", type: "WEB", size: 0, objectKey: null, excerpt: "Evidence three", url: "https://example.edu/three" });
    vi.mocked(searchWebSources)
      .mockResolvedValueOnce([
        { id: "web-1", label: "One", type: "WEB", size: 0, excerpt: "Evidence one", url: "https://nasa.gov/one" },
        { id: "web-2", label: "Two", type: "WEB", size: 0, excerpt: "Evidence two", url: "https://esa.int/two" },
      ])
      .mockResolvedValueOnce([
        { id: "web-2", label: "One", type: "WEB", size: 0, excerpt: "Evidence one", url: "https://nasa.gov/one" },
        { id: "web-3", label: "Three", type: "WEB", size: 0, excerpt: "Evidence three", url: "https://example.edu/three" },
      ]);

    const result = await prepareGenerationSources({ id: "project-refined", prompt: "Saturn", mode: "with_sources", speechDraft: null, sources: [] }, { refreshWeb: true, costEnvelopeId: "envelope-refined" });

    expect(result.map((source) => source.id)).toEqual(["saved-1", "saved-2", "saved-3"]);
    expect(searchWebSources).toHaveBeenCalledTimes(2);
    expect(vi.mocked(searchWebSources).mock.calls[1]?.[0]).toEqual(expect.objectContaining({ researchAngle: expect.any(String) }));
    expect(settleCostEnvelope).toHaveBeenNthCalledWith(1, expect.objectContaining({ reason: "mandatory_source_search_refining" }));
    expect(settleCostEnvelope).toHaveBeenNthCalledWith(2, expect.objectContaining({ idempotencyKey: "envelope-refined:mandatory-source-search:2" }));
  });

  it("uses one AITUNNEL source reservation and does not retry an insufficient result", async () => {
    const previousProvider = process.env.WEB_SEARCH_PROVIDER;
    process.env.WEB_SEARCH_PROVIDER = "aitunnel";
    const policySnapshot = { buckets: { sources: "1.50000000" } };
    costEnvelope.findUnique.mockResolvedValue({ sourceSnapshot: null, policySnapshot });
    costEnvelope.findUniqueOrThrow.mockResolvedValue({ policySnapshot });
    reserveCostEnvelope.mockResolvedValue({ status: "reserved", idempotent: false });
    settleCostEnvelope.mockResolvedValue({ status: "settled" });
    vi.mocked(searchWebSources).mockRejectedValue(new Error("mandatory_source_search_insufficient"));

    try {
      await expect(prepareGenerationSources({ id: "project-aitunnel-insufficient", prompt: "Saturn", mode: "with_sources", speechDraft: null, sources: [] }, { refreshWeb: true, costEnvelopeId: "envelope-aitunnel-insufficient" }))
        .rejects.toThrow("mandatory_source_search_insufficient");
      expect(searchWebSources).toHaveBeenCalledTimes(1);
      expect(reserveCostEnvelope).toHaveBeenCalledTimes(1);
      expect(settleCostEnvelope).toHaveBeenCalledWith({
        envelopeId: "envelope-aitunnel-insufficient",
        idempotencyKey: "envelope-aitunnel-insufficient:mandatory-source-search:1",
        actualRub: "0.50000000",
        reason: "mandatory_source_search_insufficient",
        exhaustEnvelope: true,
      });
      expect(failCostEnvelope).not.toHaveBeenCalled();
    } finally {
      if (previousProvider === undefined) delete process.env.WEB_SEARCH_PROVIDER;
      else process.env.WEB_SEARCH_PROVIDER = previousProvider;
    }
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

describe("accepted narration local recovery eligibility", () => {
  const acceptedNarration = Array.from({ length: 10 }, (_, index) => {
    const order = index + 1;
    const words = Array.from({ length: order === 1 ? 118 : order === 10 ? 124 : 132 }, (_, word) => `evidence${order}_${word + 1}`);
    const split = Math.floor(words.length / 2);
    return `Слайд ${order}: Saturn evidence ${order}\n${words.slice(0, split).join(" ")}. ${words.slice(split).join(" ")}.`;
  }).join("\n\n");
  const project = {
    id: "accepted-recovery-project",
    title: "Saturn evidence",
    prompt: "Explain Saturn using the saved evidence.",
    scenario: "university_report",
    level: "university_student",
    mode: "with_sources",
    slideCount: 10,
  };
  const snapshotSources = mandatorySourceSnapshot.sources.map((source) => ({
    id: source.sourceId,
    label: source.title,
    type: "WEB" as const,
    size: 0,
    excerpt: source.evidenceExcerpt,
    url: source.url,
  }));

  it("permits recovery only for an accepted full narration and a real URL snapshot", () => {
    expect(hasAcceptedNarrationRecoveryArtifacts(project, snapshotSources, acceptedNarration)).toBe(true);
    expect(hasAcceptedNarrationRecoveryArtifacts(project, [{ ...snapshotSources[0]!, type: "TXT", url: undefined }], acceptedNarration)).toBe(false);
    expect(hasAcceptedNarrationRecoveryArtifacts(project, snapshotSources, "Слайд 1: Коротко\nОдна фраза.")).toBe(false);
  });
});

describe("handleGenerationJob v6 narration persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    finalizeFailedCostEnvelope.mockReset();
    prismaMock.project.update.mockResolvedValue({});
    prismaMock.project.findUnique.mockResolvedValue({ speechDraft: null });
    prismaMock.project.findUniqueOrThrow.mockResolvedValue({
      id: "editable-draft-project",
      title: "Editable draft",
      prompt: "Prepare an editable speech draft",
      scenario: "report",
      level: "university_student",
      mode: "standard",
      slideCount: 10,
      workflow: "standard",
      speechDraft: null,
      defenseWorkspace: null,
      sources: [{
        id: "source-1",
        label: "Saved source",
        type: "TXT",
        size: 0,
        objectKey: null,
        url: null,
        excerpt: "Grounded source excerpt.",
        text: "Grounded source excerpt.",
        included: true,
      }],
    });
    prismaMock.generationJob.findFirst.mockResolvedValue({ id: "database-narration-job" });
    prismaMock.generationJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.presentation.findUnique.mockResolvedValue(null);
    prismaMock.userActivityEvent.create.mockResolvedValue({});
    costEnvelope.findUnique.mockResolvedValue({ sourceSnapshot: mandatorySourceSnapshot, status: "active" });
    prismaMock.$transaction.mockImplementation(async (operations: Promise<unknown>[]) => Promise.all(operations));
  });

  it("persists an editable v6 draft at the real job boundary without presentation, accept, or retry work", async () => {
    const editableText = "PRIVATE_EDITABLE_DRAFT_CONTENT";
    generateNarrationDraft.mockResolvedValue({
      text: editableText,
      narrativePlan: [],
      generationMode: "aitunnel",
      narrationOutcome: {
        kind: "editable_draft",
        text: editableText,
        stage: "narration_full_candidate",
      },
    });
    const job = {
      id: "queue-editable-draft",
      name: "generate-narration",
      data: { projectId: "editable-draft-project", userId: "user-1", generationJobId: "database-narration-job", costEnvelopeId: "envelope-editable" },
      opts: { attempts: 1 },
      attemptsMade: 0,
      updateProgress: vi.fn().mockResolvedValue(undefined),
      discard: vi.fn(),
      retry: vi.fn(),
    } as never;

    await expect(handleGenerationJob(job)).resolves.toBeUndefined();

    expect(prismaMock.project.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "editable-draft-project" },
      data: expect.objectContaining({
        speechDraft: editableText,
        status: "script_ready",
        error: null,
      }),
    }));
    expect(prismaMock.generationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "completed",
        progressStage: "completed",
        error: "editable_draft",
      }),
    }));
    expect(prismaMock.userActivityEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "generation.completed",
        metadata: {
          kind: "narration",
          narrationOutcome: "editable_draft",
          narrationStage: "narration_full_candidate",
        },
      }),
    });
    expect(JSON.stringify(prismaMock.userActivityEvent.create.mock.calls)).not.toContain(editableText);

    expect(generatePresentationFromNarration).not.toHaveBeenCalled();
    expect(prismaMock.presentation.upsert).not.toHaveBeenCalled();
    expect(prismaMock.generationJob.create).not.toHaveBeenCalled();
    expect(finalizeFailedCostEnvelope).not.toHaveBeenCalled();
    expect((job as { retry: ReturnType<typeof vi.fn> }).retry).not.toHaveBeenCalled();
    expect((job as { discard: ReturnType<typeof vi.fn> }).discard).not.toHaveBeenCalled();
  });

  it("persists accepted v6 narration at the same boundary without presentation work", async () => {
    const acceptedText = "PRIVATE_ACCEPTED_SPEECH_CONTENT";
    generateNarrationDraft.mockResolvedValue({
      text: acceptedText,
      narrativePlan: [],
      generationMode: "aitunnel",
      narrationOutcome: {
        kind: "accepted",
        text: acceptedText,
        stage: "narration_full_rewrite",
      },
    });
    const job = {
      id: "queue-accepted-speech",
      name: "generate-narration",
      data: { projectId: "editable-draft-project", userId: "user-1", generationJobId: "database-narration-job", costEnvelopeId: "envelope-accepted" },
      opts: { attempts: 1 },
      attemptsMade: 0,
      updateProgress: vi.fn().mockResolvedValue(undefined),
      discard: vi.fn(),
      retry: vi.fn(),
    } as never;

    await expect(handleGenerationJob(job)).resolves.toBeUndefined();

    expect(prismaMock.project.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "editable-draft-project" },
      data: expect.objectContaining({
        speechDraft: acceptedText,
        status: "script_ready",
        error: null,
      }),
    }));
    expect(prismaMock.generationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "completed",
        progressStage: "completed",
        error: "accepted_speech",
      }),
    }));
    expect(prismaMock.userActivityEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "generation.completed",
        metadata: {
          kind: "narration",
          narrationOutcome: "accepted",
          narrationStage: "narration_full_rewrite",
        },
      }),
    });
    expect(JSON.stringify(prismaMock.userActivityEvent.create.mock.calls)).not.toContain(acceptedText);

    expect(generatePresentationFromNarration).not.toHaveBeenCalled();
    expect(prismaMock.presentation.upsert).not.toHaveBeenCalled();
    expect(prismaMock.generationJob.create).not.toHaveBeenCalled();
    expect(finalizeFailedCostEnvelope).not.toHaveBeenCalled();
    expect((job as { retry: ReturnType<typeof vi.fn> }).retry).not.toHaveBeenCalled();
    expect((job as { discard: ReturnType<typeof vi.fn> }).discard).not.toHaveBeenCalled();
  });
});

describe("handleGenerationJob failed narration envelope finalization", () => {
  const narrationProject = (speechDraft: string | null = null) => ({
    id: "terminal-narration-project",
    title: "Terminal narration",
    prompt: "Prepare a safe speech",
    scenario: "report",
    level: "university_student",
    mode: "standard",
    slideCount: 10,
    workflow: "standard",
    speechDraft,
    defenseWorkspace: null,
    sources: [{
      id: "source-1",
      label: "Saved source",
      type: "TXT",
      size: 0,
      objectKey: null,
      url: null,
      excerpt: "Grounded source excerpt.",
      text: "Grounded source excerpt.",
      included: true,
    }],
  });

  const queueJob = (input: {
    name?: "generate-narration" | "generate-presentation";
    costEnvelopeId?: string;
    attempts?: number;
    attemptsMade?: number;
  } = {}) => ({
    id: "queue-terminal-job",
    name: input.name || "generate-narration",
    data: {
      projectId: "terminal-narration-project",
      userId: "user-1",
      generationJobId: "database-terminal-job",
      ...(input.costEnvelopeId ? { costEnvelopeId: input.costEnvelopeId } : {}),
    },
    opts: { attempts: input.attempts ?? 1 },
    attemptsMade: input.attemptsMade ?? 0,
    updateProgress: vi.fn().mockResolvedValue(undefined),
    discard: vi.fn(),
  } as never);

  beforeEach(() => {
    vi.clearAllMocks();
    finalizeFailedCostEnvelope.mockReset();
    generateNarrationDraft.mockReset();
    generatePresentationFromNarration.mockReset();
    buildLocalPresentationFromAcceptedNarration.mockReset();
    enrichPresentationImages.mockReset();
    materializePlannedVisuals.mockReset();
    materializePlannedVisuals.mockImplementation((presentation) => presentation);
    prismaMock.project.update.mockResolvedValue({});
    prismaMock.project.findUnique.mockResolvedValue({ speechDraft: null });
    prismaMock.project.findUniqueOrThrow.mockResolvedValue(narrationProject());
    prismaMock.generationJob.findFirst.mockResolvedValue({ id: "database-terminal-job" });
    prismaMock.generationJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.presentation.findUnique.mockResolvedValue(null);
    prismaMock.userActivityEvent.create.mockResolvedValue({});
    costEnvelope.findUnique.mockResolvedValue({ sourceSnapshot: mandatorySourceSnapshot, status: "active" });
  });

  it("finalizes exactly one terminal failed narration envelope without a draft, then rethrows the generation error", async () => {
    const generationError = new Error("narration generation failed");
    generateNarrationDraft.mockRejectedValue(generationError);
    finalizeFailedCostEnvelope.mockResolvedValue({ status: "exhausted", idempotent: false });
    const job = queueJob({ costEnvelopeId: "envelope-terminal" });

    await expect(handleGenerationJob(job)).rejects.toBe(generationError);

    expect(finalizeFailedCostEnvelope).toHaveBeenCalledTimes(1);
    expect(finalizeFailedCostEnvelope).toHaveBeenCalledWith({ envelopeId: "envelope-terminal" });
    expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
      where: { id: "terminal-narration-project" },
      select: { speechDraft: true },
    });
    expect(prismaMock.project.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed" }),
    }));
    expect(prismaMock.generationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", error: "narration_failed" }),
    }));
    expect(generateNarrationDraft).toHaveBeenCalledTimes(1);
    expect(generatePresentationFromNarration).not.toHaveBeenCalled();
    expect(prismaMock.generationJob.create).not.toHaveBeenCalled();
  });

  it("does not finalize a failed narration when the current project already has a saved draft", async () => {
    generateNarrationDraft.mockRejectedValue(new Error("narration generation failed"));
    prismaMock.project.findUnique.mockResolvedValue({ speechDraft: "Saved manual draft" });

    await expect(handleGenerationJob(queueJob({ costEnvelopeId: "envelope-saved-draft" }))).rejects.toThrow("narration generation failed");

    expect(finalizeFailedCostEnvelope).not.toHaveBeenCalled();
  });

  it("persists terminal narration states and rethrows the generation error when the fresh draft lookup fails", async () => {
    const generationError = new Error("narration generation failed");
    const lookupError = new Error("database draft lookup unavailable");
    generateNarrationDraft.mockRejectedValue(generationError);
    prismaMock.project.findUnique.mockRejectedValue(lookupError);

    await expect(handleGenerationJob(queueJob({ costEnvelopeId: "envelope-lookup-error" }))).rejects.toBe(generationError);

    expect(prismaMock.project.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed" }),
    }));
    expect(prismaMock.generationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", error: "narration_failed" }),
    }));
    const projectUpdateCalls = prismaMock.project.update.mock.invocationCallOrder;
    const generationJobUpdateCalls = prismaMock.generationJob.updateMany.mock.invocationCallOrder;
    const draftLookupCall = prismaMock.project.findUnique.mock.invocationCallOrder[0]!;
    expect(projectUpdateCalls[projectUpdateCalls.length - 1]!).toBeLessThan(draftLookupCall);
    expect(generationJobUpdateCalls[generationJobUpdateCalls.length - 1]!).toBeLessThan(draftLookupCall);
    expect(finalizeFailedCostEnvelope).not.toHaveBeenCalled();
    expect(captureGenerationError).toHaveBeenLastCalledWith(lookupError, expect.objectContaining({
      stage: "failed_envelope_finalization",
      projectId: "terminal-narration-project",
    }));
  });

  it("keeps an accepted narration envelope active by never invoking terminal finalization", async () => {
    generateNarrationDraft.mockResolvedValue({
      text: "Accepted narration text",
      narrativePlan: [],
      generationMode: "aitunnel",
    });

    await expect(handleGenerationJob(queueJob({ costEnvelopeId: "envelope-accepted" }))).resolves.toBeUndefined();

    expect(finalizeFailedCostEnvelope).not.toHaveBeenCalled();
  });

  it("marks the presentation ready after a structured provider failure using only accepted narration and its saved source snapshot", async () => {
    const acceptedNarration = Array.from({ length: 10 }, (_, index) => {
      const order = index + 1;
      const words = Array.from({ length: order === 1 ? 118 : order === 10 ? 124 : 132 }, (_, word) => `evidence${order}_${word + 1}`);
      const split = Math.floor(words.length / 2);
      return `Слайд ${order}: Saturn evidence ${order}\n${words.slice(0, split).join(" ")}. ${words.slice(split).join(" ")}.`;
    }).join("\n\n");
    const snapshotSources = mandatorySourceSnapshot.sources.map((source) => ({
      id: source.sourceId,
      label: source.title,
      type: "WEB" as const,
      size: 0,
      excerpt: source.evidenceExcerpt,
      url: source.url,
    }));
    const recovered = presentationSchema.parse({
      id: "local-recovery",
      title: "Saturn evidence",
      scenario: "university_report",
      level: "university_student",
      slideCount: 10,
      generationMode: "local",
      generatedText: acceptedNarration,
      sources: snapshotSources,
      outline: Array.from({ length: 10 }, (_, index) => `Saturn evidence ${index + 1}`),
      narrativePlan: Array.from({ length: 10 }, (_, index) => ({
        slideOrder: index + 1,
        slideTitle: `Saturn evidence ${index + 1}`,
        slidePurpose: "Explain grounded evidence.",
        keyMessage: "Saved evidence supports the explanation.",
        audienceQuestion: "What does the saved source establish?",
        transitionToNext: index === 9 ? "" : "Continue with the next grounded point.",
      })),
      speechScript: acceptedNarration.split("\n\n").map((section, index) => ({ slideOrder: index + 1, slideTitle: `Saturn evidence ${index + 1}`, text: section.split("\n")[1]! })),
      slides: acceptedNarration.split("\n\n").map((section, index) => ({
        id: `slide-${index + 1}`,
        order: index + 1,
        title: `Saturn evidence ${index + 1}`,
        slideKind: index === 0 ? "title" : index === 9 ? "summary" : "content",
        layout: index === 0 ? "hero" : index === 9 ? "summary" : "bullets",
        thesis: "Saved evidence supports a concrete explanation of Saturn.",
        bullets: ["The source records a grounded observation.", "The narration keeps that observation in context."],
        definition: null,
        keyConcepts: [],
        visual: { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] },
        highlights: [],
        blocks: [{ type: "bullets", items: ["The source records a grounded observation.", "The narration keeps that observation in context."] }],
        speakerNotes: section.split("\n")[1]!,
        timingSeconds: 45,
        sourceRefs: [{ sourceId: snapshotSources[index % snapshotSources.length]!.id, label: snapshotSources[index % snapshotSources.length]!.label, excerpt: snapshotSources[index % snapshotSources.length]!.excerpt, page: null }],
      })),
    });
    prismaMock.project.findUniqueOrThrow.mockResolvedValue({ ...narrationProject(acceptedNarration), title: "Saturn evidence", prompt: "Explain Saturn using the saved evidence.", scenario: "university_report", mode: "with_sources" });
    generatePresentationFromNarration.mockRejectedValue(new Error("structured presentation response was malformed"));
    buildLocalPresentationFromAcceptedNarration.mockReturnValue(recovered);
    productionQualityReleaseResult.mockReturnValue({ finalDisposition: "released", issueCategories: [], issues: [], attempts: 1 });
    costEnvelope.findUniqueOrThrow.mockResolvedValue({
      limitRub: { toString: () => "10" }, reservedRub: { toString: () => "0" }, settledRub: { toString: () => "1.5" }, status: "active",
      sourceSnapshot: mandatorySourceSnapshot, reservations: [{ status: "settled", reason: null }], _count: { costEvents: 0 },
    });

    await expect(handleGenerationJob(queueJob({ name: "generate-presentation", costEnvelopeId: "envelope-presentation" }))).resolves.toBeUndefined();

    expect(generatePresentationFromNarration).toHaveBeenCalledTimes(1);
    expect(buildLocalPresentationFromAcceptedNarration).toHaveBeenCalledTimes(1);
    expect(searchWebSources).not.toHaveBeenCalled();
    expect(productionQualityReleaseResult).toHaveBeenCalledTimes(1);
    expect(prismaMock.presentation.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ document: expect.objectContaining({ generatedText: acceptedNarration, sources: snapshotSources }) }) }));
    expect(prismaMock.project.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "ready" } }));
    expect(prismaMock.generationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }));
    expect(finalizeFailedCostEnvelope).not.toHaveBeenCalled();
  });

  it("does not finalize a terminal presentation failure through the narration helper", async () => {
    prismaMock.project.findUniqueOrThrow.mockResolvedValue(narrationProject("Accepted narration text"));
    generatePresentationFromNarration.mockRejectedValue(new Error("presentation schema failure"));
    buildLocalPresentationFromAcceptedNarration.mockImplementation(() => { throw new Error("presentation schema failure"); });

    await expect(handleGenerationJob(queueJob({ name: "generate-presentation", costEnvelopeId: "envelope-presentation" })))
      .rejects.toThrow("presentation schema failure");

    expect(finalizeFailedCostEnvelope).not.toHaveBeenCalled();
  });

  it("does not finalize while a presentation failure is scheduled for retry", async () => {
    prismaMock.project.findUniqueOrThrow.mockResolvedValue(narrationProject("Accepted narration text"));
    generatePresentationFromNarration.mockRejectedValue(new Error("presentation request timeout"));
    buildLocalPresentationFromAcceptedNarration.mockImplementation(() => { throw new Error("presentation request timeout"); });

    await expect(handleGenerationJob(queueJob({
      name: "generate-presentation",
      costEnvelopeId: "envelope-retry",
      attempts: 3,
    }))).rejects.toThrow("presentation request timeout");

    expect(finalizeFailedCostEnvelope).not.toHaveBeenCalled();
  });

  it("does not finalize a terminal narration job without a cost envelope", async () => {
    generateNarrationDraft.mockRejectedValue(new Error("narration generation failed"));

    await expect(handleGenerationJob(queueJob())).rejects.toThrow("narration generation failed");

    expect(finalizeFailedCostEnvelope).not.toHaveBeenCalled();
  });

  it("keeps the original generation error and public failure classification when envelope finalization fails", async () => {
    const generationError = new Error("narration generation failed");
    const finalizationError = new Error("database finalization unavailable");
    generateNarrationDraft.mockRejectedValue(generationError);
    finalizeFailedCostEnvelope.mockRejectedValue(finalizationError);

    await expect(handleGenerationJob(queueJob({ costEnvelopeId: "envelope-finalization-error" }))).rejects.toBe(generationError);

    expect(prismaMock.generationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", error: "narration_failed" }),
    }));
    expect(captureGenerationError).toHaveBeenLastCalledWith(finalizationError, expect.objectContaining({
      stage: "failed_envelope_finalization",
      projectId: "terminal-narration-project",
    }));
  });
});
