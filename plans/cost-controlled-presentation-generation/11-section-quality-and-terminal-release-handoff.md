# Plan 11 — quality-safe sections and terminal reservation release

Use **one numbered prompt in one new Codex chat**. Do not skip ahead: each next
prompt needs the report from the preceding one. This plan concerns future
generations only; do not rewrite saved presentations.

## Proven runtime evidence

The latest isolated Plan 09 smoke failed project `cms1mdqji000jpk0iqkrux9h4`,
job `221`, after the persisted prompt preflight had passed.

- Envelope policy: `standard-generation-cost-envelope-v4`, cap `17 ₽`.
- Candidate 1 succeeded and was accepted (79 words); its Flash fallback was
  released with `fallback_not_needed`.
- Candidate 2 and its single Flash fallback both reached the provider but
  failed `section_validation`; the terminal safe error was
  `narration_quality_failure`.
- The failure left reservations for later sections in `reserved` status. That
  violates the Plan 09 terminal rule: every unused narration reservation must
  be released.
- The affected path is `apps/worker/src/tasks/presentation/providers/generation.ts`:
  `generateAitunnelNarration`, `validateAitunnelNarrationSection`,
  `releaseNarrationReservation`, and `releaseUnusedNarrationReservations`.
- Current provider/budget contract is fixed: one persisted v4 envelope capped
  at `17 ₽`; ten Lite candidate buckets at `0.25 ₽`; ten Flash fallback
  buckets at `1.20 ₽`; at most one fallback per slide; no provider fallback,
  local filler, third call, or second job.

Never print secrets, source corpus, narration text, raw validation errors, or
raw provider responses. Private logs may contain only safe reason/category,
stage, slide order, bucket and reservation/release amounts.

## Prompt 11.1 — read-only diagnosis

Paste the following into a new chat first:

```text
Работай в D:\presentation. Прочитай AGENTS.md, проверь git status и открой
plans/cost-controlled-presentation-generation/11-section-quality-and-terminal-release-handoff.md.
Выполни только Prompt 11.1. Сохрани несвязанные изменения, не меняй код, не
запускай paid AI, Docker/deploy, smoke или commit.

Нужна read-only диагностика latest failed Plan 09 project
cms1mdqji000jpk0iqkrux9h4 (job 221). Собери только safe evidence из API,
PostgreSQL при доступности и logs остановленного worker:

1. Project/GenerationJob status, progressStage и public error.
2. CostEnvelope: policy version, limit/reserved/settled/released/remaining,
   status и termination reason.
3. Все CostEnvelopeReservation: stage, bucket, status, reserved/settled/
   released amount и reason. Раздели: settled, correctly released, incorrectly
   still reserved after terminal failure.
4. AiUsageEvent: provider/model, stage, status, input/output tokens и cost.
5. Точную безопасную причину section_validation для candidate 2 и fallback 2:
   достаточно категории проверки и slide order; не показывай текст section,
   prompt, source или raw validation message.
6. По коду проверь, почему releaseUnusedNarrationReservations не привёл
   persisted rows к released: current usage context, idempotency key, error
   swallowing, concurrency или другая подтверждённая причина. Не гадай.

Итог: таблица «факт → источник → вывод», root causes и минимальный список
файлов/тестов для исправления. Остановись без реализации.
```

## Prompt 11.2 — implement the terminal-release fix

Start a fresh chat and paste Prompt 11.1 report below this text:

```text
Работай в D:\presentation. Прочитай AGENTS.md, проверь git status и открой
plans/cost-controlled-presentation-generation/11-section-quality-and-terminal-release-handoff.md.
Выполни только Prompt 11.2, используя приложенный отчёт Prompt 11.1.
Сохрани несвязанные изменения. Не запускай paid AI, Docker/deploy, smoke или
commit.

Исправь только подтверждённый root cause terminal reservation release в
AITUNNEL section narration path. Будущие генерации только.

Контракт:
- v4 envelope с hard cap 17 ₽ не меняется;
- до первого section provider call атомарно создаются 20 reservations;
- accepted Lite освобождает только свой fallback;
- при любом terminal error после batch reservation все неиспользованные rows
  должны стать released, включая later candidate и fallback stages;
- уже settled rows не перезаписываются, а already-released rows остаются
  идемпотентными;
- не добавляй retries, новые provider calls, новый job, local filler или
  provider fallback.

Измени минимально вероятный файл
apps/worker/src/tasks/presentation/providers/generation.ts и связанные
детерминированные tests. Не меняй legacy MVP, Yandex/OpenAI paths, policy
limits/routing или persisted schema без доказанной необходимости.

Добавь тест для сценария: section 1 candidate accepted; section 2 candidate
and its one fallback fail quality; generation terminates; every later
candidate/fallback reservation released exactly once с safe reason;
settled section 1/2 rows не меняют статус. Мокируй provider и persistence;
никакой сети.

Логи только safe fields: failure category, safe validation reason, slide
order, stage, bucket, reserved/settled/released amount и release reason.

Запусти targeted worker tests, worker typecheck и git diff --check. В конце
дай: файлы, invariant, результаты и точную команду для следующего prompt.
Остановись без Docker и paid E2E.
```

## Prompt 11.3 — make section-quality failure actionable

Start a fresh chat, paste the Prompt 11.2 report, then paste:

```text
Работай в D:\presentation. Прочитай AGENTS.md, проверь git status и открой
plans/cost-controlled-presentation-generation/11-section-quality-and-terminal-release-handoff.md.
Выполни только Prompt 11.3, используя приложенный отчёт Prompt 11.2.
Сохрани несвязанные изменения. Не запускай paid AI, Docker/deploy, smoke или
commit.

Выполни узкий audit и при необходимости минимальный fix quality path AITUNNEL
section narration. Реальный run дошёл до candidate 2 и единственного Flash
fallback, но оба дали section_validation и terminal narration_quality_failure.

Нужно:
1. Разобрать validateAitunnelNarrationSection и его вызывающий код. Выделить
   детерминированные safe reason codes (например headers_or_sections,
   word_range, sentence_count, spoken_quality, template_or_repetition) без
   текста section или raw validator message.
2. Передать безопасный reason в structured worker telemetry для failed
   candidate и fallback, вместе с slide order/stage/model. Public error должен
   остаться нейтральным.
3. Проверить, что fallback получает компактный replacement prompt и уже
   соблюдает fixed 1.20 ₽ preflight bucket. Не расширяй лимиты.
4. Если evidence показывает недостаток в prompt contract или validator
   coordination, сделай минимальную правку, которая повышает вероятность
   соответствия section contract. Не ослабляй качество, не снижай minimum
   words, не принимай неполные sections и не добавляй вызовы.
5. Добавь deterministic tests на safe reason telemetry для candidate/fallback
   quality failure и на successful all-Lite section path. Tests не должны
   хранить narration/source/prompt в логах.

Запусти targeted worker tests, worker typecheck и git diff --check. В конце
отчитайся «готово к preflight» или «не готово», с причиной, файлам и точной
следующей командой. Остановись без Docker и paid E2E.
```

## Prompt 11.4 — deterministic preflight gate

Start a fresh chat, paste the Prompt 11.3 report, then paste:

```text
Работай в D:\presentation. Прочитай AGENTS.md, проверь git status и открой
plans/cost-controlled-presentation-generation/11-section-quality-and-terminal-release-handoff.md.
Выполни только Prompt 11.4, используя приложенный отчёт Prompt 11.3.
Сохрани несвязанные изменения. Это только local preflight: не запускай paid
AI, Docker rebuild/deploy, smoke или commit.

Проверь детерминированно весь будущий AITUNNEL Plan 09 path:
- v4 policy имеет ровно 20 narration buckets и cap 17 ₽;
- real candidate и fallback builders для orders 1–10, включая длинные русские
  title/keyMessage/source label/excerpt, укладываются в 0.25/1.20 ₽;
- batch получает 20 уникальных idempotency keys в одном envelope;
- candidate success освобождает только свой fallback;
- candidate+fallback quality terminal error освобождает все unused rows и не
  меняет settled rows;
- safe telemetry содержит reason/stage/slide order, но не narration, source,
  raw error или secrets;
- all-Lite success path остаётся допустимым.

При gap добавь только deterministic test или минимальную local fix. Не меняй
policy cap, routing, retry policy или provider count. Запусти relevant worker
tests, worker/api/web typecheck, npm run check, npm run test и git diff --check.

В конце ответь только: «готово к E2E» или «не готово», причины, нужные
сервисы и одну точную smoke-команду. Не выполняй paid call.
```

## Prompt 11.5 — one paid E2E

Use this only after Prompt 11.4 says **«готово к E2E»**. Start a fresh chat,
paste that report, then paste this exact authorization:

```text
Разрешаю ровно один paid E2E Plan 09 без повторов.

Работай в D:\presentation. Прочитай AGENTS.md и git status. Сохрани
несвязанные изменения. Пересобери только сервисы по diff; для worker-only
изменений это только worker. До запуска проверь пустую queued generation
очередь и API health.

Запусти ровно один isolated live generation smoke с
RUN_LIVE_GENERATION_SMOKE=true и локально загруженными секретами, не печатая
секреты. Не создавай второй project/job и не повторяй smoke при любой ошибке.
Сразу после terminal result останови worker.

При success проверь 10 slides, 10 accepted sections, 1170–1560 words,
production gate, export, envelope ≤17 ₽, costs и released reservations.
При failure не повторяй: read-only извлеки project/job, AiUsageEvent,
CostEnvelope, все reservations и safe worker logs. Покажи только safe
categories, stages, costs и reservation statuses. Не коммить.
```

## Operating rules for the user

1. Create a **new Codex chat for each numbered prompt**.
2. Paste the entire prompt from this file, not a shortened paraphrase.
3. Wait for the final report. Copy that report into the next new chat below
   the next prompt's first sentence requesting the preceding report.
4. Do not combine Prompt 11.1–11.5 in one message.
5. Do not write `разрешаю` until Prompt 11.5. That word permits only one paid
   smoke; it does not permit retries.
6. If Codex reports a blocker, paste the report back here instead of asking it
   to skip ahead.
