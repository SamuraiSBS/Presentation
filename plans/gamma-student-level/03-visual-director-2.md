# Prompt 03: Visual director 2.0

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Upgrade the visual direction layer so generated decks feel like a designed visual story, not just a set of themed slides.

## Goal

Every generated university presentation should have a deliberate visual rhythm:

- strong cover;
- short text-led slides;
- photo-led moments where useful;
- diagrams for explanation;
- comparison or evidence slides where appropriate;
- strong final takeaway slide.

The AI should decide intent and direction. Deterministic code should build the actual canvas.

## Current project context

- `DesignBrief` and `slideDirections` live in `packages/shared/src/index.ts`.
- Design brief generation lives in `apps/worker/src/tasks/presentation.ts`.
- Canvas generation lives in `buildSlideCanvas(...)` in `packages/shared/src/index.ts`.
- Web display uses `apps/web/src/components/slide-template-renderer.tsx` and editable canvas in `apps/web/src/components/project-editor.tsx`.
- Export uses `apps/worker/src/tasks/export.ts`.
- Premium themes already exist in `PREMIUM_PRESENTATION_THEMES`.

## New visual model

Extend or reinterpret each `designBrief.slideDirections[]` item as a slide scene:

```ts
visualRole:
  | "hero"
  | "problem"
  | "context"
  | "explain"
  | "compare"
  | "sequence"
  | "evidence"
  | "quote"
  | "visual_statement"
  | "summary"

layoutIntent:
  | "full_bleed_image"
  | "split_image_text"
  | "statement"
  | "cards"
  | "timeline"
  | "diagram"
  | "comparison"
  | "evidence_board"
  | "quote_spread"
  | "summary"
```

If schema expansion is too risky, map these richer concepts to existing enums internally first.

## Visual rhythm rules

- Slide 1 should almost always be `hero`.
- Final slide should be `summary`.
- Do not use the same content layout more than twice in a row.
- Do not make every slide a card grid.
- Use real images only when the topic has concrete visual anchors.
- Use diagrams for causes, processes, concepts, comparisons, and structures.
- Use text-led statement slides for strong claims.
- Use evidence slides when source refs or concrete facts matter.

## Implementation steps

1. Update `buildDesignBriefPrompt(...)` in `apps/worker/src/tasks/presentation.ts`.
   - Ask for visual roles, not raw layout code.
   - Ask for a mix of images and diagrams.
   - Ask for Gamma-like rhythm while preserving university clarity.

2. Update deterministic fallback `buildDesignBrief(...)`.
   - Produce a varied scene sequence from topic, sources, slide count, and narrative plan.
   - Keep exact slide count directions.

3. Update `diversifySlideLayouts(...)`.
   - Respect richer visual roles.
   - Keep `layoutHasEnoughContent(...)` as a guardrail.
   - Avoid promoting sparse slides into layouts that require more content.

4. Update `buildSlideCanvas(...)`.
   - Add or refine canvas variants for:
     - editorial cover;
     - split image/text;
     - evidence board;
     - quote spread;
     - diagram board;
     - comparison board;
     - final takeaway.

5. Keep export aligned.
   - Prefer shared canvas generation so PPTX uses the same design.
   - If adding non-canvas fallback renderers, mirror them in `apps/worker/src/tasks/export.ts`.

## Tests

Add or update:

- shared layout tests for new canvas variants;
- worker tests that design brief returns one direction per slide;
- worker tests that layout rhythm avoids three repeated layouts;
- export test that new canvas variants do not throw;
- web display test that premium design brief still renders.

Run:

```powershell
npm run build -w @studydeck/shared
npm run test -w @studydeck/shared
npm run test -w @studydeck/worker -- src/tasks/presentation.test.ts
npm run test -w @studydeck/worker -- src/tasks/export.test.ts
npm run typecheck -w @studydeck/web
```

## Acceptance criteria

- Decks look like a visual story, not repeated templates.
- Image-led, diagram-led, and text-led slides can coexist in one deck.
- Web preview and PPTX/PDF remain visually aligned.
- Existing saved decks remain readable.

## Non-goals

- Do not let the model generate raw CSS, HTML, or coordinates.
- Do not add a full theme editor.
- Do not force images onto every slide.

