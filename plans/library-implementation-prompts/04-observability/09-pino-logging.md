# Prompt 09: Pino structured logging

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Add or standardize Pino structured logging for API and worker runtime diagnostics.

## Goal

Create consistent logs for:

- generation stages;
- AI provider calls;
- Tavily search;
- image download;
- export jobs;
- API request failures.

## Current project context

- API is NestJS in `apps/api`.
- Worker is Node/BullMQ in `apps/worker`.
- Docker logs are used for local and production-like debugging.

## Dependencies

Check current dependency state first.

Likely packages:

```powershell
npm install pino
```

Optional development-only pretty logging can be considered, but avoid adding noise to production logs.

## Implementation steps

1. Create a small logger helper shared by API and worker, or one helper per app if simpler.

2. Use structured fields:
   - `service`;
   - `projectId`;
   - `jobId`;
   - `stage`;
   - `provider`;
   - `durationMs`;
   - `errorName`;
   - `errorMessage`.

3. Replace ad hoc `console.log/error` in touched generation/search/export paths.

4. Redact:
   - API keys;
   - internal tokens;
   - authorization headers;
   - full prompts;
   - full generated content.

5. Keep logs easy to read in Docker.

## Tests

Add tests only if there is logic such as redaction or error formatting.

Run:

```powershell
npm run typecheck -w @studydeck/api
npm run typecheck -w @studydeck/worker
npm run test -w @studydeck/worker
```

## Acceptance criteria

- Worker logs show generation stages and durations.
- Errors are structured and safe.
- Existing local workflows still print useful logs.
- No secrets appear in logs.

## Non-goals

- Do not build a logging dashboard.
- Do not replace Sentry.
- Do not add noisy logs for every small function.

