# Prompt 12: Vitest targeted tests

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Expand Vitest coverage around generation quality, schema parsing, and export-safe transformations. `vitest` is already installed.

## Goal

Improve confidence in the generation pipeline without relying on live AI calls.

Focus on:

- prompt helpers;
- fallback text generation;
- source preparation;
- Tavily query building;
- quality scoring;
- canvas generation;
- export data conversion;
- shared Zod schemas.

## Current project context

- Worker tests run with `npm run test -w @studydeck/worker`.
- Shared tests run with `npm run test -w @studydeck/shared`.
- Web tests run with `npm run test -w @studydeck/web`.

## Implementation steps

1. Inspect existing tests and identify fragile generation areas.

2. Add tests for topic-only generation helpers:
   - clean topic extraction;
   - no prompt echo;
   - no template visible text;
   - Russian university tone.

3. Add tests for source/search helpers:
   - short Tavily queries;
   - source fallback from accepted speech;
   - no failure when sources are empty.

4. Add tests for quality checks:
   - penalize dense slides;
   - penalize weak speech;
   - penalize repetitive layout rhythm;
   - preserve good decks.

5. Add tests for export-safe canvas:
   - valid dimensions;
   - no missing text;
   - image fallback behavior.

6. Mock AI providers and network calls.

## Commands

Run targeted commands first:

```powershell
npm run test -w @studydeck/shared
npm run test -w @studydeck/worker
npm run test -w @studydeck/web
```

Then:

```powershell
npm run check
```

## Acceptance criteria

- Important generation helpers are covered by deterministic tests.
- Tests do not need OpenAI/Yandex/Tavily.
- Regressions in visible slide text, sources, and export readiness are caught.

## Non-goals

- Do not snapshot huge generated presentations.
- Do not test provider APIs live.
- Do not rewrite production code just to fit tests.

