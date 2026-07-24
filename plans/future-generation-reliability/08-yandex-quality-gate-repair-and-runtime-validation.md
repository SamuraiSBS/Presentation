# 08 — Yandex quality-gate repair and runtime validation

## Scope

Implement only this prompt in a new Codex chat, after plans 01–07. A fresh UTF-8 Saturn runtime test reached `building_slides`; a later schema-valid Yandex document was rejected by the existing release gate for `duplicate`, `bad_visual`, and `bad_narration`. Fix upstream generation normalization and repair so grounded, recoverable Yandex output can pass the existing gate. Do **not** weaken, bypass, reclassify, or silence `productionQualityReleaseResult(...)`.

Never edit, retry, or delete `cmrvw6e54000hmq0joh02cprf`, `cmrwdh1ig0003l90jpd2c119u`, `cmrwenx810009l90jkh5osuuz`, `cmrwf2bst000fl90jmybxo4zc`, `cmrwg1mpi000nl90jlre6fjzm`, or `cmrwg8hh0000vl90jc50dgipz`. Preserve custom canvases, old revisions, safe public errors, Yandex-only selection, and job-status semantics. Do not add OpenAI/demo fallback or a new queue.

## Required reading

Read `AGENTS.md`, root `README.md`, package `README.md`, plans 01–07, and run `git status --short`. Then trace raw Yandex output through:

- `apps/worker/src/tasks/presentation/providers/generation.ts`
- `apps/worker/src/tasks/presentation/prompts/builders.ts`
- `apps/worker/src/tasks/presentation/normalization/presentation.ts`
- `apps/worker/src/tasks/presentation/quality/orchestration.ts`
- `apps/worker/src/tasks/presentation-quality.ts`
- `apps/worker/src/tasks/generation.ts`
- focused files: `presentation.test.ts`, `presentation-quality.test.ts`, `generation.test.ts`.

Identify the real callers for `duplicate`, `bad_visual`, and `bad_narration`; do not infer behavior from category names.

## Required behavior

- Accepted narration remains canonical in `generatedText`, `speakerNotes`, and `speechScript` according to the existing contract.
- Normalize harmless provider visual aliases (such as `diagram`) to valid shared visual types. Unknown aliases become a conservative grounded fallback or `none`; invalid visual data must not reach quality inspection.
- The existing deterministic visual fallback must output schema-valid, meaningful data and must not create duplicated visible text.
- Extend existing duplicate/fragment repair only. Derive a distinct compact point from matching accepted narration, narrative plan, or accepted source. If unavailable, remove the redundant slot or choose a compatible layout. Never invent facts or rewrite unaffected slides.
- Fix the actual local source of `bad_narration`, preserving sentence boundaries and section mapping. Do not accept generic/template narration.
- Run the same final release gate after every repair. Irreparable output still fails safely with no revision or partial document.

## Implementation sequence

1. Add compact, no-network Saturn-like fixtures covering a raw `diagram` alias, duplicate visible support text, weak visual data, and accepted 10-section narration.
2. Extend the existing `normalizeVisual(...)` seam to normalize aliases and remove incompatible payloads.
3. Repair `applyVisualPlanFallbacks(...)` and its callers so repaired slides are normalized again and pass the shared visual schema.
4. Extend deterministic visible-text/narration repair for the actual reported defects while preserving canonical narration.
5. Ensure `finalizeGeneratedPresentation(...)` returns only a release-gate-approved document or throws.
6. Do not change persistence ordering, gate thresholds, or status/error contracts.

## Tests and acceptance

Add focused tests proving known aliases normalize, unknown values cannot remain, visual fallback leaves no invalid payload, duplicate text is grounded-repaired or removed, narration adds no facts, a valid Yandex Saturn fixture passes `productionQualityReleaseResult(...)`, an irreparable fixture leaves revision `0`, and custom canvas fixtures remain untouched.

Run these commands: worker tests for `presentation-quality.test.ts`, `presentation.test.ts`, and `generation.test.ts`; worker typecheck; shared build; `docker compose config --quiet`; and `git diff --check`. If legacy tests already fail for fallback-era expectations, report them separately.

## Runtime validation

After green focused checks, verify without printing values that `AI_PROVIDER=yandex` and `ALLOW_DEMO_GENERATION=false`; rebuild/recreate **only** worker; record image/container provenance. Create a new UTF-8 Saturn project using a raw UTF-8 client (Node `fetch` with `Buffer.from(JSON.stringify(body), "utf8")` is suitable). Verify 10 Saturn narration sections before accepting the unchanged draft, generate, and wait for terminal status.

Success must show Yandex mode, new revision, 10 slides, canonical narration, canvas audit, release-gate capability, and no demo modes. Failure must show safe public error, revision `0`, no partial document, and technical category only from worker logs. Never manually retry.
