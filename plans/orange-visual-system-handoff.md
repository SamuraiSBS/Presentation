# Prompt: unify StudyDeck with the orange visual system

You are working in the StudyDeck AI monorepo at `D:\presentation` on Windows PowerShell.

Implement a production-ready redesign of the complete StudyDeck web interface. The result must clearly belong to the same visual family as the user's other products at `D:\uchi-bot\frontend` and `D:\easy study\frontend`, but the primary brand color must be `#FF8A00`.

Do not stop after writing a plan. Inspect the current code, implement the redesign, run the relevant checks, start the preferred frontend preview, and verify the result in the browser.

## User-approved direction

- Redesign the entire web product: landing page, projects dashboard, creation wizard, script review, slide editor chrome, export, pricing, and billing.
- Transfer the visual language literally enough that the three products feel related:
  - Nunito typography;
  - Lucide outline icons;
  - light brand-tinted background;
  - soft translucent surfaces;
  - generous rounded geometry;
  - vivid colored primary actions;
  - mobile bottom navigation;
  - friendly, energetic, student-oriented presentation.
- Use the light, airy atmosphere of Easy Study as the closest reference, translated into an orange palette.
- Keep desktop top navigation. Use bottom navigation on mobile.
- Do not recolor or redesign generated presentation themes. The slide canvas remains theme-driven and independent from the application chrome.
- This is a production implementation, not a static mockup.

## Product constraints

StudyDeck is a Next.js App Router application in `apps/web`. It creates study presentations from prompts and source files, lets the user review narration, edit slides, and export PDF/PPTX.

Preserve these product principles:

- The student's next action must remain obvious.
- Source confidence, generation progress, script readiness, and export readiness must stay visible.
- The interface must support long Russian labels, keyboard navigation, small mobile screens, reduced motion, loading, empty, error, disabled, and success states.
- Do not change API behavior, worker jobs, shared presentation contracts, generation logic, canvas persistence, or export rendering unless a tiny compatibility change is genuinely required by the frontend redesign.
- Preserve user changes already present in the working tree. Inspect `git status --short` before editing and do not revert unrelated files.

## Reference implementation sources

Read these files before editing StudyDeck:

- `D:\uchi-bot\frontend\src\styles.css`
- `D:\uchi-bot\frontend\src\components\Layout.tsx`
- `D:\uchi-bot\frontend\src\components\BottomNav.tsx`
- `D:\uchi-bot\frontend\src\pages\HomePage.tsx`
- `D:\easy study\frontend\src\styles.css`
- `D:\easy study\frontend\src\components\Layout.tsx`
- `D:\easy study\frontend\src\pages\HomePage.tsx`
- `D:\easy study\frontend\src\components\State.tsx`
- `D:\easy study\frontend\src\components\Motion.tsx`

Extract the reusable visual language rather than copying Telegram-specific behavior or Tailwind class strings blindly.

StudyDeck files that must be inspected before implementation:

- `apps/web/src/app/globals.css`
- `apps/web/src/app/layout.tsx`
- `apps/web/src/components/app-header.tsx`
- every `page.tsx` under `apps/web/src/app`
- `apps/web/src/components/new-project-form.tsx`
- `apps/web/src/components/project-script-review.tsx`
- `apps/web/src/components/project-editor.tsx`
- `apps/web/src/components/export-panel.tsx`
- `apps/web/src/components/checkout-button.tsx`
- `apps/web/src/components/slide-template-renderer.tsx`
- `apps/web/src/lib/presentation-display.ts`

## Visual system

Create centralized CSS tokens. These hex values are the approved visual contract:

| Role | Value | Usage |
|---|---:|---|
| Primary orange | `#FF8A00` | primary actions, current navigation, selected wizard steps |
| Deep orange | `#C95D00` | pressed states and high-contrast orange text |
| Bright orange | `#FFB14A` | highlights and controlled decorative accents |
| Soft orange | `#FFE2BE` | selected surfaces, icon backgrounds, focus support |
| App background | `#FFF5E9` | base light orange-tinted environment |
| Primary ink | `#3A2109` | headings, body text, icons |
| Muted ink | `#805C38` | secondary text with WCAG AA contrast |
| Success | `#22A866` | ready, verified, completed states only |
| AI purple | `#7B3DFF` | AI-specific state or editor power only |
| Error | existing accessible red family | destructive and failed states only |

Requirements:

- Orange must visually dominate, but semantic green, purple, and red must keep their meanings.
- Use a low-contrast orange-tinted ambient gradient similar to Easy Study for the page background.
- Use translucent white only where it improves hierarchy: navigation, major hero/workflow surface, or mobile bottom bar. Do not turn every element into glass.
- Use solid text. Never use gradient text.
- Do not use side-stripe accent borders.
- Avoid identical decorative card grids. Cards must represent real grouped objects such as projects, plans, files, or workflow steps.
- Do not combine a visible 1px border with a large ambient shadow on the same ordinary card. Prefer either a soft tonal edge or a restrained shadow.
- Use approximately 24px corners for major feature surfaces, 16-18px for ordinary cards and controls, 12px for dense editor controls, and pills only for chips/navigation. Do not exceed 28px on rectangular surfaces.

## Typography and icons

- Add a locally packaged Nunito variable font so Docker/CI builds do not depend on downloading Google Fonts.
- Prefer `@fontsource-variable/nunito` or an equivalent local package.
- Apply Nunito to application UI, headings, buttons, forms, editor chrome, and navigation.
- Do not override fonts inside generated slides when a presentation theme supplies its own typography.
- Add `lucide-react` to `@studydeck/web` and use one coherent icon set throughout the application chrome.
- Replace the custom letter-only brand mark with a simple orange icon tile and the StudyDeck AI wordmark. Do not invent a complex new logo.
- Keep icon-only controls accessible with `aria-label` or visible tooltips/titles.

## Implementation sequence

### 1. Foundation and dependencies

1. Inspect the current working tree.
2. Add the local Nunito font package and `lucide-react` to `apps/web/package.json` using the workspace package manager.
3. Update `apps/web/src/app/layout.tsx` to load the local font without changing server/client boundaries unnecessarily.
4. Refactor the top of `globals.css` into stable application tokens for color, spacing, radii, focus rings, shadow levels, motion durations, and z-index roles.
5. Keep slide theme variables and slide-rendering CSS isolated from application tokens.

### 2. Responsive application shell

Redesign `app-header.tsx` and add a client component such as `mobile-bottom-nav.tsx`.

Desktop navigation:

- sticky or stable top header;
- orange StudyDeck mark and Nunito wordmark;
- Projects, Create, and Pricing navigation with Lucide icons where useful;
- a clear primary Create action;
- visible hover and `focus-visible` states;
- no oversized marketing navigation.

Mobile navigation:

- fixed bottom navigation inspired by Uchi Bot and Easy Study;
- safe-area padding;
- routes for Home, Projects, Create, and Pricing;
- active route indicated by orange fill and readable label/icon treatment;
- minimum 44px touch targets;
- page content padded so it is never obscured by the bottom bar.

Use semantic z-index tokens. Do not use arbitrary values such as `9999`.

### 3. Shared component vocabulary

Unify existing global classes rather than introducing a large new component framework:

- `.button`, `.ghost`, icon buttons, destructive buttons;
- `.panel`, `.card`, project rows, pricing plans;
- `.status` and state variants;
- `.input`, `.textarea`, `.select`, file inputs and dropzones;
- loading bands/skeletons;
- empty, error, success, and disabled states;
- icon surfaces;
- responsive rows and action groups.

Every interactive component must have default, hover, focus-visible, active, disabled, and loading behavior where applicable. Placeholder and helper text must meet WCAG AA.

### 4. Landing page

Redesign `apps/web/src/app/page.tsx` without introducing fake metrics or decorative illustrations.

- Use a large, friendly intro surface based on Easy Study's home-page composition.
- Keep the current real StudyDeck value proposition and calls to action.
- Turn the existing five-step workflow into one meaningful process object, not five cloned marketing cards.
- Use presentation, file, script, edit, and export Lucide icons.
- Ensure the second fold makes the product workflow understandable without requiring oversized hero typography.

### 5. Projects dashboard

Update `apps/web/src/app/dashboard/page.tsx`.

- Create scannable project rows/cards with a presentation icon, title, slide count, status, and continuation affordance.
- Use semantic status colors: orange for in progress, green for ready, red for failed, muted for draft.
- Preserve the empty state but make it instructional and action-oriented.
- Remove inline layout and heading-size styles where a reusable class is clearer.

### 6. Creation wizard

Update `new-project-form.tsx` and its related CSS.

- Keep the existing three-step behavior and API calls intact.
- Use orange active steps and selection surfaces.
- Make the current step visually dominant while the summary stays secondary.
- Redesign slide-count choices, source mode, file list, confidence state, drag/drop, errors, and busy state using the shared vocabulary.
- On mobile, stack the summary and form in a logical reading order without horizontal overflow.
- Preserve long Russian labels without shrinking them below readable size.

### 7. Script review

Update `project-script-review.tsx`.

- Keep narration acceptance and automatic generation behavior unchanged.
- Give generating, ready, dirty, saved, failed, and retry states distinct visual treatments.
- Keep the script textarea comfortable for long-form reading at 65-75ch where possible.
- Make the primary next action obvious without hiding save/retry controls.

### 8. Slide editor chrome

Update only the editor chrome in `project-editor.tsx` and the associated application CSS.

- Restyle the slide rail, toolbar, properties panel, canvas frame, notes panel, selection handles, and floating object menu into the orange family.
- Use orange for the current slide, selected object, active tools, focus, and export action.
- Use dense 12px-radius controls inside the editor rather than the larger marketing geometry.
- Preserve all pointer, keyboard, resize, upload, save, refresh, generation, and canvas behavior.
- Preserve the `1280x720` canvas model and current canvas scaling.
- Do not modify the generated slide theme colors, theme fonts, slide layouts, or slide canvas contents.
- Do not make application font/color tokens leak into `.slide-content`, `.canvas-viewport`, or theme-provided CSS variables.
- Ensure desktop keeps the three-part editor. At narrower widths, collapse structurally into slide rail, canvas, and properties without making controls unusably small.

### 9. Export, pricing, and billing

- Redesign `export-panel.tsx` so PDF/PPTX actions, queued files, ready downloads, and failed exports are easy to distinguish.
- Redesign `pricing/page.tsx` in the shared product vocabulary. One recommended plan may receive stronger emphasis, but avoid three identical promotional cards with decorative icons.
- Redesign `billing/page.tsx` as a complete, honest state using the current available functionality. Do not invent payment history or controls that do not exist.
- Preserve checkout behavior in `checkout-button.tsx` and add proper loading/disabled feedback.

### 10. Documentation

After the code matches the approved system:

- update `DESIGN.md` so it no longer documents Inter, compact 8px geometry, or the old restrained visual system as current truth;
- update `.impeccable/design.json` if present;
- keep `PRODUCT.md` product strategy intact unless a small factual visual-system correction is necessary.

## Motion

- Use 150-220ms transitions for hover, focus, selected states, navigation changes, and progress feedback.
- Motion must communicate state, not decorate page load.
- Avoid bounce and elastic effects.
- Do not hide initially visible content behind JavaScript reveal animation.
- Provide a `prefers-reduced-motion: reduce` fallback for every animation.

## Responsive requirements

Verify at minimum:

- 1440x900 desktop;
- 1024x768 compact desktop/tablet;
- 768x1024 tablet;
- 390x844 mobile;
- 320px minimum width for overflow safety.

Check:

- no horizontal page scrolling;
- bottom navigation does not cover actions or text;
- long Russian labels wrap without clipping;
- touch targets remain at least 44x44px on mobile;
- editor panels remain reachable;
- headings do not overflow;
- keyboard focus remains visible;
- dropdowns or floating menus are not clipped by overflow containers.

## Verification workflow

For normal frontend implementation, follow the repository rule and use the fast host preview. Do not rebuild the production web Docker image unless explicitly asked.

Run:

```powershell
npm run typecheck -w @studydeck/web
npm run test -w @studydeck/web
npm run build -w @studydeck/web
```

Then start or reuse:

```powershell
npm run dev:web:fast
```

Verify the result at `http://localhost:3020` in a real browser. Inspect every route and the responsive sizes listed above. Check browser console errors. Read back screenshots rather than assuming they look correct.

If runtime data is needed, keep the Docker API/infrastructure services running and use the existing root `.env`. Do not switch the task to `localhost:3010` unless production-container validation is explicitly requested.

## Required routes to verify

- `/`
- `/dashboard`
- `/new`
- `/pricing`
- `/billing`
- one real `/projects/[id]/script` route if data exists;
- one real `/projects/[id]/editor` route if data exists;
- one real `/projects/[id]/export` route if data exists.

If real project data is unavailable, verify all reachable static and empty/error states and report the exact limitation.

## Acceptance criteria

- StudyDeck visibly belongs to the same product family as Uchi Bot and Easy Study.
- `#FF8A00` is unmistakably the primary brand/action color.
- Nunito and Lucide are used consistently in application UI.
- Desktop has a coherent top navigation and mobile has a safe-area-aware bottom navigation.
- All listed routes use the same visual vocabulary.
- Generated presentation themes and slide contents remain visually unchanged.
- Editor behavior, generation flow, script acceptance, export, and checkout behavior are preserved.
- Empty, loading, error, success, active, disabled, hover, and focus-visible states are implemented.
- The interface works at 320px without horizontal overflow and remains usable at desktop sizes.
- Typecheck, tests, and production web build pass.
- Browser verification finds no blocking console or layout errors.

## Non-goals

- Do not redesign generated slide themes.
- Do not change worker generation prompts or export rendering.
- Do not change shared presentation contracts.
- Do not redesign backend/API behavior.
- Do not add authentication, profile, or payment features that do not exist.
- Do not perform remote deployment.
- Do not rebuild the production web container for ordinary visual iteration.

## Final handoff format

When finished, report:

1. the implemented visual-system changes;
2. the main files changed;
3. tests and builds run with their results;
4. routes and viewport sizes inspected in the browser;
5. any remaining limitation or unverified data-dependent state;
6. the preview URL the user should open.
