# Plan 03: Stricter structured output for generation

## Goal

Make AI outputs more reliable by using strict structured output for intermediate artifacts and final presentation generation where possible.

This plan implements "Что бы я сделал первым" point 3: improve structured output and schema adherence.

## Current project context

- `packages/shared/src/index.ts` contains Zod schemas and TypeScript types.
- `apps/worker/src/tasks/presentation.ts` builds JSON schema for presentation output.
- OpenAI path uses `text.format` with `json_schema`, currently not fully strict.
- Yandex path parses text returned by the model.
- Yandex AI Studio supports response formatting as JSON and JSON schema for some text models.

## Principle

Use strict schemas for small intermediate artifacts first. Do not start by forcing the entire `PresentationDocument` into one huge strict schema if that causes model failures.

Recommended order:

1. Strict `researchBrief`.
2. Strict `narrativePlan`.
3. Strict `designBrief`.
4. Strict `slideBlueprints`.
5. Less strict final `PresentationDocument`, followed by normalization and repair.
6. Later: strict final document once the schema is simplified enough.

## Schema source of truth

Keep Zod as the source of truth in `packages/shared/src/index.ts`.

Add helpers in worker:

```ts
import { zodToJsonSchema } from "zod-to-json-schema";
```

If the package is not installed, add it only if project conventions allow it. Otherwise create hand-written JSON schemas for the small intermediate artifacts.

Avoid duplicating large schemas manually.

## Yandex implementation

Update `requestYandexText(...)` in `apps/worker/src/tasks/presentation.ts` or extract it to `apps/worker/src/tasks/yandex.ts`.

Add options:

```ts
type YandexTextOptions = {
  jsonObject?: boolean;
  jsonSchema?: unknown;
  temperature?: number;
  maxTokens?: number;
};
```

When `jsonSchema` is provided, send a request with:

```json
{
  "json_schema": {
    "schema": { "...": "..." }
  }
}
```

When only generic JSON is needed, send:

```json
{
  "json_object": true
}
```

Still keep `parseJsonText(...)` and Zod validation after every call. Structured output reduces failures; it does not remove the need for validation.

## OpenAI implementation

Update current OpenAI calls:

- narrative plan generation;
- final presentation generation;
- repair generation;
- future design brief and critique generation.

Use strict mode where supported by the schema:

```ts
text: {
  format: {
    type: "json_schema",
    name: "schema_name",
    strict: true,
    schema,
  },
}
```

If strict mode fails due to schema complexity, keep strict mode for small artifacts and use final normalization for the full deck.

## Retry strategy

Every structured generation call should follow the same pattern:

1. Call model with schema.
2. Parse JSON.
3. Validate with Zod.
4. If validation fails:
   - call repair prompt with validation error summary;
   - retry once or twice;
   - if still invalid, throw a typed error.

Create helper:

```ts
async function generateAndValidate<T>({
  call,
  schema,
  repair,
  maxAttempts = 2,
}: GenerateAndValidateOptions<T>): Promise<T>
```

## Prompt rules

All prompts that expect JSON must say:

- Return only JSON.
- Do not use Markdown.
- Do not add comments.
- Use schema keys exactly.
- Put all user-facing educational text in Russian.

For Yandex specifically, keep explicit prompt wording even when `json_schema` is used.

## Tests

Add tests for:

- Yandex request body includes `json_schema` when schema is passed.
- Yandex request body includes `json_object` for generic JSON.
- OpenAI request uses strict schema for small artifacts.
- invalid JSON is repaired or rejected.
- Zod validation remains the final gate.
- final presentation still passes `presentationSchema`.

Mock external providers; do not call real APIs in tests.

## Migration strategy

1. Add helper without changing behavior.
2. Move narrative plan to helper.
3. Move narration metadata / slide blueprints to helper.
4. Move quality critique to helper.
5. Try final presentation strict mode only after intermediate stages are stable.

This lowers risk and keeps the app usable during development.

## Acceptance criteria

- Intermediate AI outputs are schema-validated before use.
- Yandex provider supports structured JSON requests.
- OpenAI provider still works.
- Full-deck generation has fewer parse/shape failures.
- Existing demo fallback and legacy presentation parsing still work.

## Non-goals

- Do not remove normalization.
- Do not trust provider schema output without Zod validation.
- Do not require database migrations.
