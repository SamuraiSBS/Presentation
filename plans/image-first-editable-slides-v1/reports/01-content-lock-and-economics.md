# Plan 01 — content lock and economics

## Verdict

**FOUNDATION ACCEPTED**

The disabled `image_first_editable_v1` foundation enforces exact allowed deck counts, accepted-speech grounding, one deck-wide model adapter call with no automatic retry, and a versioned initial cost envelope. No image generation or production-route integration was performed.

Plan 01 remediation on 2026-09-14 now gives exact count priority. A compact accepted section can supply multiple unique self-contained claims separated by source-grounded semicolon boundaries; when unique claims still run short, the deterministic lock repeats a real claim or adds only neutral navigation/pause copy. These paths are explicit in immutable lock diagnostics and per-string provenance, and neither is represented as a new speech-grounded claim. Only absent or malformed accepted speech remains a pre-image blocker.

## Architecture map and boundary

| Seam | Existing source of truth / boundary | Plan 01 result |
|---|---|---|
| Accepted speech | `apps/worker/src/tasks/presentation/narration/processing.ts`; the existing narration state is consumed by `orchestrator.ts` | The new planner accepts only ordered accepted-speech sections. Missing or malformed accepted speech throws before the adapter can be called. |
| Provider routing | `apps/worker/src/tasks/presentation/providers/generation.ts` | Untouched. The new `DeckContentPlannerAdapter` is injected; it chooses no production provider or model. |
| Shared document/artifacts | `packages/shared/src/presentation/document.ts` and `packages/shared/src/generation/schemas.ts` | Optional v1 lock/edit lineage fields preserve old document parsing and artifacts without the new field. |
| Cost reserve/settlement | `apps/worker/src/cost-envelope.ts` | Explicit immutable policy snapshots may be created; reservations count settled, failed, and unknown reserved ceilings, so a stage cannot be reopened for a hidden retry. |
| Slide-count policy | `packages/shared/src/billing/limits.ts` and existing narration planning | The v1 contract independently allows exactly 6, 8, 10, 12, or 14, including cover and closing. |
| Native canvas/export | `packages/shared/src/presentation/canvas-builder.ts`, `apps/worker/src/tasks/export/**` | Untouched. The v1 contract marks exact tables, charts, formulas, and schemas as `native_evidence` for a later native renderer/export integration. |

The dedicated feature flag is `IMAGE_FIRST_EDITABLE_V1_ENABLED`; it is `false` unless set to the exact string `true`. It does not alter `ai_scene_v3`, OpenAI, Yandex, AITunnel, local, or demo routes, and no ordinary generation route imports the new planner.

## Changed files

- `packages/shared/src/generation/image-first-editable.ts`
- `packages/shared/src/generation/image-first-editable.test.ts`
- `packages/shared/src/generation/cost-envelope.ts`
- `packages/shared/src/generation/schemas.ts`
- `packages/shared/src/presentation/document.ts`
- `packages/shared/src/index.ts`
- `apps/worker/src/tasks/presentation/image-first-editable-v1/content-planner.ts`
- `apps/worker/src/tasks/presentation/image-first-editable-v1/content-planner.test.ts`
- `apps/worker/src/tasks/presentation/image-first-editable-v1/economics.ts`
- `apps/worker/src/tasks/presentation/image-first-editable-v1/economics.test.ts`
- `apps/worker/src/cost-envelope.ts`
- `apps/worker/src/cost-envelope.test.ts`
- `plans/image-first-editable-slides-v1/00-product-contract.md`
- `plans/image-first-editable-slides-v1/01-content-lock-and-economics.md`
- `plans/image-first-editable-slides-v1/reports/01-content-lock-and-economics.md`

## Content-lock contract

`ImageFirstEditableDeckContentLock` contains:

- `version: image_first_editable_v1`, `requestedSlideCount`, accepted-speech hash, source-snapshot hash, visual-family intent, and deck `contentHash`;
- exactly N ordered slides, with the first `cover` and last `closing`;
- a semantic title, 1–4 semantic theses on content slides, optional grounded conclusion, optional semantic labels, visual intent, composition archetype, render mode, and per-slide `contentHash`;
- for every visible semantic string: a stable `ife1:` semantic ID, kind, exact text, matching accepted-speech section ID/order/hash/excerpt, optional validating source refs, and immutable provenance (`speech_grounded`, `repeated_accepted_speech` plus `repeatedFromSemanticId`, or `fallback_added`);
- lock-level immutable `fallbackDiagnostics`, including the exact-count fallback mode and required/available unique-statement counts;
- separate `ImageFirstEditableEditableValues`, tied to the immutable generated deck hash, for later user edits. It cannot introduce IDs absent from the generation lock.

Hashes are recomputed from exact semantic strings and their provenance, and the deck hash includes `fallbackDiagnostics`. A text or provenance change invalidates hash verification; current user editable values do not mutate the lock.

The deterministic validator rejects: count/role failures, duplicate semantic IDs or unmarked duplicate visible strings, invalid speech traces, visible numbers absent from the matching speech section, weak lexical grounding for speech claims, fragments, prompt echo/generic filler, unsupported conclusions, missing composition diversity, forbidden UI-card visual-family language, a non-native render mode for precise evidence, and every candidate source ref that is not an exact member of `input.sourceRefs`. A visible claim needs at least three meaningful tokens and every such token must occur in its concrete matching speech trace; only single-token semantic labels (date/number/name/term) may use the narrower exact-token rule. `fallback_added` is limited to deterministic neutral navigation text and cannot carry a source ref; source refs are not a donor of visible text.

On invalid, timeout, or uncertain model output, the planner makes **no second model call**. It uses complete grounded statements from matching accepted sections first; when they are insufficient, it repeats them with `repeated_accepted_speech` and a `repeatedFromSemanticId`, or uses the constrained `fallback_added` navigation line when no complete claim is extractable. It records `deterministic_content_lock_fallback`, the exact count mode, and required/available statement counts in the lock. A source-grounded semicolon-separated sequence of independent claims is valid material even when it is one typographic sentence. It stops before any image stage only for absent/malformed accepted speech, never for an exact-count conflict.

## One deck-wide call proof

`planImageFirstEditableDeck()` has one injected `adapter.generate()` site and returns `modelCallCount: 1`; it has no retry/repair loop. Its prompt contains every accepted section, the requested count, source snapshot context, all semantic/grounding constraints, the no-truncation rule, one visual family, archetype diversity, and the `native_evidence` classification rule. Tests cover 600–800-word accepted speech for both 6 and 14 slides; compact one-sentence accepted speech with 10/14/18/22/26 independent grounded clauses for exact 6/8/10/12/14 fallback; two unique claims with requested 10 and provenance-marked repetition; constrained `fallback_added` copy when no complete claim is extractable; no retry; no source-only visible content; rejected non-member source refs; excess speech with exact requested count; invalid output fallback; and missing accepted speech before any adapter call.

## Cost contract

Measurement boundary: **from the user starting initial creation until the ready deck**. Therefore `source_search`, narration, and the deck-wide content-lock call are all in the same initial non-image bucket. Provider telemetry/ledger settlement remains the actual-cost source of truth; the reservation is the maximum permitted exposure.

| N | Initial total hard cap | All billable non-image stages | All image calls |
|---:|---:|---:|---:|
| 6 | 7 ₽ | 1 ₽ (`0.2 + 0.2 + 0.6`) | at most 6 × 1 ₽ |
| 8 | 9 ₽ | 1 ₽ (`0.2 + 0.2 + 0.6`) | at most 8 × 1 ₽ |
| 10 | 11 ₽ | 1 ₽ (`0.2 + 0.2 + 0.6`) | at most 10 × 1 ₽ |
| 12 | 13 ₽ | 1 ₽ (`0.2 + 0.2 + 0.6`) | at most 12 × 1 ₽ |
| 14 | 15 ₽ | 1 ₽ (`0.2 + 0.2 + 0.6`) | at most 14 × 1 ₽ |

Each provider stage calls the existing atomic `reserveCostEnvelope` before the call. The initial v1 policy snapshot is immutable (`image-first-editable-v1-initial-N`), and each image is keyed by its slide order with a 1 ₽ reservation. Settled, `provider_error`, and `unknown_usage` reservations count against the stage bucket. `uncertainCostEnvelopeRub()` reports the full reserve for unresolved, provider-error, and unknown-usage entries. Unknown settlement exhausts the envelope, blocking all later paid stages until reconciliation. Manual regeneration uses a separate `image-first-editable-v1-manual-regeneration` envelope and cannot debit an initial envelope.

The current implementation only models image reservations; it does not issue image calls.

## Verification

| Command | Result |
|---|---|
| `npm run build -w @studydeck/shared` | passed |
| `npm run test -w @studydeck/shared` | passed: 14 files, 134 tests |
| `npm run typecheck -w @studydeck/worker` | passed |
| `npm run test -w @studydeck/worker -- content-planner.test.ts cost-envelope.test.ts generation.persisted-envelope.test.ts orchestrator.editable-draft.test.ts` | passed: 4 files, 44 tests |
| `git -c safe.directory=D:/presentation diff --check` | passed |

### Remediation verification (2026-09-14)

| Command | Result |
|---|---|
| `npm run build -w @studydeck/shared` | passed |
| `npm run test -w @studydeck/shared` | passed: 14 files, 134 tests |
| `npm run typecheck -w @studydeck/worker` | passed |
| `npm run build -w @studydeck/worker` | passed |
| `npm run test -w @studydeck/worker -- content-planner.test.ts economics.test.ts cost-envelope.test.ts` | passed: 3 files, 31 tests |
| `git -c safe.directory=D:/presentation diff --check` | passed |

The first sandboxed attempt at each Vitest command stopped before collection with `spawn EPERM`. Each identical command was then run with permission for local child processes only; no network, provider, Docker, feature-flag, commit, or deploy action occurred.

### Exact-N compact-speech remediation verification (2026-09-14)

| Command | Actual result |
|---|---|
| `npm run test -w @studydeck/worker -- content-planner.test.ts` | passed: `1` file, `18` tests, duration `966ms` (`94ms` tests). The first sandboxed attempt was blocked before collection with `spawn EPERM`; the permitted rerun spawned only the local Vitest worker. |
| `npm run typecheck -w @studydeck/worker` | passed: `tsc --noEmit` |
| `git diff --no-index --check -- /dev/null <each-remediation-file>` | passed for `content-planner.ts`, `content-planner.test.ts`, and this report; Git printed only LF→CRLF warnings. |
| `git -c safe.directory=D:/presentation diff --check` | passed; Git printed only pre-existing LF→CRLF warnings for tracked dirty files outside this remediation. |

The exact-N matrix invokes an invalid mocked adapter result for every allowed count (6/8/10/12/14), so the tested path is the deterministic fallback. Each fixture has one typographic accepted-speech sentence containing the required number of independent semicolon-delimited, complete grounded claims. Assertions prove exact N, one adapter call, `modelCallCount: 1`, fallback/no retry, unique visible strings, a valid matching trace for every visible string, no generated source refs, and no visible source-only claim. A separate test rejects a candidate ref whose `(sourceId, excerpt)` does not exactly belong to `input.sourceRefs`.

Vitest initially could not spawn a local child process inside the filesystem sandbox (`spawn EPERM`). The same test commands were rerun with local child-process permission; no network or provider invocation occurred.

### Product-rule remediation verification (2026-09-14)

The product owner changed the conflict rule: insufficient unique grounded statements must never stop exact-count creation. The planner now returns the requested 6/8/10/12/14 count, including cover and closing, after its single deck-wide adapter call. It first cycles a complete accepted-speech statement only when necessary, marks each repeated line `repeated_accepted_speech`, and links it to `repeatedFromSemanticId`. If no complete statement can be extracted, it uses only a constrained neutral navigation line marked `fallback_added`. Lock-level `fallbackDiagnostics` records the deterministic fallback mode plus the required and available unique-statement counts. Provenance and diagnostics participate in immutable lock hashes, so a repeated or added fallback line cannot be silently relabelled as speech-grounded content.

| Command | Actual result |
|---|---|
| `npm run build -w @studydeck/shared` | passed |
| `npm run test -w @studydeck/shared -- image-first-editable.test.ts` | passed: 1 file, 9 tests |
| `npm run typecheck -w @studydeck/worker` | passed: `tsc --noEmit` |
| `npm run test -w @studydeck/worker -- content-planner.test.ts` | passed: 1 file, 18 tests |
| `git -c safe.directory=D:/presentation diff --check` | passed; only LF-to-CRLF warnings for existing tracked dirty files |
| `git diff --no-index --check -- /dev/null <each changed untracked file>` | passed; Git returned its normal exit code `1` for a non-empty no-index diff and printed only LF-to-CRLF warnings, with no whitespace errors |

The decisive deterministic test supplies exactly two complete unique claims and requests 10 slides. The invalid mocked adapter result triggers local fallback; assertions prove one adapter call, exactly 10 ordered slides with cover/closing, no `PreImageContentBlockerError`, explicit repeated-line provenance, lock fallback diagnostics, and a clean deterministic validation result. The test suite also covers the no-extractable-claim path with `fallback_added` provenance. The initial sandboxed Vitest attempts stopped before collection with `spawn EPERM`; only the identical target tests were rerun with local child-process permission. No network, provider, image, Docker, commit, or deploy action occurred.

## Dirty-tree boundary

At remediation start, the tracked dirty files were `apps/web/next-env.d.ts`, `apps/web/tsconfig.tsbuildinfo`, `apps/worker/src/cost-envelope.test.ts`, `apps/worker/src/cost-envelope.ts`, `packages/shared/src/generation/cost-envelope.ts`, `packages/shared/src/generation/schemas.ts`, `packages/shared/src/index.ts`, and `packages/shared/src/presentation/document.ts`. Existing untracked material was `.codex-artifacts/`, `.codex-worktrees/`, the `.p1-3-*` files/directories, `plans/ai-scene-v3-gate-0-latest-run.json`, `plans/ai-scene-v3-gate-0-manifest.json`, `plans/ai-scene-v3-gate-1/`, `референц слайдов/`, and the earlier untracked v1 shared/planner/report paths.

The product-rule remediation edited the existing untracked shared v1 contract/test and worker content planner/test, the two Plan 01 documents, and this report. No other dirty path was reset, staged, or edited. All v1 additions remain untracked until the user authorizes staging/commit.

## Not started

This plan intentionally does not generate images, call a provider, create OCR/CV reconstruction, build native image-first rendering, alter editor UI, alter exports, enable the feature flag, or attach v1 to normal production generation. Those are later-plan scope.

`paid calls: 0`
`commit/deploy: нет`
