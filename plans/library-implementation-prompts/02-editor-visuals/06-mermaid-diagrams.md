# Prompt 06: Mermaid generated diagrams

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Add Mermaid as a lightweight way to generate academic diagrams for Russian university presentations.

## Goal

Support generated diagram slides such as:

- process diagrams;
- cause-and-effect chains;
- classifications;
- timelines;
- simple flowcharts.

Mermaid should be used for generated visual structure, not for a manual diagram editor.

## Current project context

- Visual strategy and canvas building live in worker presentation tasks.
- Web slide rendering lives in `apps/web/src/lib/presentation-display.ts`.
- Export rendering lives in `apps/worker/src/tasks/export.ts`.
- Shared slide/canvas contracts live in `packages/shared/src/index.ts`.

## Dependencies

Check current Mermaid docs before installing.

Likely package:

```powershell
npm install mermaid
```

## Implementation steps

1. Add a shared diagram spec to the presentation contract:
   - diagram type;
   - Mermaid source;
   - plain-text fallback;
   - title or caption;
   - safety status.

2. Update worker prompts so the model can request a diagram only when it helps:
   - abstract concept explanation;
   - sequence/process;
   - comparison/classification;
   - causal chain.

3. Validate Mermaid source before saving:
   - length limit;
   - allowed diagram types;
   - no HTML/script;
   - Russian labels preferred.

4. Render diagrams in the web app:
   - client-side component if needed;
   - loading/error fallback;
   - stable dimensions to avoid layout shift.

5. Support export:
   - either render Mermaid to SVG/PNG before export;
   - or convert diagram spec into simple canvas shapes for PPTX/PDF.

6. Keep fallback text visible if Mermaid rendering fails.

## Tests

Add tests for:

- schema validation;
- allowed/disallowed Mermaid sources;
- rendering fallback;
- export fallback or generated SVG path.

Run:

```powershell
npm run build -w @studydeck/shared
npm run typecheck -w @studydeck/web
npm run typecheck -w @studydeck/worker
npm run test -w @studydeck/worker
```

## Acceptance criteria

- Worker can generate diagram intent.
- Web can render Mermaid diagrams or a clean fallback.
- Exports do not break when a diagram exists.
- Diagrams improve visual rhythm without replacing real images everywhere.

## Non-goals

- Do not add manual diagram editing.
- Do not use Mermaid for every slide.
- Do not allow arbitrary unsafe diagram text.

