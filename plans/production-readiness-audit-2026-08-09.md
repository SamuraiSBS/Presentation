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

**Закрыто 11 августа 2026: P0-2 прошёл GitHub CI acceptance.** Release run [#25](https://github.com/SamuraiSBS/Presentation/actions/runs/31516748337) для `main` commit `ed07252` успешно выполнил все required checks, опубликовал immutable API/worker/web images в GHCR, закрепил их `@sha256`, выполнил migration и readiness/compose smoke именно по опубликованным digest references и сохранил release manifest. В репозитории добавлен `.github/workflows/release-gates.yml`: он проверяет lockfile/Prisma/lint/typecheck/unit, secrets, Playwright desktop/mobile, собирает API/worker/web и выполняет migration и golden export smoke в Alpine worker. Deploy и manifest validation также запрещают dirty tree и неполный/неimmutable набор образов.

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

Критерий acceptance выполнен: один опубликованный commit и один digest-набор образов имеют полностью зелёный CI; тот же digest прошёл migration, readiness и compose smoke.

**Нужно доделать для acceptance:** ничего — критерий подтверждён release run #25.

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

**Реализовано 11 августа 2026:** `scripts/deploy.ps1` принимает только принятый CI `release-manifest.json` с immutable API/worker/web `@sha256` references, запрещает dirty tree и передаёт commit archive в отдельный каталог `/releases/<sha>-<timestamp>`. Remote `scripts/deploy-release.sh` сериализует deploy через `flock`, запускает `docker compose config --quiet` и pull digest-образов, создаёт защищённый pre-migration PostgreSQL dump, запускает Prisma и ждёт не более 180 секунд healthy API/worker/web и `/v1/health/ready`. Затем обязательный smoke проверяет API readiness, web и публичный Caddy `/api/internal-health`; `docker compose ps` и ответ readiness сохраняются в `deploy-evidence.txt` релиза.

При неуспешном deploy скрипт не меняет `current`, сохраняет failed release/evidence и автоматически поднимает предыдущий accepted source/manifest/image set. Предыдущий release хранится как `/previous`; ручной возврат — одна команда: `./scripts/deploy.ps1 -HostName <host> -RemotePath <path> -Rollback`. CI в текущей политике блокирует публикацию release с изменением `prisma/migrations`, пока не появится отдельная проверяемая политика forward-fix/rollback compatibility; поэтому обычный rollout не может незаметно внести schema change.

**Нужно доделать для полного закрытия:**

- Развернуть отдельный staging host и принять реальный deploy/rollback drill с сохранёнными backup, `deploy-evidence.txt` и проверкой восстановления в изолированной БД.
- Спроектировать blue/green (или иной proxy-level) traffic switch: текущий Compose обновляет сервисы in-place, поэтому rollback автоматизирован, но нулевой перерыв трафика до readiness ещё не гарантирован.
- Для будущих Prisma migrations добавить CI-проверяемый контракт backward compatibility и forward-fix/restore procedure; снять сознательный запрет migration changes только после такого drill.

### P1-2. Health endpoint проверяет только факт работы Node.js

**Реализовано 10 августа 2026:** `/v1/health/live` проверяет только жизнь API-процесса, а `/v1/health/ready` возвращает `503`, пока не готовы PostgreSQL, отсутствие незавершённых Prisma migrations, S3/MinIO bucket, BullMQ/Redis, worker heartbeat или обязательная runtime-конфигурация. Старый `/v1/health` оставлен как совместимый liveness endpoint. `/v1/health/workers` показывает heartbeat worker и queue lag (`waiting`, `active`, `delayed`, возраст старой ожидающей job) отдельно от обычного liveness.

Worker публикует TTL heartbeat в Redis, а `compose.production.yml` и local/CI compose получили healthchecks для MinIO, API readiness, worker heartbeat и web; `create-bucket` ждёт healthy MinIO, API/worker — завершения bucket setup, а Caddy — healthy API/web. Release gates и `/api/internal-health` теперь используют readiness, а не безусловный `200`.

**Дополнено 11 августа 2026:** API-side монитор (то есть независимый от worker процесс) при включённых production Telegram alerts периодически проверяет readiness и отправляет дедуплицированные уведомления о `503`, stale worker heartbeat и нарушении SLO очередей. CI сохраняет ответы live/ready/workers и `docker compose ps` в artifacts `staging-health-evidence-<sha>` и `registry-health-evidence-<sha>`.

Критерий закрытия: staging/release smoke получает `200` от `/v1/health/ready` только после migration, bucket setup и запуска worker; отключение любой зависимости возвращает `503`, тогда как `/v1/health/live` остаётся `200` до остановки процесса.

**Нужно доделать для acceptance:**

- Выполнить release-gates для commit SHA и принять CI-artifact `staging-health-evidence-<sha>`; после публикации digest принять также `registry-health-evidence-<sha>`. Они должны показать `200` live/ready/workers и healthy API/worker/web. Локально 11 августа Docker Desktop доступен, но запущены только PostgreSQL и MinIO, поэтому это не заменяет staging/release acceptance.
- В production secret manager задать `ADMIN_ALERTS_ENABLED=true`, Telegram token/chat ID и согласованные SLO-пороги `HEALTH_QUEUE_WAITING_MAX` / `HEALTH_QUEUE_LAG_MAX_AGE_MS`; API-side монитор уже отправляет Telegram-уведомления для `503` readiness, stale worker heartbeat и нарушений queue-lag и не зависит от работающего worker.

### P1-3. Нет graceful shutdown фоновых задач

**Реализовано 10 августа 2026:** worker обрабатывает `SIGTERM`/`SIGINT` ровно один раз: снимает heartbeat, прекращает получение новых задач через `pause(true)`, ждёт завершения active jobs до `WORKER_SHUTDOWN_TIMEOUT_MS` (по умолчанию 14 минут), затем при необходимости force-close оставшиеся jobs для безопасного BullMQ retry. После этого закрываются queue/Redis connections, Prisma и tracing/Sentry. API включает Nest shutdown hooks, поэтому останавливает HTTP listener и lifecycle providers, включая Prisma; отдельный lifecycle service flushes tracing/Sentry. В local и production Compose API получает 45 секунд, worker — 15 минут `stop_grace_period`, то есть больше заданного worker deadline.

**Локально подтверждено 11 августа 2026:** worker image был пересобран с прямым Node entrypoint (`node apps/worker/dist/main.js`), чтобы `SIGTERM` попадал в обработчик worker, а не в обёртку `npm`. Controlled stop/start idle worker завершился за 3,98 секунды; логи содержат `worker graceful shutdown started` и `worker graceful shutdown completed`, heartbeat удалён до остановки (`TTL=-2`) и восстановлен после запуска (`TTL=58`).

Критерий закрытия: controlled `docker compose restart api worker` во время активной generation/export job не принимает новых jobs после SIGTERM, завершает текущую job либо оставляет её для штатного BullMQ retry после timeout, удаляет worker heartbeat и завершает контейнеры в их grace period без stalled/double execution.

**Нужно доделать для acceptance:**

- Выполнить controlled restart на staging с immutable worker image во время реальных generation и PDF export jobs. Сохранить shutdown-логи, состояния BullMQ до и после retry и время завершения контейнеров; принять только при отсутствии дублей и stalled jobs. Локальный restart не заменяет этот staging acceptance.
- Для запуска этой проверки нужны SSH-доступ к staging, принятый `release-manifest.json` с digest-образами API/worker/web и чистый commit: `scripts/deploy.ps1` отказывается разворачивать dirty tree и не содержит реального staging host.

### P1-4. Billing и удаление аккаунта не образуют завершённый lifecycle

**Реализовано 11 августа 2026:** добавлен Stripe Billing Portal: платный пользователь открывает self-service из профиля и возвращается в `/profile`. Удаление аккаунта больше не выполняется в HTTP-запросе. Подтверждённый запрос создаёт durable `AccountDeletion`, сразу блокирует аккаунт (`ACCOUNT_DELETION_PENDING`) и тем самым запрещает новые jobs, затем отменяет активную Stripe subscription. Только сохранённый `subscriptionCancelledAt` позволяет поставить идемпотентную BullMQ maintenance-задачу на очистку. При ошибке Stripe операция остаётся в `failed`, storage и DB не трогаются, а повтор подтверждения безопасно повторяет lifecycle.

Worker при удалении снимает queued generation/export jobs, запрашивает отмену active generation jobs и ждёт завершения active generation/export до destructive phase. Затем удаляет project prefixes из MinIO и удаляет User вместе с каскадными данными; `AccountDeletion` остаётся audit trail со статусом, датами отмены billing/storage/completion и ошибкой. В профиле до запуска очистки явно показаны необратимые последствия, момент принятия и текущий статус; пользователь не получает ложного сообщения об успешном удалении, если billing cancellation не прошла.

Критерий закрытия: тестовый Stripe customer с активной subscription проходит Portal и account deletion: subscription отменена до удаления данных, новые/queued jobs не исполняются, active jobs штатно заканчиваются или отменяются, MinIO и DB очищены, а в `AccountDeletion` остаётся completed audit record без orphan subscription.

**Нужно доделать для acceptance:**

- На staging выполнить E2E с Stripe test mode: checkout → Portal (смена/отмена плана) → account deletion, проверить Stripe Dashboard/webhook, Postgres `AccountDeletion`, BullMQ и MinIO. Локальные unit/typecheck не подтверждают реальную Stripe-конфигурацию.
- Согласовать с legal/support срок и политику retention для audit record/платёжных транзакций, а также текст письма/тикета пользователю после завершения удаления. Текущий UI показывает статус в открытом профиле, но email/in-app delivery ещё не реализован.
- Настроить Stripe Billing Portal configuration (разрешённые тарифы, cancel behavior, invoices) и production `PUBLIC_APP_URL`/Stripe secrets в secret manager.

### P1-5. Нет backup/restore, DR и эксплуатационного runbook

**Реализовано в репозитории (2026-08-11):** production config теперь не
принимается без отдельного off-site backup target, age recipient, retention,
RPO/RTO, owner и incident channel. `scripts/backup-production.sh` создаёт
custom `pg_dump`, шифрует его age до выгрузки, сохраняет checksum/metadata и
зеркалирует MinIO в отдельный S3-compatible bucket. Скрипт требует versioning,
SSE-S3 и Object Lock `COMPLIANCE`; ошибка прав или policy завершает backup с
ошибкой. `scripts/restore-drill.sh` получает latest encrypted dump и MinIO
mirror, восстанавливает их в новые временные Docker volumes, проверяет таблицы
и объектное хранилище, затем удаляет только drill-resources. Systemd timers
задают ежедневный backup и еженедельный restore drill. Полный порядок
настройки, DB/Redis/MinIO/BullMQ/Stripe/AI/Sentry incident paths и rollback
описан в `docs/operations/production-recovery.md`.

**До live-acceptance ещё нужно:**

- Provisioning: создать отдельный off-site S3-compatible account/bucket с
  Object Lock, versioning и SSE, выпустить dedicated backup credentials и age
  recovery key; private age identity хранить только в recovery secret store.
- На production host заполнить новые `BACKUP_*`/owner/channel values, установить
  `age`, включить systemd units и успешно выполнить первый backup + isolated
  restore drill. Сохранить evidence и фактические RPO/RTO.
- Подтвердить доступность incident channel и назначение реального on-call owner;
  повторять drill минимум еженедельно и закрывать release gate при его
  просрочке/ошибке.

### P1-6. Недостаёт perimeter security

**Реализовано в репозитории 11 августа 2026:**

- API теперь применяет Redis-backed throttling одновременно по хэшированным user и IP ключам. Общий лимит и отдельные лимиты для upload, generation, export, invitation и billing задаются через `API_RATE_LIMIT_*`; при недоступном Redis защищённые запросы получают `503`, а не обходят защиту. Health endpoints исключены, чтобы не замаскировать отказ Redis.
- Caddy добавляет CSP для Next.js/Auth.js/Telegram OAuth, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` и HSTS. Production startup validation требует публичный HTTPS домен и `HSTS_MAX_AGE >= 31536000`, поэтому HSTS не включается случайно в local окружении.
- API, worker и web runner теперь запускаются как unprivileged `node`; production compose задаёт read-only rootfs с отдельными tmpfs, `no-new-privileges`, dropped capabilities, PIDs и CPU/RAM limits. Caddy работает UID 1000 с единственным `NET_BIND_SERVICE`; разовый `caddy-init` с root нужен только для миграции прав уже существующих Caddy volumes. Stateful PostgreSQL/Redis/MinIO и ClamAV не переведены в read-only режим, так как им нужны persistent writes.
- Все production runtime и Node base images закреплены `@sha256` digest-ами. API/worker удаляют dev dependencies перед переносом runtime `node_modules`. CI генерирует SBOM/provenance для публикуемых образов и останавливает release при fixable HIGH/CRITICAL уязвимостях Trivy scan.
- В production compose добавлен private ClamAV daemon с persistent signature volume. `MalwareScanService` stream-сканирует обычные uploads, defense uploads и пользовательские slide assets **до** первого S3 write; сигнатура или недоступный scanner отклоняют файл. Readiness API также проверяет ClamAV `PING`, а production config не разрешает запуск без включённого scanner и его host/port.

**Нужно доделать для live-acceptance:**

- На staging/prod выделить ClamAV минимум 4 GiB RAM, дождаться первого обновления signature database и сохранить evidence: `ready` с успешным scanner check, разрешённый чистый upload, отклонённый EICAR-тест (только изолированная staging-среда) и отказ upload при остановленном scanner.
- Проверить с публичного HTTPS домена фактические headers/CSP, Telegram OAuth, Sentry transport и `429` для каждого специального bucket. Если Sentry использует не `*.ingest.sentry.io`, добавить его точный HTTPS ingest host в `connect-src` до запуска.
- Настроить на уровне cloud firewall/WAF только 80/443 и наблюдение за signature-update/ClamAV health; application compose не заменяет сетевой perimeter провайдера.
- Результат Trivy/SBOM должен быть принят владельцем release: triage найденных fixable HIGH/CRITICAL CVE, обновление закреплённых digest-ов по расписанию и документированный exception только для явно неприменимых уязвимостей.

### P1-7. Юридический и support-минимум отсутствует

Не найдены маршруты privacy, terms и support. Для сервиса с аккаунтами, пользовательскими файлами, AI-провайдерами и платежами до запуска нужны как минимум:

- политика конфиденциальности и обработки/хранения файлов;
- пользовательское соглашение, правила возвратов/отмены подписки;
- disclosure об AI-generated content и ответственности за проверку источников;
- контакт поддержки и понятный путь сообщить о проблеме;
- юридическая проверка требований целевых стран, cookies/analytics и трансграничной передачи данных.

**Реализовано 12 августа 2026:** добавлены публичные маршруты `/privacy`, `/terms` и `/support` с общей навигацией из footer. Privacy описывает обработку учётных данных, файлов, AI/search-провайдеров, хранение и удаление; terms закрепляет disclosure о необходимости проверки AI-результата, отмену подписки и путь для запросов на возврат; support даёт единый mailto-канал и безопасный состав обращения. Production startup validation теперь не позволяет запустить публичную конфигурацию без `LEGAL_ENTITY_NAME` и валидного `SUPPORT_EMAIL`; оба значения документированы в `.env.production.example`.

**Нужно доделать для live-acceptance:**

- Юристу утвердить privacy/terms, указав полное наименование и реквизиты оператора, применимое право/целевые страны, сроки хранения, перечень процессоров, cookies/analytics, трансграничные передачи, точные правила возврата и отмены.
- На production задать реальный контролируемый `SUPPORT_EMAIL` и `LEGAL_ENTITY_NAME`, проверить доставку почты, ownership ящика, SLA/эскалацию и обработку запросов на персональные данные.
- Перед launch принять браузерное evidence публичных `/privacy`, `/terms`, `/support`, footer-ссылок и production startup validation с заданными юридическими переменными.

## 4. Средний приоритет P2

### P2-1. Editor autosave не защищён при закрытии страницы

**Реализовано 11 августа 2026:** editor помечает изменения как несохранённые до подтверждения последнего PATCH-ответа и ставит нативный `beforeunload` guard для закрытия/перехода. Ошибка сети теперь выводит явный статус и кнопку retry; конфликт ревизий по-прежнему открывает отдельный conflict-flow. Добавлен unit-тест guard для сохранённого и pending состояний.

Editor сериализует PATCH-запросы через `saveQueueRef`, но в нём нет `beforeunload`/navigation guard, аналогичного script review. Если пользователь закроет вкладку сразу после редактирования, queued save может не завершиться.

Статус: закрыто на уровне editor-кода. До live-acceptance остаётся пройти browser E2E: внести правку, начать искусственно задержанный PATCH, убедиться в предупреждении при закрытии/переходе, затем проверить retry после сетевой ошибки.

**Live E2E (11 августа 2026): не принято.** Добавлен scoped Playwright test `e2e/editor-autosave.spec.ts`: он задерживает PATCH и подтверждает native `beforeunload`, затем моделирует 500 и успешный retry. Spec компилируется и регистрирует оба сценария, но не выполнен live: production web build не завершился за 5 минут; clean Next preview сообщает `Ready`, но возвращает `000` даже на `/` и `/api/projects/demo`; единственный in-app browser изолирован от host `localhost`. Повторить `npm run test:e2e -- e2e/editor-autosave.spec.ts --project=chromium` после восстановления local web runtime.

### P2-2. Checkout имеет слабый error UX

**Реализовано 11 августа 2026:** checkout теперь сбрасывает busy-state через `finally` при сетевой ошибке, ошибочном HTTP-ответе и не-JSON ответе. Пользователь получает доступный error alert и может сразу повторить запрос кнопкой; повтор сохраняет session-scoped idempotency key. API передаёт этот key в Stripe, поэтому retry не создаёт вторую checkout session. Неуспешная попытка также записывается как Sentry breadcrumb без платежных данных. Добавлен unit-тест передачи retry key в Stripe.

Статус: закрыто на уровне кода.

**Live E2E (11 августа 2026): не принято.** В локальном `.env` отсутствуют `STRIPE_SECRET_KEY` и `STRIPE_PRICE_STUDENT`, поэтому Stripe test-mode session создать нельзя. Дополнительно текущая `/pricing` отображает только free-plan и не рендерит `CheckoutButton`, так что error alert/retry недоступны для browser-сценария. Для acceptance сначала вернуть checkout CTA в продуктовый flow и предоставить Stripe test-mode конфигурацию; затем искусственно оборвать checkout-запрос, увидеть alert и доступный retry, а в Stripe Dashboard подтвердить, что два запроса с одним ключом вернули одну checkout session.

### P2-3. Frontend bundle и CSS слишком глобальны

**Исходный baseline production build:**

- shared first-load JS: 187 KB;
- landing: 320 KB;
- editor: 456 KB.

До исправления `globals.css` импортировал 18 файлов, включая admin, legacy pages, editor, defense и account для каждого маршрута. В результате landing нёс стили внутренних тяжёлых экранов. Build также предупреждал о больших сериализуемых строках.

**Реализовано 11–12 августа 2026:**

- Корневой `globals.css` оставляет только 7 общих файлов (tokens/base/app shell, shared foundation, application слой, статусы, account chrome). 11 route-specific файлов вынесены в layout-границы `/admin`, `/new`, editor, script, export, defense и account/dashboard маршрутов.
- `landing.css` больше не импортируется root layout и подключается только в `/`; editor получает свои `editor-*` и `slide-renderer.css` только в `/projects/[id]/editor`.
- TipTap вынесен в отдельный async chunk в текстовых properties editor. Пока он загружается, доступен нативный controlled textarea fallback; введённый текст передаётся в TipTap при handoff и не теряется, если chunk успевает загрузиться до `blur`. Mermaid уже использовал динамический `import()` и остаётся отдельным chunk.
- По размеру прямых импортов корневой CSS уменьшен с 180,1 KiB до 13,9 KiB: 166,2 KiB (92,3%) route-specific CSS исключены из общего entrypoint. Это не gzip-метрика и не заменяет анализ production output.
- `legacy-pages.css` удалён из root-пути. Небольшие действительно общие primitives перенесены в `shared-foundation.css`, а admin reduced-motion rules остались в `admin.css`; прежние wizard/new-project правила больше не попадают на несвязанные маршруты.
- Добавлены `apps/web/bundle-budget.json` и `npm run bundle:check`: после production build скрипт читает `app-build-manifest.json`, измеряет actual JS/CSS assets для shared, landing и editor, сравнивает с лимитами и при необходимости сохраняет JSON evidence.
- В GitHub release gates production web build и bundle budget обязательны в quality job. После запуска именно собранного immutable web image CI поднимает Chromium, проверяет Lighthouse performance/CWV budget (score, LCP, TBT, CLS) и публикует полный Lighthouse report как artifact.

**Проверено 11 августа 2026:** `npm run typecheck -w @studydeck/web` — успешно; `npm run test -w @studydeck/web` — 11 файлов / 36 тестов успешно; `git diff --check` — без ошибок в целевом diff.

**Проверено 12 августа 2026:** `npm run typecheck -w @studydeck/web` — успешно; isolated `npm run test -w @studydeck/web -- --pool=threads --poolOptions.threads.singleThread=true` — 11 файлов / 36 тестов успешно; `node --check` для обоих новых performance scripts — успешно. Node 22 `npm ci` в Docker после обновления lockfile прошёл; это устранило блокировку на install layer production image.

**Дополнено 12 августа 2026:** local production Next build восстановлен. В route-specific layouts `/projects/[id]/{editor,script,export,defense}` было на один лишний `..` в CSS imports; после исправления `npm run build -w @studydeck/web` прошёл полностью (199,8 с вне Windows sandbox). Next 16 больше не создаёт `app-build-manifest.json`, поэтому `bundle:check` читает `build-manifest.json` и route `*_client-reference-manifest.js`; actual uncompressed metrics собранного output: shared JS 937,9 KiB / CSS 41,4 KiB / total 979,3 KiB, landing 1113,7 / 41,4 / 1155,1 KiB, editor 1103,5 / 103,8 / 1207,3 KiB. `bundle-budget.json` обновлён по этому первому воспроизводимому Next 16 baseline с небольшим запасом, `npm run bundle:check` проходит.

**Local visual smoke 12 августа 2026:** standalone production output на `localhost:3020` отдаёт `/` с `200`, а защищённые `/new`, `/admin`, editor/script/export/defense в чистом режиме перенаправляют на login. Во втором изолированном local-only runtime с E2E dev-auth flags страницы `/new`, `/admin`, `/projects/demo/editor`, `/projects/script-review-demo/script` и `/projects/demo/export` отрендерились без error boundary. `/projects/demo/defense/plan` показал штатное error-state: demo fixture не содержит defense workspace, поэтому содержимое defense flow ещё не принято. Новый Chromium regression `e2e/editor-autosave.spec.ts` вводит текст в `textarea.rich-text-content` до TipTap handoff и подтверждает тот же текст в `.ProseMirror`; весь spec проходит: 3/3. Повторный isolated web unit run: 11 файлов / 36 тестов успешно.

**Lighthouse и Docker 12 августа 2026:** standalone harness теперь копирует также `public` assets (landing image URL отвечает `200`), но последний `npm run lighthouse:production -- --url=http://localhost:3020/ --assert` всё ещё не прошёл budget: performance 43, FCP 1508 ms, LCP 5062 ms, TBT 666 ms, CLS 0 (лимиты нарушены по score/LCP/TBT). Лимиты Lighthouse не повышались. Скрипт теперь не маскирует budget verdict, если Windows временно удерживает Chrome profile directory при cleanup: это выводится как warning. `.github/workflows/release-gates.yml` подтверждённо выполняет `npm ci` до web build/bundle check и отдельный `npm ci` до запуска exact image и Lighthouse. Один `docker build --progress=plain --file Dockerfile.web ...` не вывел даже начального прогресса за две минуты и был остановлен; это остаётся Docker Desktop/BuildKit blocker ниже Dockerfile, а не регрессией Next build.

**Дополнено 12 августа 2026 (Lighthouse remediation):** публичный landing больше не загружает до первого рендера private runtime (Auth.js session client, React Query, product analytics, account/admin chrome и motion). Он получает только статический public shell; private providers и chrome загружаются отдельным async boundary для non-public routes. Интерактивные landing-витрины (hero generation demo, gallery и финальный artifact) вынесены в client islands, чтобы их motion/dialog/slide-rendering код не блокировал LCP hero. Production build и `bundle:check` проходят; actual uncompressed output изменился: shared JS/CSS/total 683,0/44,7/727,7 KiB (было 939,6/44,7/984,3), landing 688,4/44,7/733,1 KiB (было 1117,1/44,7/1161,8), editor 1112,9/107,1/1220,1 KiB. Локальный Lighthouse повторно не стартовал до аудита: `chrome-launcher` получил `ECONNREFUSED` к своему debugging port. Это launcher-host blocker, не успешный или неуспешный budget verdict; Lighthouse limits не менялись.

**Дополнено 12 августа 2026 (acceptance follow-up):** Docker Desktop и BuildKit снова отвечают (`29.4.2`, builder `v0.29.0`, весь текущий compose stack healthy), но exact `docker compose build web` с этими исходниками не завершился за 10 минут; после timeout два оставшихся процесса compose-build были остановлены, а старый `presentation-web` не заменялся. Для content-state добавлен изолированный local demo fixture `defense-demo`: он возвращает рабочее пространство защиты с материалом, source-confirmed фактом, обязательным требованием и редактируемым четырёхслайдовым планом для обоих `/projects/defense-demo/defense/{plan,review}`. Production API и реальные данные не затрагиваются. Web typecheck проходит. Принять этот fixture визуально пока нельзя: host `next dev` и повторный production build до компиляции завершаются системным `spawn EPERM`; это отдельный host runtime blocker.

**Дополнено 12–13 августа 2026 (final performance acceptance):** public shell вынесен из root client boundary в server-only `PublicRouteLayout`; private Auth.js/React Query/analytics/account-motion runtime подключается только вложенными layouts private-маршрутов. `application-system.css`, `dashboard-projects-foundation.css`, `account.css` и Nunito font вынесены из landing critical path в `private.css`; ниже первого экрана применён `content-visibility`. Hero preview выполняет фактический `import()` после LCP, а gallery/final artifact — только при приближении к viewport, поэтому Motion/dialog/slide-rendering не попадают в initial render. Заключительный `npm run build -w @studydeck/web` и `npm run bundle:check` прошли; actual uncompressed metrics: shared 682.8 KiB JS / 33.5 KiB CSS / 716.3 KiB total, landing 692.8 / 33.5 / 726.3 KiB, editor 1112.7 / 92.6 / 1205.4 KiB. Headless Chromium на production standalone подтвердил content-state `/`, `/projects/defense-demo/defense/review` и `/projects/defense-demo/defense/plan` без error-state.

**Exact Docker acceptance 13 августа 2026:** `docker compose build web` успешно собрал current image `presentation-web@sha256:c3451aef5795639a7eaf58be43d7590a726794335ab046e15c9dbdadab0bcccf`. Изолированный контейнер этого exact image на `localhost:3022` ответил `200`; два строгих `npm run lighthouse:production -- --url=http://localhost:3022/ --assert` прошли: score 78/77, FCP 955/934 ms, LCP 2591/2697 ms, TBT 209/213 ms, CLS 0/0. Windows cleanup warning временного Chrome profile не меняет verdict.

**Статус:** code scope, source build, actual bundle gate, visual content-state fixture, Lighthouse budget и exact Docker image acceptance закрыты.

**Нужно доделать:**

- Запустить release gates для commit с этими изменениями и принять artifacts: actual shared/landing/editor bundle metrics и `lighthouse-production-<sha>`.

### P2-4. Крупные модули затрудняют безопасные изменения

**Закрыто в коде 12 августа 2026.** Правила ограничений текста, видимого на слайде, и их детерминированная диагностика вынесены из `presentation-quality.ts` в `presentation/quality/visible-text-rules.ts`. Новый модуль не зависит от model critique, repair orchestration, БД или очередей; он владеет только renderer-facing лимитами и их `QualityIssue`. Фасад `presentation-quality.ts` сохраняет прежние exports, поэтому текущие потребители не меняют контракт, а целевые проверки импортируют новый модуль напрямую.

Из `export.ts` выделен `export/presentation-content.ts`: только общая семантическая проекция слайда и export theme для PPTX/HTML-PDF. В нём нет доступа к storage, Chromium, очередям или конкретному renderer API; этим исключена скрытая связь между двумя форматами и сохранено единое отображение title/body/quote/sequence/comparison.

`export/pptx-image.ts` теперь владеет binary image fitting и embedding в PPTX: cover/contain geometry, rasterization и image metadata. Canvas/PPTX renderer передаёт только входные данные и не содержит логики `sharp`-обработки; прежний `fitPptxImage` сохранён через фасад для совместимости.

`export/pptx-geometry.ts` изолирует единственный conversion boundary между canvas 96 DPI и PPTX: box coordinates, points и transparency. Это исключает разрозненные коэффициенты из renderer кода.

`export/pptx-background.ts` владеет всеми вариантами декоративного фона PPTX (`title`, `section`, `summary`, `v1`–`v5`) и их transparency offsets. Основной export workflow теперь только выбирает renderer и передаёт slide/theme, не смешивая orchestration с визуальной геометрией.

`export/pptx-content.ts` изолирует runtime-проекцию семантических template layouts PPTX (statement, definition, sequence, comparison, evidence и других) и их image placement от workflow/DB/storage boundary. `createPptx(...)` по-прежнему загружает данные, выбирает canvas/template path, добавляет attribution/notes и делегирует renderer через явный минимальный PPTX interface; API `createPptx` и формат результата не менялись.

Из API `DefenseService` выделен чистый `compliance-report-view.ts`: serializer detail/summary, stale-check и безопасное имя PDF. Orchestration очередей, idempotency и revision-conflict остаются в сервисе; view не зависит от Nest, очередей, storage или доступа к данным.

**Проверено:** worker/API typecheck, изолированный `presentation-quality.test.ts` — 59/59, целевой export contract test, cover/contain regression, `defense.service.test.ts` — 15/15 и полный `npm run lint` с нулевым baseline. Полный `export.test.ts` на host прошёл 18/20: два PDF-raster теста ожидаемо требуют Chromium, который доступен в worker image/CI, но отсутствует на Windows host. Историческое утверждение о сломанном lint baseline более не соответствует текущему состоянию.

**12 August follow-up — canvas builder tokens:** the first planned safe `canvas-builder.ts` slice is now implemented in `presentation/canvas-tokens.ts`. Typography, plaque spacing, and editorial layout tokens are pure constants with a direct regression test; `buildSlideCanvas`, fallback/ID ownership, and the public shared barrel remain unchanged, so no builder-to-helper cycle was introduced. Shared typecheck passed and the repository lint gate passed. The isolated Vitest command remains host-blocked by Windows `spawn EPERM` before test collection.

**12 August follow-up — PPTX renderers:** `createPptx` now delegates the semantic template projection to `export/pptx-content.ts` and saved canvas geometry to `export/pptx-canvas.ts`. The canvas renderer receives storage, content-type, and warning callbacks explicitly; it owns canvas text/shapes/images and gradient rasterization, while the export-job facade keeps preflight, persistence, notes, attribution, and placeholders. Worker typecheck and repository lint pass. The focused export suite is currently blocked before collection by the host's `spawn EPERM`, not an assertion failure.

**12 August follow-up — defense analysis/plan identity:** `defense-analysis-plan-job.ts` now owns the pure retry identity, queue name/id prefix, progress metadata, and failure message for both analysis and plan requests. `DefenseService` retains access checks, transactions, idempotent DB lookup, revision-conflict handling, and queue effects, but consumes the shared spec for both paths. API typecheck and repository lint pass; the focused Vitest command is host-blocked before collection by `spawn EPERM`.

**12 August follow-up — editor save state:** `editor-save-queue.ts` now owns serial slide writes, latest-patch retry, unsaved state, revision handoff, and conflict latching. `project-editor.tsx` remains the owner of UI state and local canvas/text projection, while before-unload/offline safeguards consume the extracted unsaved ref. Web typecheck and repository lint pass. The existing autosave/navigation-guard and geometry tests remain present but cannot collect on this host because Vite fails before collection with `spawn EPERM`.

**12 August follow-up — quality pipeline boundaries:** deterministic collection is now split into `quality/semantic-rules.ts`, `quality/source-grounding.ts`, and `quality/repair-orchestration.ts`. These modules accept explicit checks/repairs rather than importing the facade, so semantic, source, and initial-repair phases cannot create a `facade -> rule -> facade` cycle. `presentation-quality.ts` remains the public compatibility surface while delegating its deterministic composition to the three boundaries. Worker typecheck and repository lint pass; focused worker Vitest remains blocked before collection by the same host `spawn EPERM`.

**12 August follow-up — PDF canvas renderer:** saved-canvas HTML serialization now runs through `export/pdf-canvas.ts`, with object reads, content-type resolution, and warning logging injected by `renderPdfHtml`. This completes the canvas renderer split across PPTX and PDF/HTML while leaving semantic PDF templates and export-job lifecycle in the facade. Worker typecheck, repository lint, and scoped `git diff --check` pass; the focused export test command remains blocked before collection by the host `spawn EPERM`.

**Нужно доделать для P2-4:** ничего в code scope. Финально подтверждены typecheck shared/worker/API/web, `npm run lint` и `git diff --check`. Целевые Vitest-команды на этом Windows host не доходят до collection из-за внешнего `spawn EPERM`; их нужно повторить в CI/worker image вместе с уже существующими PDF-raster проверками. Browser regression для autosave/navigation guard остаётся существующим acceptance test и не был ослаблен.

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
