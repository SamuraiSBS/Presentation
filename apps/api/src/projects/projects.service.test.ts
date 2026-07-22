import { describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import type { ProjectAccessService } from "../access/project-access.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import type { ProjectStorageService } from "../storage/project-storage.service.js";
import type { UsageService } from "../usage/usage.service.js";
import { ProjectsService } from "./projects.service.js";

const speechDraft = "Слайд 1: Введение\nЭто достаточно длинный текст выступления для проверки запуска презентации.";

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    userId: "user-1",
    folderId: null,
    title: "Project",
    prompt: "Prompt",
    scenario: "lesson",
    level: "beginner",
    mode: "fast_draft",
    slideCount: 6,
    status: "script_ready",
    speechDraft,
    speechDraftUpdatedAt: new Date("2026-06-28T00:00:00.000Z"),
    error: null,
    createdAt: new Date("2026-06-28T00:00:00.000Z"),
    updatedAt: new Date("2026-06-28T00:00:00.000Z"),
    user: { id: "user-1", name: null, image: null },
    folder: null,
    sources: [],
    presentation: null,
    jobs: [],
    exports: [],
    ...overrides,
  };
}

function createHarness() {
  const tx = {
    user: {
      upsert: vi.fn().mockResolvedValue({ id: "user-1", planCode: "free" }),
    },
    project: {
      create: vi.fn(),
    },
    defenseWorkspace: {
      create: vi.fn().mockResolvedValue({ id: "workspace-copy" }),
      update: vi.fn(),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    project: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    presentation: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    generationJob: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  const queue = { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) };
  const access = {
    requireEditor: vi.fn().mockResolvedValue({ project: { id: "project-1", userId: "user-1" }, role: "owner" }),
    requireViewer: vi.fn().mockResolvedValue({ project: { id: "project-1", userId: "user-1" }, role: "owner" }),
    requireOwner: vi.fn().mockResolvedValue({ project: { id: "project-1", userId: "user-1" }, role: "owner" }),
    resolve: vi.fn().mockResolvedValue({ project: { id: "project-1", userId: "user-1" }, role: "owner" }),
  };
  const usage = {
    reserveCreationSlot: vi.fn(),
    getSummary: vi.fn(),
  };
  const storage = {
    copyProjectPrefix: vi.fn(),
    deleteProjectPrefix: vi.fn(),
    deleteObjectKey: vi.fn(),
  };
  const service = new ProjectsService(
    prisma as unknown as PrismaService,
    {} as ConfigService,
    queue as unknown as Queue,
    access as unknown as ProjectAccessService,
    usage as unknown as UsageService,
    storage as unknown as ProjectStorageService,
  );

  return { access, prisma, queue, service, storage, tx, usage };
}

describe("ProjectsService creation", () => {
  it("reserves the monthly slot in the same transaction and stores the creation brief", async () => {
    const { service, tx, usage } = createHarness();
    tx.project.create.mockResolvedValueOnce(project({ prompt: "saved" }));

    await service.create("user-1", {
      title: "AI in higher education",
      prompt: "Create a concise university presentation about AI in higher education.",
      scenario: "university_report",
      level: "university_student",
      mode: "with_sources",
      slideCount: 10,
      generationBrief: {
        audience: "university_student",
        speechStyle: "easy_professional",
        slideDensity: "brief_slides_full_speech",
        visualStrategy: "images_and_diagrams",
        exportTarget: "web_and_pptx_pdf",
      },
    });

    expect(usage.reserveCreationSlot).toHaveBeenCalledWith(tx, "user-1");
    expect(tx.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scenario: "university_report",
        level: "university_student",
        mode: "with_sources",
        prompt: expect.stringContaining("Creation brief:"),
      }),
      include: { sources: true, presentation: true },
    });
    expect(tx.project.create.mock.calls[0][0].data.prompt).toContain("brief_slides_full_speech");
  });
});

describe("ProjectsService generation", () => {
  it("queues presentation generation without charging creation usage again", async () => {
    const { prisma, queue, service, usage } = createHarness();
    prisma.project.findUnique.mockResolvedValue(project());
    prisma.generationJob.findFirst.mockResolvedValueOnce(null);
    prisma.generationJob.create.mockResolvedValueOnce({ id: "job-1" });

    const result = await service.enqueueGeneration("user-1", "project-1");

    expect(result.status).toBe("queued");
    expect(queue.add).toHaveBeenCalledWith(
      "generate-presentation",
      expect.objectContaining({ projectId: "project-1", userId: "user-1" }),
      expect.objectContaining({ attempts: 3 }),
    );
    expect(usage.reserveCreationSlot).not.toHaveBeenCalled();
  });

  it("returns ready without queueing when a presentation already exists", async () => {
    const { prisma, queue, service } = createHarness();
    prisma.project.findUnique.mockResolvedValueOnce(project({
      status: "ready",
      presentation: { id: "presentation-1", revision: 1, document: {} },
    }));

    const result = await service.enqueueGeneration("user-1", "project-1");

    expect(result).toEqual({ projectId: "project-1", status: "ready" });
    expect(prisma.generationJob.findFirst).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe("ProjectsService revision protection", () => {
  it("returns a 409 conflict before writing a stale slide revision", async () => {
    const { prisma, service } = createHarness();
    prisma.presentation.findUnique.mockResolvedValueOnce({
      projectId: "project-1",
      revision: 4,
      document: {},
    });

    await expect(service.updateSlide("user-1", "project-1", "slide-1", {
      expectedRevision: 3,
      title: "Новая версия",
    })).rejects.toMatchObject({ status: 409 });
    expect(prisma.presentation.updateMany).not.toHaveBeenCalled();
  });
});

describe("ProjectsService public generation errors", () => {
  it("does not expose Yandex provider details in a failed project response", async () => {
    const { service } = createHarness();
    vi.spyOn(service as any, "getProjectDetail").mockResolvedValue(project({
      status: "failed",
      error: "Yandex schema validation failed for yandex-secret123456",
    }) as never);

    const result = await service.getAccessible("user-1", "project-1");

    expect(result.error).toMatch(/[А-Яа-яЁё]/);
    expect(result.error).not.toMatch(/yandex|schema|secret/i);
  });
});

describe("ProjectsService defense lifecycle", () => {
  it("duplicates the editable defense workspace without report history", async () => {
    const { prisma, service, storage, tx } = createHarness();
    prisma.project.findUniqueOrThrow.mockResolvedValue(project({
      workflow: "requirements_driven",
      defenseWorkspace: {
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
        analysisRevision: 2,
        styleBrief: null,
        plan: null,
        planRevision: 1,
        analysisError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        facts: [],
        requirements: [],
        conflicts: [],
      },
    }));
    storage.copyProjectPrefix.mockResolvedValue(new Map());
    vi.spyOn(service, "getAccessible").mockResolvedValue({ id: "copy" } as never);

    await service.duplicate("user-1", "project-1", {});

    expect(tx.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ workflow: "requirements_driven" }),
    });
    expect(tx.defenseWorkspace.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        defenseType: "hackathon",
        analysisRevision: 2,
        projectId: expect.any(String),
      }),
    });
  });

  it("deletes the complete project storage prefix before the cascading database row", async () => {
    const { prisma, service, storage } = createHarness();
    await service.remove("user-1", "project-1");
    expect(storage.deleteProjectPrefix).toHaveBeenCalledWith("project-1");
    expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: "project-1" } });
  });
});
