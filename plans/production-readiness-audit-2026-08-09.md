# StudyDeck AI — аудит готовности к production

Дата: 9 августа 2026 года
Статус: **HOLD — текущую версию нельзя выпускать пользователям без исправления P0**

## 1. Резюме

Проект уже значительно сильнее MVP: это полноценный монорепозиторий с Next.js, NestJS, BullMQ, Prisma, PostgreSQL, Redis, MinIO, несколькими AI-провайдерами, web/image search, редактированием, биллингом и экспортом в PPTX/PDF/DOCX. Интерфейс выглядит цельно, основные мобильные экраны не имеют горизонтального переполнения, а генерация и экспорт покрыты большим количеством детерминированных тестов.

Однако текущая release-конфигурация остаётся локальной, а обязательные quality gates красные. Самая опасная комбинация: deploy-скрипт использует тот же `docker-compose.yml`, где включён dev-admin, `DEPLOYMENT_ENV=local`, присутствуют слабые значения секретов по умолчанию и наружу опубликованы API, PostgreSQL, Redis и MinIO. При таком запуске нельзя гарантировать разграничение доступа и защиту пользовательских данных.

Перед публичным запуском необходимо закрыть три блока:

1. Отделить production-конфигурацию от local/dev и сделать небезопасный запуск невозможным.
2. Сделать release воспроизводимым: чистый commit/tag, CI, зелёные lint/unit/E2E/export gates, immutable image, health check и rollback.
3. Закрыть эксплуатационный минимум: backup/restore, readiness, graceful shutdown, billing/account lifecycle, security headers/rate limits, legal/support страницы и мониторинг с алертами.

## 2. Блокирующие проблемы P0

### P0-1. Production запускается с локальной моделью доверия

Факты:

- `docker-compose.yml` задаёт `DEPLOYMENT_ENV: local` и включает `ALLOW_DEV_ADMIN` по умолчанию.
- Web и API разрешают dev-admin, если `ALLOW_DEV_ADMIN=true` и окружение не равно `production`.
- Web может подставлять `TEMP_USER_ID`/`local-user`, а внутренний API доверяет заголовкам `x-user-id` при совпавшем `INTERNAL_API_TOKEN`.
- В `.env.example` остаются `NEXTAUTH_SECRET=change-me` и `INTERNAL_API_TOKEN=change-me-internal-token`; compose также содержит статические пароли PostgreSQL и MinIO.
- На хост опубликованы `5432`, `6379`, `9000`, `9001`, `4000`, а не только Caddy `80/443`.
- Живой `localhost:3010` сейчас открывает dashboard в dev-режиме без нормального production login flow, что подтверждает реальность конфигурации, а не только теоретический риск.

Что изменить:

- Создать отдельный `compose.production.yml` или production Helm/infra-конфигурацию.
- В production жёстко задать `DEPLOYMENT_ENV=production`, `ALLOW_DEV_AUTH=false`, `ALLOW_DEV_ADMIN=false`, убрать `TEMP_USER_ID`.
- Сделать startup validation: приложение должно завершаться с ошибкой при пустых/default секретах, локальном домене, отсутствующем admin allowlist или включённых dev-флагах.
- Генерировать уникальные секреты через secret manager/CI variables; не использовать `.env.example` как runtime env.
- Убрать host-публикацию PostgreSQL, Redis, MinIO и API; оставить внутреннюю Docker-сеть и публичный Caddy.
- Ограничить сетевой доступ firewall/security group и включить production TLS для реального домена.

Критерий закрытия: из внешней сети доступны только 80/443, anonymous user не попадает в dashboard/admin, а контейнеры отказываются стартовать с default/dev значениями.

**Нужно доделать:**

- На production-сервере создать `.env.production` по `.env.production.example`, подставив секреты из secret manager, реальный домен, Telegram OAuth и Telegram ID администратора.
- Настроить DNS, production TLS и firewall/security group, затем подтвердить из внешней сети: доступны только 80/443, anonymous user перенаправляется на login, а admin доступен только пользователям из allowlist.

### P0-2. Release gates красные и не автоматизированы

**Статус на 10 августа 2026: локальная часть acceptance выполнена, ожидается GitHub CI acceptance.** В репозитории добавлен `.github/workflows/release-gates.yml`: он проверяет lockfile/Prisma/lint/typecheck/unit, secrets, Playwright desktop/mobile, собирает API/worker/web, выполняет migration и golden export smoke в Alpine worker, а после push публикует immutable GHCR images по `@sha256`, проверяет их в compose и формирует release manifest. Deploy и manifest validation также запрещают dirty tree и неполный/неimmutable набор образов. Локально собран Alpine worker, а реальный PDF smoke `renders editable canvas to a real pdf` прошёл внутри образа (10.39 s).

Старый срез проверок на момент аудита:

- TypeScript: проходит во всех четырёх workspace.
- Production build: проходит, но с предупреждениями.
- Lint: **падает — 647 проблем (1 error, 646 warnings) при лимите 57**.
- Unit/integration: shared 100/100, API 55/55, web 34/34; worker **377 passed, 1 failed, 1 skipped**.
- Chromium E2E против текущего `localhost:3010`: **19 passed, 12 failed, 5 skipped**.
- На момент исходной проверки `.github/workflows` отсутствовал; это утверждение больше не является текущим состоянием.

Особенно важно: большая часть lint-шума появилась в незавершённой декомпозиции worker-модулей (`presentation/constants.ts`, `quality/orchestration.ts`, `utilities.ts`). При сотнях предупреждений новый дефект теряется в шуме. В E2E часть падений вызвана рассинхронизацией текущего production-like контейнера и тестового/demo окружения, но это само по себе означает, что release gate невоспроизводим.

Что изменить:

- Устранить lint error и вернуть предупреждения ниже нуля или небольшого временного baseline с датой удаления.
- Добавить CI: install с lockfile, Prisma generate, lint, typecheck, unit/integration, Docker build, migration validation, Playwright desktop/mobile, dependency и secret scan.
- Тестировать именно immutable image, который затем разворачивается, а не другой dev/container build.
- Запретить deploy при dirty tree, красном gate или неполном release manifest.

Критерий acceptance: один опубликованный commit/tag и один digest образов имеют полностью зелёный CI; тот же digest проходит smoke/E2E в staging.

**Нужно доделать для acceptance:**

- Зафиксировать согласованный P0-2 набор отдельным commit и отправить его в GitHub, чтобы впервые выполнить `release-gates.yml` на фактическом SHA.
- После первого зелёного workflow проверить и включить для `main` четыре required checks: `Quality, migrations, and dependencies`, `Secret scan`, `Playwright desktop and mobile`, `Immutable images and staging smoke`.
- Подтвердить в CI полный immutable путь: publish трёх GHCR image, migration, health/smoke именно по опубликованным `@sha256` references и release manifest с SHA текущего commit. До этого критерий «тот же digest разворачивается» не доказан.

### P0-3. Регрессия export preflight — закрыто

**Закрыто 10 августа 2026:** `preparePresentationForExport` использует общий детектор целостности текста и исправляет фрагменты наподобие `Porsche 911 показал.` до экспорта. Точечный regression-тест `keeps legacy no-canvas decks on the template fallback and repairs Porsche-like fragments in generated slides` проходит.

В release gates добавлен обязательный golden smoke в Alpine worker: canvas audit, preview HTML, PPTX, реальный Chromium PDF и rasterized-PDF сравниваются в одном сценарии. Образ содержит Chromium и Poppler, а отсутствие Chromium приводит к ошибке, а не к условному пропуску.

Что изменить:

- Исправить или осознанно пересмотреть правило preflight и соответствующий тест.
- Сделать Chromium обязательной частью CI export job; отсутствие браузера должно падать, а не превращаться в skip.
- Добавить golden-deck smoke: web preview → PPTX/PDF render → изображения страниц → проверка переполнений, отсутствующих картинок, шрифтов и source attribution.

Критерий закрытия выполнен на уровне кода и CI-конфигурации. Фактический запуск golden smoke на опубликованном immutable image остаётся частью CI acceptance P0-2.

## 3. Высокий приоритет P1

### P1-1. Deploy неатомарный, без rollback и post-deploy проверки

`scripts/deploy.ps1` архивирует `HEAD` прямо в постоянный каталог, затем на сервере выполняет build, migration и `up -d`. Нет release directory, registry digest, backup, lock от параллельного deploy, `docker compose config`, health wait, smoke test, automatic rollback или сохранения предыдущего набора образов.

Текущий рабочий tree также не является release-кандидатом: есть незакоммиченные изменения в generation-коде и `.worktrees/`. Поскольку скрипт архивирует только `HEAD`, незакоммиченные исправления не попадут в релиз, даже если локальные тесты запускались на них.

Нужно:

- Собирать подписанные/versioned images в CI и разворачивать по digest.
- Перед миграцией делать backup и проверять совместимость migration rollback/forward fix.
- Добавить staging, smoke, health timeout и переключение трафика только после readiness.
- Хранить предыдущий release manifest и одну команду rollback.

### P1-2. Health endpoint проверяет только факт работы Node.js

**Реализовано 10 августа 2026:** `/v1/health/live` проверяет только жизнь API-процесса, а `/v1/health/ready` возвращает `503`, пока не готовы PostgreSQL, отсутствие незавершённых Prisma migrations, S3/MinIO bucket, BullMQ/Redis, worker heartbeat или обязательная runtime-конфигурация. Старый `/v1/health` оставлен как совместимый liveness endpoint. `/v1/health/workers` показывает heartbeat worker и queue lag (`waiting`, `active`, `delayed`, возраст старой ожидающей job) отдельно от обычного liveness.

Worker публикует TTL heartbeat в Redis, а `compose.production.yml` и local/CI compose получили healthchecks для MinIO, API readiness, worker heartbeat и web; `create-bucket` ждёт healthy MinIO, API/worker — завершения bucket setup, а Caddy — healthy API/web. Release gates и `/api/internal-health` теперь используют readiness, а не безусловный `200`.

Критерий закрытия: staging/release smoke получает `200` от `/v1/health/ready` только после migration, bucket setup и запуска worker; отключение любой зависимости возвращает `503`, тогда как `/v1/health/live` остаётся `200` до остановки процесса.

**Нужно доделать:**

- Выполнить staging smoke на собранных immutable образах и зафиксировать ответы live/ready/workers и Docker health states. Сейчас это блокируется известным зависанием Docker Desktop/BuildKit из P0-2.
- Подключить monitoring/alerting к `503` readiness, stale worker heartbeat и согласованным SLO-порогам queue lag; сам endpoint метрики отдаёт, но канал оповещения в репозитории пока отсутствует.

### P1-3. Нет graceful shutdown фоновых задач

**Реализовано 10 августа 2026:** worker обрабатывает `SIGTERM`/`SIGINT` ровно один раз: снимает heartbeat, прекращает получение новых задач через `pause(true)`, ждёт завершения active jobs до `WORKER_SHUTDOWN_TIMEOUT_MS` (по умолчанию 14 минут), затем при необходимости force-close оставшиеся jobs для безопасного BullMQ retry. После этого закрываются queue/Redis connections, Prisma и tracing/Sentry. API включает Nest shutdown hooks, поэтому останавливает HTTP listener и lifecycle providers, включая Prisma; отдельный lifecycle service flushes tracing/Sentry. В local и production Compose API получает 45 секунд, worker — 15 минут `stop_grace_period`, то есть больше заданного worker deadline.

Критерий закрытия: controlled `docker compose restart api worker` во время активной generation/export job не принимает новых jobs после SIGTERM, завершает текущую job либо оставляет её для штатного BullMQ retry после timeout, удаляет worker heartbeat и завершает контейнеры в их grace period без stalled/double execution.

**Нужно доделать:**

- Выполнить controlled restart на staging/immutable worker image во время реальных generation и PDF export jobs, сохранить логи shutdown и проверить отсутствие дублей/stalled jobs после retry. Локальная проверка сейчас зависит от восстановления Docker Desktop/BuildKit из P0-2.

### P1-4. Billing и удаление аккаунта не образуют завершённый lifecycle

Stripe webhook и синхронизация статусов существуют — это плюс. Но не найден customer billing portal/cancel flow. `removeMe` удаляет storage prefixes и запись User, не отменяя активную Stripe subscription и не координируя фоновые jobs. Возможен orphan subscription: аккаунт удалён, а списания продолжаются. Последовательное удаление storage → DB также неатомарно.

Нужно:

- Добавить Stripe Billing Portal или собственные cancel/change-plan endpoints.
- Перед удалением аккаунта отменять/планировать отмену подписки и фиксировать результат.
- Перевести удаление в идемпотентный background workflow: tombstone, запрет новых jobs, отмена/дожидание активных jobs, удаление storage, anonymization/deletion DB, audit trail.
- Показать пользователю последствия, срок удаления и статус операции.

### P1-5. Нет backup/restore, DR и эксплуатационного runbook

В репозитории не найдено автоматизации `pg_dump`/restore и проверяемого backup для PostgreSQL/MinIO. Нет RPO/RTO, инструкции инцидента, восстановления очередей, ротации секретов или действий при недоступности AI/search provider.

Нужно:

- Автоматические зашифрованные backups PostgreSQL и versioned/object-lock policy для MinIO.
- Регулярный restore drill в отдельном окружении.
- Runbook по DB/Redis/MinIO, очередям, Stripe webhook, AI provider, Sentry и rollback.
- Определить RPO/RTO, ответственного и канал уведомления.

### P1-6. Недостаёт perimeter security

Не найдены rate limiting/throttling и явные security headers: CSP, HSTS, `frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`. Caddy сейчас только сжимает и проксирует. Docker runtime работает от root; базовые образы используют mutable tags, API/worker runner копируют весь root `node_modules`.

Нужно:

- Добавить API throttling по user/IP и отдельные лимиты для upload, generation, export, invite и billing endpoints.
- Настроить CSP с учётом Next/Auth/Telegram, HSTS после готовности домена, clickjacking/referrer/permissions policies.
- Запускать контейнеры от non-root пользователя, добавить read-only filesystem там, где возможно, ограничить capabilities/resources/PIDs.
- Закрепить base images digest-ами, добавить SBOM и image scan.
- Добавить антивирусную/малварь-проверку загружаемых файлов. Текущие magic bytes и ZIP limits защищают формат и ресурсы, но не содержимое.

### P1-7. Юридический и support-минимум отсутствует

Не найдены маршруты privacy, terms и support. Для сервиса с аккаунтами, пользовательскими файлами, AI-провайдерами и платежами до запуска нужны как минимум:

- политика конфиденциальности и обработки/хранения файлов;
- пользовательское соглашение, правила возвратов/отмены подписки;
- disclosure об AI-generated content и ответственности за проверку источников;
- контакт поддержки и понятный путь сообщить о проблеме;
- юридическая проверка требований целевых стран, cookies/analytics и трансграничной передачи данных.

## 4. Средний приоритет P2

### P2-1. Editor autosave не защищён при закрытии страницы

Editor сериализует PATCH-запросы через `saveQueueRef`, но в нём нет `beforeunload`/navigation guard, аналогичного script review. Если пользователь закроет вкладку сразу после редактирования, queued save может не завершиться.

Рекомендация: dirty/pending-save guard, явный статус офлайн/ошибки, retry и тест закрытия/перехода во время сохранения.

### P2-2. Checkout имеет слабый error UX

Checkout button устанавливает busy, вызывает `fetch`, затем ожидает JSON, но не имеет `try/catch/finally` и видимого сообщения об ошибке. Network failure может оставить кнопку в busy-state без понятного восстановления.

Рекомендация: `finally`, error alert с retry, Sentry breadcrumb и идемпотентность создания checkout session.

### P2-3. Frontend bundle и CSS слишком глобальны

Production build показывает:

- shared first-load JS: 187 KB;
- landing: 320 KB;
- editor: 456 KB.

`globals.css` импортирует 18 файлов, включая admin, legacy pages, editor, defense и account для каждого маршрута. В результате landing несёт стили внутренних тяжёлых экранов. Build также предупреждает о больших сериализуемых строках.

Рекомендация:

- Перенести route-specific CSS в layout/route/component boundaries.
- Удалить или изолировать `legacy-pages.css` и `editor-legacy.css` после визуального сравнения.
- Lazy-load Mermaid/editor/export-heavy зависимости.
- Ввести bundle budgets в CI и измерить Core Web Vitals/Lighthouse на production image.

### P2-4. Крупные модули затрудняют безопасные изменения

Самые крупные production-файлы: `canvas-builder.ts` ~2797 строк, `presentation-quality.ts` ~2678, API defense service ~1589, export ~1491, project editor ~1051. Декомпозиция началась, но новые файлы пока содержат много неиспользуемого кода и сломали lint baseline.

Рекомендация: завершать декомпозицию вертикальными slices с ясным ownership и тестами, а не копированием больших наборов imports/types. Вынести export serializers, renderers и preflight; editor state/save/geometry; defense orchestration; quality rules.

### P2-5. Экспорт требует визуальной и шрифтовой матрицы

Темы используют Arial, Aptos/Aptos Display, Georgia, Trebuchet MS и Verdana. Worker image устанавливает Chromium, Noto и DejaVu, но не весь набор theme fonts. Для PDF это может приводить к подстановке и изменению переносов; для PPTX результат зависит от компьютера пользователя.

Рекомендация:

- Либо встраивать/лицензировать утверждённые шрифты, либо ограничить themes гарантированно доступным набором.
- Тестировать Windows PowerPoint, LibreOffice и PDF render на русском тексте, таблицах, диаграммах, notes и source attribution.
- Добавить retention/cleanup старых export objects и storage quotas.

### P2-6. Нужна продуктовая аналитика полного пути

В коде есть operational events/Sentry, но перед запуском нужен пользовательский funnel:

`landing → login → new project → sources → generation → script approval → editor → export → download → paid conversion`.

Нужно измерять completion/drop-off, время до первой готовой презентации, generation/export failure rate, повторные попытки, долю неподтверждённых источников, conversion и churn. События не должны содержать исходный текст презентаций или секреты.

### P2-7. Нужны route-level error/offline состояния

Есть global error и локальные ошибки на ряде экранов, но нет целостного offline/reconnect UX и единых route error boundaries для editor/export. Пользователь должен понимать, сохранены ли изменения, работает ли генерация в фоне и безопасно ли закрывать вкладку.

## 5. Дизайн и доступность

### Оценка интерфейса: 15/20 — хороший фундамент, требуется hardening

| Направление | Балл | Вывод |
|---|---:|---|
| Accessibility | 3/4 | Есть skip-link, видимый focus, reduced-motion и преимущественно достаточные touch targets. Нужны зелёный accessibility E2E, более заметное выделение текста и проверка контраста placeholder/muted text. |
| Performance | 2/4 | Визуально страницы отзывчивы, но JS/CSS bundles велики и стили всех экранов загружаются глобально. |
| Responsive | 3/4 | Landing, dashboard и export вручную проверены на 390×844 без horizontal overflow; mobile navigation и active workflow понятны. Полный E2E всё ещё красный. |
| Theming | 3/4 | Есть документированная orange/green/purple система и CSS tokens. Остаются legacy стили, hard-coded цвета и неунифицированные affordances. |
| Anti-patterns | 4/4 | Интерфейс не выглядит шаблонным AI-dashboard: есть собственный характер, ясная иерархия и согласованный workflow. Автодетектор нашёл только ложные side-tab срабатывания на тонких границах/индикаторе вкладки. |

Сильные стороны дизайна:

- Цельный визуальный язык landing и приложения.
- Понятные CTA и последовательный workflow.
- На export хорошо разделены форматы, подготовка и скачивание.
- Mobile layout не превращает desktop в уменьшенную копию; используется bottom navigation.
- Уважение `prefers-reduced-motion`.

Что улучшить:

- Не делать фон выделенного текста прозрачным: выделение должно оставаться очевидным.
- Проверить WCAG AA для placeholder, muted text и всех orange-on-cream комбинаций инструментом, а не визуально.
- Убрать глобальное переопределение native scrollbar либо оставить только там, где оно необходимо.
- Исправить client-side scroll restoration: E2E получил `window.scrollY=120` вместо `<24` после перехода к созданию.
- Устранить неоднозначные accessible names (`Папки` совпадает с `Мои папки`) или сделать тесты точными; в любом случае сохранить однозначную структуру заголовков.

После исправлений рекомендуется отдельный цикл `harden → optimize → audit` и повторная оценка.

## 6. Пользовательский путь

### Что уже хорошо

- Есть понятный вход: landing, login, dashboard, новый проект.
- Создание разделено на этапы; платные AI-действия требуют явного подтверждения.
- Source review, script approval и export не смешаны в один перегруженный экран.
- Пользователь видит progress, ошибки jobs и варианты повторной попытки.
- Профиль показывает использование и содержит удаление аккаунта.

### Чего не хватает перед запуском

- Production-auth без dev bypass и проверка первого входа нового пользователя.
- Onboarding/first-success: пример, подсказка по хорошему prompt, объяснение источников и ожидаемого времени.
- Гарантия сохранения editor/script при offline, reload и переходах.
- Понятный billing self-service: сменить тариф, отменить, скачать чек/инвойс, увидеть дату следующего списания.
- Единый support path из error states.
- Email/in-app уведомление о завершении долгой генерации/экспорта, если пользователь ушёл со страницы.
- Прозрачный status page или хотя бы публичное сообщение при сбоях провайдера.
- Тест полного пути нового реального аккаунта: регистрация → оплата → генерация → скачивание → отмена → удаление.

## 7. Экспорт

### Сильные стороны

- PPTX/PDF/DOCX представлены пользователю явно.
- Есть revision control, idempotency, plan gating, preflight и signed download flow.
- Проверяются canvas/XML/notes/images/source attribution.
- Для ZIP и загружаемых документов есть защитные лимиты.

### Обязательные улучшения

- Исправить подтверждённую preflight-регрессию.
- Запретить skip реального PDF render в CI.
- Добавить визуальные golden tests и compatibility matrix.
- Зафиксировать font strategy.
- Проверять oversized text, таблицы, длинные URL, кириллицу, emoji, отсутствующие изображения и malformed Mermaid.
- Добавить cleanup/retention, повторную выдачу ссылки и понятные ошибки истёкшей ссылки.
- В staging выполнить несколько реальных экспортов разного размера и проверить CPU/RAM/время/queue lag.

## 8. Код и архитектура

### Сильные стороны

- Границы web/API/worker/shared в целом правильные.
- Общие Zod contracts и типы не дублируются по приложениям.
- Долгие задачи вынесены в BullMQ.
- AI/search вызовы в основном мокируются или ограничиваются в тестах.
- Есть structured logging, Sentry hooks, cost envelope и usage ledger.
- `npm audit --omit=dev --audit-level=high`: 0 известных уязвимостей на момент проверки.

### Улучшения

- Завершить декомпозицию worker и вернуть lint к полезному сигналу.
- Ввести architecture boundaries/import rules между модулями.
- Удалить tracked generated artifacts (`tsconfig.tsbuildinfo`, временные PPTX/audit artifacts) из Git и сузить Docker context.
- Не копировать весь root `node_modules` в API/worker runtime; собирать production-only dependencies.
- Добавить миграционные integration tests на чистой и существующей DB.
- Добавить contract tests web proxy ↔ API и queue payload ↔ worker.
- Ввести code ownership для billing/auth/export/generation и обязательный review этих зон.

## 9. Наблюдаемость и эксплуатация

До production необходимы:

- Sentry environment/release/version, source maps и alert rules.
- Метрики: HTTP latency/error rate, DB pool, Redis, queue wait/active/stalled/failed, generation stages, export duration, provider latency/errors, cost per job.
- SLO: доступность web/API, успешность generation/export, p95/p99 latency, максимальный queue lag.
- Correlation ID от браузера через API до BullMQ job и внешнего провайдера.
- Redaction test: prompts, source contents, tokens, signed URLs, Stripe/Telegram/AI secrets не попадают в logs/events.
- Synthetic smoke после deploy.

Плагин Sentry был подключён во время аудита для возможной последующей проверки live events, но данный вердикт основан на коде, локальных проверках и production-like runtime. Перед релизом нужна отдельная сверка реальных ошибок/алертов staging или production Sentry.

## 10. Проверки, выполненные в этом аудите

| Проверка | Результат |
|---|---|
| Git status | Dirty: два изменённых worker-файла и `.worktrees/`; release незафиксирован |
| Typecheck shared/api/web/worker | PASS |
| Production build | PASS с предупреждениями |
| Lint | FAIL: 647 проблем |
| Shared tests | PASS: 100 |
| API tests | PASS: 55 |
| Web tests | PASS: 34 |
| Worker tests | FAIL: 377 pass, 1 fail, 1 skip |
| Chromium E2E на localhost:3010 | FAIL: 19 pass, 12 fail, 5 skip |
| `docker compose config --quiet` | PASS |
| Compose runtime | Все сервисы Up; healthy отмечены только PostgreSQL/Redis |
| Web/API/Caddy health | HTTP 200, но endpoint поверхностный |
| Production dependency audit | PASS: 0 известных vulnerabilities |
| Ручной desktop/mobile UI audit | Landing/dashboard/export без horizontal overflow; console чистая |

## 11. Рекомендуемый план до запуска

### Этап A — немедленные блокеры

1. Зафиксировать intended worker changes в отдельной ветке/commit и получить чистый release candidate.
2. Исправить export regression и lint.
3. Создать production compose/secrets validation, закрыть порты и dev bypass.
4. Добавить CI и получить зелёные unit/export/E2E на immutable image.

### Этап B — безопасный staging

5. Добавить readiness, graceful shutdown, resource limits и queue metrics.
6. Добавить backup/restore и rollback; провести restore drill.
7. Закрыть billing/account lifecycle, legal и support.
8. Добавить security headers, rate limits, container hardening и upload malware scan.

### Этап C — release candidate

9. Развернуть по digest в staging с production flags/secrets.
10. Пройти новый аккаунт, оплату, генерацию, script review, editor, PPTX/PDF/DOCX, отмену и удаление аккаунта.
11. Провести mobile/keyboard/accessibility и load/export soak test.
12. Проверить Sentry/alerts, synthetic smoke и rollback.

## 12. Go/No-Go критерии

Разрешать production deploy только если одновременно выполнено следующее:

- Нет P0; P1 имеют owner и согласованный срок.
- Release tree чистый, tag/digest неизменяемы.
- Dev auth/admin и default secrets технически невозможны в production.
- Наружу открыты только 80/443.
- Lint, typecheck, unit, export, desktop/mobile E2E зелёные без критических skip.
- Staging использует те же images/config shape, что production.
- Backup восстановлен в тестовом окружении; rollback отрепетирован.
- Readiness и graceful shutdown подтверждены во время controlled restart.
- Реальные PPTX/PDF/DOCX проверены визуально и на совместимость.
- Billing cancel/account delete не оставляют активных списаний или orphan data.
- Privacy/terms/support опубликованы и проверены ответственным специалистом.
- Метрики, Sentry release и критические алерты работают.

До выполнения этих условий итоговый статус: **NO-GO / HOLD**.
