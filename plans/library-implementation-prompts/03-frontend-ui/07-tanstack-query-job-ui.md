# Prompt 07: TanStack Query for job status UI

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Add TanStack Query to improve web-side data loading and long generation status updates.

## Goal

Make the frontend more reliable while generation takes longer:

- project loading;
- generation job polling;
- export job polling;
- dashboard project list refresh;
- mutation states for create, save, accept speech, and export.

## Current project context

- Web app is Next.js App Router in `apps/web`.
- API calls go through Next route handlers and `apps/web/src/lib/internal-api.ts`.
- Generation status comes from the API/worker job system.
- Dev preview should use `npm run dev:web:fast` at `http://localhost:3020`.

## Dependencies

Check current docs before installing.

Likely package:

```powershell
npm install @tanstack/react-query
```

## Implementation steps

1. Add a Query Client provider in the web app root layout or provider tree.

2. Create query hooks:
   - `useProjects`;
   - `useProject`;
   - `useGenerationJob`;
   - `useExportJob`.

3. Create mutation hooks:
   - create project;
   - accept/edit speech;
   - start final generation;
   - save presentation edits;
   - request export.

4. Use polling only while jobs are active:
   - stop polling on completed/failed;
   - use reasonable intervals;
   - avoid duplicate requests.

5. Preserve demo-preview behavior unless explicitly disabled by env.

6. Replace local ad hoc loading state only in the flows touched by this task.

## UX rules

- Show generation progress stages clearly.
- Keep long-running generation calm and confidence-building.
- Do not expose raw job JSON to the user.
- Avoid in-app instructional copy.

## Tests

Run:

```powershell
npm run typecheck -w @studydeck/web
npm run test -w @studydeck/web
```

For local verification:

```powershell
npm run dev:web:fast
```

Verify at `http://localhost:3020`.

## Acceptance criteria

- Job polling is centralized and stops correctly.
- Project/editor pages no longer duplicate fragile fetch state.
- Create/generate/export flows still work.
- UI updates feel stable during long generation.

## Non-goals

- Do not rewrite every fetch in the app at once.
- Do not add global client-side caching for sensitive auth data unnecessarily.
- Do not change API contracts unless needed.

