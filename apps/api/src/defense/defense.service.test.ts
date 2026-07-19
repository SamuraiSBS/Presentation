import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { DefenseService } from "./defense.service.js";

function fixture() {
  const prisma = {
    defenseWorkspace: { findUnique: vi.fn(), updateMany: vi.fn() },
    projectFact: { findFirst: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    projectRequirement: { count: vi.fn().mockResolvedValue(0) },
    generationJob: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    project: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    presentation: { findUnique: vi.fn() },
    complianceReport: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    source: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (input: unknown) => (
    typeof input === "function"
      ? (input as (tx: typeof prisma) => unknown)(prisma)
      : Promise.all(input as Promise<unknown>[])
  ));
  const generationQueue = { add: vi.fn(), getJob: vi.fn().mockResolvedValue(null) };
  const exportsQueue = { add: vi.fn(), getJob: vi.fn().mockResolvedValue(null) };
  const access = { requireEditor: vi.fn(), requireViewer: vi.fn() };
  const usage = { reserveCreationSlot: vi.fn() };
  const service = new DefenseService(
    prisma as never,
    { get: vi.fn(), getOrThrow: vi.fn() } as never,
    generationQueue as never,
    exportsQueue as never,
    access as never,
    usage as never,
  );
  return { service, prisma, generationQueue, exportsQueue, access, usage };
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

  it("does not reserve another creation slot when a create request is retried", async () => {
    const { service, prisma, usage } = fixture();
    prisma.project.findFirst.mockResolvedValue({ id: "project-existing" });
    vi.spyOn(service, "get").mockResolvedValue({ workspace: workspace as never } as never);

    await expect(service.create("owner-1", {
      title: "Защита проекта",
      defenseType: "hackathon",
      complianceMode: "strict",
      targetSlideCount: 10,
      targetDurationSeconds: 420,
      allowWebImages: false,
      authorProfile: {},
      idempotencyKey: "defense-create-request-1",
    })).resolves.toMatchObject({ id: "project-existing" });

    expect(usage.reserveCreationSlot).not.toHaveBeenCalled();
  });

  it("rejects input mutations after the defense plan has been approved", async () => {
    const { service, prisma, access } = fixture();
    access.requireEditor.mockResolvedValue({ project: { userId: "owner-1" }, role: "owner" });
    prisma.defenseWorkspace.findUnique.mockResolvedValue({
      ...workspace,
      plan: approvedPlan(),
    });

    await expect(service.updateConfig("owner-1", "project-1", {
      allowWebImages: true,
      confirmPresetRebuild: false,
      expectedAnalysisRevision: 3,
    })).rejects.toThrow("После подтверждения плана");
    expect(prisma.defenseWorkspace.updateMany).not.toHaveBeenCalled();
  });

  it("includes the captured plan revision in a draft input mutation CAS", async () => {
    const { service, prisma, access } = fixture();
    access.requireEditor.mockResolvedValue({ project: { userId: "owner-1" }, role: "owner" });
    prisma.defenseWorkspace.findUnique.mockResolvedValue(workspace);
    prisma.defenseWorkspace.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.updateConfig("owner-1", "project-1", {
      allowWebImages: true,
      confirmPresetRebuild: false,
      expectedAnalysisRevision: 3,
    })).rejects.toBeDefined();

    expect(prisma.defenseWorkspace.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "workspace-1",
        analysisRevision: 3,
        planRevision: 1,
      }),
    }));
  });

  it("rejects source evidence from an excluded material", async () => {
    const { service, prisma, access } = fixture();
    access.requireEditor.mockResolvedValue({ project: { userId: "owner-1" }, role: "owner" });
    prisma.defenseWorkspace.findUnique.mockResolvedValue(workspace);
    prisma.source.findMany.mockResolvedValue([{ id: "source-1", included: false, metadata: { chunks: [] } }]);

    await expect(service.createFact("owner-1", "project-1", {
      statement: "Подтверждённый факт",
      evidence: [{ confirmation: "source", sourceId: "source-1", locator: "README#facts" }],
      expectedAnalysisRevision: 3,
    })).rejects.toThrow("включённый материал");
  });
});

function approvedPlan() {
  return {
    version: 1 as const,
    defenseType: "hackathon" as const,
    complianceMode: "strict" as const,
    presetVersion: "hackathon-v1" as const,
    status: "approved" as const,
    slides: Array.from({ length: 10 }, (_, index) => ({
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
    totalTimingSeconds: 300,
    approvedAt: "2026-07-18T10:00:00.000Z",
  };
}

function queuedComplianceReport(overrides: Record<string, unknown> = {}) {
  return {
    id: "report-1",
    workspaceId: "workspace-1",
    requestKey: "defense:compliance:workspace-1:7:3-1",
    status: "queued",
    queueJobId: null,
    presentationRevision: 7,
    analysisRevision: 3,
    planRevision: 1,
    document: null,
    requiredSatisfied: 0,
    requiredTotal: 0,
    recommendedSatisfied: 0,
    recommendedTotal: 0,
    preferenceSatisfied: 0,
    preferenceTotal: 0,
    pdfObjectKey: null,
    pdfStatus: null,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("DefenseService job idempotency", () => {
  it("returns the existing analysis job for the same workspace revision", async () => {
    const { service, prisma, generationQueue, access } = fixture();
    access.requireEditor.mockResolvedValue({ project: { userId: "owner-1" }, role: "owner" });
    prisma.defenseWorkspace.findUnique.mockResolvedValue(workspace);
    prisma.generationJob.findUnique.mockResolvedValue({
      id: "job-1",
      queueJobId: "queue-1",
      status: "queued",
      progressStage: "extracting_sources",
      progressLabel: "Анализируем материалы защиты",
    });
    generationQueue.getJob.mockResolvedValue({ getState: vi.fn().mockResolvedValue("waiting") });

    await expect(service.startAnalysis("owner-1", "project-1", {
      confirmCost: true,
      idempotencyKey: "request-key-123",
      expectedAnalysisRevision: 3,
    })).resolves.toMatchObject({ jobId: "job-1", queueJobId: "queue-1" });
    expect(generationQueue.add).not.toHaveBeenCalled();
    expect(prisma.generationJob.findUnique).toHaveBeenCalledWith({
      where: {
        projectId_kind_requestKey: {
          projectId: "project-1",
          kind: "requirements_analysis",
          requestKey: "defense:analysis:workspace-1:3:auto",
        },
      },
    });
  });

  it("re-enqueues a persisted analysis job that has no queue job id", async () => {
    const { service, prisma, generationQueue, access } = fixture();
    access.requireEditor.mockResolvedValue({ project: { userId: "owner-1" }, role: "owner" });
    prisma.defenseWorkspace.findUnique.mockResolvedValue(workspace);
    prisma.source.count.mockResolvedValue(1);
    prisma.generationJob.findUnique.mockResolvedValue({
      id: "job-recovery",
      queueJobId: null,
      status: "queued",
      progressStage: "extracting_sources",
      progressLabel: "Анализируем материалы защиты",
    });
    prisma.defenseWorkspace.updateMany.mockResolvedValue({ count: 1 });
    prisma.generationJob.update.mockResolvedValue({
      id: "job-recovery",
      queueJobId: "queue-recovery",
      status: "queued",
      progressStage: "extracting_sources",
      progressLabel: "Анализируем материалы защиты",
    });
    generationQueue.add.mockResolvedValue({ id: "queue-recovery" });

    await expect(service.startAnalysis("owner-1", "project-1", {
      confirmCost: true,
      idempotencyKey: "different-client-key",
      expectedAnalysisRevision: 3,
    })).resolves.toMatchObject({ jobId: "job-recovery", queueJobId: "queue-recovery" });

    expect(generationQueue.add).toHaveBeenCalledWith(
      "analyze-defense-brief",
      expect.objectContaining({ expectedAnalysisRevision: 3, expectedPlanRevision: 1 }),
      expect.objectContaining({ jobId: "defense-analysis-job-recovery" }),
    );
  });

  it("re-enqueues a queued compliance report that has no queue job id", async () => {
    const { service, prisma, generationQueue, access } = fixture();
    const report = queuedComplianceReport();
    access.requireEditor.mockResolvedValue({ project: { userId: "owner-1" }, role: "owner" });
    prisma.defenseWorkspace.findUnique.mockResolvedValue({ ...workspace, plan: approvedPlan() });
    prisma.presentation.findUnique.mockResolvedValue({ revision: 7 });
    prisma.complianceReport.findUnique.mockResolvedValue(report);
    prisma.generationJob.findUnique.mockResolvedValue({ id: "compliance-job-1", status: "queued", queueJobId: null });
    prisma.complianceReport.update.mockResolvedValue(report);
    prisma.generationJob.update.mockResolvedValue({ id: "compliance-job-1", status: "queued", queueJobId: "compliance-queue-1" });
    generationQueue.add.mockResolvedValue({ id: "compliance-queue-1" });

    await expect(service.startComplianceCheck("owner-1", "project-1", {
      expectedPresentationRevision: 7,
      expectedAnalysisRevision: 3,
      expectedPlanRevision: 1,
      idempotencyKey: "compliance-retry-1",
    })).resolves.toMatchObject({ queueJobId: "compliance-queue-1" });

    expect(generationQueue.add).toHaveBeenCalledWith(
      "check-defense-compliance",
      expect.objectContaining({ reportId: "report-1", generationJobId: "compliance-job-1" }),
      expect.objectContaining({ jobId: "defense-compliance-compliance-job-1" }),
    );
  });

  it("recovers a concurrent compliance report instead of surfacing a uniqueness error", async () => {
    const { service, prisma, generationQueue, access } = fixture();
    const report = queuedComplianceReport();
    const duplicate = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "test",
    });
    access.requireEditor.mockResolvedValue({ project: { userId: "owner-1" }, role: "owner" });
    prisma.defenseWorkspace.findUnique.mockResolvedValue({ ...workspace, plan: approvedPlan() });
    prisma.presentation.findUnique.mockResolvedValue({ revision: 7 });
    prisma.complianceReport.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(report);
    prisma.complianceReport.findFirst.mockResolvedValue(null);
    prisma.complianceReport.create.mockRejectedValue(duplicate);
    prisma.complianceReport.update.mockResolvedValue(report);
    prisma.generationJob.findUnique.mockResolvedValue({ id: "compliance-job-1", status: "queued", queueJobId: null });
    prisma.generationJob.update.mockResolvedValue({ id: "compliance-job-1", status: "queued", queueJobId: "compliance-queue-1" });
    generationQueue.add.mockResolvedValue({ id: "compliance-queue-1" });

    await expect(service.startComplianceCheck("owner-1", "project-1", {
      expectedPresentationRevision: 7,
      expectedAnalysisRevision: 3,
      expectedPlanRevision: 1,
      idempotencyKey: "compliance-retry-1",
    })).resolves.toMatchObject({ queueJobId: "compliance-queue-1" });
  });

  it("re-enqueues a queued compliance PDF that has no queue job id", async () => {
    const { service, prisma, exportsQueue, access } = fixture();
    const report = queuedComplianceReport({
      status: "ready",
      pdfStatus: "queued",
      pdfQueueJobId: null,
    });
    access.requireViewer.mockResolvedValue({ project: { userId: "owner-1" }, role: "owner" });
    prisma.defenseWorkspace.findUnique.mockResolvedValue(workspace);
    prisma.complianceReport.findFirst.mockResolvedValue(report);
    prisma.complianceReport.updateMany.mockResolvedValue({ count: 1 });
    prisma.complianceReport.update.mockResolvedValue({ ...report, pdfQueueJobId: "pdf-queue-1" });
    exportsQueue.add.mockResolvedValue({ id: "pdf-queue-1" });

    await expect(service.requestReportPdf("owner-1", "project-1", "report-1", {
      expectedPresentationRevision: 7,
      idempotencyKey: "pdf-retry-1",
    })).resolves.toMatchObject({ queueJobId: "pdf-queue-1" });

    expect(exportsQueue.add).toHaveBeenCalledWith(
      "export-compliance-report",
      expect.objectContaining({ reportId: "report-1", workspaceId: "workspace-1" }),
      expect.objectContaining({ jobId: "defense-compliance-pdf-report-1-7" }),
    );
  });

  it("re-enqueues a compliance PDF whose persisted BullMQ job has disappeared", async () => {
    const { service, prisma, exportsQueue, access } = fixture();
    const report = queuedComplianceReport({
      status: "ready",
      pdfStatus: "processing",
      pdfQueueJobId: "missing-pdf-job",
    });
    access.requireViewer.mockResolvedValue({ project: { userId: "owner-1" }, role: "owner" });
    prisma.defenseWorkspace.findUnique.mockResolvedValue(workspace);
    prisma.complianceReport.findFirst.mockResolvedValue(report);
    prisma.complianceReport.updateMany.mockResolvedValue({ count: 1 });
    prisma.complianceReport.update.mockResolvedValue({ ...report, pdfStatus: "queued", pdfQueueJobId: "pdf-queue-2" });
    exportsQueue.add.mockResolvedValue({ id: "pdf-queue-2" });

    await expect(service.requestReportPdf("owner-1", "project-1", "report-1", {
      expectedPresentationRevision: 7,
      idempotencyKey: "pdf-retry-missing-job",
    })).resolves.toMatchObject({ queueJobId: "pdf-queue-2" });

    expect(exportsQueue.add).toHaveBeenCalledWith(
      "export-compliance-report",
      expect.objectContaining({ reportId: "report-1" }),
      expect.objectContaining({ jobId: "defense-compliance-pdf-report-1-7" }),
    );
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
        factIds: index === 1 ? ["fact-1"] : [],
        assetSourceIds: [],
        placeholders: index === 0 ? [] : [{
          id: `evidence-gap-${index + 1}`,
          kind: "text" as const,
          label: `Добавьте подтверждённый факт для раздела ${index + 1}`,
          resolved: false as const,
          severity: "warning" as const,
        }],
        visualStrategy: "",
        origin: "user" as const,
      })),
      totalTimingSeconds: workspace.targetSlideCount * 30,
      approvedAt: null,
    };
    access.requireEditor.mockResolvedValue({ project: { userId: "owner-1" }, role: "owner" });
    prisma.defenseWorkspace.findUnique.mockResolvedValue({ ...workspace, plan });
    prisma.projectFact.count.mockResolvedValue(1);
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

  it("rejects narration confirmation after failed analysis before it creates a job", async () => {
    const { service, prisma, generationQueue, access } = fixture();
    access.requireEditor.mockResolvedValue({ project: { userId: "owner-1" }, role: "owner" });
    prisma.defenseWorkspace.findUnique.mockResolvedValue({
      ...workspace,
      analysisStatus: "failed",
      plan: approvedPlan(),
    });

    await expect(service.confirmPlan("owner-1", "project-1", {
      expectedAnalysisRevision: 3,
      expectedPlanRevision: 1,
    })).rejects.toThrow("Сначала завершите анализ");
    expect(generationQueue.add).not.toHaveBeenCalled();
  });

  it("rejects an evidence-free plan before it queues narration", async () => {
    const { service, prisma, generationQueue, access } = fixture();
    access.requireEditor.mockResolvedValue({ project: { userId: "owner-1" }, role: "owner" });
    prisma.defenseWorkspace.findUnique.mockResolvedValue({ ...workspace, plan: approvedPlan() });
    prisma.projectFact.count.mockResolvedValue(0);
    prisma.projectRequirement.count.mockResolvedValue(0);

    await expect(service.confirmPlan("owner-1", "project-1", {
      expectedAnalysisRevision: 3,
      expectedPlanRevision: 1,
    })).rejects.toThrow("пока нет подтверждённых фактов или требований");
    expect(generationQueue.add).not.toHaveBeenCalled();
  });
});
