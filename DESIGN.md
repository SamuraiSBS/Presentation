---
name: Lazyum
description: A warm, task-led workspace that turns a study prompt and sources into an editable presentation.
colors:
  app-bg: "#fff5e9"
  surface: "#ffffff"
  surface-warm: "#fff0dc"
  surface-input: "#fffdf9"
  ink: "#3a2109"
  muted: "#805c38"
  line: "#efd6b9"
  action-orange: "#ff8a00"
  action-orange-deep: "#a84600"
  action-orange-soft: "#ffe2be"
  verified-green: "#168552"
  ai-purple: "#7b3dff"
  error: "#a73822"
  error-soft: "#fff0ec"
  editor-workspace: "#302012"
  editor-panel: "#432b18"
  editor-control: "#54371f"
typography:
  display:
    fontFamily: "Nunito Variable, Nunito, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(43px, 6vw, 76px)"
    fontWeight: 900
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Nunito Variable, Nunito, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(26px, 3vw, 34px)"
    fontWeight: 850
    lineHeight: 1.12
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Nunito Variable, Nunito, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Nunito Variable, Nunito, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 800
    lineHeight: 1.2
rounded:
  editor: "12px"
  control: "14px"
  card: "18px"
  major: "24px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "14px"
  lg: "18px"
  xl: "24px"
  page-x: "clamp(16px, 4vw, 48px)"
  page-y: "clamp(30px, 5vw, 68px)"
components:
  button-primary:
    backgroundColor: "{colors.action-orange}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "44px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.major}"
    padding: "clamp(18px, 3vw, 28px)"
  input:
    backgroundColor: "{colors.surface-input}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "12px"
---

# Design System: Lazyum

## 1. Overview

**Creative North Star: "The Guided Study Desk"**

Lazyum is a practical desk for a student preparing a presentation under time pressure. The next useful action must be unmistakable: formulate the topic, add material, check the plan, refine slides and speech, then export. The interface supports that work rather than hiding it behind a magical-looking generation flow.

The app shell is light, warm, and compact. A pale peach canvas and white work surfaces reduce glare; orange establishes action and current progress; green confirms trustworthy completion; purple is reserved for AI- and presentation-specific moments. The editor deliberately changes scene into a dark, concentrated workspace while leaving the generated 16:9 slide itself theme-driven.

It rejects generic green SaaS styling, childish classroom imagery, decorative AI gradients, heavy glassmorphism, oversized marketing composition in signed-in flows, and polished output that conceals source quality.

**Key Characteristics:**

- Workflow-first pages with one prominent next action.
- One friendly product sans for application chrome, dense labels, and long Russian copy.
- Functional color: orange for action, green for confirmation, purple for AI/editor context.
- Soft tonal layering and short state shadows instead of floating-card decoration.
- Structural mobile layout: desktop topbar becomes a safe-area-aware bottom navigation below 760px.

## 2. Colors

The palette is a light warm-neutral product system with accents assigned by meaning, not decoration.

### Primary

- **Action Orange** (`#ff8a00`): Create, generate, export, active progress, selected mobile navigation, and the product mark.
- **Deep Orange** (`#a84600`): Active text, hover feedback, focus-adjacent details, and small directional icons.
- **Soft Orange** (`#ffe2be`): Hover fills, selected controls, and low-emphasis action context.

### Secondary

- **Verified Green** (`#168552`): Completion, readiness, confidence, and successful export states. Pair it with the app's pale green status surfaces rather than using it as a general accent.
- **AI Purple** (`#7b3dff`): AI and speech/editor-specific accents. It is not a replacement for the primary action color.
- **Error Red** (`#a73822`) on **Error Soft** (`#fff0ec`): Failures and blocking form feedback.

### Neutral

- **Study Canvas** (`#fff5e9`): The page field, with a restrained warm gradient only at the app background level.
- **White Surface** (`#ffffff`): Primary panels, dialogs, controls, and readable content planes.
- **Warm Source Surface** (`#fff0dc`) and **Input Surface** (`#fffdf9`): Secondary workflow areas, generated-content context, and fields.
- **Ink** (`#3a2109`), **Muted** (`#805c38`), and **Line** (`#efd6b9`): Text hierarchy and quiet separation.
- **Editor Workspace** (`#302012`), **Editor Panel** (`#432b18`), and **Editor Control** (`#54371f`): Focused editor shell, rails, and local controls.

### Named Rules

**The Task Color Rule.** Orange, green, and purple always communicate action, confirmation, or AI/editor context.

**The Warm Neutral Ceiling.** The background may be warm but must remain subordinate to the task. Do not turn the product into a cream marketing surface.

## 3. Typography

**Display Font:** Nunito Variable, then Nunito and system sans fallbacks.
**Body Font:** Nunito Variable, then Nunito and system sans fallbacks.
**Label/Mono Font:** The same product sans; no display or mono face is introduced for chrome.

**Character:** Rounded, high-weight Nunito makes actions and structure easy to scan without becoming childish. Body copy stays conventional and roomy enough for study text and Russian labels.

### Hierarchy

- **Display** (900, `clamp(43px, 6vw, 76px)`, 1.02): Landing-only hero headings. Use balanced wrapping and `-0.035em` tracking.
- **Headline** (850, `clamp(26px, 3vw, 34px)`, 1.12): Page sections, export stages, wizard questions, and editor headings.
- **Title** (800–900, 18–24px, 1.2): Cards, summaries, and structured workspace blocks.
- **Body** (400–750, 16–17px, 1.5–1.65): Helper text, narration, notes, and generated study content. Keep prose close to 65–75ch when the layout permits.
- **Label** (800–900, 11–14px, 1.2): Navigation, form labels, status, controls, and compact metadata.

### Named Rules

**The Russian Label Rule.** Give long Russian labels room to wrap or expand before reducing their type size.

**The Slide Boundary Rule.** Application typography is Nunito. Generated slide themes own their own type tokens so web preview and export remain aligned.

## 4. Elevation

Depth is stateful and structural. Most work surfaces use tonal contrast and very short warm shadows; raised previews, menus, dialogs, and a hovered project card earn stronger elevation. The dark editor provides its own depth through nested tones, not ambient glass.

### Shadow Vocabulary

- **Surface Rest** (`0 5px 12px rgba(111, 61, 14, 0.07)`): Standard `.card`, `.panel`, and wizard surface separation.
- **Raised Object** (`0 12px 30px rgba(111, 61, 14, 0.11)`): Hovered project cards and floating menus.
- **Preview Object** (`0 22px 44px rgba(76, 39, 8, 0.18)`): The landing workflow preview only.
- **Dialog** (`0 22px 60px rgba(58, 33, 9, 0.22)`): Modal layer above the app shell.

### Named Rules

**The Purposeful Lift Rule.** Do not add a border and a broad decorative shadow to the same ordinary surface. Use the established short shadow at rest; reserve stronger lift for interaction or hierarchy.

## 5. Components

### Buttons

- **Shape:** 14px rounded rectangles; standard shell actions are at least 44px high. Shared UI primitives may use the compact 40px size.
- **Primary:** `#ff8a00` with Ink text, heavy label, 0 6px 10px orange-tinted shadow. Hover changes to `#ed7d00` and lifts by 1px; active moves down by 1px.
- **Secondary / Ghost:** White or translucent white with a `#efd6b9` outline. Hover moves to Soft Orange and a brighter orange edge.
- **Focus / disabled:** A 2px Deep Orange outline plus the 4px orange focus ring; disabled buttons stay readable at reduced opacity with no lift.

### Fields and Selects

- **Fields:** 46px minimum height, 16px radius, `#fffdf9` fill, warm edge, and a visible orange hover/focus treatment.
- **Selects:** 12px radius, 40px height, clear chevron, and Radix popover content instead of clipped in-flow menus.
- **Errors:** Pale red fill with a red inset edge and no ambiguous low-contrast status copy.

### Cards / Containers

- **Corner Style:** 24px for major workflows and dialogs, 18px for cards and fields, 14px for controls, and 12px for dense editor chrome.
- **Background:** White for normal work, Warm Source Surface for summaries and secondary workflow context, and the dark editor palette for slide tooling.
- **Spacing:** Use the existing 8 / 12 / 14 / 18 / 24px rhythm; page gutters are `clamp(16px, 4vw, 48px)`.

### Navigation

- **Desktop:** Sticky 72px translucent topbar with product mark, icon-led links, create action, and account menu.
- **Mobile:** At 760px and below, hide desktop navigation and use a fixed safe-area-aware bottom bar. The current destination uses orange; the create destination remains available as a primary task.

### Status, Wizard, and Progress

- **Status:** Orange is draft or in-progress; pale green with deep green is ready/completed; pale red is failed.
- **Wizard:** Pill steps make the next configuration task explicit. Active and completed markers use the orange action language.
- **Progress:** Thin orange indicators move only to communicate live generation/export state; honour reduced-motion preferences.

### Slide Editor and Canvas

- **Editor:** `#302012` shell with `#432b18` rails and panels, `#54371f` controls, a light canvas shell, and 12px local radii.
- **Canvas:** Always 16:9 and visually independent from app-shell tokens. Slide themes supply their own text, accent, line, and font variables so export and browser rendering agree.

## 6. Do's and Don'ts

### Do:

- **Do** start every screen with the student's next action: topic, material, plan, edit, rehearsal, or export.
- **Do** use orange only for action and active progress; use green only for trustworthy completion.
- **Do** preserve the established 150–200ms ease-out state transitions and reduced-motion alternatives.
- **Do** use the same rounded-control, field, focus, and icon vocabulary across routes.
- **Do** test long Russian labels, 320px-wide screens, and the 760px navigation transition.
- **Do** keep source confidence, speaker preparation, and export readiness visible instead of implying that a deck is finished by default.

### Don't:

- **Don't** use generic green SaaS styling, childish classroom cartoons, decorative AI gradients, or heavy glassmorphism.
- **Don't** use oversized marketing hero layouts for authenticated product flows.
- **Don't** hide source quality behind polished slides.
- **Don't** add broad decorative shadows to buttons, ordinary cards, or panels.
- **Don't** use side-stripe borders, gradient text, or repeated identical icon-card grids.
- **Don't** add a new display font to controls, labels, data, or editor chrome.
- **Don't** redesign the slide canvas with app-shell tokens; its presentation theme is a separate contract.
