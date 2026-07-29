import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditSlideCanvas, presentationSchema, PREMIUM_PRESENTATION_THEMES } from "@studydeck/shared";
import { handleGenerationJob, prepareGenerationSources, repairPresentationLayout } from "./generation.js";
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

const { reserveCostEnvelope, settleCostEnvelope, failCostEnvelope, finalizeFailedCostEnvelope, captureGenerationError, generateNarrationDraft, generatePresentationFromNarration, costEnvelope, prismaMock } = vi.hoisted(() => ({
  reserveCostEnvelope: vi.fn(),
  settleCostEnvelope: vi.fn(),
  failCostEnvelope: vi.fn(),
  finalizeFailedCostEnvelope: vi.fn(),
  captureGenerationError: vi.fn(),
  generateNarrationDraft: vi.fn(),
  generatePresentationFromNarration: vi.fn(),
  costEnvelope: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  prismaMock: {
    source: { create: vi.fn(), deleteMany: vi.fn(), update: vi.fn() },
    costEnvelope: undefined as unknown,
    operationalEvent: { create: vi.fn().mockResolvedValue({}) },
    project: { update: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    generationJob: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    presentation: { findUnique: vi.fn(), upsert: vi.fn() },
    userActivityEvent: { create: vi.fn() },
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

vi.mock("./presentation.js", () => ({
  generateNarrationDraft,
  generatePresentationFromNarration,
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
    expect(settleCostEnvelope).toHaveBeenCalledWith({
      envelopeId: "envelope-1",
      idempotencyKey: "envelope-1:mandatory-source-search",
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
    const policySnapshot = { buckets: { sources: "0.50000000" } };
    costEnvelope.findUnique.mockResolvedValue({ sourceSnapshot: null, policySnapshot });
    costEnvelope.findUniqueOrThrow.mockResolvedValue({ policySnapshot });
    reserveCostEnvelope
      .mockResolvedValueOnce({ status: "reserved", idempotent: false })
      .mockResolvedValueOnce({ status: "reserved", idempotent: true });
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

    expect(settleCostEnvelope).toHaveBeenCalledTimes(1);
    expect(settleCostEnvelope).toHaveBeenCalledWith({
      envelopeId: "envelope-insufficient",
      idempotencyKey: "envelope-insufficient:mandatory-source-search",
      actualRub: "0.50000000",
      reason: "mandatory_source_search_insufficient",
      exhaustEnvelope: true,
    });
    expect(failCostEnvelope).not.toHaveBeenCalled();
    expect(captureGenerationError).not.toHaveBeenCalled();
    expect(generateNarrationDraft).not.toHaveBeenCalled();

    await expect(prepareGenerationSources(project, { refreshWeb: true, costEnvelopeId: "envelope-insufficient" }))
      .rejects.toThrow("already in progress");
    expect(searchWebSources).toHaveBeenCalledTimes(1);
    expect(settleCostEnvelope).toHaveBeenCalledTimes(1);
  });

  it("keeps a pre-success HTTP failure as provider_error without settlement or raw provider telemetry", async () => {
    const policySnapshot = { buckets: { sources: "0.50000000" } };
    const rawProviderDetail = "Tavily 503: private project prompt; raw source excerpt";
    costEnvelope.findUnique.mockResolvedValue({ sourceSnapshot: null, policySnapshot });
    costEnvelope.findUniqueOrThrow.mockResolvedValue({ policySnapshot });
    reserveCostEnvelope
      .mockResolvedValueOnce({ status: "reserved", idempotent: false })
      .mockResolvedValueOnce({ status: "reserved", idempotent: true });
    failCostEnvelope.mockResolvedValue({ status: "provider_error" });
    vi.mocked(searchWebSources).mockRejectedValue(new Error(rawProviderDetail));

    const project = { id: "project-provider-failure", prompt: "private project prompt", mode: "with_sources", speechDraft: null, sources: [] };
    await expect(prepareGenerationSources(project, { refreshWeb: true, costEnvelopeId: "envelope-provider-failure" }))
      .rejects.toThrow("mandatory_source_search_provider_failure");

    expect(settleCostEnvelope).not.toHaveBeenCalled();
    expect(failCostEnvelope).toHaveBeenCalledWith({
      envelopeId: "envelope-provider-failure",
      idempotencyKey: "envelope-provider-failure:mandatory-source-search",
      reason: "mandatory_source_search_failed",
    });
    expect(captureGenerationError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "mandatory_source_search_provider_failure" }),
      expect.objectContaining({ projectId: "project-provider-failure", stage: "researching", provider: expect.any(String) }),
    );
    expect(JSON.stringify(captureGenerationError.mock.calls)).not.toContain(rawProviderDetail);
    expect(JSON.stringify(captureGenerationError.mock.calls)).not.toContain(project.prompt);

    await expect(prepareGenerationSources(project, { refreshWeb: true, costEnvelopeId: "envelope-provider-failure" }))
      .rejects.toThrow("already in progress");
    expect(searchWebSources).toHaveBeenCalledTimes(1);
    expect(failCostEnvelope).toHaveBeenCalledTimes(1);
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

describe("handleGenerationJob editable-draft persistence", () => {
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
    costEnvelope.findUnique.mockResolvedValue({ sourceSnapshot: mandatorySourceSnapshot });
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
    prismaMock.project.update.mockResolvedValue({});
    prismaMock.project.findUnique.mockResolvedValue({ speechDraft: null });
    prismaMock.project.findUniqueOrThrow.mockResolvedValue(narrationProject());
    prismaMock.generationJob.findFirst.mockResolvedValue({ id: "database-terminal-job" });
    prismaMock.generationJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.presentation.findUnique.mockResolvedValue(null);
    prismaMock.userActivityEvent.create.mockResolvedValue({});
    costEnvelope.findUnique.mockResolvedValue({ sourceSnapshot: mandatorySourceSnapshot });
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

  it("does not finalize a terminal presentation failure through the narration helper", async () => {
    prismaMock.project.findUniqueOrThrow.mockResolvedValue(narrationProject("Accepted narration text"));
    generatePresentationFromNarration.mockRejectedValue(new Error("presentation schema failure"));

    await expect(handleGenerationJob(queueJob({ name: "generate-presentation", costEnvelopeId: "envelope-presentation" })))
      .rejects.toThrow("presentation schema failure");

    expect(finalizeFailedCostEnvelope).not.toHaveBeenCalled();
  });

  it("does not finalize while a presentation failure is scheduled for retry", async () => {
    prismaMock.project.findUniqueOrThrow.mockResolvedValue(narrationProject("Accepted narration text"));
    generatePresentationFromNarration.mockRejectedValue(new Error("presentation request timeout"));

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
