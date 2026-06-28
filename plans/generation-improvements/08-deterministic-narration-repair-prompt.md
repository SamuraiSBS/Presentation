# Deterministic Narration Repair Prompt

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Implement a deterministic local repair layer for overlong and repetitive slide narration in `apps/worker/src/tasks/presentation.ts`.

This repair must not call an AI model. It must be deterministic, testable, and safe.

Problem:

Yandex sometimes returns valid slide sections, but each section contains too many sentences and repeats generic formulas. The quality gate rejects this with errors such as:

```text
slide 1 must have 5-6 narration sentences, got 17
slide 2 must have 5-6 narration sentences, got 11
adjacent narration sections repeat opening sentence
adjacent narration sections repeat closing sentence
narration sections repeat opening phrase
narration sections repeat closing phrase
speakerNotes must have 5-6 sentences
speechScript must have 5-6 sentences
neighboring slides are too similar
```

Add a deterministic repair function that can turn structurally complete but overlong narration into valid narration.

Suggested design:

1. Add a helper near the existing narration helpers:

```ts
function repairNarrationSections(sections: NarrationSection[], project: ProjectInput): NarrationSection[]
```

or use a more appropriate local name that matches existing style.

2. The helper should only repair when it is safe:
   - `sections.length === project.slideCount`;
   - section orders are `1..project.slideCount`;
   - every section has a non-empty title;
   - every section has at least 5 usable sentences after filtering.

3. Split section text with the existing sentence helpers if available:
   - Prefer `speechSentences(...)` or the current local sentence parser over creating a new parser.
   - Keep behavior aligned with `sentenceCount(...)`.

4. Filter bad sentences before selecting the final 5-6:
   - Remove sentences that copy the user's task instead of explaining the topic.
   - Remove sentences with generic meta formulas, including Russian patterns like:
     - `рассказ про`
     - `также рассказать`
     - `что стоит понять сначала`
     - `главный вывод по теме`
     - `важно запомнить`
     - `следующая часть`
     - `раздел`
     - `слайд`
     - `презентация`
   - Remove exact duplicate normalized sentences.
   - Remove sentences that are nearly only topic/request restatement.

5. Select the repaired section body deterministically:
   - Keep the first strong concrete sentence if it is not a repeated opening.
   - Prefer sentences with concrete subject terms, numbers, names, causes, consequences, examples, dates, definitions, or comparisons.
   - Avoid using the same normalized opening as the previous repaired section.
   - Avoid using the same normalized closing as the previous repaired section.
   - Return 5 sentences by default.
   - Return 6 only if the sixth adds useful concrete detail and does not repeat the opening/closing pattern.

6. If filtering leaves fewer than 5 sentences:
   - Try a second pass with less aggressive filtering.
   - Still remove exact duplicates and obvious prompt-copy sentences.
   - If there are still fewer than 5 usable sentences, do not fabricate content. Return the original sections or signal repair failure so the existing quality gate can throw.

7. Rebuild all narration-dependent fields from the repaired sections:
   - `generatedText` must be regenerated from repaired sections.
   - `slide.speakerNotes` must match the repaired section body for the same slide.
   - `speechScript[item].text` must match the repaired section body for the same slide.
   - Keep slide titles and visible slide content intact unless existing code already derives them from narration.

8. Integrate the repair before final quality failure:
   - When `assertPresentationQuality(...)` finds only repairable narration-length/repetition issues, run deterministic repair and validate again.
   - Do not bypass validation.
   - If validation still fails, throw the original or updated quality error.

Add tests:

1. Repairs 14 overlong sections to 5-6 sentences each.
2. Removes repeated openings and closings between neighboring sections.
3. Updates `generatedText`, `speakerNotes`, and `speechScript` consistently.
4. Refuses to repair missing sections or sections with fewer than 5 usable sentences.
5. Does not alter demo-mode fallback behavior.

Verification:

```powershell
npm run test -w @studydeck/worker -- src/tasks/presentation.test.ts
npm run typecheck -w @studydeck/worker
```

Acceptance criteria:

- The real Mercedes/Yandex-style failure with 14 structurally present but overlong sections becomes repairable.
- The final saved presentation still has exactly 5-6 narration sentences per slide.
- No quality checks are removed.
- Broken structure still fails loudly.
