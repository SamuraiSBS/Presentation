# Prompt 16: OpenTelemetry tracing

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Add OpenTelemetry only after basic logging/Sentry are in place, or keep this task scoped to a minimal foundation.

## Goal

Trace the full generation path:

- web request;
- API project/job creation;
- BullMQ worker job;
- Tavily search;
- AI provider call;
- image processing/upload;
- export.

## Current project context

- API is NestJS.
- Worker runs BullMQ jobs.
- Web app is Next.js.
- Docker Compose is used for local services.

## Dependencies

Check current OpenTelemetry JS docs before installing.

Likely packages may include:

```powershell
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
```

Exporter choice depends on the target observability backend. If no backend is configured, implement only local/no-op-safe setup.

## Implementation steps

1. Add tracing bootstrap for API and worker.

2. Keep tracing disabled unless env enables it.

3. Add manual spans around critical stages:
   - `generation.research`;
   - `generation.speech`;
   - `generation.slides`;
   - `generation.visuals`;
   - `generation.export`.

4. Add safe attributes:
   - project ID;
   - job ID;
   - stage;
   - provider;
   - duration;
   - no prompts, no secrets.

5. Propagate trace context from API to worker if feasible. If not, log a follow-up note.

6. Document env vars in `.env.example`.

## Tests

Run:

```powershell
npm run typecheck -w @studydeck/api
npm run typecheck -w @studydeck/worker
npm run test -w @studydeck/worker
```

## Acceptance criteria

- App runs normally with tracing disabled.
- API and worker can create spans when enabled.
- Generation stage traces contain safe metadata.
- No secrets or full prompts are exported.

## Non-goals

- Do not build a custom tracing UI.
- Do not require a paid observability backend for local dev.
- Do not block generation if tracing fails.

