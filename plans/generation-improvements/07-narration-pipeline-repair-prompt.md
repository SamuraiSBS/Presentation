# Narration Pipeline Repair Prompt

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Fix the Yandex presentation-generation failure where final generation stops with errors like:

```text
AI presentation generation failed. yandex: AI generation quality check failed:
slide 1 must have 5-6 narration sentences, got 17;
slide 2 must have 5-6 narration sentences, got 11;
...
speakerNotes must have 5-6 sentences;
speechScript must have 5-6 sentences;
neighboring slides are too similar
```

The goal is not to weaken the quality gate. The goal is to make the worker recover when Yandex produces overlong, repetitive narration.

Implement these four changes:

1. Strengthen narration draft generation and validation.
   - Work mainly in `apps/worker/src/tasks/presentation.ts`.
   - Find the narration draft generation path, final presentation generation path, and existing helpers around `parseNarrationSections`, `validateNarrationSections`, `assertPresentationQuality`, and local narration repair.
   - Make the prompt and validation flow stricter about one narration section per slide.
   - Each slide narration section must contain exactly 5-6 sentences.
   - The model must not copy or paraphrase the user's request as slide content.
   - The model must not use repeated first or last sentences across neighboring slides.
   - The model must not use generic meta phrases like "рассказ про", "что стоит понять сначала", "главный вывод по теме", or similar placeholder formulas.

2. Add local narration compression before final presentation assembly.
   - If all slide sections exist and are in the correct order, but a section has more than 6 sentences, repair it locally before failing.
   - Compress each section to 5-6 useful sentences.
   - Prefer concrete topic sentences over meta-structural sentences.
   - Remove repeated prompt fragments, repeated openings, repeated endings, and generic filler.
   - Preserve the slide title and the core subject of the section.
   - The repaired narration must become the single source of truth for `generatedText`, `speakerNotes`, and `speechScript`.

3. Make presentation-quality repair handle overlong narration safely.
   - Inspect `isRepairablePresentationQualityError(...)`.
   - Do not blindly mark missing slides, missing sections, malformed slide order, or empty text as repairable.
   - Treat "must have 5-6 narration sentences", "speakerNotes must have 5-6 sentences", and "speechScript must have 5-6 sentences" as repairable only when:
     - all requested slides exist;
     - parsed narration sections match the requested slide count;
     - each section has enough usable text to compress;
     - the repair result passes `validateNarrationSections(...)` and `assertPresentationQuality(...)`.
   - After repair, rerun the same quality checks. If the repaired document still fails, keep throwing the quality error.

4. Add regression tests for the real failure mode.
   - Add tests in `apps/worker/src/tasks/presentation.test.ts`.
   - Create a fixture where Yandex returns 14 narration sections, but many sections contain 9-17 sentences and repeated formula starts/endings.
   - Assert that the worker repairs the narration to 5-6 sentences per slide.
   - Assert that `generatedText`, every slide's `speakerNotes`, and every `speechScript` item all satisfy the 5-6 sentence rule.
   - Assert that repeated neighboring openings/endings are removed.
   - Keep tests deterministic and avoid network-dependent behavior.

Constraints:

- Preserve the strict quality gate. Do not remove checks just to make the job pass.
- Keep the change scoped to worker generation/repair behavior unless shared contracts genuinely need an update.
- Do not change legacy root MVP files.
- Do not commit generated TypeScript build info.
- Be careful with existing uncommitted changes. Do not revert unrelated files.

Verification:

```powershell
npm run test -w @studydeck/worker -- src/tasks/presentation.test.ts
npm run typecheck -w @studydeck/worker
```

If `packages/shared` was changed, also run:

```powershell
npm run build -w @studydeck/shared
npm run test -w @studydeck/shared
```

Expected result:

- Overlong but structurally complete narration no longer fails immediately.
- The worker repairs it to valid 5-6 sentence narration per slide.
- The final presentation still fails when the model output is structurally broken or too thin to repair.
