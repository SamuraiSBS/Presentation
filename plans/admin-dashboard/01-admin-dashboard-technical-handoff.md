# StudyDeck: административная панель, экономика сервиса и операционный контроль

## Назначение документа

Это самодостаточный технический handoff для нового чата Codex. Нужно реализовать административную панель внутри текущего монорепозитория StudyDeck AI в `D:\presentation`.

Пользователь уже согласовал продуктовые решения ниже. Не нужно заново спрашивать, нужна ли админка, какие основные разделы в ней должны быть или следует ли учитывать фактические AI-расходы. Перед кодом нужно проверить живое состояние репозитория и затем выполнять реализацию по этапам до работающего результата.

Этот документ разрешает изменения в:

- `prisma`;
- `packages/shared`;
- `apps/api`;
- `apps/worker`;
- `apps/web`;
- `.env.example` и `docker-compose.yml` в части новой конфигурации;
- тестах и документации, непосредственно относящихся к админке.

Не менять legacy MVP в корне (`server.js`, root HTML/CSS/JS), если это не потребуется отдельно.

## Перед началом

1. Прочитать `AGENTS.md`, `PRODUCT.md`, `DESIGN.md` и этот файл полностью.
2. Выполнить `git -c safe.directory=D:/presentation status --short` и изучить текущий diff.
3. Рабочее дерево уже может содержать большой незавершённый блок личного кабинета, Telegram Auth, пользователей, папок, совместной работы и обновлённой Prisma-схемы. Считать его актуальной основой. Не откатывать, не перезаписывать и не удалять эти изменения.
4. Повторно открыть фактические версии как минимум:
   - `prisma/schema.prisma`;
   - `apps/web/src/lib/auth-options.ts`;
   - `apps/web/src/lib/internal-api.ts`;
   - `apps/web/src/middleware.ts`;
   - `apps/api/src/auth/internal-auth.guard.ts`;
   - `apps/api/src/billing/billing.service.ts`;
   - `apps/api/src/observability.ts`;
   - `apps/worker/src/observability.ts`;
   - `apps/worker/src/tasks/presentation.ts`;
   - `apps/worker/src/tasks/generation.ts`;
   - `apps/worker/src/tasks/web-search.ts`;
   - `apps/worker/src/tasks/image-search.ts`;
   - `apps/worker/src/tasks/job-progress.ts`.
5. Перед изменением расчёта цены проверить актуальные официальные документы OpenAI, Yandex Cloud, Tavily и Stripe. Не полагаться на запомненные тарифы. В коде не зашивать тариф навсегда без `effectiveFrom`/версии цены.
6. Если найден конфликт между этим handoff и более новым фактическим кодом, сохранить продуктовые требования документа, но адаптировать конкретные имена файлов и API к текущей архитектуре.

## Зафиксированные продуктовые решения

- Сейчас администратор один.
- На локальном production-like стенде `http://localhost:3010/admin` доступ должен быть открыт без проверки Telegram ID через отдельный явный dev-флаг.
- В production доступ разрешён только Telegram ID из серверного allowlist.
- Админка не только просматривает данные, но и выполняет административные действия.
- Расходы показываются отдельно по категориям и общей суммой.
- Основная валюта интерфейса — российский рубль.
- Валютные расходы пересчитываются по актуальному курсу; одновременно нужно сохранять исходную валюту и курс на момент события.
- Для AI нужна фактическая стоимость каждого запроса по реально возвращённым токенам.
- Главный экран: пользователи, выручка, расходы и ошибки.
- Остальные направления вынесены в отдельные пункты/разделы административной навигации.
- Период выбирается фильтром, включая произвольный диапазон.
- Основной часовой пояс — `Europe/Moscow`.
- Карточка пользователя должна показывать профиль, регистрацию, последнюю активность, тариф, подписку, проекты, генерации, слайды, экспорты, ошибки, расходы, оплаты и историю действий.
- Полные промпты, исходные материалы и содержимое презентаций по умолчанию администратору не показывать. Допустимы названия проектов и безопасные технические метаданные.
- Важные структурированные события и ошибки хранить в PostgreSQL ограниченное время; полный stack trace и диагностику оставлять в Sentry.
- Telegram-уведомления об операционных проблемах и бюджете включать только в production.
- Существующий незавершённый блок личного кабинета считать актуальной основой.

## Текущая архитектура и важные ограничения

- Web: Next.js App Router, Auth.js/NextAuth, BFF routes под `apps/web/src/app/api/**`.
- API: NestJS с глобальным `/v1` prefix.
- Worker: BullMQ, Redis, PostgreSQL, MinIO.
- Контракты: Zod и типы в `packages/shared`.
- Пользователи уже имеют `telegramId`, `planCode`, Stripe identifiers и `subscriptionStatus` либо получают их из текущего личного кабинета.
- В базе уже есть проекты, `GenerationJob`, `Export`, `UsageCounter` и ошибки отдельных сущностей.
- Pino пишет структурированные JSON-логи в stdout. Эти логи сами по себе не являются базой для фильтруемой админки.
- Sentry уже подключён и должен оставаться неблокирующим и DSN-gated.
- Секреты, cookies, токены, prompt/content уже редактируются в observability helpers. Новые события должны использовать те же правила или общий вынесенный helper.
- OpenAI structured generation через AI SDK сейчас может отбрасывать `usage`, возвращая только `result.output`.
- Legacy OpenAI Responses path также возвращает usage в ответе, но текущая функция может его не сохранять.
- Yandex response type может не описывать usage, даже если провайдер его возвращает. Нужно сверить реальный официальный контракт и расширить parsing безопасно.
- Исторические генерации, созданные до внедрения telemetry, не имеют точных токенов. Не вычислять и не выдавать вымышленные исторические расходы как фактические.

## Архитектурная схема результата

```text
Browser /admin/**
  -> Next.js server page + Auth.js session
  -> Next.js BFF /api/admin/**
       -> INTERNAL_API_TOKEN + trusted session user id
       -> NestJS /v1/admin/**
            -> InternalAuthGuard
            -> AdminAccessGuard
            -> Admin services / Prisma / BullMQ / Stripe

Worker provider call
  -> normalized provider result { value, usage, providerRequestId }
  -> pricing catalog + exchange-rate snapshot
  -> AiUsageEvent / CostEvent
  -> aggregate Admin API

API/worker operational error
  -> existing redacted Pino + Sentry
  -> redacted OperationalEvent
  -> alert evaluator
  -> Telegram only in production
```

Браузер никогда не получает `INTERNAL_API_TOKEN` и не может передать произвольный `userId` или `telegramId`, чтобы стать администратором.

## 1. Права администратора

### Production

Добавить серверную переменную:

```dotenv
ADMIN_TELEGRAM_IDS=
ALLOW_DEV_ADMIN=false
```

`ADMIN_TELEGRAM_IDS` — список Telegram `sub`/`telegramId`, разделённый запятыми. Username Telegram не использовать как identity: он изменяемый.

Создать централизованный `AdminAccessGuard` в API:

- он выполняется после `InternalAuthGuard`;
- получает доверенный `request.userId`;
- загружает пользователя из Prisma;
- в production допускает только пользователя, чей `telegramId` входит в `ADMIN_TELEGRAM_IDS`;
- отсутствие Telegram ID, пустой allowlist или несовпадение возвращает 403;
- не полагается только на скрытый пункт меню или web middleware.

На web добавить server-side helper вроде `requireAdminSession()` и защищать:

- страницы `/admin/**`;
- BFF `/api/admin/**`;
- показ пункта «Админка» в app chrome.

### Localhost:3010

`ALLOW_DEV_ADMIN=true` должен разрешать локальный доступ к админке без Telegram ID, включая production-like Docker web на `localhost:3010`.

Это отдельный явный флаг, потому что Docker web может работать с `NODE_ENV=production`. Не пытаться определять локальный доступ только по `NODE_ENV`.

Защита от случайного production bypass:

- документировать `ALLOW_DEV_ADMIN=false` как production default;
- передать флаг в local compose явно;
- если в проекте есть отдельный `DEPLOYMENT_ENV`/production marker, при production marker + `ALLOW_DEV_ADMIN=true` завершать запуск или как минимум писать критическую ошибку и запрещать bypass;
- не определять доверие по присланному браузером `Host` без дополнительной серверной конфигурации.

## 2. Prisma: модели экономики, событий и аудита

Финальные имена можно адаптировать к текущей схеме, но семантика обязательна.

### `AiUsageEvent`

Одна запись — одна фактическая попытка обращения к AI-провайдеру, включая repair/retry.

Минимальные поля:

- `id`;
- уникальный `idempotencyKey`;
- nullable `userId`, `projectId`, `generationJobId` с индексами;
- `provider` (`openai`, `yandex`, future-safe string/enum);
- `model`;
- `operation`/`schemaName`/`stage`;
- `attempt`;
- `providerRequestId` nullable;
- `status` (`succeeded`, `failed`, `unknown_usage`);
- `inputTokens`;
- `outputTokens`;
- `cachedInputTokens` nullable;
- `reasoningTokens` nullable;
- `totalTokens` nullable;
- `durationMs`;
- `sourceCurrency`;
- snapshot цены input/output/cached/reasoning на миллион токенов;
- `sourceCost`;
- `exchangeRateToRub`;
- `rubCostAtEvent`;
- `pricingVersion`/`priceEffectiveFrom`;
- `startedAt`, `finishedAt`, `createdAt`;
- безопасный `errorCode`/`errorClass`, но не raw prompt/response.

Деньги и курсы не хранить в JS float. Предпочтительно Prisma `Decimal` с достаточной точностью (`Decimal(20, 8)` или лучше после проверки агрегатов), а в JSON DTO сериализовать строкой либо целым количеством микрорублей. Выбрать один способ и применить последовательно.

### `CostEvent`

Для расходов, не являющихся AI-токенами:

- `category`: `web_search`, `image_search`, `storage`, `export_compute`, `payment_fee`, `other`;
- nullable `userId`, `projectId`, `generationJobId`, `exportId`;
- `provider`;
- `quantity`, `unit`, `unitPrice`;
- `sourceCurrency`, `sourceCost`;
- `exchangeRateToRub`, `rubCostAtEvent`;
- `measurement`: `provider_reported` или `calculated`;
- `pricingVersion`;
- `occurredAt`;
- уникальный `idempotencyKey`.

UI обязан визуально различать фактическую/provider-reported стоимость и расчётную стоимость. Например, storage GB-days и локальный export compute обычно являются расчётными, а не точной строкой счёта облачного провайдера.

### `ExchangeRate`

- `baseCurrency`;
- `quoteCurrency` (`RUB`);
- `rate`;
- `provider`;
- `effectiveAt`;
- `fetchedAt`;
- unique по валютной паре и дате/эффективному моменту.

Получать актуальный курс серверно, кешировать ежедневно, использовать последний успешный курс при временной сетевой ошибке. Не блокировать генерацию из-за недоступности курса: сохранить исходную стоимость и пометить RUB conversion pending, затем дозаполнить безопасным reconcile job.

### `PaymentTransaction`

- nullable `userId` с `onDelete: SetNull`;
- Stripe customer/subscription/invoice/payment intent/charge ids;
- уникальный `stripeEventId` или иной idempotency key;
- `type`: payment, refund, dispute, fee, adjustment;
- `status`;
- `grossAmount`, `feeAmount`, `netAmount`;
- `currency`;
- RUB snapshot amounts и FX rate;
- `occurredAt`, `createdAt`;
- безопасные metadata без полного Stripe payload.

Финансовые записи не должны исчезать каскадно при удалении пользователя. Для удалённого пользователя сохранять анонимную связь/nullable id без PII.

### `OperationalEvent`

- `service`: web/api/worker;
- `severity`: info/warn/error/critical;
- `category`/`operation`/`stage`;
- nullable `userId`, `projectId`, `jobId`, `exportId`;
- redacted `message`;
- `errorClass`, `errorCode`, HTTP status;
- nullable `sentryEventId`;
- `fingerprint` для группировки;
- `occurredAt` и `expiresAt`;
- индексы по времени, severity, service, user/project/job.

Не превращать PostgreSQL в полный stdout log sink. Сохранять только события, полезные для админки: ошибки, предупреждения, старт/финиш ключевых операций и существенные изменения состояния.

### `AdminAuditLog`

- actor user id;
- action;
- target type/id;
- обязательная причина для опасных действий;
- JSON metadata только из allowlisted полей;
- occurredAt;
- request/correlation id.

Admin audit immutable: не предоставлять API удаления/редактирования этих записей.

### Активность и административные поля пользователя

Добавить или адаптировать:

- `lastSeenAt`;
- `blockedAt`, `blockedById`, `blockReason`;
- manual plan override: plan, start/end, reason, actor;
- при необходимости отдельный `UserActivityEvent` для login, project create, generation start/finish, export и billing событий.

Не писать activity event на каждый GET/poll. `lastSeenAt` обновлять throttled, например не чаще одного раза в 10–15 минут.

## 3. Каталог цен и пересчёт валют

Создать единый серверный pricing service, используемый worker/API. Не размазывать арифметику по presentation tasks.

Он должен:

- выбирать цену по provider + model + effective timestamp;
- отдельно считать input/output/cached/reasoning, когда доступны;
- поддерживать исторические версии;
- возвращать Decimal-safe breakdown;
- прикладывать источник/версию цены;
- не падать на неизвестной модели: сохранять usage со статусом `unknown_price`, показывать его в админке и отправлять alert;
- поддерживать reconcile после добавления недостающей цены;
- не пересчитывать уже сохранённый `rubCostAtEvent` задним числом;
- отдельно вычислять отображаемую оценку по текущему курсу, если пользователь выбрал такую колонку.

Для требования «пересчитывать на текущий курс» в UI показывать:

- основную колонку «По текущему курсу»;
- tooltip/детали «На момент события»;
- исходную валюту и сумму.

Таким образом бухгалтерский snapshot не теряется, но текущий RUB total соответствует запросу пользователя.

## 4. Инструментация AI и других расходов

### OpenAI AI SDK

Изменить provider wrapper так, чтобы он не терял `result.usage`, response metadata и request id.

Не ломать публичный generic contract `generateStructuredWithProvider<T>`. Предпочтительный подход:

- внутренний результат `{ value, telemetry }`;
- либо dependency-injected `onUsage` callback/context;
- верхний уровень по-прежнему возвращает `T` вызывающему generation pipeline;
- telemetry записывается после каждого provider call, включая validation repair attempts.

### OpenAI legacy Responses

Сохранять usage из response и request id. Учесть различие полей SDK version. Не логировать input/output body.

### Yandex

По официальному текущему контракту расширить response type для usage. Если usage отсутствует:

- сохранить событие `unknown_usage`;
- не оценивать токены самодельным `text.length / N` как фактические;
- показать это в админке и OperationalEvent;
- generation должна продолжать работать.

### Контекст пользователя

Передать безопасный telemetry context через generation pipeline:

- `userId` владельца проекта;
- `projectId`;
- database `GenerationJob.id` и BullMQ job id;
- operation/stage/schemaName;
- attempt.

Не начислять расход collaborator/editor как расход владельца интерфейсно без явного правила. Экономический расход проекта относится к владельцу `Project.userId`; actor при необходимости хранится отдельно.

### Tavily и изображения

На успешные web/image search вызовы писать отдельные `CostEvent` с количеством запросов/credits согласно реальному provider contract и текущему pricing catalog.

Скачанные/обработанные изображения учитывать отдельно:

- network/provider search cost;
- сохранённые bytes для storage estimate;
- не считать бесплатную загрузку изображения «фактической платной операцией», если провайдер её не тарифицирует.

### Storage и export

Storage считать как расчётную величину по bytes × времени хранения × настроенной цене GB-month/GB-day.

Export compute считать только при наличии согласованной unit price CPU/minute или flat operation price. В UI маркировать `calculated`, не `provider reported`.

## 5. Stripe, выручка и подписки

Расширить существующий webhook идемпотентно. Обрабатывать минимум:

- checkout completion;
- subscription created/updated/deleted;
- invoice paid/payment succeeded;
- invoice payment failed;
- charge refunded;
- dispute/chargeback, если используется;
- payment fee/net через Stripe balance transaction, если доступно используемому аккаунту/API.

Не считать `checkout_completed` выручкой. Выручка появляется только из подтверждённой платёжной транзакции.

Сохранять Stripe event id и не проводить один webhook дважды. Существующий update `User.planCode` сохранить, но ручной admin plan override не должен подменять или разрушать Stripe subscription state.

Агрегаты:

- gross revenue;
- refunds;
- fees;
- net revenue;
- active/cancelled/past_due subscriptions;
- revenue by plan;
- revenue by user;
- expenses;
- contribution margin = net revenue minus tracked expenses.

Не называть margin «чистой прибылью», если не учтены зарплаты, налоги и вся инфраструктура.

## 6. Блокировка и ручной тариф

### Блокировка

Блокировка должна проверяться централизованно в API после identity resolution, а не в отдельных UI-кнопках.

Заблокированный пользователь:

- не создаёт/изменяет/генерирует/экспортирует;
- получает стабильный 403 code и русское сообщение;
- может при необходимости открыть страницу с объяснением блокировки;
- admin endpoints для разблокировки остаются доступны администратору.

Не блокировать фоновые финансовые webhooks или admin access из-за target user block.

### Manual plan override

Хранить отдельно от Stripe state:

- override plan;
- expiresAt nullable;
- reason;
- actor;
- audit record.

UsageService должен вычислять effective plan детерминированно: активный manual override, иначе Stripe/current `planCode`.

## 7. Административные действия первой версии

Реализовать:

1. Блокировка/разблокировка пользователя.
2. Назначение временного или бессрочного manual plan override.
3. Повтор неуспешной генерации.
4. Повтор неуспешного экспорта.
5. Отмена queued job.
6. Для active generation — cooperative cancel через `cancelRequestedAt` и проверки на безопасных границах стадий; не обещать мгновенное убийство выполняющегося provider HTTP request, если cancellation signal туда не проведён.
7. Удаление проекта через существующий storage-aware service с явным подтверждением и audit.

Для каждой mutation:

- AdminAccessGuard;
- Zod/shared DTO validation;
- reason для блокировки, удаления, plan override и отмены;
- idempotency/repeated-click safety;
- audit record в той же транзакции, где это возможно;
- понятный toast/result;
- invalidation только релевантных TanStack Query keys.

Не включать в первую версию:

- impersonation/login as user;
- просмотр raw prompts и source contents;
- возвраты денег из админки;
- редактирование финансовых транзакций;
- shell/SQL console в браузере.

Возвраты пока выполняются в Stripe Dashboard и синхронизируются webhook.

## 8. Admin API

Создать отдельный NestJS `AdminModule` с контроллерами/сервисами. Не помещать административные запросы в обычные user services.

Ожидаемые endpoints, имена можно адаптировать:

```text
GET  /v1/admin/overview
GET  /v1/admin/users
GET  /v1/admin/users/:id
GET  /v1/admin/users/:id/activity
GET  /v1/admin/revenue
GET  /v1/admin/costs
GET  /v1/admin/generations
GET  /v1/admin/errors
GET  /v1/admin/logs
GET  /v1/admin/audit
GET  /v1/admin/alerts

POST /v1/admin/users/:id/block
POST /v1/admin/users/:id/unblock
PUT  /v1/admin/users/:id/plan-override
DELETE /v1/admin/users/:id/plan-override
POST /v1/admin/generations/:id/retry
POST /v1/admin/generations/:id/cancel
POST /v1/admin/exports/:id/retry
DELETE /v1/admin/projects/:id
PUT  /v1/admin/alerts/:id
```

Все list endpoints:

- cursor pagination либо проверенная offset pagination для админского объёма;
- server-side sort;
- фильтры;
- total/summary без загрузки всех строк в память;
- не возвращают full presentation JSON, raw prompt, source text или credentials;
- возвращают money как безопасные string/micro-unit DTO.

Общий time filter:

- today;
- 7 days;
- 30 days;
- current month;
- all time;
- custom `from`/`to`;
- интерпретация календарных границ в `Europe/Moscow`, хранение timestamps в UTC.

Общие фильтры:

- provider/model;
- plan;
- user;
- project/job;
- status;
- expense category;
- error severity/service/stage;
- фактическая или расчётная стоимость.

Добавить shared Zod schemas/types для query и response contracts. Не дублировать интерфейсы в web вручную.

## 9. Web/BFF

Создать BFF routes под `apps/web/src/app/api/admin/**`, использующие существующий server-side internal API helper и session identity.

Не делать browser -> Nest прямые вызовы. Не принимать `x-user-id`, `telegramId` или admin flag из браузера.

Для client polling/filtering использовать TanStack Query. Создать отдельный `admin-queries.ts` или тематически разделённые query modules.

## 10. Интерфейс `/admin`

Админка — плотный рабочий инструмент, не маркетинговая страница.

Сохранить визуальный язык StudyDeck:

- Nunito и существующие app tokens;
- оранжевый — действие/active navigation;
- зелёный — healthy/success;
- красный — реальные ошибки/опасность;
- фиолетовый — AI/provider context, но не декоративный градиент;
- существующие UI primitives, Radix и Lucide;
- без glassmorphism, gradient text, бесконечной сетки одинаковых карточек и декоративной анимации.

Структура:

```text
/admin                     Обзор
/admin/users               Пользователи
/admin/users/[id]          Пользователь
/admin/revenue             Выручка и подписки
/admin/costs               Расходы
/admin/generations         Генерации и очереди
/admin/errors              Ошибки
/admin/logs                Технические события
/admin/audit               Действия администратора
/admin/alerts              Уведомления
```

### Общая оболочка

- отдельная admin side navigation на desktop;
- collapsible/navigation drawer на узких экранах;
- общий фильтр периода;
- indication «Локальный открытый доступ» при `ALLOW_DEV_ADMIN=true`;
- indication московского времени;
- loading skeletons;
- обучающие empty states;
- error state с retry;
- keyboard navigation и видимые focus states.

### Overview

Первый экран показывает четыре главных направления:

- пользователи: total, new, active;
- выручка: gross/net, активные подписки;
- расходы: total/current RUB, breakdown;
- ошибки: count, critical, failure rate.

Не использовать шаблон «одно гигантское число + одинаковые карточки». Сделать компактный операционный summary, trend rows и две полезные области:

- динамика выручки/расходов;
- последние критические ошибки и проблемные генерации.

Если библиотека графиков не установлена, не добавлять тяжёлую библиотеку ради двух линий. Допустим аккуратный accessible SVG chart или табличный trend view. Не строить графики вручную, если в текущем worktree уже есть выбранная библиотека.

### Users

Таблица:

- avatar/name/Telegram;
- registered/last seen;
- plan/subscription;
- projects/generations;
- AI cost;
- total cost;
- revenue;
- margin;
- errors;
- blocked status.

Search по name, Telegram username/id и user id. Server pagination и sort.

### User detail

Header profile + actions, затем tabs:

- Summary;
- Projects;
- Generations;
- Costs;
- Payments;
- Errors;
- Activity;
- Admin audit.

По умолчанию не показывать prompt/source content/presentation document. Название проекта допустимо. Добавить явную подпись, что чувствительное содержимое скрыто.

### Costs

- summary total;
- breakdown AI/Tavily/images/storage/export/fees;
- provider/model/stage breakdown;
- actual vs calculated indication;
- source currency, current RUB, event-time RUB;
- unknown price/usage queue.

### Errors and logs

- grouped errors by fingerprint;
- count/first seen/last seen/affected users;
- service/provider/stage;
- safe message;
- project/job links;
- Sentry link/id, если настроено;
- raw stack не хранить/не показывать из PostgreSQL.

## 11. Telegram alerts

Production-only variables:

```dotenv
ADMIN_TELEGRAM_BOT_TOKEN=
ADMIN_TELEGRAM_CHAT_ID=
ADMIN_ALERTS_ENABLED=false
ADMIN_DAILY_COST_ALERT_RUB=
ADMIN_ERROR_BURST_THRESHOLD=
```

Если в проекте уже есть безопасный Telegram bot client, переиспользовать. Иначе достаточно маленького injected notifier поверх Telegram Bot API, без новой тяжёлой библиотеки.

Условия первой версии:

- critical API/worker error;
- burst одинакового fingerprint;
- дневные расходы превысили threshold;
- резкий рост расходов относительно предыдущего сопоставимого периода;
- неизвестная цена активной AI-модели;
- provider unavailable;
- job stuck дольше configured threshold.

Обязательно:

- production gate;
- rate limit;
- deduplication window;
- retry с ограничением;
- отсутствие PII, prompts и секретов;
- failure notifier не блокирует generation/API.

Настройки alerts можно хранить в `AdminAlertRule` либо использовать env для первой версии и read-only экран конфигурации. Если реализуется редактирование через UI, секреты bot token/chat id не возвращать и не хранить в открытом виде в БД.

## 12. Retention и maintenance

- `OperationalEvent`: default retention 90 дней.
- Info events можно хранить меньше, например 30 дней; error/critical — 90 дней.
- Financial events и admin audit не удалять retention job.
- Не добавлять новую scheduler-библиотеку без необходимости.
- Использовать существующий BullMQ для ежедневного maintenance/reconcile job либо существующий repo-approved scheduler, если он уже появился.
- Maintenance должен:
  - удалять истёкшие operational events batch-ами;
  - обновлять курс;
  - reconcile unknown price/FX usage;
  - проверять stuck jobs;
  - оценивать alert rules.

## 13. Исторические данные

Миграция не может восстановить реальные токены старых запросов.

Для старых данных:

- backfill user/project/generation counts, statuses и timestamps из существующих таблиц;
- revenue backfill только из надёжных Stripe данных, если доступен безопасный idempotent sync;
- AI cost до telemetry показывать как «Нет данных», а не `0 ₽`;
- явно разделять периоды «с точным учётом» и «до начала учёта»;
- не оценивать старые токены по длине сохранённого текста как фактическую стоимость.

## 14. Тесты

### Pricing/unit tests

- input/output/cached/reasoning calculation;
- Decimal precision на малых token costs;
- model price selected by effective date;
- unknown model does not crash generation;
- current FX vs event-time FX;
- fallback to last known FX;
- totals equal sum of breakdown within chosen precision;
- duplicate provider retry callback does not duplicate event.

### API/auth tests

- non-admin production user gets 403;
- admin Telegram ID gets access;
- username match alone does not grant access;
- local dev flag grants access;
- dev flag disabled denies normal local user;
- empty production allowlist fails closed;
- list endpoints never include prompt/source text/presentation JSON;
- filters respect Moscow date boundaries;
- pagination/sort stable;
- block/unblock, plan override, retry, cancel and delete write audit;
- repeated mutation is idempotent or returns stable conflict;
- blocked user is rejected centrally.

### Worker tests

- OpenAI AI SDK usage persisted;
- legacy Responses usage persisted;
- Yandex usage persisted when present;
- missing usage marked unknown without failing generation;
- repair attempt stored as separate cost;
- Tavily web and image calls stored separately;
- user/project/job context correct;
- telemetry write failure is logged/captured but does not destroy an otherwise valid generated presentation; use a safe retry/outbox approach if required for stronger accounting guarantees.

### Billing tests

- webhook signature path preserved;
- duplicate Stripe event ignored;
- checkout completion alone is not revenue;
- paid invoice creates revenue;
- refund reduces net revenue;
- manual plan override does not mutate Stripe status;
- user deletion does not erase financial ledger.

### Web tests

- local admin shell renders;
- production non-admin state is forbidden;
- overview filters update query;
- table pagination/filtering;
- sensitive content absent;
- destructive action confirmations and reason fields;
- Russian labels fit desktop/mobile;
- keyboard and focus behavior.

### Playwright

Добавить отдельный admin spec с mocked/dev-auth data:

1. Open `/admin` on local dev flag.
2. Change period and verify summary refresh.
3. Search and open a user.
4. Block/unblock with audit entry.
5. Set/remove plan override.
6. Open failed generation and retry.
7. Verify costs breakdown and unknown-cost state.
8. Verify prompt/source content is absent from UI and network response.

Не выполнять реальные AI, Tavily, Telegram и Stripe вызовы в тестах.

## 15. Порядок реализации

### Этап A — foundation и безопасность

1. Re-audit current auth/worktree.
2. Prisma enums/models/migration.
3. Shared Zod contracts.
4. AdminAccessGuard + web `requireAdminSession`.
5. Local open access flag and production fail-closed behavior.
6. Audit log foundation.

Готово, когда admin access tests проходят до появления UI.

### Этап B — usage и cost ledger

1. Pricing catalog/service.
2. Exchange-rate service/cache.
3. OpenAI AI SDK telemetry.
4. OpenAI legacy telemetry.
5. Yandex telemetry.
6. Tavily/image/storage/export events.
7. Idempotency and reconcile paths.

Готово, когда одна тестовая генерация создаёт отдельные provider attempts и точный token/cost breakdown без сохранения prompt.

### Этап C — billing/revenue

1. PaymentTransaction.
2. Stripe webhook event coverage/idempotency.
3. Fee/net/refund handling.
4. Revenue aggregates.

### Этап D — operational events/actions/alerts

1. OperationalEvent sink around existing observability boundaries.
2. Central user block enforcement.
3. Admin mutations and audit.
4. Job cancel/retry.
5. Telegram notifier and dedup.
6. Retention/reconcile maintenance.

### Этап E — API и UI

1. Admin aggregate/list/detail endpoints.
2. Next BFF.
3. Admin shell/navigation.
4. Overview.
5. Users and user detail.
6. Revenue/costs.
7. Generations/errors/logs/audit/alerts.
8. Responsive/accessibility states.

### Этап F — end-to-end verification

1. Targeted tests throughout.
2. Full relevant typecheck/tests.
3. Migration deploy.
4. Production-like compose rebuild.
5. Verify `localhost:3010/admin` and health endpoints.

Не откладывать безопасность, telemetry correctness или tests до этапа «полировки».

## 16. Предполагаемые файлы

Конкретный diff зависит от живого worktree, но ожидаются:

### Prisma/shared

- `prisma/schema.prisma`
- `prisma/migrations/<timestamp>_admin_dashboard_observability/migration.sql`
- `packages/shared/src/index.ts` или тематический shared module, если репозиторий уже разделён
- shared tests

### API

- `apps/api/src/app.module.ts`
- `apps/api/src/admin/**`
- `apps/api/src/auth/admin-access.guard.ts`
- `apps/api/src/auth/**` для blocked-user enforcement
- `apps/api/src/billing/**`
- `apps/api/src/observability.ts`
- pricing/exchange/activity/alert services

### Worker

- `apps/worker/src/tasks/presentation.ts`
- `apps/worker/src/tasks/generation.ts`
- `apps/worker/src/tasks/web-search.ts`
- `apps/worker/src/tasks/image-search.ts`
- `apps/worker/src/tasks/export.ts`
- `apps/worker/src/tasks/job-progress.ts`
- `apps/worker/src/observability.ts`
- новые pricing/usage/maintenance helpers и tests

### Web

- `apps/web/src/middleware.ts`
- `apps/web/src/lib/internal-api.ts`
- `apps/web/src/lib/admin-*.ts`
- `apps/web/src/app/api/admin/**`
- `apps/web/src/app/admin/**`
- `apps/web/src/components/admin/**`
- `apps/web/src/components/app-header.tsx`/admin navigation integration
- `apps/web/src/app/globals.css` либо существующие CSS modules

### Config/tests

- `.env.example`
- `docker-compose.yml`
- `e2e/admin-dashboard.spec.ts`

Не создавать второй параллельный дизайн-системный слой и не добавлять альтернативный ORM/logging/query library.

## 17. Проверка

Минимальная последовательность, адаптировать к текущим scripts:

```powershell
npm run prisma:generate
npm run build -w @studydeck/shared
npm run test -w @studydeck/shared
npm run typecheck -w @studydeck/api
npm run test -w @studydeck/api
npm run typecheck -w @studydeck/worker
npm run test -w @studydeck/worker
npm run typecheck -w @studydeck/web
npm run test -w @studydeck/web
npm run test:e2e
docker compose config --quiet
```

После Prisma migration и изменения web/api/worker выполнить production-like local verification, потому что пользователь явно хочет `localhost:3010`:

```powershell
$env:WEB_PORT='3010'
docker compose run --rm api npm run prisma:deploy
docker compose build web api worker
docker compose up -d web api worker
docker compose ps
curl.exe -s http://localhost:4000/v1/health
curl.exe -k -s https://localhost/api/internal-health
```

Проверить:

- `http://localhost:3010/admin`;
- local open access banner;
- overview period filters;
- user search/detail;
- cost and revenue breakdown;
- failed generation action;
- audit log;
- absence sensitive content;
- mobile width;
- API health.

Если frontend нужно проверять до production build, сначала использовать `npm run dev:web:fast` на `http://localhost:3020`. Финальный критерий этого задания всё равно включает production-like `localhost:3010`.

После typecheck/build не оставлять случайный diff `apps/web/tsconfig.tsbuildinfo` и transient `test-results/`, если они не являются намеренной частью изменения. Не удалять существующие пользовательские артефакты, которые были в worktree до начала задачи.

## 18. Acceptance criteria

- `/admin` реально существует и защищён сервером и API.
- `ALLOW_DEV_ADMIN=true` открывает админку на локальном compose `localhost:3010`.
- Production доступен только allowlisted Telegram ID и fail-closed при пустой конфигурации.
- Overview показывает выбранный период по Москве: users, revenue, expenses, errors.
- Каждый раздел имеет отдельный route и фильтры.
- User detail показывает согласованную статистику, подписку, usage, costs, payments, errors, activity и audit.
- Промпты, source text, presentation JSON, секреты и cookies отсутствуют в admin DTO/UI/events.
- Каждый новый AI request/repair/retry сохраняет реальные provider token usage, если провайдер его возвращает.
- Стоимость разбита по input/output и другим доступным token classes, provider/model/stage/user/project.
- Неизвестная цена/usage показывается как unknown, а не `0 ₽`.
- Траты Tavily, image search, storage, export и payment fees показываются отдельно и в total; calculated items помечены.
- RUB current-rate view и event-time snapshot не смешиваются.
- Stripe revenue основана на фактических payment events, поддерживает refunds/fees и идемпотентна.
- Block/unblock, plan override, retry, cancel и delete работают, требуют подтверждения/причины где нужно и пишут immutable audit.
- Operational events фильтруются, имеют retention и ссылку/идентификатор Sentry без raw stack в БД.
- Production Telegram alerts deduplicated, rate-limited, redacted и не блокируют основной сервис.
- Исторические периоды без token telemetry честно помечены как неполные.
- Targeted tests, typechecks и production-like localhost verification завершены и результаты честно описаны пользователю.

## 19. Non-goals и запреты

- Не делать impersonation.
- Не добавлять возвраты денег через admin UI в первой версии.
- Не показывать raw user content.
- Не хранить полный stdout/Pino поток в PostgreSQL.
- Не хранить raw Sentry stack/attachments в собственной БД.
- Не оценивать отсутствующие исторические токены как «фактические».
- Не использовать Telegram username как admin identity.
- Не доверять browser-provided user/admin headers.
- Не использовать JS floating point для финансового ledger.
- Не блокировать готовую генерацию только потому, что telemetry/FX/Sentry/Telegram временно недоступны; сохранять/reconcile безопасно и сигнализировать об accounting gap.
- Не ослаблять существующие generation/export quality gates.
- Не перезаписывать unrelated dirty-worktree changes.
- Не вводить новую тяжёлую библиотеку графиков, логов, ORM или state management без доказанной необходимости.
- Не делать remote deploy без отдельного явного запроса пользователя.

## Финальная инструкция новому Codex

Если пользователь в новом чате просит реализовать этот файл, считать план согласованным. Не останавливаться после нового анализа или переписывания плана. Сначала проверить live worktree и актуальные provider contracts, затем реализовать этапы, миграцию, тесты и локальный production-like запуск. Задавать дополнительный вопрос только при настоящем блокере или если действие требует новых полномочий, которых нет в этом handoff.
