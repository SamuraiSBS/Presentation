# Plan 04: Better text quality pipeline

## Goal

Improve the actual educational writing: less generic text, stronger narrative, better Russian, clearer slide text, and more useful speaker notes.

This plan implements the section "Для качества текста".

## Current project context

- The product already generates a narration draft first and routes the user to review/edit it.
- The final deck should use the accepted narration as the source of truth.
- The worker already tries to avoid visible filler text in prompts.
- The user wants presentations to feel like real school/college reports, not generic AI summaries.

## Text model

Every generated deck should have a clear content spine:

1. Main idea of the whole presentation.
2. Audience question.
3. Slide-by-slide answer path.
4. Concrete examples/facts.
5. Human conclusion.

Do not generate slides directly from the raw user prompt. Generate a story first, then compress it into slides.

## New artifact: `DeckStory`

Add schema in `packages/shared/src/index.ts`:

```ts
export const deckStorySchema = z.object({
  mainIdea: z.string(),
  audienceQuestion: z.string(),
  tone: z.enum(["school_report", "college_report", "exam_explanation", "teacher_explainer"]),
  chapters: z.array(z.object({
    title: z.string(),
    purpose: z.string(),
    slideOrders: z.array(z.number().int().positive()),
  })),
  conclusion: z.string(),
});
```

This can be internal first; it does not need to be displayed in the UI.

## Per-slide text structure

For each slide, generate:

- `slideQuestion`: what this slide answers.
- `coreClaim`: one complete claim.
- `evidenceOrExample`: concrete detail, if available.
- `listenerTakeaway`: what the listener should remember.
- `visibleText`: short title/thesis/bullets.
- `speakerNotes`: 5-6 sentence report-style text.

Add internal schema:

```ts
export const slideTextPlanSchema = z.object({
  slideOrder: z.number(),
  slideQuestion: z.string(),
  coreClaim: z.string(),
  evidenceOrExample: z.string().default(""),
  listenerTakeaway: z.string(),
  title: z.string(),
  thesis: z.string(),
  bullets: z.array(z.string()).max(3),
  speakerNotes: z.string(),
});
```

## Prompt strategy

Use a three-pass text generation flow:

1. `generateDeckStory(...)`
   - Creates main idea, audience question, chapters, conclusion.

2. `generateSlideTextPlans(...)`
   - Creates per-slide semantic plans.
   - Does not choose final design yet.

3. `compressVisibleSlideText(...)`
   - Converts slide text plan into short visible text.
   - Keeps speaker notes rich and human.

## Style rules

Visible slide text:

- title: ideally 4-8 words;
- thesis: one sentence;
- bullets: 0-3 short phrases;
- no meta phrases;
- no markdown;
- no source names;
- no generic placeholders.

Speaker notes:

- Russian, calm, natural;
- 5-6 sentences per slide;
- no "на этом слайде";
- no "следующий раздел";
- no repeated formula openings;
- uses concrete facts from sources when available;
- if facts are thin, explains cautiously instead of inventing.

## Deterministic text checks

Add checks in `apps/worker/src/tasks/presentation-quality.ts`:

- `isGenericTitle(title)`
- `hasMetaSlideLanguage(text)`
- `hasRepeatedSentenceStart(texts)`
- `hasUnsupportedSpecificity(text, sources)`
- `isVisibleTextTooLong(slide)`
- `hasWeakConclusion(slide, project)`

## User review integration

The existing `/projects/[id]/script` review page should remain the main acceptance gate.

Optional later improvement:

- show AI suggestions for improving the draft;
- let user pick "more formal", "simpler", "more vivid";
- save revised draft before final deck generation.

Do not block this plan on UI changes.

## YandexGPT usage

Recommended model split during development:

- YandexGPT Pro 5.1 or Alice AI LLM:
  - `DeckStory`;
  - narration draft;
  - slide text plans.

- YandexGPT Lite:
  - small checks;
  - title shortening;
  - simple classification after quality is verified.

Keep provider config flexible through env:

- `YANDEX_MODEL_URI`
- `YANDEX_MODEL_NAME`
- optional future envs:
  - `YANDEX_TEXT_MODEL_URI`
  - `YANDEX_CRITIC_MODEL_URI`
  - `YANDEX_FAST_MODEL_URI`

## Tests

Add tests:

- generated text plan maps to exact slide count;
- visible text is shorter than speaker notes;
- no banned phrases pass deterministic checks;
- final slide has topic-specific conclusion;
- source-thin projects do not invent fake precise facts;
- accepted edited narration remains the source of truth.

## Acceptance criteria

- Generated decks read like a connected report.
- Slide text is compact and meaningful.
- Speaker notes are human and topic-specific.
- The final deck is generated from accepted narration, not from a separate story.
- Existing API flow remains unchanged for the user.

## Non-goals

- Do not add citations into visible slide text.
- Do not force all presentations into the same essay style.
- Do not generate long paragraphs on slides.
