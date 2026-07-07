import "dotenv/config";
import { Worker } from "bullmq";
import { captureExportError, captureGenerationError, initSentry, logger } from "./observability.js";
import { createRedisConnection } from "./queue.js";
import { handleExportJob } from "./tasks/export.js";
import { handleGenerationJob } from "./tasks/generation.js";

initSentry();

const connection = createRedisConnection();

const generationWorker = new Worker("generation", handleGenerationJob, { connection, concurrency: 2 });
const exportWorker = new Worker("exports", handleExportJob, { connection, concurrency: 2 });

generationWorker.on("failed", (job, error) => {
  captureGenerationError(error, {
    projectId: job?.data?.projectId,
    jobId: job?.id,
    stage: "job_failed",
    queue: "generation",
  });
});

exportWorker.on("failed", (job, error) => {
  captureExportError(error, {
    projectId: job?.data?.projectId,
    jobId: job?.id,
    exportId: job?.data?.exportId,
    exportType: job?.data?.type,
    stage: "job_failed",
    queue: "exports",
  });
});

logger.info({ queues: ["generation", "exports"], concurrency: 2 }, "studydeck worker started");
