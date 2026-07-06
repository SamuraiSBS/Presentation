# Prompt 17: React Flow for later interactive visual structures

You are working in the StudyDeck AI monorepo at `D:\presentation`.

This is a later-stage prompt. Do not implement React Flow unless the product needs interactive diagram editing or richer generated visual structures beyond Mermaid.

## Goal

Use React Flow for structured visual diagrams only when StudyDeck needs:

- editable concept maps;
- dependency graphs;
- branching process maps;
- interactive visual planning;
- advanced generated diagram layouts.

For the current product direction, Mermaid is usually enough first.

## Current project context

- The user does not want a full visual editor yet.
- First editing scope is text on slides and speaker speech.
- Web/PPTX/PDF export parity matters.

## Dependencies

Modern React Flow package is likely:

```powershell
npm install @xyflow/react
```

Check current docs before installing.

## Implementation steps

1. Confirm that Mermaid cannot cover the needed diagram type.

2. Add a shared diagram graph schema:
   - nodes;
   - edges;
   - layout direction;
   - labels;
   - fallback text.

3. Render the graph in the web app with React Flow.

4. Keep editing disabled at first unless explicitly requested.

5. Add export fallback:
   - convert nodes/edges to canvas elements;
   - or render a static image/SVG for export.

6. Preserve slide layout stability on mobile and desktop.

## Tests

Run:

```powershell
npm run build -w @studydeck/shared
npm run typecheck -w @studydeck/web
npm run typecheck -w @studydeck/worker
```

## Acceptance criteria

- React Flow is used only for diagrams that need graph rendering.
- Web rendering has stable dimensions.
- Export has a safe fallback.
- The product does not become a manual visual editor accidentally.

## Non-goals

- Do not build Canva-like editing.
- Do not replace Mermaid for simple diagrams.
- Do not add React Flow to every generated slide.

