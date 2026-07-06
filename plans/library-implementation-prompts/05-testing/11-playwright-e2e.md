# Prompt 11: Playwright end-to-end tests

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Add Playwright tests for the most important StudyDeck user flows.

## Goal

Verify the product path that matters most:

1. enter a short Russian topic;
2. generate or review speech;
3. accept or edit speech;
4. get generated slides;
5. edit slide text;
6. request export or reach export-ready state.

## Current project context

- Web app runs with `npm run dev:web:fast` at `http://localhost:3020`.
- API/infra can run through Docker Compose.
- Demo preview behavior may affect project reads.
- Full real AI generation may be too slow or non-deterministic for CI.

## Dependencies

Check current package state before installing.

Likely package:

```powershell
npm install -D @playwright/test
```

Then install browsers only if needed for the local environment.

## Implementation steps

1. Add Playwright config at the repo root or under `apps/web`, following existing workspace conventions.

2. Add test scripts:
   - root `test:e2e`;
   - or web workspace script.

3. Start with deterministic tests:
   - homepage/dashboard loads;
   - new project form accepts Russian topic;
   - editor/demo project renders slides;
   - text editing UI works if Tiptap has been added.

4. For generation flow:
   - use demo/fake API when possible;
   - or mark real AI generation test as local/manual.

5. Add selectors that are stable:
   - accessible names;
   - data attributes only where necessary.

6. Capture screenshots only for failed tests or explicit visual checks.

## Tests

Run:

```powershell
npm run typecheck -w @studydeck/web
npm run test:e2e
```

If the dev server is needed:

```powershell
npm run dev:web:fast
```

Verify at `http://localhost:3020`.

## Acceptance criteria

- E2E tests cover the core user path without requiring real AI by default.
- Tests are stable and not dependent on network search.
- Failures point to real product regressions.

## Non-goals

- Do not make all tests depend on OpenAI/Yandex/Tavily.
- Do not add brittle screenshot-only tests for the entire UI.
- Do not block local development with long real-generation tests.

