# Plan 13 — floor-aware section acceptance before another paid E2E

## Why this is a separate task

The latest Plan 12 E2E reached the v5 envelope correctly, then safe-failed
with `narration_quality_failure`. This was **not** a missing global-rewrite
transition:

- every section satisfied the existing local ±30% bounds;
- the ten accepted sections totalled **1034 words**;
- the canonical whole-speech gate correctly rejected that result because the
  contract is **1170–1560 words**;
- Plan 12 makes `narration_global_rewrite` ineligible for a full-document
  duration failure, so its unused reservation was correctly released.

For a ten-slide deck, the current local minima are `56 + 8 × 98 + 70 = 910`.
They cannot guarantee the global lower bound when every section passes
locally. This plan fixes that mathematical gap for **future AITUNNEL
generations only**. It does not weaken the global gate, reuse a saved project,
add a model call, or reinterpret an existing cost envelope.

## Locked contract

Keep all of these rules unchanged:

- `AI_PROVIDER=aitunnel`; no hidden OpenAI, Yandex, or demo fallback.
- The canonical 10-slide narration range remains 1170–1560 words, target
  1300, with target section sizes 80 / 140 / 100.
- Plan 12's policy v5 remains `18.20000000` RUB and reserves exactly 21
  narration rows: ten Lite candidates, ten Flash fallbacks, and one global
  Flash slot. Do not add a 22nd call, a second global slot, a second job, or a
  cost bucket.
- The one global slot remains only for a **current-section** dual local
  quality failure. It remains unavailable for final whole-document duration
  failure.
- Do not use local filler, truncation, rejected narration, raw validation
  details, full source text, or secrets in a prompt, log, or telemetry.
- Existing v4/v5 snapshots, saved projects, UI flows, provider selection,
  output-token caps, and `MAX_AITUNNEL_NARRATION_TEXT_CALLS` remain unchanged.

## Target behaviour

Add a shared, deterministic **floor-aware acceptance bound** for each
independently generated section. It must be derived from the timing budget,
not copied as magic numbers in worker code.

For a 10-slide university presentation, calculate each section's floor as:

`ceil(sectionTargetWords × wholeSpeechMinWords / wholeSpeechTargetWords)`.

That produces these effective lower bounds while retaining existing upper
bounds:

| Slide kind | Target | Old local range | New acceptance range |
| --- | ---: | ---: | ---: |
| Title (1) | 80 | 56–104 | **72–104** |
| Content (2–9) | 140 | 98–182 | **126–182** |
| Conclusion (10) | 100 | 70–130 | **90–130** |

Their lower floors sum to exactly 1170. A section can still be natural and
shorter than its target, but an accepted sequence can no longer be locally
valid yet incapable of passing the global lower gate. The shared helper must
work for every supported timing preset; do not hard-code 72, 126, or 90
outside tests.

## Prompt 13.1 — implementation and deterministic verification only

Use this in a **new Codex chat**. Do not add paid authorization to this prompt.

```text
Работай в D:\presentation. Сначала полностью прочитай AGENTS.md,
plans/cost-controlled-presentation-generation/README.md и
plans/cost-controlled-presentation-generation/13-floor-aware-section-acceptance-before-paid-e2e.md.
Затем выполни git -c safe.directory=D:/presentation status --short и сохрани
все несвязанные пользовательские изменения. Реализуй только Plan 13; не
переходи к paid E2E, Docker rebuild/deploy, commit или следующим планам.

Контекст: последний Plan 12 E2E корректно использовал v5 / 18.20 RUB и
закончился с десятью локально валидными sections, но лишь 1034 словами. Это
не ошибка global rewrite: slot намеренно запрещён для final whole-document
duration failure. Исправь для будущих AITUNNEL narration jobs математический
разрыв между local acceptance и строгим whole-speech minimum.

Сделай ровно следующее.

1. Shared timing helper.
   - В packages/shared/src/generation/speech-timing.ts добавь экспортируемый
     helper для floor-aware section acceptance bounds.
   - Он берёт только существующий SpeechTimingBudget и slideOrder. target
     остаётся title/content/conclusion target; maxWords остаётся существующим
     +30% maxWords; minWords равен max(existingToleranceMin,
     ceil(targetWords * budget.minWords / budget.targetWords)).
   - Не копируй 72/126/90 в production code. Для 10 slides helper обязан
     вернуть 72–104, 126–182 и 90–130; сумма ten per-slide minima должна быть
     ровно 1170. Существующий helper ±30% можно оставить raw-tolerance helper,
     но AITUNNEL builders и validator должны использовать новый helper.
   - Не меняй whole-speech minWords/targetWords/maxWords, presets, word rate
     или UI semantics.

2. AITUNNEL prompts and local validator.
   - В apps/worker/src/tasks/presentation/prompts/builders.ts переведи
     candidate, per-slide Flash fallback и one-use global section prompt на
     shared floor-aware bounds. В каждом явно укажи допустимый диапазон,
     target, что нельзя стремиться к границе, и что текст ниже acceptance
     floor нельзя возвращать.
   - В apps/worker/src/tasks/presentation/providers/generation.ts используй
     тот же helper в validateAitunnelNarrationSection(). Не создавай локальную
     математику или отдельные константы.
   - Сохрани 2–7 sentences, 384-token caps, models (Lite/Flash), source
     truncation, safe prompt content, quality categories и existing call flow.
   - Если candidate/fallback не достигает нового floor, это остаётся
     `word_range`: текущий fallback/global logic работает как в Plan 12.
     Global slot по-прежнему не вызывается только из-за final 1170–1560 gate.

3. Deterministic coverage.
   - Обнови shared tests: 10-slide bounds 72–104 / 126–182 / 90–130;
     minima sum = 1170; upper bounds and full 1170–1560 gate unchanged.
   - Обнови worker/prompt tests: all three AITUNNEL prompt kinds contain
     floor-aware range and target, but never raw rejected narration/source
     corpus/secret.
   - Обнови persisted-envelope tests with the observed 1034-word shape:
     section 2 at 118 words must now fail local `word_range` before final
     normalize; its fallback/global path is used only under existing Plan 12
     rules. Include a passing ten-section fixture at the new floors and prove
     no 22nd call exists.
   - Preserve tests for all-Lite, normal fallback, one global rewrite, later
     dual failure after global use, terminal releases, and the separate final
     full-duration gate. Do not alter cost policy sums, 21-row reservation,
     retry policy, models or provider routing merely to satisfy a test.

4. Verification and handoff.
   - Run relevant shared/worker tests, worker/api/web typechecks,
     npm run check, npm run test and git diff --check. Use the existing
     single-thread Vitest workaround only if this Windows host hits spawn
     EPERM; report it honestly.
   - Do not run paid AI, smoke, Docker rebuild/deploy or commit.
   - End with one of exactly: «готово к E2E» or «не готово к E2E». Include
     changed files, observed-vs-new acceptance math, all command results,
     and the exact next smoke command, but stop there.
```

## Prompt 13.2 — one paid E2E only after a separate decision

Send this **only** after Prompt 13.1 reports `готово к E2E` and only if you
want to spend on one new validation.

```text
Разрешаю ровно один paid E2E Plan 13 без повторов.

Работай в D:\presentation. Прочитай AGENTS.md, README.md этого plan package,
Plan 13 и git status. Сохрани несвязанные изменения. Пересобери только
сервисы по diff: если затронуты worker + packages/shared, пересобери api и
worker; web не пересобирай, если его source не менялся. До запуска проверь
API health и пустую BullMQ generation queue.

Запусти ровно один isolated npm run smoke:generation:live с
RUN_LIVE_GENERATION_SMOKE=true и локально загруженными секретами, не печатая
их. Не создавай второй project/job и не повторяй smoke при любой ошибке.
Сразу после terminal result останови worker.

При успехе read-only проверь: 10 slides, 10 accepted sections, 1170–1560
words, production gate, completed export, policy v5, envelope <=18.20 RUB,
AiUsageEvent costs и отсутствие reserved rows. При failure не повторяй:
извлеки только safe project/job statuses, safe worker categories/stages,
AiUsageEvent costs, envelope totals и reservation statuses. Не показывай
secrets, prompts, sources, raw narration или raw validation errors. Не
коммить.
```

## Success criteria

- Future 10-slide AITUNNEL jobs no longer accept a 1034-word narration as
  locally valid.
- Every accepted section sequence has a deterministic lower-floor sum of at
  least 1170, while canonical whole-document validation stays authoritative.
- The change uses no more than Plan 12's maximum of 21 narration calls and
  cannot turn final-duration rejection into a second global rewrite.
- The cost envelope remains exactly v5 / 18.20 RUB; no existing snapshot or
  saved presentation changes.
