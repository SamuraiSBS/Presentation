import "dotenv/config";
import { Worker } from "bullmq";
import { createRedisConnection } from "./queue.js";
import { handleExportJob } from "./tasks/export.js";
import { handleGenerationJob } from "./tasks/generation.js";

const connection = createRedisConnection();

new Worker("generation", handleGenerationJob, { connection, concurrency: 2 });
new Worker("exports", handleExportJob, { connection, concurrency: 2 });

console.log("StudyDeck worker started");
