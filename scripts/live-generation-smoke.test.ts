import { describe, expect, it, vi } from "vitest";
import {
  NARRATION_SMOKE_FLOW,
  UTF8_JSON_CONTENT_TYPE,
  assertNarrationSmokeDryRun,
  buildNarrationSmokeDryRun,
  executeNarrationSmokeCli,
  runNarrationSmoke,
} from "./live-generation-smoke.js";

const russianInput = {
  title: "Французская революция: причины, основные этапы и последствия",
  prompt: "Подготовь содержательную русскоязычную университетскую речь по этой теме.",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("live narration smoke dry run", () => {
  it("round-trips a Russian title and prompt as explicit UTF-8 without a replacement question mark", () => {
    const dryRun = assertNarrationSmokeDryRun(russianInput);

    expect(dryRun).toMatchObject({
      bodyContentType: UTF8_JSON_CONTENT_TYPE,
      hasCyrillic: true,
      hasReplacementQuestionMark: false,
      roundTripMatches: true,
      createCount: 1,
      narrationEnqueueCount: 1,
    });
  });

  it("plans exactly one create and one narration enqueue without acceptance, presentation, or export", () => {
    const dryRun = buildNarrationSmokeDryRun(russianInput);

    expect(dryRun.flow).toEqual(NARRATION_SMOKE_FLOW);
    expect(dryRun.flow).not.toContain("accept");
    expect(dryRun.flow).not.toContain("export");
    expect(dryRun.createCount).toBe(1);
    expect(dryRun.narrationEnqueueCount).toBe(1);
  });
});

describe("live narration smoke execution", () => {
  it("sends UTF-8 bytes, creates one project and one narration job, then stops at script_ready", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ id: "project-1", status: "draft" }))
      .mockResolvedValueOnce(response({ projectId: "project-1", jobId: "narration-1", queueJobId: "queue-1", status: "script_queued" }))
      .mockResolvedValueOnce(response({
        status: "script_ready",
        jobs: [{ id: "narration-1", queueJobId: "queue-1", status: "completed", progressStage: "script_ready" }],
      }));

    const result = await runNarrationSmoke({ ...russianInput, userId: "user-1", internalApiToken: "test-token" }, {
      fetchImpl,
      sleep: async () => undefined,
    });

    expect(result.outcome).toBe("script_ready");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [createUrl, createOptions] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(createUrl).toMatch(/\/projects$/);
    expect(createOptions.method).toBe("POST");
    expect(createOptions.headers).toMatchObject({ "content-type": UTF8_JSON_CONTENT_TYPE });
    expect(Buffer.from(createOptions.body as Uint8Array).toString("utf8")).toContain(russianInput.title);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/\/generate$/),
      expect.stringMatching(/\/exports$/),
    ]));
    expect(fetchImpl.mock.calls.slice(2).map(([url]) => String(url))).not.toContain(expect.stringMatching(/\/narration$/));
  });

  it("does not retry or create another project when the narration enqueue returns an HTTP error", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ id: "project-1", status: "draft" }))
      .mockResolvedValueOnce(response({}, 500));

    await expect(runNarrationSmoke({ ...russianInput, userId: "user-1", internalApiToken: "test-token" }, { fetchImpl })).rejects.toMatchObject({
      stage: "narration_enqueue",
      status: "http_500",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/projects"))).toHaveLength(1);
  });

  it("keeps the created project ID in the safe CLI report after a narration enqueue transport error", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ id: "project-1", status: "draft" }))
      .mockRejectedValueOnce(new Error("network unavailable"));
    const reporter = vi.fn();

    const exitCode = await executeNarrationSmokeCli({
      args: ["--title", russianInput.title, "--prompt", russianInput.prompt],
      environment: { RUN_LIVE_GENERATION_SMOKE: "true", TEMP_USER_ID: "user-1", INTERNAL_API_TOKEN: "test-token" },
      reporter,
      runSmoke: (input) => runNarrationSmoke(input, { fetchImpl }),
    });

    expect(exitCode).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(reporter).toHaveBeenLastCalledWith(expect.objectContaining({
      projectId: "project-1",
      generationJobId: null,
      queueJobId: null,
      projectStatus: "draft",
      stage: "narration_enqueue",
    }));
  });

  it("keeps one project and one narration job snapshot when polling times out", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ id: "project-1", status: "draft" }))
      .mockResolvedValueOnce(response({ projectId: "project-1", jobId: "narration-1", queueJobId: "queue-1", status: "script_queued" }));

    await expect(runNarrationSmoke({
      ...russianInput,
      userId: "user-1",
      internalApiToken: "test-token",
      timeoutMs: -1,
    }, { fetchImpl })).rejects.toMatchObject({
      stage: "narration_poll",
      status: "timeout",
      snapshot: {
        projectId: "project-1",
        generationJobId: "narration-1",
        queueJobId: "queue-1",
        projectStatus: "script_queued",
        jobStatus: "queued",
        stage: "narration_enqueue",
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/projects"))).toHaveLength(1);
    expect(fetchImpl.mock.calls.filter(([url]) => /\/narration$/.test(String(url)))).toHaveLength(1);
  });

  it("stops on terminal narration failure without acceptance, presentation, export, or a second job", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ id: "project-1", status: "draft" }))
      .mockResolvedValueOnce(response({ projectId: "project-1", jobId: "narration-1", queueJobId: "queue-1", status: "script_queued" }))
      .mockResolvedValueOnce(response({
        status: "failed",
        jobs: [{ id: "narration-1", queueJobId: "queue-1", status: "failed", progressStage: "source_preparation" }],
      }));

    const result = await runNarrationSmoke({ ...russianInput, userId: "user-1", internalApiToken: "test-token" }, {
      fetchImpl,
      sleep: async () => undefined,
    });

    expect(result.outcome).toBe("failed");
    expect(result.snapshot).toMatchObject({
      projectId: "project-1",
      generationJobId: "narration-1",
      queueJobId: "queue-1",
      projectStatus: "failed",
      jobStatus: "failed",
      stage: "source_preparation",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.filter(([url]) => /\/narration$/.test(String(url)))).toHaveLength(1);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/\/generate$/),
      expect.stringMatching(/\/exports$/),
    ]));
  });

  it("reports the actual terminal failed snapshot and maps it to a nonzero CLI exit code", async () => {
    const terminalSnapshot = {
      projectId: "project-1",
      generationJobId: "narration-1",
      queueJobId: "queue-1",
      projectStatus: "failed",
      jobStatus: "failed",
      stage: "source_preparation",
    };
    const reporter = vi.fn();

    const exitCode = await executeNarrationSmokeCli({
      args: ["--title", russianInput.title, "--prompt", russianInput.prompt],
      environment: { RUN_LIVE_GENERATION_SMOKE: "true", TEMP_USER_ID: "user-1", INTERNAL_API_TOKEN: "test-token" },
      reporter,
      runSmoke: vi.fn().mockResolvedValue({ outcome: "failed", snapshot: terminalSnapshot }),
    });

    expect(exitCode).toBe(1);
    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter).toHaveBeenCalledWith(terminalSnapshot);
  });

  it("maps script_ready to a successful CLI exit code", async () => {
    const reporter = vi.fn();
    const terminalSnapshot = {
      projectId: "project-1",
      generationJobId: "narration-1",
      queueJobId: "queue-1",
      projectStatus: "script_ready",
      jobStatus: "completed",
      stage: "script_ready",
    };

    const exitCode = await executeNarrationSmokeCli({
      args: ["--title", russianInput.title, "--prompt", russianInput.prompt],
      environment: { RUN_LIVE_GENERATION_SMOKE: "true", TEMP_USER_ID: "user-1", INTERNAL_API_TOKEN: "test-token" },
      reporter,
      runSmoke: vi.fn().mockResolvedValue({ outcome: "script_ready", snapshot: terminalSnapshot }),
    });

    expect(exitCode).toBe(0);
    expect(reporter).toHaveBeenCalledWith(terminalSnapshot);
  });
});
