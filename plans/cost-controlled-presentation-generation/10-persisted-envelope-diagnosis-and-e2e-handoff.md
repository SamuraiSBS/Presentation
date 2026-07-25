# Prompt 10 — persisted-envelope diagnosis, fix, and bounded E2E handoff

Используй один раздел в одном новом чате Codex. Не переходи к следующему без отчёта предыдущего.

## Контекст и результаты этого чата

### Что реализовано для Plan 09

- В рабочем дереве реализован переход на policy v4 с hard cap `17.00000000 ₽`.
- Policy содержит 20 narration buckets: десять Lite candidate по `0.25 ₽` и десять Flash fallback по `1.20 ₽`, а также отдельные buckets источников, narrative plan, images и export/infra.
- Narration path резервирует все candidate/fallback stages одним `reserveCostEnvelopeBatch()` до первого Gemini narration call.
- Lite candidate использует только `gemini-3.5-flash-lite`; fallback использует только `gemini-3.6-flash` и допускается максимум один раз для текущего slide order.
- Успешный candidate освобождает свой fallback; terminal failure пытается освободить все ещё не использованные reservations.
- Добавлен компактный Flash replacement prompt без rejected section, raw validation error и полного source corpus.
- Исправлена telemetry price routing: `gemini-3.6-flash` считается по Flash catalog, а не Lite catalog.

### Проверки, уже проходившие до runtime E2E

- `npm run check` прошёл.
- `npm run test` прошёл: 284 passed, 1 skipped.
- Обязательный targeted набор Plan 09 прошёл: 193 tests.
- Дополнительный targeted набор после compact prompts прошёл: 110 tests.

### Проведённые paid E2E и наблюдения

| Project | Job | Наблюдение |
| --- | --- | --- |
| `cms0biwm50003pg0jbzqf40k8` | `216` | После AITUNNEL narrative-plan job завершился `narration_budget_exhausted_failure` до Gemini narration section calls. |
| `cms0bu4a40003pk0j2exqkdvg` | `217` | Та же категория после compact section system prompt и bounded replacement source anchor. |
| Последующий E2E после ограничения title/keyMessage | новый isolated project | Та же safe-failure category; повтор одного и того же smoke не выполнялся. |

Для всех этих runs API и worker были пересобраны, а API health был зелёным. Worker logs подтверждают AITUNNEL structured `studydeck_narrative_plan`, после которого generation завершается `narration_budget_exhausted_failure`. Доказательства успешного candidate или fallback provider call отсутствуют.

### Уже проверенные гипотезы

- Общий `NARRATION_SYSTEM_PROMPT` был слишком дорогим для per-section reservation. Он заменён на отдельный компактный `AITUNNEL_NARRATION_SECTION_SYSTEM_PROMPT`.
- Flash replacement context был слишком длинным для консервативного test fixture; anchor сокращён до одного короткого excerpt.
- `slideTitle` и `keyMessage`, полученные от narrative-plan model, теперь ограничиваются по длине в candidate и fallback prompts, чтобы не раздувать reservation.
- Deterministic tests показывают, что текущие fixture candidate/fallback requests помещаются в `0.25 ₽` и `1.20 ₽`.

### Что пока не доказано

Точная runtime-причина всё ещё не установлена. Возможные ветки: persisted `policySnapshot` не v4/не содержит нужного bucket, `reserveCostEnvelopeBatch()` отклоняет batch по envelope/bucket/replay, либо реальный prompt конкретного run всё ещё больше fixture. Предыдущая попытка SQL-диагностики не получила данные из-за PowerShell quoting, поэтому Prompt 10.1 должен сначала извлечь фактические rows и status/reason без догадок.

### Границы работы

- Не было commit.
- Не удаляй и не восстанавливай несвязанные user changes, включая `.audit-bmw/tmpw120oeib/enlarged.pptx`.
- Следующий paid E2E запускай только после Prompt 10.4 «готово к E2E» и нового явного разрешения пользователя.

## 1. Read-only диагностика

**Сообщение для нового чата:**

```text
Работай в D:\presentation. Прочитай AGENTS.md, проверь git status и открой plans/cost-controlled-presentation-generation/10-persisted-envelope-diagnosis-and-e2e-handoff.md. Выполни только Prompt 10.1. Сохрани несвязанные изменения, не запускай paid AI, Docker/deploy и не коммить.
```

```text
Работай в D:\presentation. Прочитай AGENTS.md, проверь git status и сохрани несвязанные изменения.

Нужна только read-only диагностика failed Plan 09 E2E. Не меняй код, не запускай paid AI, Docker rebuild/deploy, smoke или commit.

Изучи последние failed проекты, включая cms0biwm50003pg0jbzqf40k8 (job 216) и cms0bu4a40003pk0j2exqkdvg (job 217).

Собери evidence report из PostgreSQL, API и worker logs:
- project.status/error и GenerationJob.status/progressStage/error;
- CostEnvelope: policyVersion, limitRub, reservedRub, settledRub, releasedRub, status, policySnapshot;
- все CostEnvelopeReservation: bucket, stage, status, amounts, reason;
- AiUsageEvent: stage, provider/model, status, input/output tokens, cost, error category;
- точную ветку narration_budget_exhausted_failure: missing bucket, prompt above bucket, batch block, in-memory budget или другое.

Не показывай секреты, narration text, source corpus или raw model responses. Не делай предположений без evidence.
Итог: таблица «факт → источник → вывод», root cause и минимальный список файлов/тестов для исправления. Остановись без реализации.
```

## 2. Исправление root cause

**Сообщение для нового чата:**

```text
Работай в D:\presentation. Прочитай AGENTS.md, проверь git status и открой plans/cost-controlled-presentation-generation/10-persisted-envelope-diagnosis-and-e2e-handoff.md. Выполни только Prompt 10.2. Используй отчёт Prompt 10.1, приложенный ниже. Сохрани несвязанные изменения, не запускай paid AI, Docker/deploy и не коммить.
```

```text
Работай в D:\presentation. Прочитай AGENTS.md, проверь git status и сохрани несвязанные изменения.

Реализуй только исправление root cause из приложенного отчёта диагностики Plan 09. Не меняй legacy MVP, Yandex/OpenAI paths, defense или сохранённые презентации.

Контракт Plan 09: один persisted envelope v4 с hard cap 17 ₽; sources 0.50, narrative plan 0.75, 10 Lite candidates по 0.25, 10 Flash fallbacks по 1.20, images 0.50, export/infra 0.75. До первого Gemini narration call атомарно резервируются 20 candidate/fallback reservations. Lite только gemini-3.5-flash-lite, fallback только gemini-3.6-flash, максимум одна Flash replacement на слайд. Terminal failure освобождает unused reservations. Без provider fallback, local filler, третьего вызова и повторного job.

Устрани подтверждённую причину, не ослабляй budget gate. Добавь deterministic test на реальный runtime сценарий. Логи: только safe category, stage, bucket, reservation/release amount и reason; без prompt/source text.

Не запускай paid AI, Docker/deploy или commit. Запусти relevant worker tests, typecheck worker/api/web, npm run check, npm run test и git diff --check. В конце дай файлы, fix, результаты и нужные сервисы для E2E.
```

## 3. Проверка observability

**Сообщение для нового чата:**

```text
Работай в D:\presentation. Прочитай AGENTS.md, проверь git status и открой plans/cost-controlled-presentation-generation/10-persisted-envelope-diagnosis-and-e2e-handoff.md. Выполни только Prompt 10.3. Используй отчёт Prompt 10.2, приложенный ниже. Сохрани несвязанные изменения, не запускай paid AI, Docker/deploy и не коммить.
```

```text
Работай в D:\presentation. Прочитай AGENTS.md и git status. Сохрани несвязанные изменения.

Выполни только аудит observability Plan 09. Не запускай paid AI, Docker/deploy или commit.

Проверь safe telemetry для missing policy bucket, prompt above bucket, batch bucket/envelope exhaustion, replay, missing usage, cost overrun, candidate/fallback и slide order. Public error должен быть нейтральным. Private telemetry не должна содержать narration/raw validation/source corpus. Terminal failure не оставляет unused reserved rows; valid Lite section освобождает только свой Flash fallback.

Если нужно, добавь только минимальный safe reason/code и test. Не меняй лимиты и routing. Запусти targeted tests и typecheck worker. Не коммить.
```

## 4. Deterministic preflight

**Сообщение для нового чата:**

```text
Работай в D:\presentation. Прочитай AGENTS.md, проверь git status и открой plans/cost-controlled-presentation-generation/10-persisted-envelope-diagnosis-and-e2e-handoff.md. Выполни только Prompt 10.4. Используй отчёты Prompts 10.1–10.3, приложенные ниже. Сохрани несвязанные изменения, не запускай paid AI, Docker/deploy и не коммить.
```

```text
Работай в D:\presentation. Прочитай AGENTS.md, git status и предыдущие отчёты Plan 09.

Это только preflight. Не запускай paid AI, smoke, Docker rebuild/deploy или commit.

Проверь: v4 policy имеет 20 buckets и exact sum 17 ₽; реальные candidate/fallback requests каждого slide order укладываются в 0.25/1.20 ₽; narrative-plan output не раздувает prompt; reserveCostEnvelopeBatch получает 20 unique keys в одном envelope; source/narrative-plan reservations находятся в том же envelope; tests покрывают failure до provider call и successful all-Lite path.

В конце ответь только: «готово к E2E» или «не готово», причины, нужные сервисы и одну точную smoke-команду. Никаких paid вызовов.
```

## 5. Один paid E2E

**Сообщение для нового чата:**

```text
Работай в D:\presentation. Прочитай AGENTS.md, проверь git status и открой plans/cost-controlled-presentation-generation/10-persisted-envelope-diagnosis-and-e2e-handoff.md. Выполни только Prompt 10.5. Используй отчёт Prompt 10.4, приложенный ниже. Сохрани несвязанные изменения и не коммить. Разрешаю ровно один paid E2E Plan 09 без повторов.
```

Отправляй этот раздел только после «готово к E2E» из пункта 4.

```text
Разрешаю ровно один paid E2E Plan 09 без повторов.

Работай в D:\presentation. Прочитай AGENTS.md и git status. Сохрани несвязанные изменения.

Пересобери только сервисы по diff. Проверь docker compose ps, http://127.0.0.1:4000/v1/health и https://localhost/api/internal-health. Запусти ровно один isolated live generation smoke с RUN_LIVE_GENERATION_SMOKE=true и локально загруженными секретами, не печатая их. Не создавай второй project/job и не повторяй smoke при failure.

При success проверь 10 slides, 10 accepted sections, 1170–1560 words, production gate, export, envelope ≤17 ₽, costs и released reservations. При failure не повторяй: read-only извлеки project.error, GenerationJob, AiUsageEvent, CostEnvelope, все CostEnvelopeReservation и worker logs. Покажи только safe categories, stages, costs и reservation statuses. Не коммить.
```

## Как передавать prompts

1. Создай новый чат.
2. Вставь один раздел целиком.
3. Дождись отчёта и приложи его к следующему разделу в следующем новом чате.
4. Не объединяй пункты 1–5.
5. Для paid E2E всегда используй точную формулировку из пункта 5.
