---
name: StudyDeck AI
description: A focused study-workflow interface for turning prompts and source material into editable presentations, speaker notes, scripts, and exports.
colors:
  app-bg: "#f8f8f5"
  surface: "#ffffff"
  surface-warm: "#fff4e6"
  surface-input: "#fffefb"
  ink: "#151914"
  muted: "#626c62"
  line: "#ddded6"
  action-orange: "#ff8a00"
  verified-green: "#137447"
  ai-purple: "#6d3df7"
  editor-dark: "#171915"
  editor-panel: "#24271f"
  editor-control: "#30342c"
  error-bg: "#fff2ee"
  error-line: "#f0b8a8"
  error-text: "#8d2d18"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "38px to 78px on marketing shell; 30px to 52px in app pages"
    fontWeight: 900
    lineHeight: 0.98
    letterSpacing: "0"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "26px to 48px"
    fontWeight: 850
    lineHeight: 1.1
    letterSpacing: "0"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "16px to 19px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px to 14px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "0"
rounded:
  sm: "8px"
  md: "10px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "14px"
  lg: "18px"
  xl: "24px"
  page-x: "clamp(16px, 4vw, 44px)"
  page-y: "clamp(24px, 5vw, 64px)"
components:
  button-primary:
    backgroundColor: "{colors.action-orange}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "40px"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "40px"
  status-chip:
    backgroundColor: "#eef4ea"
    textColor: "{colors.verified-green}"
    rounded: "{rounded.pill}"
    padding: "5px 9px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "clamp(18px, 3vw, 28px)"
  input:
    backgroundColor: "{colors.surface-input}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "12px"
---

# Design System: StudyDeck AI

## 1. Overview

**Creative North Star: "The Guided Study Desk"**

StudyDeck AI should feel like a clean, energetic workspace for a student under deadline: the next action is obvious, the source trail stays visible, and the interface helps the user prepare rather than pretending the work is magically done. The system is familiar product UI first, with just enough color to make workflow state legible.

The current interface is restrained and task-led. Warm neutral backgrounds reduce glare, orange carries primary action, green marks verified progress and status, and purple is reserved for AI/editor power inside generated presentation material. The editor is deliberately darker than the rest of the app so slide work feels like a focused canvas.

It explicitly rejects generic green SaaS styling, childish classroom cartoons, decorative AI gradients, heavy glassmorphism, oversized marketing hero layouts, and interfaces that hide source quality behind polished slides.

**Key Characteristics:**
- Workflow-first composition: prompt, files, plan, editor, script, export.
- Single-family typography with heavy, readable labels and headings.
- Orange action language, green confidence language, purple AI/editor language.
- Mostly flat surfaces with borders; shadow appears only for the dark preview object.
- Compact 8px geometry across cards, controls, editor panels, and slide primitives.

## 2. Colors

The palette is warm-neutral product UI with three functional accents: orange for action, green for verified progress, and purple for AI-powered editing.

### Primary
- **Action Orange**: The primary action color. Use for create, next, generate, loading progress, active wizard steps, and the StudyDeck mark.

### Secondary
- **Verified Green**: The confidence and completion color. Use for status chips, completed step hints, and successful/verified states.
- **AI Purple**: The editor-power color. Use inside slide themes, AI-generated visual accents, speech panels, and moments where the product is shaping study material.

### Neutral
- **Study Canvas**: The app background. It should remain quiet and slightly warm, never saturated enough to read as beige branding.
- **White Surface**: Cards, panels, top-level content containers, and ghost controls.
- **Warm Source Surface**: Secondary panels, slide alternate surfaces, choice buttons, and generated-content blocks.
- **Ink**: Primary text and icon color.
- **Muted Text**: Secondary text, helper copy, slide metadata, and inactive navigation.
- **Divider Line**: Borders, panel outlines, slide boundaries, and input strokes.
- **Editor Dark**: The focused slide-editor workspace.
- **Editor Panel**: Dark rails, speech panels, and editor interior surfaces.

### Named Rules

**The Task Color Rule.** Orange, green, and purple are not decoration. Each color must communicate action, confidence, or AI/editor power.

**The Warm Neutral Ceiling.** The app may be warm, but it must not become a cream SaaS page. Neutral backgrounds stay low-chroma and subordinate to the workflow.

## 3. Typography

**Display Font:** Inter with system sans fallbacks.
**Body Font:** Inter with system sans fallbacks.
**Label/Mono Font:** Inter with system sans fallbacks.

**Character:** The type system is direct and sturdy. Heavy weights make actions and slide structure scannable, while body copy stays plain and readable for long Russian labels and study text.

### Hierarchy
- **Display** (900, 38px to 78px, 0.98 line-height): Landing shell and page-level titles only. Letter spacing stays at 0.
- **Headline** (850 to 950, 26px to 48px, 1.1 line-height): App page headers, wizard prompts, editor titles, and slide headings.
- **Title** (800 to 900, 16px to 26px, 1.2 line-height): Cards, panels, rail headings, export rows, and slide substructures.
- **Body** (400 to 750, 16px to 19px, 1.45 to 1.58 line-height): Helper copy, narration text, slide notes, and generated study material. Prose should stay within roughly 65-75ch where the layout allows.
- **Label** (800 to 850, 12px to 14px, 0 letter-spacing): Navigation, status chips, form labels, wizard steps, and small slide metadata.

### Named Rules

**The Product Sans Rule.** Do not introduce display fonts into controls, labels, data, editor rails, or generated slide chrome. Inter carries the product.

**The Russian Label Rule.** Buttons, chips, and navigation must be sized for long Russian labels without clipping. Use wrapping or wider containers before reducing legibility.

## 4. Elevation

StudyDeck AI is flat by default. Depth is conveyed with tonal layers, dark editor surfaces, borders, and spacing. The only prominent shadow in the current app is the landing workflow preview; it behaves like a product object, not a card decoration.

### Shadow Vocabulary
- **Preview Object** (`box-shadow: 0 18px 42px rgba(21, 25, 20, 0.16)`): Use only for a large preview object that needs to separate from the page background.
- **Inset Slide Frame** (`box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--slide-line) 88%, transparent)`): Use only inside generated slide themes where a frame is part of the slide design.

### Named Rules

**The Flat Workflow Rule.** Panels, cards, inputs, rails, and lists are bordered or tonally layered at rest. Do not add ambient shadows to ordinary UI.

## 5. Components

### Buttons
- **Shape:** Compact rounded rectangles (8px radius), minimum 40px height.
- **Primary:** Action Orange background with Ink text; heavy label; used for start, next, generate, export, and create.
- **Hover / Focus:** Preserve the same vocabulary across routes. Add visible focus rings before adding decorative hover effects.
- **Secondary / Ghost:** White surface with Divider Line border and Ink text; used for back, refresh, pricing, dashboard, and secondary export actions.

### Chips
- **Style:** Pill shape with pale green background and Verified Green text for status and progress.
- **State:** Active wizard steps switch to orange; completed steps keep orange number marks. Inactive steps stay neutral with muted text.

### Cards / Containers
- **Corner Style:** Gently rounded, not soft (8px radius for cards and panels; 10px only for major preview/editor shells).
- **Background:** White Surface for normal containers, Warm Source Surface for generated or secondary content, Editor Dark for the slide workspace.
- **Shadow Strategy:** No shadow on ordinary panels. Use borders and tonal layering.
- **Border:** 1px Divider Line for cards, panels, inputs, slide text panels, and slide canvas frames.
- **Internal Padding:** Cards use 18px; panels use `clamp(18px, 3vw, 28px)`.

### Inputs / Fields
- **Style:** Full-width, 1px Divider Line border, 8px radius, Warm Input Surface background, 12px padding.
- **Focus:** Must be visibly keyboard-focusable. Use a high-contrast outline or border shift that does not move layout.
- **Error / Disabled:** Error panels use pale red background, red border, and dark red text. Disabled controls keep shape and label legibility.

### Navigation
- **Style, typography, default/hover/active states, mobile treatment.** The topbar is sticky, lightly translucent, and bordered. Brand mark is an orange 36px square with an 8px radius. Navigation uses 14px heavy muted text and hides on narrow screens; action buttons remain visible.

### Wizard
- **Style:** Step chips form a compact progression. The selected step has orange border influence and Ink text; completed and active number dots are orange.
- **Behavior:** The wizard should always reveal the next action: topic, slide count, materials, then generation.

### Slide Editor
- **Style:** Dark editor shell with dark rails, a light canvas panel, and a 16:9 slide canvas. Slide selection uses dark buttons with heavy white labels.
- **Behavior:** Speaker notes and generated script remain adjacent to the slide when space allows, then collapse structurally on smaller screens.

### Slide Canvas
- **Style:** Generated slides use their own CSS variables for background, surface, text, muted text, accent, secondary accent, line, and fonts. Layouts are structured and readable, not decorative-only.
- **Behavior:** Visual blocks, comparison boards, definition panels, sequence nodes, and metric tiles use the same 8px geometry as the app so export rendering and web preview stay aligned.

## 6. Do's and Don'ts

### Do:
- **Do** start every screen from the student's next action: create, choose slides, add materials, edit script, review slide, export.
- **Do** use orange only for action and active progress.
- **Do** use green only for verified, completed, ready, or trustworthy states.
- **Do** reserve purple for AI/editor power and generated presentation accents.
- **Do** keep ordinary panels flat with 1px borders and 8px corners.
- **Do** keep source confidence, speaker preparation, and export readiness visible in workflow surfaces.
- **Do** test long Russian labels and small mobile widths before shipping any new control.

### Don't:
- **Don't** use generic green SaaS styling.
- **Don't** add childish classroom cartoons.
- **Don't** add decorative AI gradients.
- **Don't** use heavy glassmorphism.
- **Don't** build oversized marketing hero layouts for authenticated product flows.
- **Don't** hide source quality behind polished slides.
- **Don't** add ambient shadows to cards, panels, or buttons.
- **Don't** use side-stripe borders, gradient text, or repeated identical icon-card grids.
- **Don't** introduce display fonts into controls, labels, data, or editor panels.
