# Plan 02: Quality critic and repair pass

## Goal

Add an automatic quality layer after presentation generation. The worker should detect weak text, generic filler, repeated structures, factual risk, overlong slide text, and boring slide rhythm before saving the presentation.

This plan implements "Что бы я сделал первым" point 2: a quality editor after generation.

## Current project context

- Final presentation normalization happens in `apps/worker/src/tasks/presentation.ts`.
- Existing quality/repair logic already exists around slide text issues. Reuse it instead of replacing it.
- Shared presentation validation lives in `packages/shared/src/index.ts`.
- The user already dislikes generic fallback text and visible text unrelated to the topic.

## Quality dimensions

The critic should evaluate:

1. Text relevance
   - Does each slide talk about the requested topic?
   - Does each slide use the matching narration section?

2. Human style
   - No meta phrases like "на этом слайде".
   - No generic filler like "материал раскрывается через контекст".
   - No repeated formula starts.

3. Slide density
   - Titles are short.
   - Thesis is one sentence.
   - Bullets are short and meaningful.
   - Speaker notes are longer than slide text, not duplicated visible text only.

4. Narrative flow
   - The presentation has a clear beginning, development, and conclusion.
   - Adjacent slides are not duplicates.
   - Final slide contains a topic-specific conclusion.

5. Visual fit
   - Layout matches slide intent.
   - `visual.description` is concrete and searchable.
   - The deck does not use the same layout too many times.

6. Factual safety
   - No unsupported precise facts if sources are thin.
   - Source-derived facts should keep `sourceRefs` where available.

## Shared schema

Add to `packages/shared/src/index.ts`:

```ts
export const qualityIssueSchema = z.object({
  slideId: z.string().optional(),
  severity: z.enum(["blocker", "major", "minor"]),
  category: z.enum([
    "generic_text",
    "off_topic",
    "too_long",
    "duplicate",
    "bad_narration",
    "bad_visual",
    "factual_risk",
    "schema_risk",
  ]),
  field: z.string().optional(),
  message: z.string(),
  repairInstruction: z.string().optional(),
});

export const qualityCritiqueSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string(),
  issues: z.array(qualityIssueSchema),
});
```

## Deterministic checks first

Implement deterministic checks before asking the model.

Create `apps/worker/src/tasks/presentation-quality.ts`.

Recommended functions:

- `findGenericTextIssues(presentation)`
- `findRepeatedTitleIssues(presentation)`
- `findLongSlideTextIssues(presentation)`
- `findNarrationMetaIssues(presentation)`
- `findLayoutRhythmIssues(presentation)`
- `findVisualDescriptionIssues(presentation)`
- `scorePresentationQuality(presentation, issues)`

Keep the banned phrase list in one place. Include Russian variants:

- "на этом слайде"
- "этот слайд"
- "материал раскрывается"
- "главная идея связана"
- "контекст, причины и последствия" when used as filler
- "следующий раздел"
- "переход"
- "опорные пункты"

Use Unicode-aware checks for Cyrillic text. Avoid ASCII-only word boundaries.

## Model critic second

After deterministic checks, call the AI critic only when needed:

- if deterministic score is below threshold;
- if deck is longer than a small number of slides;
- if sources are thin and hallucination risk is higher.

The model critic should return `qualityCritiqueSchema`.

Use YandexGPT for this during development. This is a good use case because the output is structured and smaller than full deck generation.

Prompt rule:

```text
Evaluate the presentation. Do not rewrite it. Return only JSON with score and issues.
```

## Repair strategy

Repair only what is broken.

1. If there are field-level issues:
   - pass only affected slides and issue instructions to the repair model.

2. If there are global issues:
   - repair `outline`, `generatedText`, `speechScript`, and affected slides consistently.

3. Run validation again:
   - `presentationSchema.parse(...)`;
   - deterministic quality checks;
   - optional model critic if needed.

4. Limit repair attempts:
   - max 2 repair passes.
   - if still weak, save the best valid version but attach warnings to logs.

## Integration points

In `apps/worker/src/tasks/presentation.ts`, after current finalization:

```ts
const normalized = normalizePresentation(...);
return improvePresentationQuality(normalized, project, sources, provider);
```

Add:

```ts
export async function improvePresentationQuality(
  presentation: PresentationDocument,
  project: ProjectInput,
  sources: Source[],
  provider: AiGenerationMode | FallbackGenerationMode,
): Promise<PresentationDocument>
```

Do not run model repair for demo fallback unless it is cheap and providers are configured.

## Tests

Add worker tests:

- detects meta phrase in `speakerNotes`;
- detects generic visible title/thesis;
- detects duplicated titles;
- detects overlong bullets;
- repairs only affected slides;
- does not modify valid presentations;
- stops after max repair attempts;
- keeps final presentation schema-valid.

Add snapshots only for small deterministic examples. Avoid brittle full-deck snapshots.

## Logging

Log compact quality results:

- project id;
- provider;
- quality score before repair;
- quality score after repair;
- issue counts by category;
- repair attempts.

Do not log full user source text in production logs.

## Acceptance criteria

- Bad generated visible text is caught before persistence.
- A valid deck with good text passes without unnecessary repair.
- The worker remains provider-neutral.
- YandexGPT can perform critique and repair.
- Existing fallback generation still works.
- Worker tests cover at least generic text, duplicates, long text, and repair.

## Non-goals

- Do not add a user-facing quality score yet.
- Do not block users forever if the model cannot repair a deck.
- Do not remove manual editing; this is pre-save quality improvement, not a replacement for the editor.
