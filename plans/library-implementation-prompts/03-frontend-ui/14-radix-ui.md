# Prompt 14: Radix UI primitives

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Use Radix UI primitives where StudyDeck needs accessible behavior under custom styling.

## Goal

Improve accessibility and interaction quality for:

- dialogs;
- popovers;
- dropdown menus;
- tooltips;
- tabs;
- switches;
- segmented controls.

Radix should support the product UI, not dictate the visual style.

## Current project context

- Web app lives in `apps/web`.
- The app has a custom visual system in CSS.
- shadcn/ui may also be used; it is built on Radix primitives.

## Dependencies

Install only primitives needed for the touched feature:

```powershell
npm install @radix-ui/react-dialog
```

Use equivalent package names for popover, dropdown menu, tabs, tooltip, switch, etc.

## Implementation steps

1. Identify one interaction that needs robust behavior:
   - export modal;
   - generation settings dialog;
   - editor toolbar dropdown;
   - slide options menu;
   - tooltip for icon-only buttons.

2. Add the minimal Radix primitive package.

3. Wrap it in a local StudyDeck component instead of scattering primitive usage everywhere.

4. Style with existing CSS tokens.

5. Ensure keyboard and focus behavior works.

6. Use `lucide-react` icons for icon buttons where appropriate.

## Tests

Run:

```powershell
npm run typecheck -w @studydeck/web
npm run test -w @studydeck/web
```

Verify manually at `http://localhost:3020` with:

```powershell
npm run dev:web:fast
```

## Acceptance criteria

- The chosen interaction is accessible and keyboard usable.
- Focus management works.
- Styling matches StudyDeck.
- No broad UI rewrite occurs.

## Non-goals

- Do not install every Radix package.
- Do not duplicate shadcn/ui components if shadcn is already configured for the same primitive.
- Do not add visible instructional copy.

