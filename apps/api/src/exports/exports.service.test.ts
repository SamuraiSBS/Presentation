import { describe, expect, it, vi } from "vitest";
import { ExportsService } from "./exports.service.js";

function serviceFixture() {
  const prisma = {
    project: { findUnique: vi.fn() },
    presentation: { findUnique: vi.fn() },
    export: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
  };
  const queue = { add: vi.fn() };
  const access = { requireViewer: vi.fn() };
  const config = { getOrThrow: vi.fn(), get: vi.fn() };
  const service = new ExportsService(prisma as never, config as never, queue as never, access as never);
  return { service, prisma, queue, access };
}

describe("ExportsService revision safety", () => {
  it("stores the presentation revision when an export is requested", async () => {
    const { service, prisma, queue, access } = serviceFixture();
    access.requireViewer.mockResolvedValue({ project: { userId: "user-1" } });
    prisma.project.findUnique.mockResolvedValue({ id: "project-1", userId: "user-1", user: { planCode: "free" }, presentation: { revision: 7 } });
    prisma.export.create.mockResolvedValue({ id: "export-1", projectId: "project-1", type: "pptx", presentationRevision: 7 });
    queue.add.mockResolvedValue({ id: "queue-1" });
    prisma.export.update.mockResolvedValue({});

    await service.enqueue("user-1", "project-1", "pptx");

    expect(prisma.export.create).toHaveBeenCalledWith({ data: { projectId: "project-1", type: "pptx", presentationRevision: 7 } });
  });

  it("blocks downloading a ready export from an older revision", async () => {
    const { service, prisma } = serviceFixture();
    vi.spyOn(service, "get").mockResolvedValue({ status: "ready", objectKey: "old.pptx", presentationRevision: 2 } as never);
    prisma.presentation.findUnique.mockResolvedValue({ revision: 3 });

    await expect(service.getDownloadUrl("user-1", "project-1", "export-1"))
      .rejects.toThrow("Экспорт устарел после редактирования презентации");
  });
});
