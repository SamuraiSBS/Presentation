# Prompt 04: BullMQ generation jobs

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Strengthen BullMQ job orchestration for longer, higher-quality presentation generation. `bullmq` is already installed and the worker architecture exists.

## Goal

Make long generation feel reliable by improving:

- staged job progress;
- retry behavior;
- structured job logs;
- recoverability when AI/search/image/export steps fail;
- clear status for the web app.

## Current project context

- Worker jobs live under `apps/worker/src`.
- API job/project endpoints live under `apps/api/src`.
- Web job status is consumed by `apps/web`.
- Redis is provided by `docker-compose.yml`.
- Generation can involve sources, AI calls, image search, MinIO, and export.

## Implementation steps

1. Inspect current queue and job definitions:
   - generation queue;
   - export queue;
   - extraction queue;
   - job status endpoint.

2. Define consistent progress stages:
   - `queued`;
   - `researching`;
   - `drafting_speech`;
   - `building_slides`;
   - `selecting_visuals`;
   - `polishing`;
   - `saving`;
   - `completed`;
   - `failed`.

3. Store job progress with human-readable Russian labels for the UI, but keep stable enum values in code.

4. Improve retry policy:
   - transient network/API failures can retry;
   - schema validation failures should trigger repair first;
   - fatal configuration errors should fail fast.

5. Add structured logs per stage:
   - project ID;
   - job ID;
   - stage;
   - duration;
   - safe error summary.

6. Keep idempotency in mind:
   - avoid duplicating sources or images on retry;
   - do not overwrite user-edited accepted narration.

## Tests

Add unit tests for progress-stage mapping and retry classification. If current queue tests are limited, keep tests small and deterministic.

Run:

```powershell
npm run test -w @studydeck/worker
npm run typecheck -w @studydeck/worker
npm run typecheck -w @studydeck/api
```

## Runtime verification

If production-like verification is needed:

```powershell
docker compose build worker api
docker compose up -d worker api
docker compose ps
curl.exe -s http://localhost:4000/v1/health
```

## Acceptance criteria

- Generation jobs expose meaningful progress.
- Transient failures are retried safely.
- Fatal failures are visible and actionable.
- Existing generation/export behavior still works.

## Non-goals

- Do not replace BullMQ.
- Do not introduce a separate workflow engine.
- Do not change billing or quotas in this task.

