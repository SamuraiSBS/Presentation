# Итоги реализации Plan 14–16 и live-проверок

## Статус

Цепочка Plan 14–16 завершена до границы текущей product policy. Платные
проверки не должны повторяться без нового отдельного решения: источник и
ledger теперь доказаны, а оставшийся terminal failure является ожидаемым
безопасным исходом locked narration policy.

## Что подтверждено

### 1. Источники и worker readiness

- Mandatory web-source route использует один Tavily search под persisted
  `sources` reservation и не запускает narration до получения source snapshot.
- После диагностики `provider_error` был выполнен ровно один отдельный
  app-shaped Tavily probe: API healthy, worker running без OOM, generation
  queue пуста, Tavily ответил HTTP `200` и вернул `6` результатов.
- Probe не создавал project/job и не вызывал AI.

### 2. Cost-envelope reconciliation

В worker внесён future-only reconciliation fix:

- `WebSearchRequest` получил `costEnvelopeRub` для mandatory source-search.
- `prepareGenerationSources()` передаёт policy amount источников в
  `searchWebSources()`.
- `recordCostEvent()` принимает authoritative `rubCostAtEvent` и сохраняет
  его, когда внешняя Tavily цена не задана. Provider price/source cost при
  этом могут оставаться `null`; envelope accounting сохраняет точную RUB
  величину source reservation.

Изменённые worker-файлы:

- `apps/worker/src/tasks/generation.ts`
- `apps/worker/src/tasks/web-search.ts`
- `apps/worker/src/usage-ledger.ts`
- соответствующие targeted tests.

Проверки fix:

- targeted `usage-ledger` + `web-search` tests: `27/27 passed`;
- worker typecheck: passed;
- `git diff --check`: passed;
- worker был пересобран отдельно и прошёл readiness: API healthy, startup
  marker есть, `Running=true` через 20 секунд, `OOMKilled=false`, все шесть
  generation queue counts равны `0`.

### 3. Последний full paid E2E

Был выполнен ровно один новый full paid E2E после успешного Tavily probe.
Новый project/job получили terminal `failed`; retry и API cancellation не
применялись, worker был остановлен после terminal result.

Безопасные ledger totals этого run:

- `CostEnvelope.limitRub = 18.20000000 RUB`;
- `settledRub = 2.59986000 RUB`;
- `releasedRub = 12.80000000 RUB`;
- AI usage: `5` succeeded events, `2.09986000 RUB`;
- non-AI `web_search`: `1` CostEvent, `0.50000000 RUB`;
- reconciliation доказан: `2.59986000 = 2.09986000 + 0.50000000 RUB`.

Следовательно, ранее наблюдавшийся source-search ledger gap устранён для
будущих успешных source-search runs. Исторические projects, jobs, envelopes,
reservations и events не переписывались.

### 4. Narration terminal failure

Read-only postmortem последнего run доказал:

- project/job terminal `failed`, job attempt `1`;
- `23` reservation rows: `21` narration + `narrative_plan` + `sources`;
- `6` settled, `17` released, `0` reserved/other;
- один `narrative_plan`, два section candidates, один section fallback и один
  `narration_global_rewrite` завершились успешно;
- global rewrite был ровно один, после него provider calls отсутствовали;
- не было retry, второго global rewrite или незакрытых reservations;
- safe telemetry показала `word_range` ниже floor-aware bounds `126–182`.

Диагноз: `narration_quality_failure`, verdict: `expected_locked_policy`.
Это не runtime, source-search или cost-ledger defect. Нельзя исправлять его
ещё одним E2E или скрытым дополнительным вызовом.

## Deterministic policy proof

Existing coverage в
`apps/worker/src/tasks/presentation/providers/generation.persisted-envelope.test.ts`
уже моделирует успешное использование global rewrite, а затем следующий dual
`word_range`. Assertions доказывают:

- terminal `narration_quality_failure`;
- ровно один global rewrite и отсутствие второго provider call после него;
- `9` calls в этом сценарии;
- unused later reservations released;
- floor-aware bounds `126–182`;
- policy не меняет 21 narration reservations, cap или retry behaviour.

Targeted test прошёл `12/12`; после Windows `spawn EPERM` он был успешно
повторён в single-thread mode. Worker typecheck и `git diff --check` прошли.
Production narration code не менялся.

## Зафиксированные ограничения

- Нет нового paid E2E без отдельного product decision.
- Не retry/не resume historical Plan 14/15/16 jobs и не удалять их rows.
- Не добавлять второй global rewrite, hidden retry, provider fallback или
  увеличение policy cap в рамках этой цепочки.
- Коммит в этой последовательности не создавался; существующие unrelated
  worktree changes сохраняются.

## Единственный осмысленный следующий шаг

Только отдельная product/design задача может изменить outcome narration:
выбрать и явно забюджетировать другой quality-recovery contract (например,
дополнительный global rewrite, иные effective bounds или иной deterministic
fallback). До такого решения текущий `narration_quality_failure` является
корректным fail-closed результатом.
