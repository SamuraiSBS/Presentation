import { describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import { ProjectsService } from "./projects.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";

const speechDraft = "Слайд 1: Введение\nЭто достаточно длинный текст выступления для проверки запуска презентации.";

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    userId: "user-1",
    title: "Project",
    prompt: "Prompt",
    scenario: "lesson",
    level: "beginner",
    mode: "without_sources",
    slideCount: 6,
    status: "script_ready",
    speechDraft,
    speechDraftUpdatedAt: new Date("2026-06-28T00:00:00.000Z"),
    error: null,
    sources: [],
    presentation: null,
    jobs: [],
    exports: [],
    ...overrides,
  };
}

function createHarness() {
  const prisma = {
    project: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    generationJob: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "user-1", planCode: "free" }),
    },
    usageCounter: {
      upsert: vi.fn().mockResolvedValue({ userId: "user-1", period: "2026-06", generated: 0 }),
      update: vi.fn(),
    },
  };
  const queue = {
    add: vi.fn().mockResolvedValue({ id: "queue-job-1" }),
  };
  const service = new ProjectsService(
    prisma as unknown as PrismaService,
    {} as ConfigService,
    queue as unknown as Queue,
  );

  return { prisma, queue, service };
}

describe("ProjectsService narration acceptance", () => {
  it("queues final presentation generation when the narration draft is accepted", async () => {
    const { prisma, queue, service } = createHarness();
    const accepted = project({ status: "script_ready", speechDraft });
    const queued = project({
      status: "queued",
      speechDraft,
      jobs: [{ id: "job-1", kind: "presentation", status: "queued", queueJobId: "queue-job-1" }],
    });

    prisma.project.findFirst
      .mockResolvedValueOnce(project({ speechDraft: "Previous accepted text." }))
      .mockResolvedValueOnce(accepted)
      .mockResolvedValueOnce(queued);
    prisma.project.update
      .mockResolvedValueOnce(accepted)
      .mockResolvedValueOnce(queued);
    prisma.generationJob.findFirst.mockResolvedValueOnce(null);
    prisma.generationJob.create.mockResolvedValueOnce({ id: "job-1" });

    const result = await service.updateNarrationDraft("user-1", "project-1", {
      speechDraft,
      accept: true,
    });

    expect(result.status).toBe("queued");
    expect(prisma.generationJob.create).toHaveBeenCalledWith({
      data: { projectId: "project-1", kind: "presentation", status: "queued" },
    });
    expect(queue.add).toHaveBeenCalledWith("generate-presentation", { projectId: "project-1", userId: "user-1" }, { attempts: 2 });
    expect(prisma.usageCounter.update).toHaveBeenCalledWith({
      where: { userId_period: { userId: "user-1", period: expect.any(String) } },
      data: { generated: { increment: 1 } },
    });
  });

  it("does not create a duplicate presentation job when one is already queued", async () => {
    const { prisma, queue, service } = createHarness();
    const existingJob = { id: "job-existing", kind: "presentation", status: "queued", queueJobId: "queue-job-existing" };
    const queued = project({ status: "queued", speechDraft, jobs: [existingJob] });

    prisma.project.findFirst
      .mockResolvedValueOnce(project())
      .mockResolvedValueOnce(queued)
      .mockResolvedValueOnce(queued);
    prisma.project.update.mockResolvedValueOnce(project({ status: "script_ready", speechDraft }));
    prisma.generationJob.findFirst.mockResolvedValueOnce(existingJob);

    const result = await service.updateNarrationDraft("user-1", "project-1", {
      speechDraft,
      accept: true,
    });

    expect(result.status).toBe("queued");
    expect(prisma.generationJob.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    expect(prisma.usageCounter.upsert).not.toHaveBeenCalled();
  });

  it("returns ready without queueing when a presentation already exists", async () => {
    const { prisma, queue, service } = createHarness();
    prisma.project.findFirst.mockResolvedValueOnce(project({
      status: "ready",
      presentation: { id: "presentation-1", document: {} },
    }));

    const result = await service.enqueueGeneration("user-1", "project-1");

    expect(result).toEqual({ projectId: "project-1", status: "ready" });
    expect(prisma.generationJob.findFirst).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
