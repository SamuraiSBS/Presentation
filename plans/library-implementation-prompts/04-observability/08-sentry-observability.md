# Prompt 08: Sentry observability

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Add Sentry for error monitoring across web, API, and worker. Prioritize generation failures and export failures.

## Goal

Make failures visible and actionable:

- frontend runtime errors;
- API route/controller errors;
- worker generation errors;
- AI provider failures;
- Tavily/image/MinIO/export failures.

## Current project context

- Web app: `apps/web`, Next.js App Router.
- API: `apps/api`, NestJS.
- Worker: `apps/worker`, BullMQ.
- Environment variables are managed through `.env` and Docker Compose.

## Dependencies

Check current Sentry docs before installing.

Likely packages:

```powershell
npm install @sentry/nextjs @sentry/node
```

## Implementation steps

1. Add Sentry configuration for Next.js:
   - minimal setup;
   - source maps only if appropriate;
   - DSN from env;
   - disabled if DSN is missing.

2. Add Sentry initialization for API and worker:
   - startup init;
   - capture unhandled exceptions;
   - capture job failures with context.

3. Add safe context fields:
   - project ID;
   - job ID;
   - stage;
   - provider;
   - error class;
   - not full prompts, not API keys, not full generated content.

4. Add helper:

```ts
captureGenerationError(error, {
  projectId,
  jobId,
  stage,
  provider,
});
```

5. Update `.env.example` with:
   - `SENTRY_DSN`;
   - optional environment name.

6. Keep the app fully functional when Sentry is not configured.

## Tests

Run:

```powershell
npm run typecheck -w @studydeck/web
npm run typecheck -w @studydeck/api
npm run typecheck -w @studydeck/worker
npm run test
```

## Acceptance criteria

- Missing Sentry DSN does not crash local development.
- Worker job failures are captured with useful safe context.
- Frontend/API errors can be captured.
- No secrets or full prompts are sent to Sentry.

## Non-goals

- Do not add product analytics in this task.
- Do not block generation because Sentry failed.
- Do not expose Sentry details in the UI.

