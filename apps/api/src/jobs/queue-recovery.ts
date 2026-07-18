import type { JobsOptions, Queue } from "bullmq";

/**
 * Reuse a deterministic BullMQ job across API retries.
 *
 * A database write can succeed just before the process loses the response or
 * stops. BullMQ retains failed jobs, so `add()` with the same id would only
 * report a duplicate and would not execute it again. Retrying the retained
 * failed job preserves one-job semantics while making the API recovery path
 * actually runnable.
 */
export async function enqueueOrRetryJob(
  queue: Pick<Queue, "add" | "getJob">,
  name: string,
  data: unknown,
  options: JobsOptions,
) {
  if (typeof options.jobId === "string") {
    const existing = await queue.getJob(options.jobId);
    if (existing) {
      if (await existing.getState() === "failed") {
        try {
          await existing.retry();
        } catch (error) {
          // Another retry may have already moved this exact job to waiting.
          // BullMQ rejects the second move, but the job is recoverable again.
          if (await existing.getState() === "failed") throw error;
        }
      }
      return existing;
    }
  }
  return queue.add(name, data, options);
}

/** Returns true when a persisted queue reference is missing or has exhausted retries. */
export async function needsQueueRecovery(
  queue: Pick<Queue, "getJob">,
  queueJobId: string | null | undefined,
) {
  if (!queueJobId) return true;
  const existing = await queue.getJob(queueJobId);
  if (!existing) return true;
  return (await existing.getState()) === "failed";
}
