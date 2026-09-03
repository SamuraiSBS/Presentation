import type { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { ProjectAccessService } from "../access/project-access.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import type { ProjectStorageService } from "../storage/project-storage.service.js";
import type { UsageService } from "../usage/usage.service.js";
import type { MalwareScanService } from "../security/malware-scan.service.js";
import { COST_ENVELOPE_POLICY_VERSION } from "@studydeck/shared";
import { ProjectsService } from "./projects.service.js";

const speechDraft = "Слайд 1: Введение\nЭто достаточно длинный текст выступления для проверки запуска презентации.";

function acceptedTenSlideSpeech(wordsPerSection = 70) {
  return Array.from({ length: 10 }, (_, index) => {
    const words = Array.from({ length: wordsPerSection }, (_, word) => `fact${index + 1}_${word + 1}`);
    const split = Math.floor(words.length / 2);
    return `Слайд ${index + 1}: Тема ${index + 1}\n${words.slice(0, split).join(" ")}. ${words.slice(split).join(" ")}.`;
  }).join("\n\n");
}

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
      update: vi.fn().mockResolvedValue({ slideCount: 6 }),
    },
    defenseWorkspace: {
      create: vi.fn().mockResolvedValue({ id: "workspace-copy" }),
      update: vi.fn(),
    },
    generationJob: {
      create: vi.fn().mockResolvedValue({ id: "job-1" }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    costEnvelope: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "envelope-1" }),
      update: vi.fn(),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    project: {
      findFirst: vi.fn(),
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
    assertSlideCount: vi.fn(),
    reserveGenerationSlot: vi.fn(),
    releaseGenerationSlot: vi.fn().mockResolvedValue(true),
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
    { scan: vi.fn().mockResolvedValue(undefined) } as unknown as MalwareScanService,
  );

  return { access, prisma, queue, service, storage, tx, usage };
}

describe("ProjectsService creation", () => {
  it("checks slide entitlement without charging a draft and stores the creation brief", async () => {
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

    expect(usage.assertSlideCount).toHaveBeenCalledWith(tx, "user-1", 10);
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

  it("returns the existing project for a repeated creation request", async () => {
    const { service, prisma, tx, usage } = createHarness();
    prisma.project.findFirst.mockResolvedValueOnce({ id: "project-existing" });
    vi.spyOn(service, "getAccessible").mockResolvedValue({ id: "project-existing" } as never);

    await expect(service.create("user-1", {
      title: "AI in education",
      prompt: "Create a concise presentation about AI in education.",
      scenario: "general",
      level: "general",
      mode: "with_sources",
      slideCount: 6,
      idempotencyKey: "new-project-request-1",
    })).resolves.toEqual({ id: "project-existing" });

    expect(tx.project.create).not.toHaveBeenCalled();
    expect(usage.assertSlideCount).not.toHaveBeenCalled();
    expect(service.getAccessible).toHaveBeenCalledWith("user-1", "project-existing");
  });

  it("recovers the project created by a concurrent request after P2002", async () => {
    const { service, prisma, tx } = createHarness();
    const duplicate = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "test",
    });
    prisma.project.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "project-concurrent" });
    tx.project.create.mockRejectedValueOnce(duplicate);
    vi.spyOn(service, "getAccessible").mockResolvedValue({ id: "project-concurrent" } as never);

    await expect(service.create("user-1", {
      title: "AI in education",
      prompt: "Create a concise presentation about AI in education.",
      scenario: "general",
      level: "general",
      mode: "with_sources",
      slideCount: 6,
      idempotencyKey: "new-project-request-2",
    })).resolves.toEqual({ id: "project-concurrent" });

    expect(service.getAccessible).toHaveBeenCalledWith("user-1", "project-concurrent");
  });

  it("keeps different idempotency keys independent", async () => {
    const { service, prisma, tx } = createHarness();
    prisma.project.findFirst.mockResolvedValue(null);
    tx.project.create
      .mockResolvedValueOnce(project({ id: "project-a" }))
      .mockResolvedValueOnce(project({ id: "project-b" }));

    await service.create("user-1", {
      title: "AI in education",
      prompt: "Create a concise presentation about AI in education.",
      scenario: "general",
      level: "general",
      mode: "with_sources",
      slideCount: 6,
      idempotencyKey: "new-project-request-a",
    });
    await service.create("user-1", {
      title: "Climate in education",
      prompt: "Create a concise presentation about climate in education.",
      scenario: "general",
      level: "general",
      mode: "with_sources",
      slideCount: 6,
      idempotencyKey: "new-project-request-b",
    });

    expect(tx.project.create).toHaveBeenCalledTimes(2);
    expect(tx.project.create.mock.calls.map(([call]) => call.data.creationRequestKey)).toEqual([
      "new-project-request-a",
      "new-project-request-b",
    ]);
  });
});

describe("ProjectsService generation", () => {
  it("queues presentation generation without charging creation usage again", async () => {
    const { prisma, queue, service, usage, tx } = createHarness();
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
    expect(usage.reserveGenerationSlot).toHaveBeenCalledWith(tx, "user-1", "job-1", 6);
  });

  it("queues narration with one final BullMQ attempt", async () => {
    const { prisma, queue, service } = createHarness();
    prisma.project.findUnique.mockResolvedValue(project());
    prisma.generationJob.findFirst.mockResolvedValueOnce(null);
    prisma.generationJob.create.mockResolvedValueOnce({ id: "narration-job-1" });

    await service.enqueueNarration("user-1", "project-1");

    expect(queue.add).toHaveBeenCalledWith(
      "generate-narration",
      expect.objectContaining({ projectId: "project-1", userId: "user-1" }),
      expect.objectContaining({ attempts: 1 }),
    );
    expect(queue.add.mock.calls[0][2]).not.toHaveProperty("backoff");
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

  it("does not queue an invalid ten-slide editable draft and keeps the response neutral", async () => {
    const { prisma, queue, service } = createHarness();
    prisma.project.findUnique.mockResolvedValue(project({
      slideCount: 10,
      level: "university_student",
      mode: "with_sources",
      speechDraft: acceptedTenSlideSpeech(116),
    }));

    await expect(service.enqueueGeneration("user-1", "project-1")).rejects.toThrow(/Проверьте и сохраните текст выступления/u);
    expect(queue.add).not.toHaveBeenCalled();
    expect(prisma.generationJob.create).not.toHaveBeenCalled();
  });

  it("queues a manually corrected ten-slide draft without a narration call", async () => {
    const { prisma, queue, service } = createHarness();
    prisma.project.findUnique.mockResolvedValue(project({
      slideCount: 10,
      level: "university_student",
      mode: "with_sources",
      speechDraft: acceptedTenSlideSpeech(70),
    }));
    prisma.generationJob.findFirst.mockResolvedValueOnce(null);
    prisma.generationJob.create.mockResolvedValueOnce({ id: "job-10" });

    const result = await service.enqueueGeneration("user-1", "project-1");

    expect(result.status).toBe("queued");
    expect(queue.add).toHaveBeenCalledWith(
      "generate-presentation",
      expect.objectContaining({ projectId: "project-1" }),
      expect.any(Object),
    );
  });

  it("queues a failed presentation as a new AI retry without rerunning narration", async () => {
    const { prisma, queue, service, tx } = createHarness();
    const originalProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "aitunnel";
    prisma.project.findUnique.mockResolvedValue(project({
      status: "failed",
      jobs: [{ kind: "presentation", status: "failed", error: "provider presentation failure" }],
    }));
    tx.generationJob.create.mockResolvedValueOnce({ id: "presentation-retry" });
    tx.costEnvelope.create.mockResolvedValueOnce({ id: "retry-envelope" });

    try {
      await service.enqueueGeneration("user-1", "project-1");
    } finally {
      if (originalProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = originalProvider;
    }

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      "generate-presentation",
      expect.objectContaining({ generationJobId: "presentation-retry", costEnvelopeId: "retry-envelope", presentationRetry: true }),
      expect.any(Object),
    );
    expect(queue.add.mock.calls[0][0]).not.toBe("generate-narration");
  });

  it("reuses the active job from a concurrent launch without reserving another quota slot", async () => {
    const { service, tx, usage } = createHarness();
    tx.generationJob.findFirst.mockResolvedValueOnce({ id: "active-job", queueJobId: "bull-1" });

    await expect((service as any).createAitunnelEnvelope("project-1", "presentation", "user-1"))
      .resolves.toMatchObject({ existing: true, job: { id: "active-job" } });

    expect(usage.reserveGenerationSlot).not.toHaveBeenCalled();
    expect(tx.generationJob.create).not.toHaveBeenCalled();
  });

  it("returns a quota slot when BullMQ rejects the launch before accepting it", async () => {
    const { prisma, queue, service, usage } = createHarness();
    prisma.project.findUnique.mockResolvedValue(project());
    queue.add.mockRejectedValueOnce(new Error("Redis unavailable"));

    await expect(service.enqueueGeneration("user-1", "project-1")).rejects.toThrow("Redis unavailable");

    expect(usage.releaseGenerationSlot).toHaveBeenCalledWith("job-1");
  });

  it("creates a fresh presentation envelope while preserving the failed attempt source snapshot", async () => {
    const { service, tx } = createHarness();
    const originalProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "aitunnel";
    tx.generationJob.create.mockResolvedValueOnce({ id: "presentation-retry-job" });
    tx.costEnvelope.findMany.mockResolvedValueOnce([{
      id: "attempt-group-1",
      policyVersion: COST_ENVELOPE_POLICY_VERSION,
      sourceSnapshot: { version: 1, sources: [] },
      status: "exhausted",
      presentationJobId: "failed-presentation-job",
    }]);

    try {
      await expect((service as any).createAitunnelEnvelope("project-1", "presentation"))
        .resolves.toMatchObject({ id: "envelope-1", job: { id: "presentation-retry-job" } });
    } finally {
      if (originalProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = originalProvider;
    }

    expect(tx.costEnvelope.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        projectId: "project-1",
        presentationJobId: "presentation-retry-job",
        sourceSnapshot: { version: 1, sources: [] },
      }),
    }));
    expect(tx.costEnvelope.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        projectId: "project-1",
        OR: [
          { narrationJob: { is: { status: "completed" } } },
          { presentationJob: { is: { status: "failed" } } },
        ],
      },
    }));
    expect(tx.costEnvelope.update).not.toHaveBeenCalled();
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

  it("routes a pre-narration source failure without provider detail or a quality-exhaustion claim", async () => {
    const { service } = createHarness();
    vi.spyOn(service as any, "getProjectDetail").mockResolvedValue(project({
      status: "failed",
      error: "Tavily returned 2 results after private query",
      speechDraft: null,
      jobs: [{ kind: "narration", status: "failed", error: "source_preparation_failed" }],
    }) as never);

    const result = await service.getAccessible("user-1", "project-1");

    expect(result.narrationState).toBe("source_preparation_failed");
    expect(result.error).toBe("Не удалось подготовить текст выступления. Проект сохранён — запустите подготовку ещё раз, когда будете готовы.");
    expect(result.error).not.toMatch(/tavily|provider|quality|проверку качества|попыток/i);
    expect(result.jobs[0]?.error).toBeNull();
  });

  it("uses the neutral narration fallback for malformed terminal data without exposing the raw error or a numeric deficit", async () => {
    const { service } = createHarness();
    vi.spyOn(service as any, "getProjectDetail").mockResolvedValue(project({
      status: "failed",
      error: "provider malformed response: missing 136 words",
      speechDraft: null,
      jobs: [{ kind: "narration", status: "failed", error: "provider malformed response: missing 136 words" }],
    }) as never);

    const result = await service.getAccessible("user-1", "project-1");

    expect(result.narrationState).toBe("narration_failed");
    expect(result.error).toBe("Не удалось завершить подготовку текста выступления. Проект сохранён — запустите подготовку ещё раз, когда будете готовы.");
    expect(result.error).not.toMatch(/provider|136|quality|проверку качества/i);
  });

  it("marks a saved editable draft without turning it into accepted speech or a public error", async () => {
    const { service } = createHarness();
    vi.spyOn(service as any, "getProjectDetail").mockResolvedValue(project({
      status: "script_ready",
      error: null,
      jobs: [{ kind: "narration", status: "completed", error: "editable_draft" }],
    }) as never);

    const result = await service.getAccessible("user-1", "project-1");

    expect(result.narrationState).toBe("editable_draft");
    expect(result.error).toBeNull();
    expect(result.jobs[0]?.error).toBeNull();
  });

  it("preserves the accepted-speech flow without exposing a terminal job marker as an error", async () => {
    const { service } = createHarness();
    vi.spyOn(service as any, "getProjectDetail").mockResolvedValue(project({
      status: "script_ready",
      error: null,
      jobs: [{ kind: "narration", status: "completed", error: "accepted_speech" }],
    }) as never);

    const result = await service.getAccessible("user-1", "project-1");

    expect(result.narrationState).toBe("accepted_speech");
    expect(result.error).toBeNull();
    expect(result.jobs[0]?.error).toBeNull();
  });

  it("returns separate narration and presentation failure states", async () => {
    const { service } = createHarness();
    vi.spyOn(service as any, "getProjectDetail").mockResolvedValue(project({
      status: "failed",
      error: "Production quality gate rejected generated presentation",
      jobs: [
        { kind: "presentation", status: "failed", error: "Production quality gate rejected generated presentation" },
        { kind: "narration", status: "completed", error: "accepted_speech" },
      ],
    }) as never);

    const result = await service.getAccessible("user-1", "project-1");

    expect(result.narrationState).toBe("accepted_speech");
    expect(result.generationErrorCategory).toBe("quality");
    expect(result.latestNarrationJob).toMatchObject({ kind: "narration", error: null });
    expect(result.latestPresentationJob).toMatchObject({ kind: "presentation", errorCategory: "quality" });
    expect(result.error).toContain("не прошла финальную проверку качества");
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
