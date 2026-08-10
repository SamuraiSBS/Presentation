import { describe, expect, it, vi } from "vitest";
import { createWorkerShutdown, workerShutdownTimeoutMs, type QueueLike, type WorkerLike } from "./shutdown.js";

function worker() {
  return {
    pause: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } satisfies WorkerLike;
}

function dependencies(workers: WorkerLike[]) {
  const queue = {
    client: Promise.resolve({ del: vi.fn().mockResolvedValue(undefined) }),
    close: vi.fn().mockResolvedValue(undefined),
  } satisfies QueueLike;
  return {
    workers,
    maintenanceQueue: queue,
    heartbeatTimer: setInterval(() => undefined, 60_000),
    heartbeatKey: "worker:heartbeat",
    timeoutMs: 100,
    disconnectPrisma: vi.fn().mockResolvedValue(undefined),
    shutdownObservability: vi.fn().mockResolvedValue(undefined),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as const;
}

describe("worker graceful shutdown", () => {
  it("pauses workers before waiting for active jobs and closes all resources", async () => {
    const first = worker();
    const second = worker();
    const state = dependencies([first, second]);

    await createWorkerShutdown(state)("SIGTERM");

    expect(first.pause).toHaveBeenCalledWith(true);
    expect(second.pause).toHaveBeenCalledWith(true);
    expect(first.close).toHaveBeenCalledWith();
    expect(second.close).toHaveBeenCalledWith();
    await expect(state.maintenanceQueue.client).resolves.toMatchObject({ del: expect.any(Function) });
    const redis = await state.maintenanceQueue.client;
    expect(redis.del).toHaveBeenCalledWith("worker:heartbeat");
    expect(state.maintenanceQueue.close).toHaveBeenCalledOnce();
    expect(state.disconnectPrisma).toHaveBeenCalledOnce();
    expect(state.shutdownObservability).toHaveBeenCalledOnce();
  });

  it("uses one shutdown promise when both termination signals arrive", async () => {
    const state = dependencies([worker()]);
    const shutdown = createWorkerShutdown(state);

    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);

    expect(state.maintenanceQueue.close).toHaveBeenCalledOnce();
  });

  it("force-closes workers that outlive the shutdown deadline", async () => {
    const never = new Promise<void>(() => undefined);
    const slowWorker = {
      pause: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockImplementation((force?: boolean) => force ? Promise.resolve() : never),
    } satisfies WorkerLike;
    const state = { ...dependencies([slowWorker]), timeoutMs: 1 };

    await createWorkerShutdown(state)("SIGTERM");

    expect(slowWorker.close).toHaveBeenNthCalledWith(1);
    expect(slowWorker.close).toHaveBeenNthCalledWith(2, true);
  });

  it("uses a safe default for an invalid shutdown timeout", () => {
    expect(workerShutdownTimeoutMs("invalid")).toBe(14 * 60_000);
    expect(workerShutdownTimeoutMs("900000")).toBe(14 * 60_000);
    expect(workerShutdownTimeoutMs("60000")).toBe(60_000);
  });
});
