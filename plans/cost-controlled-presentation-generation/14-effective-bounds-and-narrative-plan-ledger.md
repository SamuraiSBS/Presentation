# Plan 14 — effective `word_range` telemetry and narrative-plan ledger coverage

## Observed facts this plan must preserve

The isolated Plan 13 E2E proved two distinct facts:

1. The one permitted `narration_global_rewrite` was consumed correctly on
   slide 3. Slide 6 then had another candidate-plus-fallback `word_range`.
   With the global slot already used, the existing Plan 12 policy correctly
   produced terminal `narration_quality_failure`; it did not create a hidden
   retry or a second global request.
2. The cost envelope has no active reservation rows, no duplicate narration
   stages, and no double settlement. Its `0.15246000 RUB` reconciliation gap
   comes from a real `drafting_speech` structured narrative-plan AI event of
   `0.65246000 RUB` which is attached to the envelope but has no persisted
   reservation, offset by the separately settled `0.50000000 RUB` mandatory
   source-search CostEvent.

This plan is deliberately narrow. It makes the effective bounds observable
without leaking narration and makes the existing `narrative_plan` policy
bucket cover the persisted narrative-plan call. It does **not** introduce a
second global rewrite, a fourth per-slide call, automatic retry, a new model,
or a larger policy cap.

## Locked contract

- Keep `AI_PROVIDER=aitunnel`, the v5 `18.20000000 RUB` policy, all models,
  token caps, prompt truncation, source handling, and no-demo behaviour.
- Keep exactly 21 narration reservations: 10 candidates, 10 fallbacks, one
  global slot. A narrative-plan row is a separate pre-existing policy bucket,
  not narration call 22.
- After global slot use, a later dual `word_range` remains a terminal safe
  failure. Product changes to that policy require a future separate plan.
- Keep the canonical 1170–1560 word gate and Plan 13's floor-aware effective
  bounds. Do not revert to raw ±30% acceptance bounds.
- Logs and durable telemetry may contain only safe numeric values: slide,
  stage, effective min/max and observed word count. Never store narration,
  prompt text, raw validation messages, sources or secrets.
- Existing projects, jobs, CostEnvelope snapshots, reservations and events
  remain immutable. The new behavior applies only to future generation jobs.

## Expected reconciliation after the fix

For a future equivalent job, the following identity must hold:

`CostEnvelope.settledRub = sum(envelope-scoped AiUsageEvent.rubCostAtEvent) + sum(envelope-scoped non-AI CostEvent.rubCostAtEvent)`.

For the observed run, the post-fix shape would be:

- narration AI reservations settled: `4.09326000 RUB`;
- persisted `narrative_plan` reservation settled from its structured AI usage:
  `0.65246000 RUB`;
- mandatory source-search CostEvent: `0.50000000 RUB`;
- envelope settled total: `5.24572000 RUB`;
- all AI usage remains `4.74572000 RUB`; the only difference to envelope
  settled is the known non-AI source-search cost of `0.50000000 RUB`.

The numbers are an acceptance fixture, not constants to write into production
code.

## Prompt 14.1 — implementation and deterministic verification only

Run this in a **new Codex chat**. Do not include paid authorization.

```text
Работай в D:\presentation. Сначала полностью прочитай AGENTS.md,
plans/cost-controlled-presentation-generation/README.md,
plans/cost-controlled-presentation-generation/13-floor-aware-section-acceptance-before-paid-e2e.md
и plans/cost-controlled-presentation-generation/14-effective-bounds-and-narrative-plan-ledger.md.
Затем выполни git -c safe.directory=D:/presentation status --short. Сохрани
все несвязанные изменения. Реализуй только Plan 14. Не запускай paid AI,
smoke, Docker rebuild/deploy или commit.

Приложенный отчёт read-only уже установил: global slot был использован на
slide 3, затем slide 6 получил второй dual word_range и корректно завершился
terminal failure; повторный global slot запрещён. Также установлен ledger gap:
AiUsageEvent drafting_speech/narrative plan = 0.65246000 RUB не имеет
persisted reservation, а mandatory source-search = 0.50000000 RUB является
отдельным CostEvent. Не меняй эту product policy и не изменяй прошлые rows.

Сделай ровно следующее.

1. Effective `word_range` telemetry.
   - В apps/worker/src/tasks/presentation/providers/generation.ts найди
     validateAitunnelNarrationSection и safe logger для AITUNNEL narration.
   - При каждом `word_range` логируй safe numeric `wordCount`,
     `effectiveMinWords` и `effectiveMaxWords`, вместе с уже существующими
     projectId, stage, slide/call и qualityReason. Используй ровно тот
     floor-aware shared helper, который применяет validator; не логируй raw
     ±30% bounds, если они не являются фактическим acceptance rule.
   - При success сохрани существенные safe word count/duration поля. Не
     добавляй narration text, prompt, sources, raw exception или secret.
   - Не меняй branch: после уже использованного global slot следующий dual
     word_range остаётся terminal safe failure без нового provider call.

2. Persisted `narrative_plan` reservation and settlement.
   - Используй уже существующий v5 policy bucket `narrative_plan` (0.75 RUB),
     не добавляй bucket и не меняй exact 18.20 RUB sum.
   - В narration generation path резервируй одну persisted row с устойчивым
     key `<envelopeId>:narrative_plan` до фактического AITUNNEL structured
     narrative-plan provider call. Не резервируй её для не-AITUNNEL,
     presentation, historical или demo paths.
   - Свяжи нормализованный usage того же provider response с этой row:
     success -> settle на actualRub; provider/usage/pricing failure ->
     существующая безопасная fail/release semantics. Не создавай second call,
     не считай стоимость post-hoc по AiUsageEvent и не допускай duplicate на
     replay/idempotency.
   - `recordAiUsage` должен сохранить тот же costEnvelopeId, но теперь каждый
     envelope-scoped AITUNNEL structured narrative-plan event имеет
     соответствующую persisted reservation. Mandatory source search остаётся
     отдельным non-AI CostEvent и не становится AiUsageEvent.
   - Если нужно расширить API между generateNarrativePlanWithProvider,
     generateStructuredWithProvider и usage-ledger, передавай только явный
     reservation context/key. Не меняй другие structured-generation stages.

3. Deterministic coverage.
   - Добавь тест, где slide 3 использует global slot, slide 6 получает dual
     word_range: terminal failure, нет второй global request, и logs содержат
     effective bounds + wordCount без narration/raw prompt.
   - Добавь тест для Plan 13 effective bounds: telemetry на 10-slide content
     section показывает 126–182, а не raw 98–182.
   - Добавь persisted ledger tests: narrative-plan reservation reserve ->
     actual settlement -> matching AiUsageEvent; provider/unknown-usage path
     не оставляет reserved row; replay не создаёт дубликат.
   - Добавь reconciliation fixture: narration AI + narrative-plan AI + source
     CostEvent exactly equals envelope settled; known source CostEvent является
     единственной non-AI частью. Не хардкодь production amounts из smoke.
   - Сохрани проверку: 21 narration rows не меняются; narrative_plan и
     source-search — отдельные policy rows; v5 cap не меняется.

4. Verification and stop condition.
   - Запусти targeted shared/worker tests, worker/api/web typecheck,
     npm run check, npm run test и git diff --check. Если Windows/Vitest даёт
     spawn EPERM, используй single-thread только для повторения конкретного
     теста и честно укажи непрошедшую из-за окружения команду.
   - Не запускай paid AI, smoke, Docker rebuild/deploy или commit.
   - В финале дай только «готово к E2E» или «не готово к E2E»: перечисли
     files, новую reconciliation identity, результаты тестов и точную
     будущую smoke-команду. Остановись.
```

## Prompt 14.2 — one paid E2E only after a separate decision

Use this only after Prompt 14.1 says `готово к E2E`.

```text
Разрешаю ровно один paid E2E Plan 14 без повторов.

Работай в D:\presentation. Прочитай AGENTS.md, README.md package, Plan 14 и
git status. Сохрани несвязанные изменения. Пересобери только сервисы по diff:
для worker/shared changes — api и worker; web только если изменён его source.
До запуска проверь API health и пустую BullMQ generation queue.

Запусти ровно один isolated npm run smoke:generation:live с
RUN_LIVE_GENERATION_SMOKE=true и локально загруженными secrets, не печатая
их. Не создавай второй project/job и не повторяй smoke при любой ошибке.
Сразу после terminal result останови worker.

При любом terminal result read-only проверь safe project/job statuses,
effective word_range telemetry, AiUsageEvent, CostEnvelope,
CostEnvelopeReservation и non-AI CostEvent. Покажи reconciliation:
envelope settled = AI usage total + non-AI envelope cost total; отдельно
покажи source-search. Не показывай prompts, narration, sources, raw errors
или secrets. Не коммить.
```

## Acceptance criteria

- A future `word_range` failure identifies the effective bounds and numeric
  word count safely.
- The existing second-dual-failure policy is observable and unchanged.
- Every envelope-scoped AITUNNEL narrative-plan AI cost has exactly one
  persisted `narrative_plan` reservation.
- Future envelope reconciliation is explainable without an unexplained
  `drafting_speech` gap; source-search remains explicitly non-AI.
- No policy cap, provider, model, call count or retry policy increases.
