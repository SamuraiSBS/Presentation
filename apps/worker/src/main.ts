import "dotenv/config";
import { Queue, Worker } from "bullmq";
import { captureExportError, captureGenerationError, initSentry, initTracing, logger, shutdownObservability } from "./observability.js";
import { disconnectPrisma } from "./prisma.js";
import { createRedisConnection } from "./queue.js";
import { createWorkerShutdown, workerShutdownTimeoutMs } from "./shutdown.js";
import { handleExportJob } from "./tasks/export.js";
import { handleGenerationJob } from "./tasks/generation.js";
import { handleAdminMaintenance } from "./tasks/admin-maintenance.js";
import { assertProductionConfiguration, workerHeartbeatIntervalMs, workerHeartbeatKey, workerHeartbeatTtlMs } from "@studydeck/shared";

assertProductionConfiguration();
initTracing();
initSentry();

const connection = createRedisConnection();

// Generation can legitimately wait several minutes for provider and image-search calls.
// Keep its BullMQ lease beyond those calls so it is not incorrectly retried as stalled.
const generationWorker = new Worker("generation", handleGenerationJob, {
  connection,
  concurrency: 2,
  lockDuration: 10 * 60_000,
  lockRenewTime: 60_000,
});
const exportWorker = new Worker("exports", handleExportJob, {
  connection,
  concurrency: 2,
  lockDuration: 10 * 60_000,
  lockRenewTime: 60_000,
});
const maintenanceWorker = new Worker("admin-maintenance", handleAdminMaintenance, {
  connection,
  concurrency: 1,
});
const maintenanceQueue = new Queue("admin-maintenance", { connection });
async function reportHeartbeat() {
  const redis = await maintenanceQueue.client;
  await redis.set(workerHeartbeatKey, Date.now().toString(), { PX: workerHeartbeatTtlMs });
}

await reportHeartbeat();
const heartbeatTimer = setInterval(() => {
  void reportHeartbeat().catch((error) => logger.warn({ errorName: error instanceof Error ? error.name : typeof error }, "worker heartbeat could not be recorded"));
}, workerHeartbeatIntervalMs);
heartbeatTimer.unref();

void maintenanceQueue.add("reconcile", {}, {
  jobId: "admin-maintenance-schedule",
  repeat: { pattern: "*/15 * * * *" },
  removeOnComplete: { age: 86_400, count: 10 },
  removeOnFail: { age: 604_800, count: 50 },
}).catch((error) => logger.warn({ errorName: error instanceof Error ? error.name : typeof error }, "admin maintenance schedule could not be registered"));

generationWorker.on("failed", (job, error) => {
  captureGenerationError(error, {
    projectId: job?.data?.projectId,
    jobId: job?.id,
    stage: "job_failed",
    queue: "generation",
  });
});

exportWorker.on("failed", (job, error) => {
  const data = job?.data as { projectId?: string; exportId?: string; type?: string } | undefined;
  captureExportError(error, {
    projectId: data?.projectId,
    jobId: job?.id,
    exportId: data?.exportId,
    exportType: data?.type,
    stage: "job_failed",
    queue: "exports",
  });
});
maintenanceWorker.on("failed", (_job, error) => {
  logger.error({ errorName: error.name }, "admin maintenance job failed");
});

const shutdown = createWorkerShutdown({
  workers: [generationWorker, exportWorker, maintenanceWorker],
  maintenanceQueue,
  heartbeatTimer,
  heartbeatKey: workerHeartbeatKey,
  timeoutMs: workerShutdownTimeoutMs(),
  disconnectPrisma,
  shutdownObservability,
  logger,
});
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

logger.info({ queues: ["generation", "exports", "admin-maintenance"], concurrency: 2 }, "studydeck worker started");
