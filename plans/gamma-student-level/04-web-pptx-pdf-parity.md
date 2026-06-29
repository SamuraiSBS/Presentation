# Prompt 04: Web, PPTX, and PDF parity

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Make web preview, editable canvas, PPTX export, and PDF export behave as one visual system.

## Goal

The user said web and PPTX/PDF are equally important. A generated deck should not look premium in the browser and weaker after export.

The source of truth should be shared presentation data and generated `SlideCanvas` wherever possible.

## Current project context

- Shared canvas generation lives in `packages/shared/src/index.ts`.
- Web editor renders canvas in `apps/web/src/components/project-editor.tsx`.
- Older template preview exists in `apps/web/src/components/slide-template-renderer.tsx`.
- Export lives in `apps/worker/src/tasks/export.ts`.
- `createPptx(...)` already renders `item.canvas` through `renderCanvasSlide(...)`.
- PDF export is routed through `createPdf(...)` in the same worker file.

## Required behavior

- Any new visual layout should render through `SlideCanvas`.
- PPTX export should use canvas when canvas exists.
- PDF export should visually match the same source as closely as possible.
- The editor should preserve generated canvas unless the user edits it.
- Sanitization should not remove useful generated visuals.

## Implementation steps

1. Audit rendering paths.
   - Confirm when web uses canvas vs template preview.
   - Confirm when export uses canvas vs legacy layout renderers.
   - Identify layout types still dependent on duplicate renderer logic.

2. Prefer generated canvas as source of truth.
   - Keep `ensureEditableCanvas(...)` central.
   - Avoid adding new visual behavior only to React template preview.

3. Strengthen `renderCanvasSlide(...)` in `apps/worker/src/tasks/export.ts`.
   - Verify text fit, shape opacity, image fit, gradients, and notes.
   - Add tests for canvas text, images, shapes, and background styles.

4. Create parity fixtures.
   - A deck with image hero.
   - A deck with diagram board.
   - A deck with evidence slide.
   - A deck with final summary.

5. Add regression tests.
   - `ensureEditableCanvas(...)` creates valid canvas for every slide.
   - PPTX generation does not fall back unexpectedly.
   - Custom user canvas remains custom.
   - Stored visual images become usable URLs in web and readable object keys in export.

## Tests

Run:

```powershell
npm run build -w @studydeck/shared
npm run test -w @studydeck/shared
npm run test -w @studydeck/web -- src/lib/presentation-display.test.ts
npm run test -w @studydeck/worker -- src/tasks/export.test.ts
npm run typecheck -w @studydeck/web
npm run typecheck -w @studydeck/worker
```

If the test runner does not support a direct file argument for a workspace, use the closest existing workspace command.

## Acceptance criteria

- New generated layouts use shared canvas.
- Browser preview and PPTX/PDF export remain aligned.
- User edits are preserved and not overwritten by regeneration helpers.
- Existing legacy presentations still display.

## Non-goals

- Do not rewrite the whole editor.
- Do not remove legacy preview until canvas coverage is complete.
- Do not add remote deployment in this plan.

