# Prompt 13: shadcn/ui for StudyDeck interface

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Use shadcn/ui selectively for polished app UI. Do not replace the whole design system at once.

## Goal

Introduce reusable, accessible UI primitives for:

- dialogs;
- dropdown menus;
- tabs;
- buttons;
- inputs;
- progress/status surfaces;
- editor panels.

StudyDeck should feel like a serious tool for Russian university presentations, not a marketing landing page.

## Current project context

- Web app lives in `apps/web`.
- Global visual system lives in `apps/web/src/app/globals.css`.
- The project already uses `lucide-react`.
- Current design direction should be preserved.

## Dependencies

Check current shadcn/ui docs before running the CLI. shadcn/ui is a code-generation workflow, not just a runtime library.

Initialize only if the repo is not already configured.

## Implementation steps

1. Inspect existing web styling and component structure.

2. Add shadcn/ui configuration only if missing.

3. Add a small first component set:
   - button;
   - dialog;
   - dropdown-menu;
   - tabs;
   - progress;
   - textarea/input if useful.

4. Adapt generated components to StudyDeck tokens and CSS variables.

5. Use components in one focused area first:
   - generation progress;
   - speech review dialog;
   - export controls;
   - editor side panel.

6. Keep components accessible and keyboard-friendly.

## Design rules

- Avoid nested cards.
- Keep panels dense and work-focused.
- Use icons for tool buttons when possible.
- Do not add a landing page.
- Do not introduce a purple/blue one-note palette.

## Tests

Run:

```powershell
npm run typecheck -w @studydeck/web
npm run test -w @studydeck/web
```

For visual verification:

```powershell
npm run dev:web:fast
```

Verify at `http://localhost:3020`.

## Acceptance criteria

- shadcn/ui is configured cleanly.
- At least one real workflow uses the new components.
- Existing StudyDeck visual direction is preserved.
- No broad unrelated redesign happens.

## Non-goals

- Do not migrate every component.
- Do not use shadcn/ui as an excuse to redesign all screens.
- Do not add decorative landing-page sections.

