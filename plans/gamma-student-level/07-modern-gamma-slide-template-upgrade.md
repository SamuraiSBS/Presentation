# Prompt 07: Modern Gamma slide template upgrade

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Implement a new-generation-only visual upgrade for StudyDeck presentations so newly generated decks feel closer to Gamma / modern AI presentations while still fitting student reports, university/school defense, and public speaking.

Do not regenerate, migrate, or visually rewrite old saved presentations. Preserve backward compatibility.

## User-approved direction

The user wants:

- Gamma / modern AI presentation quality.
- Audience/use cases: a student defending a report, a school or university paper, and public speaking.
- A mixed text rhythm:
  - some slides are one strong phrase;
  - some slides have 3-4 short sentences or sentence-like fragments;
  - some slides are mostly a diagram or photo with very little text.
- Automatic mood selection by topic.
- For the first version, only realistic/documentary images. Do not introduce AI-generated illustration as a generated asset path yet.
- Slide text can be a mix of full short sentences and short Gamma-like phrases.
- The result should look cool, but still remain readable and useful for a student who needs to speak from the deck.

## Product principle

Build presentations as a directed speech-first visual story, not as a set of repeated templates.

Visible slides should carry the key idea and visual support. Fuller explanation should remain in `speakerNotes`, `speechScript`, and accepted narration text. Do not make visible slides text-heavy.

## Current project context

- Shared slide/canvas contracts and template generation live in `packages/shared/src/index.ts`.
- `buildSlideCanvas(...)` is the main deterministic canvas engine.
- Design brief generation and layout/image strategy live in `apps/worker/src/tasks/presentation.ts`.
- Quality scoring and deterministic repairs live in `apps/worker/src/tasks/presentation-quality.ts`.
- Normal preview renderer is `apps/web/src/components/slide-template-renderer.tsx`.
- Web-side normalization and display fallbacks live in `apps/web/src/lib/presentation-display.ts`.
- Editable canvas UI is `apps/web/src/components/project-editor.tsx`.
- Export rendering lives in `apps/worker/src/tasks/export.ts`.
- Existing related plans:
  - `plans/gamma-student-level/03-visual-director-2.md`
  - `plans/gamma-student-level/04-web-pptx-pdf-parity.md`
  - `plans/gamma-student-level/05-studydeck-quality-score.md`
  - `plans/gamma-student-level/06-mixed-visual-strategy.md`

## Non-negotiable constraints

- Do not ask the model to output raw CSS, HTML, coordinates, or pixel sizes.
- Keep deterministic canvas generation responsible for actual layout.
- Keep web, editor, PPTX, and PDF aligned.
- Do not overwrite a user-edited custom canvas.
- Keep `layoutHasEnoughContent(...)` or equivalent guardrails before promoting a slide into a content-hungry layout.
- Keep realistic/documentary images only for this version:
  - use `real_photo` when the topic has concrete visual anchors;
  - use `diagram` for abstract, explanatory, process, comparison, cause/effect, and structural slides;
  - use `none` for strong text-led moments;
  - do not add generated illustration behavior yet.
- Do not force images onto every slide.
- Do not weaken quality gates that protect slide brevity, university tone, generic text, source grounding, or export readiness.

## Target deck rhythm

For a typical 6-10 slide deck:

1. Cover / hero:
   - poster-like, strong title, minimal text;
   - realistic photo if the topic has a concrete visual subject;
   - otherwise strong typographic statement.

2. Context:
   - why the topic matters;
   - short Gamma-like text, not a dense paragraph.

3. Explanation / structure:
   - diagram, process, concept map, or split text.

4. Evidence / example:
   - documentary photo, evidence board, quote spread, or comparison.

5. Deeper idea:
   - can be 3-4 short sentences or compact phrases.

6. Final takeaway:
   - no generic "thank you";
   - one strong conclusion plus 2-3 memorable support points.

For shorter decks, preserve the same story roles but compress them.

## Text-density system

Add or implement a deterministic concept like `textDensity` / `sceneTextMode` in the design direction, or derive it from existing fields:

```ts
type SceneTextMode =
  | "hero_phrase"      // one large idea, optional 1-2 tiny chips
  | "talk_sentences"   // 3-4 short sentence-like lines/fragments
  | "visual_labels"    // diagram/photo with concise labels only
  | "takeaway";        // final conclusion plus compact support
```

If adding a schema field is too risky, keep it internal in worker/shared helpers and map from `visualRole`, `layoutIntent`, and slide order.

Rules:

- `hero_phrase`: 1 large idea, 0-2 support chips.
- `talk_sentences`: 3-4 short lines/fragments, each readable at presentation scale.
- `visual_labels`: no paragraph; only labels/captions.
- `takeaway`: final statement plus 2-3 compact support lines.

Do not make every slide use the same text mode.

## Automatic mood selection by topic

Refine theme selection so topic drives mood:

- history, culture, literature, biography: `editorialMagazine` or documentary/editorial mood.
- technology, AI, engineering, physics, cybersecurity: `darkLecture`, tech-clean, or high-contrast science mood.
- biology, ecology, medicine, geography: `scienceBoard` or clean light scientific mood.
- business, economics, startups, marketing: `startupPitch` with strong metrics and contrast.
- general school/university report: `academicClean` or Gamma-clean default.
- dramatic social, war, crisis, disaster, crime, political conflict: documentary/editorial, restrained and serious.

Keep the theme registry deterministic and compatible with `resolveThemeFromDesignBrief(...)` / `resolvePresentationTheme(...)`.

## New or improved slide scene templates

Implement or noticeably improve these deterministic canvas variants in `packages/shared/src/index.ts`.

### 1. Poster hero

For cover/title slides.

Expected feel:

- large title;
- one visual subject or strong typographic scene;
- minimal text;
- optional 1-2 support chips;
- photo can be full-bleed or dominant, with readable wash/overlay.

Avoid:

- centered title card that looks like a default template;
- tiny decorative accents without purpose.

### 2. Documentary split

For concrete topics with realistic images.

Expected feel:

- photo occupies roughly 40-60% of the slide;
- text is compact and large;
- image caption/source is present but unobtrusive;
- crop feels intentional, not like a stock thumbnail in a card.

### 3. Talk slide

For slides with 3-4 short sentences/fragments.

Expected feel:

- one thesis line;
- 3-4 readable text beats;
- no dense bullet wall;
- strong hierarchy between main claim and supporting lines.

### 4. Diagram board

For process, cause/effect, concept map, structure, or system explanation.

Expected feel:

- deterministic shapes, connectors, labels;
- understandable without Mermaid rendering;
- 3-6 nodes maximum where possible;
- labels are concise and presentation-scale.

### 5. Evidence board

For source-grounded or factual slides.

Expected feel:

- one claim;
- 3-4 evidence cards or markers;
- source refs small but preserved;
- should feel like an argument board, not a generic card grid.

### 6. Contrast / comparison slide

For comparisons.

Expected feel:

- two or three large zones;
- clear contrast;
- table fallback only when rows truly matter.

### 7. Quote / key idea spread

For memorable idea, definition, or important quote.

Expected feel:

- oversized quote/thesis;
- little secondary text;
- editorial spacing.

### 8. Final takeaway

For summary slides.

Expected feel:

- strong final conclusion;
- 2-3 compact memory points;
- no generic "thank you" or weak conclusion;
- should help the student end the speech confidently.

## Worker prompt and planning changes

Update `apps/worker/src/tasks/presentation.ts` so generation plans explicitly ask for modern visual rhythm:

- strong cover;
- mixed text modes;
- realistic/documentary photos only when grounded;
- diagrams for explanation-heavy slides;
- compact visible text, richer narration;
- final takeaway without generic closing.

The prompt should not ask for exact layout coordinates. It should ask for art direction, role, image strategy, text density, and visual prompt.

Recommended prompt constraints:

- "Visible slide text should alternate between one strong phrase, 3-4 short sentence-like fragments, and diagram/photo labels."
- "Do not turn every content slide into bullets or cards."
- "Use realistic/documentary image prompts only for concrete visible subjects."
- "Use diagram or none for abstract topics."
- "Keep full explanation in narration/speaker notes."

Update deterministic fallback design brief generation too. Do not rely only on the model path.

## Image strategy rules

For this version:

- `real_photo`: allowed only for concrete subjects, places, objects, people, events, artifacts, documents, environments.
- `diagram`: preferred for abstract, process, structure, comparison, cause/effect.
- `none`: preferred for strong claims, transitions, reflection, final summary, or weakly sourced abstract content.
- `generated_illustration`: keep schema compatibility if it already exists, but do not actively select or implement it for now.

Maintain the existing approximate image band for grounded decks, but make image choice quality-sensitive. A deck with fewer excellent images is better than a deck filled with generic stock-like images.

## Quality gates

Update or extend deterministic checks in `apps/worker/src/tasks/presentation-quality.ts`:

- flag too many adjacent slides with the same `layoutIntent` or same text mode;
- flag visible slide text that becomes a wall of text;
- flag realistic image prompts that are generic, e.g. "educational presentation image";
- flag final slides that end weakly or generically;
- keep export readiness checks for canvas safety.

Do not weaken existing checks for generic text, repeated openings, slide brevity, university tone, source grounding, or export readiness.

## Export and preview parity

Preferred path: put most visual improvements into shared canvas generation so:

- web editor can show the same `slide.canvas`;
- PPTX/PDF export can honor canvas elements;
- preview and export do not drift.

If a non-canvas fallback is changed in `slide-template-renderer.tsx`, mirror the behavior in `apps/worker/src/tasks/export.ts` or document why it is preview-only.

Keep `presentation-display.ts` preserving any new fields added to visual/image/design metadata.

## Tests and verification

Add or update targeted tests where they fit the current repo:

- shared tests for new canvas variants and defensive partial slide handling;
- worker tests for exact slide-count design directions;
- worker tests for mixed text rhythm and no three repeated layouts/text modes;
- worker tests that realistic image prompts are concrete and not generic;
- export tests that new canvas variants do not throw;
- web display tests if new visual fields or display normalization change.

Suggested commands:

```powershell
npm run build -w @studydeck/shared
npm run test -w @studydeck/shared
npm run test -w @studydeck/worker -- src/tasks/presentation.test.ts
npm run test -w @studydeck/worker -- src/tasks/presentation-quality.test.ts
npm run test -w @studydeck/worker -- src/tasks/export.test.ts
npm run typecheck -w @studydeck/web
```

If shared contracts changed, rebuild `@studydeck/shared` before trusting worker or web typecheck/test failures.

## Runtime verification

If the implementation changes only worker/shared generation logic, rebuild/restart the narrowest affected Docker services for production-like localhost verification.

For worker/shared generation changes, prefer:

```powershell
$services = @("worker")
docker compose build @services
docker compose up -d @services
```

If web preview or editor files changed, use the fast web preview workflow:

```powershell
npm run dev:web:fast
```

Verify visually with a newly generated project. Use a topic that has concrete visual anchors and a topic that is abstract:

- concrete/documentary example: "История строительства Берлинской стены"
- abstract/diagram example: "Причины инфляции простыми словами"
- science example: "Фотосинтез и его роль в экосистеме"

Inspect:

- cover strength;
- mixed slide rhythm;
- text density;
- image concreteness;
- diagram usefulness;
- final takeaway;
- export safety if PPTX/PDF code changed.

## Acceptance criteria

- New generated decks look closer to modern Gamma-style presentations.
- Slide rhythm alternates between phrase-led, short-talk, diagram/photo, evidence/comparison, and takeaway scenes.
- Realistic/documentary images are used only when they are concrete and useful.
- Abstract slides prefer diagrams or strong text, not random photos.
- Visible text is not too dense, but some slides can contain 3-4 short sentence-like fragments.
- Narration remains fuller than visible slide text.
- The final slide has a strong conclusion, not a generic closing.
- Web preview, editor, PPTX, and PDF remain aligned.
- Existing saved decks remain readable and are not unexpectedly redesigned.

## Non-goals

- Do not implement AI-generated illustrations yet.
- Do not add a full visual design editor.
- Do not redesign old stored presentations.
- Do not add raw model-generated CSS/HTML/coordinates.
- Do not make every slide a card grid, every slide a photo, or every slide a paragraph.

