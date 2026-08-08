import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { handleGenerationJob, hasAcceptedNarrationRecoveryArtifacts } from "./generation.js";
import { productionQualityReleaseResult } from "./presentation-quality.js";
import { searchWebSources } from "./web-search.js";

const { generatePresentationFromNarration, prismaMock, costEnvelope, reserveCostEnvelope, settleCostEnvelope, captureGenerationError } = vi.hoisted(() => {
  const costEnvelope = { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), create: vi.fn() };
  const reserveCostEnvelope = vi.fn();
  const settleCostEnvelope = vi.fn();
  const captureGenerationError = vi.fn();
  return {
    generatePresentationFromNarration: vi.fn(),
    costEnvelope,
    reserveCostEnvelope,
    settleCostEnvelope,
    captureGenerationError,
    prismaMock: {
      project: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
      source: { create: vi.fn(), deleteMany: vi.fn(), update: vi.fn() },
      presentation: { findUnique: vi.fn(), upsert: vi.fn() },
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
vi.mock("./image-search.js", () => ({ enrichPresentationImages: vi.fn() }));
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

const acceptedNarration = readFileSync(new URL("../../../../e2e-237-accepted-speech.txt", import.meta.url), "utf8");
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

function job() {
  return { id: "recovery-job", name: "generate-presentation", data: { projectId: project.id, userId: project.userId, costEnvelopeId: "recovery-envelope" }, attemptsMade: 0, opts: { attempts: 1 }, updateProgress: vi.fn(), discard: vi.fn() } as never;
}

describe("accepted narration local recovery with the actual production gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (values: Promise<unknown>[]) => Promise.all(values));
    prismaMock.project.findUniqueOrThrow.mockResolvedValue(project);
    prismaMock.presentation.findUnique.mockResolvedValue(null);
    costEnvelope.findUnique.mockResolvedValue({ sourceSnapshot, status: "active" });
    costEnvelope.findUniqueOrThrow.mockResolvedValue({
      limitRub: { toString: () => "10" }, reservedRub: { toString: () => "0" }, settledRub: { toString: () => "0" }, status: "active",
      sourceSnapshot, reservations: [{ status: "settled", reason: null }], _count: { costEvents: 0 },
    });
    generatePresentationFromNarration.mockRejectedValue(new Error("structured presentation response was malformed"));
  });

  it("recovers a provider failure to ready through the real release gate without a second provider or Tavily call", async () => {
    await expect(handleGenerationJob(job())).resolves.toBeUndefined();
    const document = prismaMock.presentation.upsert.mock.calls[0]?.[0]?.create?.document;
    const release = productionQualityReleaseResult(document, sources, { ...project, mandatorySourceSnapshot: true, acceptedNarrationRecovery: true });
    expect(release).toMatchObject({ finalDisposition: "released", issueCategories: [], issues: [] });
    expect(generatePresentationFromNarration).toHaveBeenCalledTimes(1);
    expect(searchWebSources).not.toHaveBeenCalled();
    expect(prismaMock.project.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ready" }) }));
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
