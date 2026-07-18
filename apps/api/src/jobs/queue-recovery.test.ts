import { describe, expect, it, vi } from "vitest";
import { enqueueOrRetryJob, needsQueueRecovery } from "./queue-recovery.js";

describe("enqueueOrRetryJob", () => {
  it("retries a retained failed BullMQ job instead of submitting a duplicate", async () => {
    const job = {
      getState: vi.fn().mockResolvedValue("failed"),
      retry: vi.fn().mockResolvedValue(undefined),
    };
    const queue = { getJob: vi.fn().mockResolvedValue(job), add: vi.fn() };

    await expect(enqueueOrRetryJob(queue as never, "analysis", { projectId: "project-1" }, { jobId: "job-1" }))
      .resolves.toBe(job);

    expect(job.retry).toHaveBeenCalledOnce();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("adds a deterministic job when BullMQ has no prior record", async () => {
    const queuedJob = { id: "job-1" };
    const queue = { getJob: vi.fn().mockResolvedValue(null), add: vi.fn().mockResolvedValue(queuedJob) };

    await expect(enqueueOrRetryJob(queue as never, "analysis", { projectId: "project-1" }, { jobId: "job-1" }))
      .resolves.toBe(queuedJob);

    expect(queue.add).toHaveBeenCalledWith("analysis", { projectId: "project-1" }, { jobId: "job-1" });
  });

  it("accepts a concurrent retry when another caller already moved the job to waiting", async () => {
    const retryError = new Error("Job cannot be retried from failed state");
    const job = {
      getState: vi.fn().mockResolvedValueOnce("failed").mockResolvedValueOnce("waiting"),
      retry: vi.fn().mockRejectedValue(retryError),
    };
    const queue = { getJob: vi.fn().mockResolvedValue(job), add: vi.fn() };

    await expect(enqueueOrRetryJob(queue as never, "analysis", { projectId: "project-1" }, { jobId: "job-1" }))
      .resolves.toBe(job);

    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe("needsQueueRecovery", () => {
  it("marks null, missing, and failed BullMQ references for recovery", async () => {
    const queue = { getJob: vi.fn() };

    await expect(needsQueueRecovery(queue as never, null)).resolves.toBe(true);

    queue.getJob.mockResolvedValueOnce(null);
    await expect(needsQueueRecovery(queue as never, "missing-job")).resolves.toBe(true);

    queue.getJob.mockResolvedValueOnce({ getState: vi.fn().mockResolvedValue("failed") });
    await expect(needsQueueRecovery(queue as never, "failed-job")).resolves.toBe(true);
  });

  it("keeps a live queued BullMQ reference", async () => {
    const queue = { getJob: vi.fn().mockResolvedValue({ getState: vi.fn().mockResolvedValue("waiting") }) };

    await expect(needsQueueRecovery(queue as never, "waiting-job")).resolves.toBe(false);
  });
});
