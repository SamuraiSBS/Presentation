import { beforeEach, describe, expect, it, vi } from "vitest";
import { presentationSchema } from "@studydeck/shared";
import { buildEmergencyReadablePresentation, handleGenerationJob, hasAcceptedNarrationRecoveryArtifacts, mergeRecoveredVisuals } from "./generation.js";
import { buildLocalPresentationFromAcceptedNarration } from "./presentation.js";
import { finalCanvasSafetyIssues, productionQualityReleaseResult } from "./presentation-quality.js";
import { searchWebSources } from "./web-search.js";

const { generatePresentationFromNarration, enrichPresentationImages, prismaMock, costEnvelope, reserveCostEnvelope, settleCostEnvelope, captureGenerationError } = vi.hoisted(() => {
  const costEnvelope = { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), create: vi.fn() };
  const reserveCostEnvelope = vi.fn();
  const settleCostEnvelope = vi.fn();
  const captureGenerationError = vi.fn();
  const enrichPresentationImages = vi.fn();
  return {
    generatePresentationFromNarration: vi.fn(),
    enrichPresentationImages,
    costEnvelope,
    reserveCostEnvelope,
    settleCostEnvelope,
    captureGenerationError,
    prismaMock: {
      project: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
      source: { create: vi.fn(), deleteMany: vi.fn(), update: vi.fn() },
      presentation: { findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
      generationJob: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
      userActivityEvent: { create: vi.fn() },
      operationalEvent: { create: vi.fn() },
      costEnvelope,
      $transaction: vi.fn(),
    },
  };
});

vi.mock("../prisma.js", () => ({ getPrisma: () => prismaMock }));
vi.mock("./web-search.js", () => ({ searchWebSources: vi.fn() }));
vi.mock("./image-search.js", () => ({ enrichPresentationImages }));
vi.mock("./presentation.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./presentation.js")>(),
  generatePresentationFromNarration,
}));
vi.mock("../cost-envelope.js", () => ({
  reserveCostEnvelope, settleCostEnvelope, failCostEnvelope: vi.fn(), finalizeFailedCostEnvelope: vi.fn(),
}));
vi.mock("../observability.js", () => ({
  captureGenerationError, errorLogFields: () => ({}), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  withTraceSpan: async (_name: string, _context: unknown, callback: () => Promise<unknown>) => callback(),
}));

const acceptedNarrationTitles = [
  "The photovoltaic effect",
  "History of solar cells",
  "Semiconductor materials",
  "Charge separation",
  "Solar panel construction",
  "Efficiency factors",
  "Environmental conditions",
  "Engineering tradeoffs",
  "Photovoltaic applications",
  "Conclusions and next steps",
];
const acceptedNarrationVocabulary = [
  ["solar", "photon", "electron", "silicon", "current", "voltage", "panel", "spectrum", "charge", "circuit", "efficiency", "storage"],
  ["orbit", "rings", "inclination", "shadow", "spectral", "tilt", "visibility", "planet", "distance", "signal", "observation", "pattern"],
  ["moon", "tides", "resonance", "crater", "gravity", "migration", "satellite", "mass", "rotation", "interaction", "stability", "systematic"],
];
const acceptedNarration = Array.from({ length: 10 }, (_, index) => {
  const order = index + 1;
  const words = order === 1 ? 60 : order === 10 ? 80 : 70;
  const firstSentenceWords = Math.floor(words / 3);
  const sentence = (part: number) => Array.from(
    { length: part === 2 ? words - firstSentenceWords * 2 : firstSentenceWords },
    (_, wordIndex) => acceptedNarrationVocabulary[part][(wordIndex + order) % 12] + order,
  ).join(" ");
  return `\u0421\u043b\u0430\u0439\u0434 ${order}: ${acceptedNarrationTitles[index]}\n${sentence(0)}. ${sentence(1)}. ${sentence(2)}.`;
}).join("\n\n");
const sources = ["physics", "engineering", "energy"].map((id) => ({
  id, label: `${id} source`, type: "WEB" as const, size: 0,
  url: `https://science.example/${id}`,
  excerpt: "Фотоэнергетика солнечные панели фотоэффект кремний солнечная генерация энергия инженерные решения.",
}));
const sourceSnapshot = {
  version: 1, capturedAt: "2026-08-04T00:00:00.000Z", provenance: { provider: "tavily" as const, queryAt: "2026-08-04T00:00:00.000Z" },
  sources: sources.map((source) => ({ sourceId: source.id, title: source.label, url: source.url, evidenceExcerpt: source.excerpt })),
};
const project = { id: "recovery-project", userId: "user", title: "Фотоэнергетика", prompt: "Подготовь академическую презентацию по фотоэнергетике", scenario: "university_report", level: "university_student", mode: "with_sources", slideCount: 10, speechDraft: acceptedNarration, sources };

function job(data: Record<string, unknown> = {}) {
  return { id: "recovery-job", name: "generate-presentation", data: { projectId: project.id, userId: project.userId, costEnvelopeId: "recovery-envelope", ...data }, attemptsMade: 0, opts: { attempts: 1 }, updateProgress: vi.fn(), discard: vi.fn() } as never;
}

describe("accepted narration local recovery with the actual production gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (operation: unknown) => typeof operation === "function"
      ? operation(prismaMock)
      : Promise.all(operation as Promise<unknown>[]));
    prismaMock.project.findUnique.mockResolvedValue(project);
    prismaMock.project.findUniqueOrThrow.mockResolvedValue(project);
    prismaMock.presentation.findUnique.mockResolvedValue(null);
    costEnvelope.findUnique.mockResolvedValue({ sourceSnapshot, status: "active" });
    costEnvelope.findUniqueOrThrow.mockResolvedValue({
      limitRub: { toString: () => "10" }, reservedRub: { toString: () => "0" }, settledRub: { toString: () => "0" }, status: "active",
      sourceSnapshot, reservations: [{ status: "settled", reason: null }], _count: { costEvents: 0 },
    });
    enrichPresentationImages.mockImplementation(async (_project, presentation) => presentation);
    generatePresentationFromNarration.mockRejectedValue(new Error("structured presentation response was malformed"));
  });

  it("runs the bounded image enrichment exactly once on a fresh successful presentation", async () => {
    generatePresentationFromNarration.mockResolvedValue(buildLocalPresentationFromAcceptedNarration(project, sources, acceptedNarration));

    await expect(handleGenerationJob(job())).resolves.toBeUndefined();

    expect(enrichPresentationImages).toHaveBeenCalledTimes(1);
    expect(enrichPresentationImages).toHaveBeenCalledWith(expect.objectContaining({ id: project.id }), expect.any(Object), expect.objectContaining({ attemptedSlideOrders: expect.any(Set) }));
    expect(prismaMock.project.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ready" }) }));
    const document = prismaMock.presentation.upsert.mock.calls[0]?.[0]?.create?.document;
    expect(finalCanvasSafetyIssues(document as any)).toEqual([]);
  });

  it("keeps operator recovery presentation-only and advances the revision conditionally", async () => {
    prismaMock.presentation.findUnique.mockResolvedValue({ revision: 1 });
    prismaMock.presentation.updateMany.mockResolvedValue({ count: 1 });

    await expect(handleGenerationJob(job({
      generationJobId: "recovery-job-db",
      presentationOnlyRecovery: true,
      expectedPresentationRevision: 1,
    }))).resolves.toBeUndefined();

    expect(generatePresentationFromNarration).not.toHaveBeenCalled();
    expect(searchWebSources).not.toHaveBeenCalled();
    expect(prismaMock.presentation.upsert).not.toHaveBeenCalled();
    expect(prismaMock.presentation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: project.id, revision: 1 },
      data: { document: expect.any(Object), revision: { increment: 1 } },
    }));
  });

  it("recovers a provider failure to ready through the real release gate without a second provider or Tavily call", async () => {
    await expect(handleGenerationJob(job())).resolves.toBeUndefined();
    const document = prismaMock.presentation.upsert.mock.calls[0]?.[0]?.create?.document;
    const release = productionQualityReleaseResult(document, sources, { ...project, mandatorySourceSnapshot: true, acceptedNarrationRecovery: true });
    expect(release.finalDisposition).toBe("released");
    expect(release.issues.every((issue) => issue.severity !== "blocker")).toBe(true);
    expect(document.presentationTheme?.themeId).toBe("studydeckEditorial");
    expect(document.designBrief?.themeId).toBe("studydeckEditorial");
    expect(document.productionQualityGate).toMatchObject({ recoveryApplied: true });
    expect(["accepted_narration", "canvas_layout", "emergency"]).toContain(document.productionQualityGate.recoveryStage);
    expect(document.productionQualityGate.recoveryReason).toEqual(expect.any(String));
    expect(generatePresentationFromNarration).toHaveBeenCalledTimes(1);
    expect(enrichPresentationImages).toHaveBeenCalledTimes(1);
    expect(enrichPresentationImages).toHaveBeenCalledWith(expect.objectContaining({ id: project.id }), expect.any(Object), expect.objectContaining({ recovery: true, skipSlideOrders: expect.any(Set) }));
    expect(searchWebSources).not.toHaveBeenCalled();
    expect(prismaMock.project.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ready" }) }));
  });

  it("does not silently downgrade a user presentation retry to local recovery", async () => {
    const providerError = new Error("structured presentation response was malformed");
    generatePresentationFromNarration.mockRejectedValueOnce(providerError);

    await expect(handleGenerationJob(job({ presentationRetry: true }))).rejects.toBe(providerError);

    expect(generatePresentationFromNarration).toHaveBeenCalledTimes(1);
    expect(enrichPresentationImages).not.toHaveBeenCalled();
    expect(prismaMock.presentation.upsert).not.toHaveBeenCalled();
    expect(prismaMock.generationJob.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", error: providerError.message }),
    }));
  });

  it("releases the emergency readable deck when the editorial local projection remains generic", () => {
    const local = buildLocalPresentationFromAcceptedNarration(project, sources, acceptedNarration);
    const rejectedEditorialProjection = {
      ...local,
      slides: local.slides.map((slide, index) => index === 0
        ? { ...slide, thesis: "Общая информация", visual: { ...slide.visual, description: "Общая схема" } }
        : slide),
    };

    expect(productionQualityReleaseResult(rejectedEditorialProjection, sources, {
      ...project,
      mandatorySourceSnapshot: true,
      acceptedNarrationRecovery: true,
    }).finalDisposition).toBe("rejected");

    const emergency = buildEmergencyReadablePresentation(rejectedEditorialProjection);
    expect(emergency.presentationTheme?.themeId).toBe("studydeckEditorial");
    expect(emergency.productionQualityGate).toMatchObject({ recoveryApplied: true, recoveryStage: "emergency" });
    const emergencyRelease = productionQualityReleaseResult(emergency, sources, {
      ...project,
      mandatorySourceSnapshot: true,
      acceptedNarrationRecovery: true,
    });
    expect(emergencyRelease.issues).toEqual([]);
    expect(emergencyRelease).toMatchObject({ finalDisposition: "released", issueCategories: [] });
  });

  it("keeps accepted generatedText and support bullets during emergency layout recovery", () => {
    const support = "A distinct support sentence remains visible after the recovery canvas is rebuilt.";
    const local = buildLocalPresentationFromAcceptedNarration(project, sources, acceptedNarration);
    const input = {
      ...local,
      generatedText: "The accepted narration must remain byte-stable.",
      slides: local.slides.map((slide, index) => index === 1
        ? { ...slide, thesis: "The accepted thesis remains the central claim.", bullets: [support], blocks: [] }
        : slide),
    };

    const emergency = buildEmergencyReadablePresentation(input);

    expect(emergency.generatedText).toBe(input.generatedText);
    expect(emergency.slides[1].bullets).toEqual([support]);
    expect(emergency.slides[1].blocks).toEqual([]);
  });

  it("keeps available images and grounded diagrams in emergency recovery", () => {
    const local = buildLocalPresentationFromAcceptedNarration(project, sources, acceptedNarration);
    const imageSlide = {
      ...local.slides[1],
      layout: "image-focus" as const,
      visual: {
        type: "image" as const,
        title: "",
        description: "A stored documentary photograph supports this topic.",
        leftLabel: "",
        rightLabel: "",
        items: [],
        rows: [],
        image: {
          url: "https://example.com/recovery.jpg",
          objectKey: "projects/recovery-project/images/recovery.jpg",
          alt: "Recovery evidence",
          query: "recovery evidence",
          provider: "archive" as const,
          contentType: "image/jpeg",
          sourceTitle: "Recovery archive",
          warnings: [],
        },
      },
    };
    const emergency = buildEmergencyReadablePresentation({
      ...local,
      slides: [local.slides[0], imageSlide, ...local.slides.slice(2)],
    });

    expect(emergency.slides[1].visual.image?.objectKey).toBe("projects/recovery-project/images/recovery.jpg");
    expect(emergency.slides[1].canvas?.elements.some((element) => element.type === "image")).toBe(true);
    expect(emergency.slides.some((slide) => slide.visual.type === "process_diagram")).toBe(true);
    expect(emergency.slides.some((slide) => slide.canvas?.elements.some((element) => element.type === "shape" && element.id.includes("recovery-card")))).toBe(true);
    expect(() => presentationSchema.parse(emergency)).not.toThrow();
  });

  it("merges only persisted rejected-version images by stable slide id", () => {
    const recovered = buildLocalPresentationFromAcceptedNarration(project, sources, acceptedNarration);
    const rejected = {
      ...recovered,
      slides: recovered.slides.map((slide, index) => index === 1
        ? {
          ...slide,
          visual: {
            ...slide.visual,
            image: {
              url: "https://example.com/stored.jpg",
              objectKey: "projects/recovery-project/images/stored.jpg",
              alt: "Stored source image",
              provider: "tavily" as const,
              contentType: "image/jpeg",
              query: "stored source image",
              sourceTitle: "Stored source",
              warnings: [],
            },
          },
        }
        : slide),
    };
    const merged = mergeRecoveredVisuals(recovered, rejected);

    expect(merged.slides[1].visual.image?.objectKey).toBe("projects/recovery-project/images/stored.jpg");
    expect(merged.slides[1].visual.image).toEqual(rejected.slides[1].visual.image);
    expect(mergeRecoveredVisuals({
      ...recovered,
      slides: recovered.slides.map((slide, index) => index === 1
         ? { ...slide, visual: { ...slide.visual, image: { url: "https://example.com/user.jpg", objectKey: "projects/recovery-project/images/user.jpg", alt: "User asset", provider: "user" as const, contentType: "image/jpeg", query: "user asset", sourceTitle: "User asset", warnings: [] } } }
        : slide),
    }, rejected).slides[1].visual.image?.provider).toBe("user");
    expect(mergeRecoveredVisuals({
      ...recovered,
      slides: recovered.slides.map((slide, index) => index === 1
        ? {
          ...slide,
          visual: {
            ...slide.visual,
            image: {
              ...rejected.slides[1].visual.image!,
              provider: "archive" as const,
              objectKey: "projects/recovery-project/images/archive.jpg",
            },
          },
        }
        : slide),
    }, rejected).slides[1].visual.image?.provider).toBe("archive");
    expect(mergeRecoveredVisuals(recovered, {
      ...rejected,
      slides: rejected.slides.map((slide, index) => index === 1 ? { ...slide, id: "different-slide-id" } : slide),
    }).slides[1].visual.image).toBeUndefined();
  });

  it("does not spend again when a retry inherits a terminal envelope", async () => {
    costEnvelope.findUnique
      .mockResolvedValueOnce({ policyVersion: "standard-generation-cost-envelope-v10", policySnapshot: {}, catalogSnapshot: {} })
      .mockResolvedValueOnce({ sourceSnapshot })
      .mockResolvedValueOnce({ status: "exhausted" });

    await expect(handleGenerationJob(job())).resolves.toBeUndefined();

    expect(generatePresentationFromNarration).not.toHaveBeenCalled();
    expect(searchWebSources).not.toHaveBeenCalled();
    expect(reserveCostEnvelope).not.toHaveBeenCalled();
    expect(settleCostEnvelope).not.toHaveBeenCalled();
    expect(prismaMock.presentation.upsert).toHaveBeenCalledTimes(1);
    const document = prismaMock.presentation.upsert.mock.calls[0]?.[0]?.create?.document;
    expect(document.sources.map((source: { id: string }) => source.id)).toEqual(sourceSnapshot.sources.map((source) => source.sourceId));
    expect(document.slides.flatMap((slide: { sourceRefs: Array<{ sourceId: string }> }) => slide.sourceRefs).every((ref: { sourceId: string }) => sourceSnapshot.sources.some((source) => source.sourceId === ref.sourceId))).toBe(true);
    expect(prismaMock.costEnvelope.create).not.toHaveBeenCalled();
    expect(prismaMock.project.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ready" }) }));
  });

  it("fails terminally with insufficient persisted artifacts without creating a presentation or spending", async () => {
    prismaMock.project.findUniqueOrThrow.mockResolvedValue({ ...project, speechDraft: "Слайд 1: неполный документ" });
    costEnvelope.findUnique
      .mockResolvedValueOnce({ policyVersion: "standard-generation-cost-envelope-v10", policySnapshot: {}, catalogSnapshot: {} })
      .mockResolvedValueOnce({ sourceSnapshot })
      .mockResolvedValueOnce({ status: "exhausted" });

    await expect(handleGenerationJob(job())).rejects.toThrow("presentation_recovery_envelope_exhausted");

    expect(prismaMock.presentation.upsert).not.toHaveBeenCalled();
    expect(prismaMock.costEnvelope.create).not.toHaveBeenCalled();
    expect(generatePresentationFromNarration).not.toHaveBeenCalled();
    expect(searchWebSources).not.toHaveBeenCalled();
    expect(reserveCostEnvelope).not.toHaveBeenCalled();
    expect(settleCostEnvelope).not.toHaveBeenCalled();
    expect(prismaMock.project.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }));
  });

  it("keeps the original presentation terminal diagnostic when local recovery is ineligible", async () => {
    const diagnostic = new Error("provider_presentation_terminal_diagnostic");
    prismaMock.project.findUniqueOrThrow.mockResolvedValue({ ...project, speechDraft: "Слайд 1: неполный документ" });
    generatePresentationFromNarration.mockRejectedValue(diagnostic);

    await expect(handleGenerationJob(job())).rejects.toBe(diagnostic);

    expect(prismaMock.generationJob.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ error: "provider_presentation_terminal_diagnostic" }) }));
    expect(captureGenerationError).toHaveBeenCalledWith(diagnostic, expect.objectContaining({ stage: "building_slides" }));
  });

  it("rejects malformed, generic, and local-only artifacts before local recovery", () => {
    const generic = Array.from({ length: 10 }, (_, index) => `Слайд ${index + 1}: Общая тема\n${Array.from({ length: 120 }, () => "Общий материал повторяется без предметного содержания.").join(" ")}`).join("\n\n");
    expect(hasAcceptedNarrationRecoveryArtifacts(project, sources, "Слайд 1: неполный документ")).toBe(false);
    expect(hasAcceptedNarrationRecoveryArtifacts(project, sources, generic)).toBe(false);
    expect(hasAcceptedNarrationRecoveryArtifacts(project, sources.map((source) => ({ ...source, type: "TXT" as const, url: undefined })), acceptedNarration)).toBe(false);
  });
});
