# Plan 01: Multi-role generation pipeline

## Goal

Split presentation generation into explicit specialist stages instead of relying on one large prompt to produce the final deck. The system should be able to use YandexGPT as the main development provider while keeping the existing OpenAI/Yandex provider abstraction.

This plan implements the idea from "Что бы я сделал первым" point 1: researcher, story planner, writer, slide editor, design director, and critic.

## Current project context

- Main generation logic lives in `apps/worker/src/tasks/presentation.ts`.
- Job orchestration lives in `apps/worker/src/tasks/generation.ts`.
- Shared contracts live in `packages/shared/src/index.ts`.
- Project generation already has a two-step flow:
  - narration draft generation;
  - user review/edit;
  - final presentation generation from accepted narration.
- The final deck is validated by `presentationSchema`.
- Yandex generation currently uses `requestYandexText(...)`.
- OpenAI generation currently uses Responses API with JSON schema formatting.

## Target architecture

Add a staged pipeline:

1. `researchBrief`
   - Input: project, sources.
   - Output: factual summary, key facts, missing-context warnings, suggested angle.

2. `narrativePlan`
   - Input: project, sources, researchBrief.
   - Output: slide-by-slide story plan.

3. `narrationDraft`
   - Input: project, researchBrief, narrativePlan.
   - Output: user-editable Russian speech draft.

4. `designBrief`
   - Input: project, researchBrief, narrativePlan.
   - Output: deck-level visual direction. Detailed implementation is covered in `05-design-brief-and-layout-engine.md`.

5. `slideBlueprints`
   - Input: accepted narrationDraft, narrativePlan, designBrief.
   - Output: per-slide intent: purpose, title, visual strategy, layout candidate, text density.

6. `presentationDocument`
   - Input: accepted narrationDraft, slideBlueprints, designBrief.
   - Output: final `PresentationDocument`.

7. `qualityCritique`
   - Input: final document.
   - Output: structured issues and optional repair instructions. Detailed implementation is covered in `02-quality-critic-and-repair-pass.md`.

## Shared contracts to add

In `packages/shared/src/index.ts`, add schemas and types:

- `researchBriefSchema`
- `slideNarrativeSchema` if the existing narrative type is not exported cleanly enough.
- `designBriefSchema`
- `slideBlueprintSchema`
- `qualityCritiqueSchema`
- `generationPipelineArtifactsSchema`

Suggested shape:

```ts
export const researchBriefSchema = z.object({
  topic: z.string(),
  angle: z.string(),
  facts: z.array(z.object({
    text: z.string(),
    sourceId: z.string().optional(),
    confidence: z.enum(["high", "medium", "low"]).default("medium"),
  })),
  warnings: z.array(z.string()).default([]),
  vocabulary: z.array(z.object({
    term: z.string(),
    explanation: z.string(),
  })).default([]),
});
```

Keep schemas small and composable. Avoid one giant schema for all intermediate states.

## Worker implementation steps

1. Create generation-stage helpers in `apps/worker/src/tasks/presentation.ts` or split into a new file:
   - `apps/worker/src/tasks/presentation-pipeline.ts`
   - `apps/worker/src/tasks/presentation-prompts.ts`
   - `apps/worker/src/tasks/presentation-quality.ts`

2. Implement provider-neutral function:

```ts
async function generateStructuredWithProvider<T>({
  provider,
  system,
  prompt,
  schema,
  schemaName,
  parse,
}: GenerateStructuredOptions<T>): Promise<T>
```

3. For OpenAI:
   - use JSON schema / structured output as already done;
   - prefer strict schema where possible.

4. For Yandex:
   - use Yandex structured output (`json_schema`) when available in `requestYandexText`;
   - otherwise use prompt + `parseJsonText` + Zod validation + repair retry.

5. Replace direct calls inside:
   - `generateNarrationDraft(...)`;
   - `generatePresentationFromNarration(...)`;
   - legacy `generateWithOpenAI(...)` / `generateWithYandex(...)` if still used.

6. Save artifacts in memory during job execution first.
   - Do not add DB columns in the first pass unless the UI needs to display them.
   - The final presentation JSON can include stable fields already supported by `presentationSchema`.

7. Keep demo fallback intact.
   - If AI providers fail and demo generation is allowed, current demo behavior should continue.

## Prompting rules

Each stage prompt should be short and specific.

Bad:

```text
Create a full presentation with everything...
```

Better:

```text
Create only the research brief. Do not write slide text yet. Return JSON matching the schema.
```

Use Russian for generated educational content, but schema keys should remain English.

## Yandex-specific notes

- Use `YandexGPT Pro 5.1` or explicit `YANDEX_MODEL_URI` for main generation.
- Use a cheaper/faster model only for small classification or critique tasks after testing quality.
- Because model lifecycle can change, avoid hardcoding `latest` where a specific URI is more stable.

## Tests

Add or update tests in `apps/worker/src/tasks/presentation.test.ts`:

- pipeline calls stages in the expected order;
- Yandex provider can parse structured stage output;
- invalid stage JSON triggers repair or fallback;
- generated presentation still validates with `presentationSchema`;
- demo fallback still works with no configured provider.

Add tests in `packages/shared/src/index.test.ts`:

- new schemas accept minimal valid objects;
- new schemas reject missing required fields;
- older presentations still validate.

## Acceptance criteria

- The final public behavior stays the same: user creates project, reviews narration, then generates deck.
- Internally the worker uses staged artifacts.
- YandexGPT can run the whole flow without OpenAI.
- OpenAI path still works.
- Existing presentations remain readable.
- `npm run test -w @studydeck/worker` passes.
- `npm run typecheck -w @studydeck/worker` passes.

## Non-goals

- Do not redesign the editor UI in this plan.
- Do not introduce LangChain/CrewAI unless there is a strong reason.
- Do not store every intermediate artifact in Prisma yet.
- Do not remove OpenAI provider support.
