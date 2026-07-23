# 13 — Управляемый A/B явной YandexGPT Pro версии для narration

## Роль и границы

Выполни только этот пункт в новом чате после успешного завершения 12. Сначала прочитай `AGENTS.md`, README пакета, 12, этот файл, `git status --short` и фактическую provider configuration. Не реализуй 12 заново и не меняй timing/recovery policy из него.

Цель — получить измеримый ответ, улучшает ли **явная доступная версия YandexGPT Pro** соблюдение полного 10-slide narration contract по сравнению с текущим alias. Это не разрешение автоматически перевести production на новую модель, не разрешение добавить OpenAI и не разрешение снизить 9-minute minimum.

Не изменяй сохранённые decks, existing projects, `Presentation.revision`, user canvas, OpenAI/demo fallback policy или provider routes для не-narration операций.

## Что уже известно

Текущая конфигурация primary narration использует `AI_PROVIDER=yandex` и `YANDEX_MODEL_NAME=yandexgpt`; без `YANDEX_MODEL_URI` это разрешается как `gpt://<folder>/yandexgpt/latest`. В локальной usage table этот alias считается YandexGPT Pro 5. Economy stages narrative plan/design brief используют `yandexgpt-5-lite`.

Нельзя назвать переключением на Pro простой перенос narration с Lite: narration уже primary/Pro alias. Эксперимент сравнивает текущий alias только с подтверждённой явной поддерживаемой Pro-version/model URI, например более новой Pro-линейкой, если она доступна данному folder и API. Не выдумывай model id: сначала подтвердить его только в актуальной официальной документации Yandex Cloud и/или доступной account configuration.

## Продуктовое решение

- По умолчанию поведение остаётся текущим `yandexgpt/latest`.
- Candidate model применима только к primary narration и её full rewrite из 12, не к economy narrative planning/design brief.
- Выбор candidate требует явного env/config override; никаких случайных promotion по слову `pro`.
- A/B не запускается на пользовательском проекте и не выполняется автоматически в production request path.
- Решение о promotion принимает пользователь после отчёта с качеством, word count, latency, provider usage и рублёвой стоимостью.

## Реализация

### 1. Подтверди candidate и цены до изменения кода

Перед кодом:

1. Найди актуальные официальные Yandex Cloud / AI Studio документы о model URI, доступных Pro-models и synchronous token pricing. Не опирайся на старые блоги или неофициальные сайты.
2. Проверь текущие `.env` значения без вывода API key/token.
3. Найди локальный `getYandexModelConfig(...)` и `apps/worker/src/usage-ledger.ts`.
4. Запиши в итог: current alias, candidate exact ID/URI, pricing source, currency, rate input/output tokens и expected multiplier relative to `yandexgpt`.
5. Если candidate нельзя подтвердить или он не доступен folder, не меняй production config и заверши с конкретным blocker report.

### 2. Добавь узкий override только для narration primary calls

Добавь явно документированную конфигурацию, например `YANDEX_NARRATION_MODEL_NAME` и при необходимости `YANDEX_NARRATION_MODEL_URI`. Используй названия, совместимые с существующей env naming convention после проверки кода.

Требования:

- если override не задан, exact existing `getYandexModelConfig("primary")` path не меняется;
- override применяется только к full narration и full duration rewrite, не к planning/design/structured slide generation;
- `requestYandexText(...)` получает resolved model config через явный option или маленький adapter, без чтения env scattered по callers;
- every usage event/log для narration содержит фактическое `model` name; секреты и полный URI с folder ID в публичный UI/log не выводить;
- usage ledger получает цену candidate из явной актуальной table/version или, если цены не подтверждены, честно сохраняет `unknown_price`, а не подставляет цену текущего alias;
- не добавляй OpenAI path, fallback и не меняй default model глобально.

### 3. Сделай A/B запуск явным и ограниченным

Не добавляй автоматический background experiment. Достаточен документированный локальный operator flow:

1. Создать два новых изолированных projects с одинаковыми title-independent prompt, scenario, level, mode, slide count и sources policy.
2. Первый запуск без narration override — baseline.
3. Второй — с candidate override, применённым только на время нового worker запуска.
4. Для каждого зафиксировать: model, job status, public error или acceptance, total narration words, duration, quality/spoken issue count, number of Yandex calls, latency, input/output tokens и rub cost.
5. Не rerun автоматически после failure; не более одного baseline и одного candidate paid run без следующего explicit user approval.

Если проект имеет готовую admin cost endpoint/DB query, используй существующую безопасную surface. Не создавай новую admin UI ради эксперимента.

### 4. Дай механическое promotion rule, но не включай его

Добавь/документируй deterministic result summary. Candidate считается лучше только если одновременно:

- проходит 1170–1560 words и all existing narration quality checks;
- не добавляет plan leakage, repeated phrases, template text, unsupported facts или release-gate regression;
- не использует больше одного full duration rewrite;
- имеет понятную стоимость и latency;
- пользователь вручную одобрил promotion.

Если хотя бы один quality requirement не выполнен, default alias остаётся production primary. Нельзя выбирать candidate только потому, что он длиннее.

## Тесты

Добавь deterministic tests, не требующие Yandex network:

1. Без override narration calls используют текущий primary `yandexgpt/latest` mapping.
2. С valid narration override только narration и full rewrite получают candidate; narrative plan/design brief остаются economy/current routes.
3. Blank/invalid override безопасно fails loudly before provider call или игнорируется строго по документированному default; выбери один вариант и тестируй его.
4. Usage event сохраняет candidate model и применяет verified price; непроверенная цена становится `unknown_price`, не ценой alias.
5. Existing Yandex-only/no-demo/no-OpenAI provider-selection tests остаются зелёными.

Запусти:

```powershell
npm run test -w @studydeck/worker -- presentation.test.ts
npm run typecheck -w @studydeck/worker
npm run build -w @studydeck/shared
docker compose config --quiet
git diff --check
```

## Paid runtime protocol

Запускай paid A/B только после отдельного явного подтверждения пользователя, даже если код готов. Перед запуском:

- сообщи candidate model и подтверждённую цену;
- сообщи, что будет максимум два paid narration jobs;
- пересобери только worker;
- убедись в `AI_PROVIDER=yandex`, `ALLOW_DEMO_GENERATION=false`, пустом `OPENAI_API_KEY`;
- не удаляй baseline/candidate records без пользовательского решения.

После run выдай компактную таблицу baseline/candidate и не включай override в default `.env` без явного одобрения.

## Приёмка

Пункт принят, если default production behaviour не изменён без флага, candidate model и цена не выдуманы, A/B может быть проведён с ограниченным числом Yandex calls и наблюдаемой стоимостью, а promotion остаётся ручным quality-first решением. Никаких OpenAI/demo fallback, тихого изменения всех pipeline stages или изменения timing contract.
