# Prompt 05: StudyDeck quality score

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Add a richer quality score for Gamma-level university presentations. The current quality gate catches many bad cases; this plan adds positive quality dimensions and uses them to repair weak decks before saving.

## Goal

The worker should evaluate whether a generated deck is actually good, not only whether it avoids forbidden phrases.

Add quality dimensions:

- `speechNaturalness`;
- `universityTone`;
- `slideBrevity`;
- `visualRhythm`;
- `sourceGrounding`;
- `exportReadiness`.

The score should guide repair and logging. It does not need to be shown to users yet.

## Current project context

- Deterministic quality checks live in `apps/worker/src/tasks/presentation-quality.ts`.
- `qualityCritiqueSchema` lives in `packages/shared/src/index.ts`.
- `improvePresentationQuality(...)` already runs after finalization.
- Current repair only runs under narrow conditions.
- Presentation generation finalization happens in `apps/worker/src/tasks/presentation.ts`.

## Suggested schema

Extend quality critique carefully:

```ts
export const qualityDimensionScoreSchema = z.object({
  score: z.number().min(0).max(100),
  reason: z.string().default(""),
});

export const qualityCritiqueSchema = z.object({
  score: z.number().min(0).max(100).default(100),
  summary: z.string().default("No quality issues found."),
  dimensions: z.object({
    speechNaturalness: qualityDimensionScoreSchema,
    universityTone: qualityDimensionScoreSchema,
    slideBrevity: qualityDimensionScoreSchema,
    visualRhythm: qualityDimensionScoreSchema,
    sourceGrounding: qualityDimensionScoreSchema,
    exportReadiness: qualityDimensionScoreSchema,
  }).optional(),
  issues: z.array(qualityIssueSchema).default([]),
  passed: z.boolean().optional(),
});
```

Keep backward compatibility for old documents that only have `score`, `summary`, and `issues`.

## Deterministic dimension checks

Add helper functions:

- `scoreSpeechNaturalness(presentation)`;
- `scoreUniversityTone(presentation, project)`;
- `scoreSlideBrevity(presentation)`;
- `scoreVisualRhythm(presentation)`;
- `scoreSourceGrounding(presentation, sources)`;
- `scoreExportReadiness(presentation)`.

Examples:

- speech naturalness drops for repeated openings, meta phrases, or too-short notes;
- university tone drops for childish labels or school-oriented copy;
- slide brevity drops for long titles, dense bullets, or paragraph blocks;
- visual rhythm drops for repeated layouts or all slides using text-only cards;
- source grounding drops for precise unsupported facts;
- export readiness drops for missing canvas, overflowing text, missing image object keys, or invalid canvas elements.

## Model critic

Use model critique only after deterministic checks, not as the first line of defense.

Prompt the critic to evaluate:

- Can a university student read this aloud naturally?
- Are slides brief enough?
- Does the visual rhythm feel intentionally designed?
- Are claims grounded enough?
- Would export likely preserve the design?

The critic should return structured JSON only.

## Repair behavior

Repair should target the weakest dimensions:

- weak speech: rewrite `speakerNotes` and `speechScript` from accepted narration;
- too dense slides: shorten titles, thesis, bullets, blocks;
- weak visual rhythm: change layouts and visual descriptions, then rebuild canvas;
- weak source grounding: generalize unsupported precise claims;
- export risk: rebuild canvas or remove invalid visual assumptions.

Do not mutate user-edited custom canvas unless explicitly requested.

## Tests

Add tests in `apps/worker/src/tasks/presentation-quality.test.ts`:

- scores a strong university deck high;
- penalizes school-oriented or childish copy;
- penalizes overfilled slide text;
- penalizes repeated visual layout rhythm;
- penalizes missing canvas/export readiness;
- repair keeps schema valid.

Add shared schema tests if changing `qualityCritiqueSchema`.

Run:

```powershell
npm run build -w @studydeck/shared
npm run test -w @studydeck/shared
npm run test -w @studydeck/worker -- src/tasks/presentation-quality.test.ts
npm run typecheck -w @studydeck/worker
```

## Acceptance criteria

- Quality logs show dimension scores.
- Weak decks get targeted repair instructions.
- Good decks pass without unnecessary rewrites.
- Backward compatibility is preserved.

## Non-goals

- Do not show the score in the UI yet.
- Do not block users forever if repair fails.
- Do not make the model critic the only quality gate.

