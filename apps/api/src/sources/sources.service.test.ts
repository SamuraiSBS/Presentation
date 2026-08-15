import { describe, expect, it, vi } from "vitest";
import { SourcesService } from "./sources.service.js";

describe("SourcesService defense upload idempotency", () => {
  it("returns the complete persisted batch before attempting a second object upload", async () => {
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          id: "project-1",
          userId: "owner-1",
          workflow: "requirements_driven",
          user: { planCode: "free" },
          defenseWorkspace: { id: "workspace-1", analysisRevision: 2, plan: null },
        }),
      },
      source: {
        findMany: vi.fn().mockResolvedValue([
          { id: "source-1", uploadFieldName: "file_0", label: "project.md" },
        ]),
      },
    };
    const service = new SourcesService(
      prisma as never,
      { get: vi.fn(), getOrThrow: vi.fn() } as never,
      { requireEditor: vi.fn().mockResolvedValue({ project: { userId: "owner-1" } }) } as never,
      { scan: vi.fn().mockResolvedValue(undefined) } as never,
    );
    const file = {
      fieldname: "file_0",
      originalname: "project.md",
      size: 20,
      mimetype: "text/markdown",
      buffer: Buffer.from("# Project"),
    } as Express.Multer.File;

    await expect(service.uploadDefense(
      "owner-1",
      "project-1",
      [file],
      [{ fieldName: "file_0", role: "project_document", label: "project.md" }],
      2,
      "defense-upload-request-1",
    )).resolves.toEqual({ sources: [{ id: "source-1", uploadFieldName: "file_0", label: "project.md" }] });

    expect(prisma.source.findMany).toHaveBeenCalledWith({
      where: { projectId: "project-1", uploadRequestKey: "defense-upload-request-1" },
      orderBy: { uploadFieldName: "asc" },
    });
  });
});
