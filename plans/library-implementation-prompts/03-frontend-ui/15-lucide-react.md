# Prompt 15: lucide-react icon system

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Standardize icon usage with `lucide-react`. It is already installed in `apps/web`.

## Goal

Make StudyDeck controls easier to scan by using consistent icons for:

- editor toolbar actions;
- export buttons;
- generation status;
- source/search indicators;
- slide navigation;
- warnings and success states.

## Current project context

- `lucide-react` is already in `apps/web/package.json`.
- The frontend has an existing visual system and should stay restrained.
- Icon buttons should use tooltips when the meaning is not obvious.

## Implementation steps

1. Search for manual SVG icons, emoji-like symbols, or text-only compact buttons in `apps/web/src`.

2. Replace only clear candidates with lucide icons:
   - save;
   - download/export;
   - refresh/regenerate;
   - edit;
   - search;
   - image;
   - chart/diagram;
   - warning;
   - success;
   - next/previous.

3. Create a small icon-button pattern if one does not exist.

4. Add accessible labels:
   - `aria-label`;
   - tooltip for unfamiliar icon-only buttons.

5. Keep icon sizes consistent.

## Tests

Run:

```powershell
npm run typecheck -w @studydeck/web
npm run test -w @studydeck/web
```

Visual check:

```powershell
npm run dev:web:fast
```

## Acceptance criteria

- Important controls use consistent lucide icons.
- Icon-only controls are accessible.
- No unrelated visual redesign occurs.
- Text still fits in buttons on mobile and desktop.

## Non-goals

- Do not replace brand/logo assets.
- Do not use icons as decoration where they do not clarify action or state.
- Do not add custom SVG icons when lucide has a suitable icon.

