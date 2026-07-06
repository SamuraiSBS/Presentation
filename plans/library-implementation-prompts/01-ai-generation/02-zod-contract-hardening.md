# Prompt 02: Zod contract hardening

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Strengthen Zod contracts for high-quality Russian university presentations. `zod` is already installed and should remain the shared contract foundation.

## Goal

Make generated presentation data safer and more useful by tightening validation for:

- short visible slide text;
- fuller speaker notes;
- Russian university tone;
- visual strategy per slide;
- source grounding;
- export-safe canvas elements.

## Current project context

- Shared contracts live in `packages/shared/src/index.ts`.
- Worker generation validates and normalizes output in `apps/worker/src/tasks/presentation.ts`.
- Quality checks live in `apps/worker/src/tasks/presentation-quality.ts`.
- Web rendering depends on `apps/web/src/lib/presentation-display.ts`.
- Export depends on `apps/worker/src/tasks/export.ts`.

## Implementation steps

1. Inspect existing schemas:
   - `presentationSchema`;
   - slide schema;
   - visual/canvas schemas;
   - quality critique schemas;
   - generation artifact schemas, if present.

2. Add or refine schemas for:
   - `researchBrief`;
   - `universitySpeechDraft`;
   - `slideTextPlan`;
   - `visualStrategy`;
   - `diagramSpec`;
   - `generationPipelineArtifacts`.

3. Preserve backward compatibility for existing saved presentations:
   - add defaults where appropriate;
   - avoid required fields unless all old data can still parse;
   - use `.optional()` and normalization in the worker where needed.

4. Add refinements that catch bad generation:
   - too-long slide titles;
   - too many bullets;
   - empty speaker notes;
   - unsupported metadata phrases like "слайд должен";
   - generic educational filler;
   - invalid canvas element dimensions.

5. Keep schema errors developer-readable. Add helper formatting if current logs are too noisy.

## Tests

Add or update tests in:

- `packages/shared`;
- `apps/worker/src/tasks/presentation-quality.test.ts`;
- any existing presentation parsing tests.

Run:

```powershell
npm run build -w @studydeck/shared
npm run test -w @studydeck/shared
npm run test -w @studydeck/worker
npm run typecheck -w @studydeck/web
npm run typecheck -w @studydeck/worker
```

## Acceptance criteria

- Strong decks parse cleanly.
- Bad AI output fails with useful messages or is repaired by existing normalization.
- Web rendering, PPTX export, and PDF export still accept the shared contract.
- Old saved presentations remain readable.

## Non-goals

- Do not redesign the whole presentation JSON.
- Do not add DB migrations unless absolutely required.
- Do not make validation so strict that topic-only generation fails often.

