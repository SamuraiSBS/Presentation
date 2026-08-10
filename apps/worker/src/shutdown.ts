import type { logger } from "./observability.js";

export type WorkerLike = {
  pause(doNotWaitActive?: boolean): Promise<void>;
  close(force?: boolean): Promise<void>;
};

export type QueueLike = {
  close(): Promise<void>;
  client: Promise<{ del(key: string): Promise<unknown> }>;
};

type ShutdownLogger = Pick<typeof logger, "info" | "warn" | "error">;

export type WorkerShutdownDependencies = {
  workers: WorkerLike[];
  maintenanceQueue: QueueLike;
  heartbeatTimer: NodeJS.Timeout;
  heartbeatKey: string;
  timeoutMs: number;
  disconnectPrisma: () => Promise<void>;
  shutdownObservability: () => Promise<void>;
  logger: ShutdownLogger;
};

const DEFAULT_WORKER_SHUTDOWN_TIMEOUT_MS = 14 * 60_000;
const MAX_WORKER_SHUTDOWN_TIMEOUT_MS = 14 * 60_000;

export function workerShutdownTimeoutMs(value = process.env.WORKER_SHUTDOWN_TIMEOUT_MS) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1_000 && parsed <= MAX_WORKER_SHUTDOWN_TIMEOUT_MS
    ? parsed
    : DEFAULT_WORKER_SHUTDOWN_TIMEOUT_MS;
}

export function createWorkerShutdown(dependencies: WorkerShutdownDependencies) {
  let shutdown: Promise<void> | undefined;

  return (signal: NodeJS.Signals) => {
    shutdown ??= stopWorker(signal, dependencies);
    return shutdown;
  };
}

async function stopWorker(signal: NodeJS.Signals, dependencies: WorkerShutdownDependencies) {
  const { workers, maintenanceQueue, heartbeatTimer, heartbeatKey, timeoutMs, disconnectPrisma, shutdownObservability, logger } = dependencies;
  clearInterval(heartbeatTimer);
  logger.info({ signal, timeoutMs }, "worker graceful shutdown started");

  const pauseResults = await Promise.allSettled(workers.map((worker) => worker.pause(true)));
  logRejectedResults(logger, pauseResults, "worker could not pause during shutdown");

  const closeResults = await settleBefore(workers.map((worker) => worker.close()), timeoutMs);
  if (closeResults === undefined) {
    logger.warn({ signal, timeoutMs }, "worker shutdown grace period elapsed; forcing remaining jobs to be retried");
    const forcedResults = await Promise.allSettled(workers.map((worker) => worker.close(true)));
    logRejectedResults(logger, forcedResults, "worker could not be force-closed during shutdown");
  } else {
    logRejectedResults(logger, closeResults, "worker could not close cleanly during shutdown");
  }

  const heartbeatResults = await Promise.allSettled([
    removeHeartbeat(maintenanceQueue, heartbeatKey),
  ]);
  logRejectedResults(logger, heartbeatResults, "worker heartbeat could not be removed during shutdown");

  const cleanupResults = await Promise.allSettled([
    maintenanceQueue.close(),
    disconnectPrisma(),
    shutdownObservability(),
  ]);
  logRejectedResults(logger, cleanupResults, "worker shutdown cleanup failed");
  logger.info({ signal }, "worker graceful shutdown completed");
}

async function removeHeartbeat(queue: QueueLike, heartbeatKey: string) {
  const redis = await queue.client;
  await redis.del(heartbeatKey);
}

async function settleBefore<T>(promises: Promise<T>[], timeoutMs: number) {
  let timer: number | NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.allSettled(promises),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function logRejectedResults(logger: ShutdownLogger, results: PromiseSettledResult<unknown>[], message: string) {
  for (const result of results) {
    if (result.status === "rejected") {
      logger.warn({ errorName: result.reason instanceof Error ? result.reason.name : typeof result.reason }, message);
    }
  }
}
