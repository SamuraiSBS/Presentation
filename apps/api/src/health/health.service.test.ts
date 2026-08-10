import { describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import type { PrismaService } from "../prisma/prisma.service.js";
import type { HealthStorageService } from "./health-storage.service.js";
import { HealthService } from "./health.service.js";

const runtimeValues = {
  DATABASE_URL: "postgresql://studydeck:secret@postgres:5432/studydeck",
  REDIS_URL: "redis://redis:6379",
  S3_ENDPOINT: "http://minio:9000",
  S3_BUCKET: "studydeck",
  S3_ACCESS_KEY_ID: "studydeck-access",
  S3_SECRET_ACCESS_KEY: "studydeck-secret",
};

function queue(heartbeat = String(Date.now())) {
  return {
    client: Promise.resolve({ get: vi.fn().mockResolvedValue(heartbeat) }),
    getJobCounts: vi.fn().mockResolvedValue({ waiting: 2, active: 1, delayed: 3 }),
    getWaiting: vi.fn().mockResolvedValue([{ timestamp: Date.now() - 1_000 }]),
  };
}

function subject(options: { heartbeat?: string; storageError?: Error } = {}) {
  const generationQueue = queue(options.heartbeat);
  const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ pending: 0 }]) };
  const config = { get: vi.fn((key: keyof typeof runtimeValues) => runtimeValues[key]) };
  const storage = { check: vi.fn().mockImplementation(async () => {
    if (options.storageError) throw options.storageError;
  }) };
  return new HealthService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    storage as unknown as HealthStorageService,
    generationQueue as unknown as Queue,
    queue() as unknown as Queue,
    queue() as unknown as Queue,
  );
}

describe("HealthService", () => {
  it("reports readiness only after every required dependency is available", async () => {
    const readiness = await subject().ready();

    expect(readiness).toMatchObject({
      ok: true,
      status: "ready",
      checks: {
        configuration: { ok: true },
        database: { ok: true },
        migrations: { ok: true },
        storage: { ok: true },
        queues: { ok: true },
        worker: { ok: true },
      },
    });
    expect(readiness.checks.queues).toMatchObject({
      lag: { generation: { waiting: 2, active: 1, delayed: 3, oldestWaitingMs: expect.any(Number) } },
    });
  });

  it("does not report ready when storage is unavailable", async () => {
    const readiness = await subject({ storageError: new Error("bucket unavailable") }).ready();

    expect(readiness).toMatchObject({
      ok: false,
      status: "not_ready",
      checks: { storage: { ok: false, error: "storage is unavailable" } },
    });
  });

  it("reports a stale worker heartbeat as unavailable", async () => {
    const workers = await subject({ heartbeat: String(Date.now() - 46_000) }).workers();

    expect(workers).toMatchObject({
      ok: false,
      checks: { worker: { ok: false, error: "worker heartbeat is stale" } },
    });
  });
});
