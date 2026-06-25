# Plan 05: Design brief and layout engine

## Goal

Improve presentation visuals by adding a design-direction layer. The AI should act as an art director, while deterministic code builds the final `slideCanvas`.

This plan implements the section "Для более крутого оформления".

## Current project context

- Shared slide/canvas contracts live in `packages/shared/src/index.ts`.
- Canvas generation is centered around `ensureEditableCanvas(...)` and `buildSlideCanvas(...)`.
- Normal preview uses `SlideTemplatePreview` in `apps/web/src/components/slide-template-renderer.tsx`.
- Export rendering lives in `apps/worker/src/tasks/export.ts`.
- Existing generated slide visuals must not regress.

## Core principle

Do not ask the model to generate raw CSS, HTML, or exact coordinates.

Ask the model for:

- style direction;
- theme;
- rhythm;
- slide visual intent;
- image strategy;
- density;
- mood.

Then deterministic code maps those decisions to:

- `presentationTheme`;
- slide layouts;
- canvas elements;
- image placement;
- color tokens;
- export rendering.

## New artifact: `DesignBrief`

Add schema in `packages/shared/src/index.ts`:

```ts
export const designBriefSchema = z.object({
  themeId: z.string(),
  mood: z.enum(["dark", "light", "playful", "serious", "neutral"]),
  audienceFit: z.string(),
  visualMetaphor: z.string(),
  colorIntent: z.string(),
  typographyIntent: z.string(),
  rhythm: z.object({
    titleStyle: z.enum(["bold", "quiet", "editorial", "academic"]),
    density: z.enum(["low", "medium", "high"]),
    imageFrequency: z.enum(["rare", "balanced", "frequent"]),
    sectionBreaks: z.boolean(),
  }),
  slideDirections: z.array(z.object({
    slideOrder: z.number().int().positive(),
    visualRole: z.enum(["hero", "explain", "compare", "sequence", "evidence", "reflect", "summary"]),
    layoutIntent: z.enum(["full_bleed_image", "split_image_text", "statement", "cards", "timeline", "diagram", "metric", "summary"]),
    imageStrategy: z.enum(["real_photo", "generated_illustration", "diagram", "none"]),
    visualPrompt: z.string(),
  })),
});
```

Use stable `themeId` values from the premium themes plan.

## Worker implementation

Add function:

```ts
async function generateDesignBrief(
  project: ProjectInput,
  sources: Source[],
  deckStory: DeckStory,
  slideTextPlans: SlideTextPlan[],
): Promise<DesignBrief>
```

Call it before final `PresentationDocument` generation.

Pass design brief into:

- slide layout choice;
- visual description generation;
- image search/generation strategy;
- `presentationTheme` resolution.

## Shared theme mapping

Create deterministic theme registry:

```ts
export const PREMIUM_PRESENTATION_THEMES = {
  editorialMagazine: { ... },
  academicClean: { ... },
  darkLecture: { ... },
};
```

Add helper:

```ts
export function resolveThemeFromDesignBrief(brief: DesignBrief): PresentationTheme
```

Keep current theme presets working for old documents.

## Layout engine changes

Update `buildSlideCanvas(slide, theme)` so it can use:

- `presentation.presentationTheme`;
- `slide.layout`;
- `slide.visual.type`;
- optional `slide.designDirection` if added.

Recommended additions:

- stronger hero slide variants;
- editorial full-bleed image title slide;
- split image/text content slide;
- clean card grid slide;
- timeline with stronger date markers;
- visual quote/statement slide;
- summary slide with final conclusion block.

Avoid making old generated slides look different unless they are regenerated.

## Schema extension options

Option A: Store design info deck-level only.

```ts
presentation.designBrief?: DesignBrief
```

Option B: Store minimal per-slide design hints.

```ts
slide.design?: {
  visualRole: string;
  layoutIntent: string;
  imageStrategy: string;
}
```

Recommended: start with Option A, derive per-slide behavior from `designBrief.slideDirections` by slide order.

## Image strategy

Add image strategy field in generated slide directions:

- `real_photo`: use Tavily image search and MinIO download.
- `generated_illustration`: use future YandexART/OpenAI image generation.
- `diagram`: use code-rendered diagram/card/timeline.
- `none`: text-focused slide.

Do not implement image generation in this plan unless requested. Prepare the field and keep Tavily path working.

## Export alignment

Any visual style visible in web preview should also export to PPTX/PDF.

Update:

- `apps/web/src/components/slide-template-renderer.tsx`
- `apps/worker/src/tasks/export.ts`
- `packages/shared/src/index.ts`

Keep renderer logic shared where practical. If duplicate rendering is unavoidable, add tests for the same layout categories.

## Tests

Shared tests:

- theme registry returns valid `PresentationTheme`;
- old presentation without `designBrief` still works;
- `buildSlideCanvas` handles partial slide data defensively;
- premium theme palettes validate as hex colors.

Worker tests:

- design brief is generated with exact slide count directions;
- layout choice follows design brief;
- image strategy is preserved;
- export does not throw for premium-themed deck.

Web tests if available:

- preview renders premium theme deck;
- old demo deck still looks like legacy template preview.

## Acceptance criteria

- AI produces design direction, not raw layout code.
- Deterministic code maps design direction to stable canvas output.
- Existing presentations remain compatible.
- Web preview and export stay aligned.
- Premium theme selection is visible in generated decks.

## Non-goals

- Do not add a full design editor.
- Do not make every slide use images.
- Do not change existing saved decks unexpectedly.
- Do not depend on generated images before the image pipeline is ready.
