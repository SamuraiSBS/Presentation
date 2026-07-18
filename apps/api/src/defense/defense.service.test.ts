import { describe, expect, it, vi } from "vitest";
import { DefenseService } from "./defense.service.js";

function fixture() {
  const prisma = {
    defenseWorkspace: { findUnique: vi.fn(), updateMany: vi.fn() },
    projectFact: { findFirst: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    projectRequirement: { count: vi.fn().mockResolvedValue(0) },
    generationJob: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    project: { update: vi.fn() },
    source: { count: vi.fn().mockResolvedValue(0) },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (input: unknown) => (
    typeof input === "function"
      ? (input as (tx: typeof prisma) => unknown)(prisma)
      : Promise.all(input as Promise<unknown>[])
  ));
  const generationQueue = { add: vi.fn() };
  const exportsQueue = { add: vi.fn() };
  const access = { requireEditor: vi.fn(), requireViewer: vi.fn() };
  const service = new DefenseService(
    prisma as never,
    { get: vi.fn(), getOrThrow: vi.fn() } as never,
    generationQueue as never,
    exportsQueue as never,
    access as never,
    { reserveCreationSlot: vi.fn() } as never,
  );
  return { service, prisma, generationQueue, access };
}

const workspace = {
  id: "workspace-1",
  projectId: "project-1",
  defenseType: "hackathon",
  complianceMode: "strict",
  language: "ru",
  targetSlideCount: 10,
  targetDurationSeconds: 420,
  allowWebImages: false,
  authorProfile: {},
  standardPresetVersion: "hackathon-v1",
  analysisStatus: "review_ready",
  analysisRevision: 3,
  styleBrief: null,
  plan: null,
  planRevision: 1,
  analysisError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("DefenseService access and ownership", () => {
  it("uses editor access for review mutations", async () => {
    const { service, access } = fixture();
    access.requireEditor.mockRejectedValue(new Error("forbidden"));

    await expect(service.deleteFact("viewer-1", "project-1", "fact-1")).rejects.toThrow("forbidden");
  });

  it("looks up a fact through both project workspace and nested fact id", async () => {
    const { service, prisma, access } = fixture();
    access.requireEditor.mockResolvedValue({ project: { userId: "owner-1" }, role: "editor" });
    prisma.defenseWorkspace.findUnique.mockResolvedValue(workspace);
    prisma.projectFact.findFirst.mockResolvedValue(null);

    await expect(service.updateFact("editor-1", "project-1", "foreign-fact", {
      statement: "Исправленный факт",
      expectedAnalysisRevision: 3,
    })).rejects.toThrow("Факт не найден");
    expect(prisma.projectFact.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign-fact", workspaceId: "workspace-1" },
    });
  });
});

describe("DefenseService job idempotency", () => {
  it("returns the existing analysis job for the same request key", async () => {
    const { service, prisma, generationQueue, access } = fixture();
    access.requireEditor.mockResolvedValue({ project: { userId: "owner-1" }, role: "owner" });
    prisma.defenseWorkspace.findUnique.mockResolvedValue(workspace);
    prisma.generationJob.findFirst.mockResolvedValue({
      id: "job-1",
      queueJobId: "queue-1",
      status: "queued",
      progressStage: "extracting_sources",
      progressLabel: "Анализируем материалы защиты",
    });

    await expect(service.startAnalysis("owner-1", "project-1", {
      confirmCost: true,
      idempotencyKey: "request-key-123",
    })).resolves.toMatchObject({ jobId: "job-1", queueJobId: "queue-1" });
    expect(generationQueue.add).not.toHaveBeenCalled();
    expect(prisma.generationJob.findFirst).toHaveBeenCalledWith({
      where: { projectId: "project-1", kind: "requirements_analysis", requestKey: "request-key-123" },
    });
  });

  it("approves a plan and enqueues the existing narration pipeline once", async () => {
    const { service, prisma, generationQueue, access } = fixture();
    const plan = {
      version: 1 as const,
      defenseType: "hackathon" as const,
      complianceMode: "strict" as const,
      presetVersion: "hackathon-v1" as const,
      status: "draft" as const,
      slides: Array.from({ length: workspace.targetSlideCount }, (_, index) => ({
        id: `slide-${index + 1}`,
        order: index + 1,
        title: `Слайд ${index + 1}`,
        purpose: "Показать подтверждённую часть проекта",
        timingSeconds: 30,
        requirementIds: [],
        factIds: [],
        assetSourceIds: [],
        placeholders: [],
        visualStrategy: "",
        origin: "user" as const,
      })),
      totalTimingSeconds: workspace.targetSlideCount * 30,
      approvedAt: null,
    };
    access.requireEditor.mockResolvedValue({ project: { userId: "owner-1" }, role: "owner" });
    prisma.defenseWorkspace.findUnique.mockResolvedValue({ ...workspace, plan });
    prisma.defenseWorkspace.updateMany.mockResolvedValue({ count: 1 });
    prisma.generationJob.findUnique.mockResolvedValue(null);
    prisma.generationJob.create.mockResolvedValue({
      id: "narration-1",
      status: "queued",
      queueJobId: null,
    });
    prisma.generationJob.update.mockResolvedValue({
      id: "narration-1",
      status: "queued",
      queueJobId: "queue-narration-1",
    });
    generationQueue.add.mockResolvedValue({ id: "queue-narration-1" });

    await expect(service.confirmPlan("owner-1", "project-1", {
      expectedAnalysisRevision: 3,
      expectedPlanRevision: 1,
    })).resolves.toMatchObject({
      plan: { status: "approved" },
      planRevision: 2,
      jobId: "narration-1",
      status: "script_queued",
    });
    expect(generationQueue.add).toHaveBeenCalledWith(
      "generate-narration",
      expect.objectContaining({ projectId: "project-1", workspaceId: "workspace-1", planRevision: 2 }),
      expect.objectContaining({ jobId: "defense-narration-narration-1" }),
    );
  });
});
