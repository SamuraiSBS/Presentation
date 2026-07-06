# Prompt 01: Vercel AI SDK for structured generation

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Implement Vercel AI SDK only where it improves provider-neutral AI calls for high-quality Russian university presentations. Do not rewrite the entire generation pipeline in one pass.

## Goal

Introduce a thin AI generation adapter based on the Vercel AI SDK so StudyDeck can run structured generation stages more consistently:

- research brief;
- university speech draft;
- slide plan;
- final presentation document;
- optional repair or polish pass.

The main user flow is short Russian topic input without uploaded files. Quality may take longer if the result is stronger.

## Current project context

- Main worker generation lives in `apps/worker/src/tasks/presentation.ts`.
- Search and source preparation live near the worker generation tasks.
- Shared Zod schemas live in `packages/shared/src/index.ts`.
- OpenAI and Yandex are already supported through existing provider code.
- Keep Yandex support intact. If the SDK is first used for OpenAI only, preserve the current Yandex path as a fallback.
- The accepted narration should remain the source of truth after the user approves or edits it.

## Dependencies

Check current official docs before installing.

Likely packages:

```powershell
npm install ai @ai-sdk/openai
```

If package placement matters, keep root workspace dependency conventions consistent with the current repo.

## Implementation steps

1. Find the current provider abstraction and AI call sites in:
   - `apps/worker/src/tasks/presentation.ts`;
   - any OpenAI/Yandex helper files under `apps/worker/src`.

2. Add a small adapter, for example:
   - `apps/worker/src/tasks/ai-provider.ts`;
   - or a focused helper beside existing generation code.

3. Create a provider-neutral function:

```ts
type StructuredGenerationOptions<T> = {
  schemaName: string;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  temperature?: number;
  maxRetries?: number;
};
```

4. For OpenAI, use Vercel AI SDK structured output or object generation.

5. For Yandex, keep the current implementation unless there is a safe SDK-compatible path. Do not remove Yandex behavior.

6. Add stage-specific wrappers only where useful:
   - `generateResearchBrief`;
   - `generateUniversitySpeechDraft`;
   - `generateSlidePlan`;
   - `generatePresentationDocument`;
   - `generateQualityRepair`.

7. Add clear logging for:
   - provider used;
   - schema name;
   - retry count;
   - validation failure reason without leaking API keys or full user content.

8. Keep demo fallback behavior unchanged.

## Prompting rules

All prompts should assume:

- Russian output by default;
- university defense or public speaking style;
- short visible slide text;
- fuller speaker notes;
- no generic template language;
- no unsupported precise claims.

## Tests

Add targeted tests around the adapter using mocked provider calls.

Run:

```powershell
npm run build -w @studydeck/shared
npm run test -w @studydeck/worker
npm run typecheck -w @studydeck/worker
```

If dependencies change:

```powershell
npm run check
```

## Acceptance criteria

- Existing OpenAI/Yandex generation still works.
- New adapter validates model output through Zod.
- OpenAI can use the Vercel AI SDK path.
- Yandex remains supported.
- The final deck contract stays compatible with web, PPTX, and PDF export.

## Non-goals

- Do not replace every generation function at once.
- Do not introduce a chat UI.
- Do not remove current provider env vars.
- Do not weaken validation to make SDK integration easier.

