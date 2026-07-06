# Prompt 03: Tavily research pipeline

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Improve Tavily usage for short Russian topic input without uploaded files. Tavily behavior already exists; this task should make it more deliberate and quality-oriented.

## Goal

Turn short topic input into better factual context before deck generation:

- build concise Russian search queries;
- collect reliable source summaries;
- avoid overlong provider queries;
- pass grounded facts into speech and slide generation;
- choose image search only when a slide actually benefits from a real image.

## Current project context

- Worker generation lives in `apps/worker/src/tasks/presentation.ts`.
- Web search logic likely lives in `apps/worker/src/tasks/web-search.ts`.
- Image search and MinIO download logic live in worker tasks.
- `with_sources` generation can create `WEB` sources through Tavily.
- Topic-only input must work.

## Implementation steps

1. Inspect current Tavily helpers:
   - query builder;
   - search request;
   - result normalization;
   - source creation;
   - image search gating.

2. Add a Russian university-topic query builder:
   - concise query length;
   - no full prompt echo;
   - includes topic, academic angle, and context words only when useful;
   - avoids user instructions that are not search terms.

3. Create a research brief from sources:
   - key facts;
   - concepts and definitions;
   - likely defense angle;
   - warnings about weak or missing sources;
   - source IDs for grounding.

4. Feed this research brief into:
   - narration draft;
   - final slide generation;
   - visual strategy selection.

5. Improve image search gating:
   - use real images only for people, places, objects, historical events, products, maps, and concrete visual evidence;
   - prefer generated diagrams or no image for abstract theory slides;
   - avoid decorative stock-like images.

6. Keep network behavior optional in tests through dependency injection or env gates.

## Tests

Add targeted worker tests for:

- short topic query generation;
- no prompt echo in search queries;
- query length limit;
- research brief source grounding;
- image search gating.

Run:

```powershell
npm run test -w @studydeck/worker -- src/tasks/web-search.test.ts
npm run test -w @studydeck/worker
npm run typecheck -w @studydeck/worker
```

## Acceptance criteria

- A short Russian topic produces useful sources without user-uploaded files.
- Tavily query length stays safe.
- Generated slides reference grounded facts when sources exist.
- Image search runs selectively, not on every slide.

## Non-goals

- Do not require Tavily for demo fallback.
- Do not fail the whole job if search is unavailable.
- Do not add a user-visible source research UI in this task.

