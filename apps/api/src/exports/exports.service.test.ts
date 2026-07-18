import { describe, expect, it, vi } from "vitest";
import { ExportsService } from "./exports.service.js";

function serviceFixture() {
  const prisma = {
    project: { findUnique: vi.fn() },
    presentation: { findUnique: vi.fn() },
    export: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  };
  const queue = { add: vi.fn(), getJob: vi.fn().mockResolvedValue(null) };
  const access = { requireViewer: vi.fn() };
  const config = { getOrThrow: vi.fn(), get: vi.fn() };
  const service = new ExportsService(prisma as never, config as never, queue as never, access as never);
  return { service, prisma, queue, access, config };
}

describe("ExportsService revision safety", () => {
  it("stores the presentation revision when an export is requested", async () => {
    const { service, prisma, queue, access } = serviceFixture();
    access.requireViewer.mockResolvedValue({ project: { userId: "user-1" } });
    prisma.project.findUnique.mockResolvedValue({ id: "project-1", userId: "user-1", user: { planCode: "free" }, presentation: { revision: 7 } });
    prisma.export.create.mockResolvedValue({ id: "export-1", projectId: "project-1", type: "pptx", presentationRevision: 7 });
    queue.add.mockResolvedValue({ id: "queue-1" });
    prisma.export.update.mockResolvedValue({ id: "export-1", projectId: "project-1", type: "pptx", presentationRevision: 7, queueJobId: "queue-1" });

    await service.enqueue("user-1", "project-1", "pptx");

    expect(prisma.export.create).toHaveBeenCalledWith({
      data: { projectId: "project-1", type: "pptx", presentationRevision: 7, requestKey: "auto" },
    });
  });

  it("returns an existing export for the same presentation revision instead of queueing a duplicate", async () => {
    const { service, prisma, queue, access } = serviceFixture();
    access.requireViewer.mockResolvedValue({ project: { userId: "user-1" } });
    prisma.project.findUnique.mockResolvedValue({ id: "project-1", userId: "user-1", user: { planCode: "free" }, presentation: { revision: 7 } });
    prisma.export.findUnique.mockResolvedValue({ id: "export-existing", status: "queued", queueJobId: "queue-existing" });
    queue.getJob.mockResolvedValue({ getState: vi.fn().mockResolvedValue("waiting") });

    await expect(service.enqueue("user-1", "project-1", "pptx")).resolves.toMatchObject({ id: "export-existing" });

    expect(prisma.export.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("re-enqueues a queued export that was persisted before its queue job id", async () => {
    const { service, prisma, queue, access } = serviceFixture();
    access.requireViewer.mockResolvedValue({ project: { userId: "user-1" } });
    prisma.project.findUnique.mockResolvedValue({ id: "project-1", userId: "user-1", user: { planCode: "free" }, presentation: { revision: 7 } });
    prisma.export.findUnique.mockResolvedValue({ id: "export-recovery", status: "queued", queueJobId: null });
    prisma.export.update
      .mockResolvedValueOnce({ id: "export-recovery", status: "queued", queueJobId: null })
      .mockResolvedValueOnce({ id: "export-recovery", status: "queued", queueJobId: "queue-recovery" });
    queue.add.mockResolvedValue({ id: "queue-recovery" });

    await expect(service.enqueue("user-1", "project-1", "pptx")).resolves.toMatchObject({
      id: "export-recovery",
      queueJobId: "queue-recovery",
    });

    expect(queue.add).toHaveBeenCalledWith(
      "export-presentation",
      expect.objectContaining({ exportId: "export-recovery", projectId: "project-1", type: "pptx" }),
      expect.objectContaining({ jobId: "presentation-export-export-recovery" }),
    );
  });

  it("blocks downloading a ready export from an older revision", async () => {
    const { service, prisma } = serviceFixture();
    vi.spyOn(service, "get").mockResolvedValue({ status: "ready", objectKey: "old.pptx", presentationRevision: 2 } as never);
    prisma.presentation.findUnique.mockResolvedValue({ revision: 3 });

    await expect(service.getDownloadUrl("user-1", "project-1", "export-1"))
      .rejects.toThrow("Экспорт устарел после редактирования презентации");
  });

  it("requires a backend-validated acknowledgement for a defense export without a report", async () => {
    const { service, prisma, queue, access, config } = serviceFixture();
    access.requireViewer.mockResolvedValue({ project: { userId: "user-1" } });
    config.getOrThrow.mockReturnValue("internal-secret");
    prisma.project.findUnique.mockResolvedValue({
      id: "project-1",
      userId: "user-1",
      workflow: "requirements_driven",
      user: { planCode: "free" },
      presentation: { revision: 7, document: { slides: [] } },
      defenseWorkspace: {
        analysisRevision: 2,
        planRevision: 3,
        complianceReports: [],
        _count: { conflicts: 0 },
      },
    });

    let preflightToken = "";
    try {
      await service.enqueue("user-1", "project-1", "pptx");
    } catch (error) {
      const response = (error as { getResponse(): { details?: { preflightToken?: string } } }).getResponse();
      preflightToken = response.details?.preflightToken || "";
      expect(response.details).toMatchObject({
        allowed: false,
        presentationRevision: 7,
        warnings: [{ code: "missing_compliance_report" }],
      });
    }
    expect(preflightToken).toHaveLength(43);
    expect(queue.add).not.toHaveBeenCalled();

    prisma.export.create.mockResolvedValue({ id: "export-1", presentationRevision: 7, type: "pptx" });
    prisma.export.update.mockResolvedValue({ id: "export-1", projectId: "project-1", type: "pptx", presentationRevision: 7, queueJobId: "queue-1" });
    queue.add.mockResolvedValue({ id: "queue-1" });
    await expect(service.enqueue("user-1", "project-1", "pptx", {
      acknowledgeWarnings: true,
      preflightToken,
      expectedPresentationRevision: 7,
    })).resolves.toMatchObject({ id: "export-1" });

    prisma.project.findUnique.mockResolvedValue({
      id: "project-1",
      userId: "user-1",
      workflow: "requirements_driven",
      user: { planCode: "free" },
      presentation: { revision: 8, document: { slides: [] } },
      defenseWorkspace: {
        analysisRevision: 2,
        planRevision: 3,
        complianceReports: [],
        _count: { conflicts: 0 },
      },
    });
    await expect(service.enqueue("user-1", "project-1", "pptx", {
      acknowledgeWarnings: true,
      preflightToken,
      expectedPresentationRevision: 7,
    })).rejects.toMatchObject({ status: 409 });
  });
});
