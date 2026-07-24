# 15 — Восстановление CostEvent telemetry для web-search

## Скопируй этот prompt в новый чат Codex

Работай в D:\presentation.

Сначала прочитай AGENTS.md, затем:
- plans/future-generation-reliability/README.md
- plans/future-generation-reliability/14-yandex-full-rewrite-duration-compliance-and-controlled-smoke.md
- этот файл.

Перед изменениями выполни git status --short и не трогай несвязанные изменения. Выполни только этот пункт. Не запускай paid Yandex/Tavily запросы без отдельного разрешения пользователя.

## Контекст

Во время A/B 23.07.2026 AiUsageEvent сохранил Yandex tokens, latency и RUB cost, но worker залогировал PrismaClientValidationError при prisma.costEvent.upsert() категории web_search: cost telemetry could not be persisted.

Следствие: AI cost видна, но общая стоимость generation неполна, потому что Tavily web-search CostEvent не сохранён. Это observability/financial-correctness проблема, а не причина narration failure. Она не должна менять provider routing, timing contract, source relevance rules или public error.

Основные seams:
- apps/worker/src/usage-ledger.ts: recordCostEvent
- apps/worker/src/tasks/web-search.ts: Tavily call и CostEvent
- apps/worker/src/tasks/image-search.ts, export.ts, defense/jobs.ts: другие consumers
- prisma/schema.prisma: CostEvent
- apps/api/src/admin/admin.service.ts: aggregation reads.

## Цель

Добейся, чтобы каждый успешный Tavily web-search в usage context создавал один idempotent valid CostEvent с корректными project/job links, quantity, measurement, source/RUB cost (если цена есть) и pricing version. Telemetry failure остаётся non-fatal для generation, но должна быть диагностируемой и не скрывать Prisma cause.

## Диагноз до правки

1. Прочитай полный CostEvent schema, recordCostEvent, все callers и tests.
2. В read-only режиме извлеки точное полное Prisma validation message из worker log или isolated mocked Prisma invocation. Не ограничивайся pino-truncated text.
3. Сверь create payload с schema, особенно nullable relation IDs projectId/generationJobId/exportId, Decimal values, enum category/measurement, occurredAt и undefined price.
4. Проверь idempotency: повторный тот же idempotencyKey не создаёт дубликат и не меняет recorded monetary values.
5. Не редактируй историю A/B и не дописывай пропущенные production records без отдельного решения пользователя.

Если причина не в recordCostEvent, исправь минимальный фактический seam и объясни это в отчёте.

## Реализация

1. Внеси минимальную корректировку в recordCostEvent и/или web-search caller, чтобы Prisma получал только допустимый payload.
2. Сохрани current usage context и один deterministic idempotency key на фактический Tavily query/job.
3. Не делай CostEvent обязательным для generation. При failure web-search result остаётся usable, а structured log включает безопасные category, provider, context presence и Prisma error class/message.
4. Не логируй API keys, полный user prompt, folder ID или source content.
5. При unset TAVILY_CREDIT_PRICE_USD сохрани event с sourceCost/rubCostAtEvent = null, не ноль. При заданной цене используй existing exchange-rate mechanism.
6. Не меняй narration routing, fallback policy, timing rules, DB history или admin UI.

## Deterministic tests

Добавь focused mocked tests:
1. Tavily web-search в complete usage context передаёт valid upsert create payload и expected project/job IDs.
2. Optional IDs, включая exportId, передаются допустимым Prisma образом; test воспроизводит обнаруженный production failure до fix и защищает fix.
3. Unset price сохраняет event с null monetary fields.
4. Configured USD price плюс known exchange rate даёт корректные source/RUB cost без floating point.
5. Same idempotency key не создаёт второй event.
6. Prisma rejection пишет structured log, но не отменяет successful web-search result.
7. Existing image-search/export/defense telemetry tests остаются зелёными.

Все network calls mock. Не вызывай Tavily/Yandex.

## Проверки

npm run test -w @studydeck/worker -- web-search.test.ts usage-ledger.test.ts image-search.test.ts export.test.ts
npm run typecheck -w @studydeck/worker
npm run build -w @studydeck/shared
docker compose config --quiet
git diff --check

Если нужен live proof, сначала попроси отдельное разрешение на один paid Tavily/Yandex smoke. Без разрешения закончи по mocked Prisma tests и честно укажи отсутствие live proof.

## Paid protocol после разрешения

Пересобери только worker. Создай один новый isolated project, не меняй A/B projects 23.07.2026. После run read-only query/log должен подтвердить ровно один CostEvent с category web_search, совпадающими project/job IDs и корректными monetary fields или null при unset price. Второй paid rerun запрещён.

## Приёмка

Пункт принят, если validation error устранён в deterministic reproduction, CostEvent валиден и idempotent, стоимость не выдумывается, telemetry наблюдаема и non-fatal, остальные consumers не регрессируют, а paid calls не выполняются без разрешения. В конце сообщи root cause, файлы, tests, live proof и remaining risks.

