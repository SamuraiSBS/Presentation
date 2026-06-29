# Prompt 02: University speech director

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Implement a speech-quality layer for university-student presentations. The goal is to make the student sound natural, prepared, and professional while keeping slide text short.

## Goal

Generated speech should feel like a good university student presenting:

- clear and confident;
- easy to read aloud;
- professional but not bureaucratic;
- concrete and topic-specific;
- structured as a connected report;
- free from meta phrases about slides or presentation mechanics.

The visible slide text should remain short. The speech belongs in `speakerNotes`, `speechScript`, and accepted narration.

## Current project context

- Narration draft generation is in `apps/worker/src/tasks/presentation.ts`.
- Final generation from accepted narration is in `generatePresentationFromNarration(...)`.
- The two-step flow is already implemented:
  - narration draft;
  - user review/edit;
  - final deck generation.
- Quality repair lives in `apps/worker/src/tasks/presentation-quality.ts`.
- Existing deterministic checks already reject many generic phrases.
- The accepted narration must remain the final deck source of truth.

## New artifact

Add an internal `SpeechBrief` or equivalent helper. It does not need to be stored in Prisma.

Suggested shape:

```ts
const speechBriefSchema = z.object({
  audience: z.literal("university_student"),
  tone: z.literal("easy_professional"),
  sentenceStyle: z.enum(["clear_varied"]),
  slideNarrationSentences: z.object({
    min: z.literal(5),
    max: z.literal(6),
  }),
  forbiddenPatterns: z.array(z.string()),
  requiredQualities: z.array(z.string()),
});
```

Use this as prompt structure and testable generation context.

## Speech rules

Each slide narration must:

- contain 5-6 complete sentences;
- explain the real topic, not the slide object;
- include one concrete detail, example, reason, consequence, contrast, or definition;
- use varied sentence openings;
- avoid repeated first or last sentences across neighboring slides;
- sound like oral Russian, not an abstract essay.

Forbidden phrases include:

- "на этом слайде";
- "этот слайд";
- "следующий раздел";
- "переход";
- "рассказ про тему";
- "главная мысль связана";
- "материал раскрывается";
- "опорные пункты";
- generic endings like "так становится понятнее, почему тема важна".

## Implementation steps

1. Add a small speech brief builder in `apps/worker/src/tasks/presentation.ts`.
   - Example: `buildSpeechBrief(project)`.
   - It should always return university-student settings for now.

2. Feed the speech brief into:
   - `buildNarrationPrompt(...)`;
   - `buildNarrationRepairPrompt(...)`;
   - `buildGenerationPrompt(...)`.

3. Strengthen `normalizeNarrationText(...)` and related repair helpers only if needed.
   - Do not weaken the 5-6 sentence quality gate.
   - Repair overlong narration deterministically when structure is valid.

4. Add positive speech checks in `apps/worker/src/tasks/presentation-quality.ts`.
   - Detect too many formulaic openings.
   - Detect notes that are technically valid but too generic.
   - Detect final slides without a human university-level conclusion.

5. Keep web display sanitization as a fallback only.
   - Do not rely on `apps/web/src/lib/presentation-display.ts` to hide bad speech that should be fixed in worker.

## Tests

Add or update worker tests:

- narration prompt includes university student and easy professional speech;
- generated/normalized narration has 5-6 sentences per slide;
- rejected narration contains meta slide phrases;
- repeated openings or endings are repairable only when there is enough real content;
- final `speakerNotes` and `speechScript` mirror the accepted narration.

Run:

```powershell
npm run test -w @studydeck/worker -- src/tasks/presentation.test.ts
npm run test -w @studydeck/worker -- src/tasks/presentation-quality.test.ts
npm run typecheck -w @studydeck/worker
```

## Acceptance criteria

- Speech sounds like a prepared university student, not a generic AI outline.
- Slide text remains short and does not absorb the full explanation.
- `speakerNotes`, `speechScript`, and `generatedText` stay aligned.
- The system still fails loudly on broken narration structure.

## Non-goals

- Do not add multiple voice presets yet.
- Do not expose a speech editor redesign in this plan.
- Do not generate long paragraphs on slides.

