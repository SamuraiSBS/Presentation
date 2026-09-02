# StudyDeck AI — повторный аудит готовности к production

Дата: 31 августа 2026 года  
Объект ревью: текущий dirty working tree в `D:\presentation` как кандидат, production `https://slides.lazyum.ru` как фактическая среда сравнения  
Итог: **NO-GO — текущий кандидат нельзя выпускать**

## 1. Краткий вывод

Production-среда заметно сильнее, чем в аудите от 9 августа: она работает на immutable digest-образах, наружу опубликован только Caddy, readiness зелёный, анонимный пользователь не попадает в dashboard, внутренние зависимости и worker heartbeat исправны. Последний release run для production-коммита полностью зелёный.

Но локальный кандидат не является безопасным продолжением production:

1. Он не зафиксирован commit SHA и менялся прямо во время аудита.
2. Production-коммит `79273de724a97d428baafd7946ce41a74f831caf` не является предком локального `HEAD` `d64d8f47762220b333043c71d35e136f06faeba2`. Между ними — расходящиеся ветки и 59 изменённых файлов.
3. Кандидат добавляет Prisma-миграцию, а текущий release workflow, manifest validator и deploy script принимают только `migrationCompatibility: no-schema-change` и отклоняют любое изменение `prisma/migrations`.
4. На production включено явное временное исключение `ALLOW_PRODUCTION_WITHOUT_BACKUP=true`, резервное копирование выключено, алерты выключены, Sentry DSN отсутствует.
5. Юридические тексты сами помечают себя как неутверждённые до запуска; критические пользовательские потоки не прошли live acceptance на двух ролях.

Это не означает, что production нужно немедленно останавливать. Это означает, что расширять доступ или выкатывать текущий локальный срез нельзя до закрытия P0 и launch-blocking P1.

## 2. Границы и методика

Проверено:

- Git-состояние кандидата, его diff, миграции и ancestry относительно production.
- Release workflow, immutable manifest policy и deploy validation.
- Production через read-only SSH: release manifest, контейнеры, порты, readiness, несекретные operational-флаги, локальные backup-артефакты и расписания.
- Production DB только агрегатными read-only запросами без пользовательского содержимого.
- Публичные маршруты, редиректы и security headers.
- Код auth/admin boundary, rate limiting, malware scanning, quota reservation/release, billing webhook, account deletion, health и graceful shutdown.
- Статические UX/accessibility признаки по frontend-коду и публичным страницам.

Не выполнялось:

- Никаких исправлений, миграций, деплоев, рестартов production, коммитов или изменений данных.
- Реальная оплата, платная AI-генерация, удаление аккаунта и иные необратимые действия.
- Authenticated live acceptance: в текущей задаче не было доступной интерактивной сессии и тестовых credentials для admin и нового обычного пользователя.
- Полный визуальный/mobile/keyboard/screen-reader проход: in-app Browser не предоставил управляемую вкладку. Публичные HTTP-проверки не выдаются за визуальный smoke.
- Live Sentry issue/alert review: локально отсутствуют `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`; production API также не имеет `SENTRY_DSN`.

Важное ограничение воспроизводимости: dirty-состав кандидата изменился во время ревью. Последний наблюдаемый срез включал дополнительные изменения `image-search`, presentation planning/quality/normalization и их тестов, которых не было в первоначальном baseline. Отчёт описывает последний увиденный срез, но не может сделать его immutable.

## 3. P0 — блокеры любого релиза

### P0-1. Кандидат не является зафиксированным release artifact

Факты:

- Branch: `codex/release-gates-automation`.
- `HEAD`: `d64d8f47762220b333043c71d35e136f06faeba2`.
- Working tree dirty: изменены API, web config/build artifacts, worker generation/cost/image/planning code, shared cost contract и Prisma schema; присутствует новая migration и большое количество untracked `.p1-3-*`, `.codex-*` артефактов.
- Состав diff изменился во время аудита без действий этого ревью.
- `scripts/deploy.ps1` правильно запрещает deploy dirty tree, поэтому кандидат в текущем виде не может пройти штатный release path.

Риск: результаты typecheck, review или CI нельзя однозначно привязать к одному набору байтов; повторный запуск может проверять уже другой код.

Критерий закрытия:

- Все целевые изменения собраны в чистом commit на отдельной ветке.
- Untracked/генерируемые артефакты удалены из release scope или корректно игнорируются.
- Зафиксированы candidate SHA и полный diff; после фиксации SHA код не меняется до завершения acceptance.

### P0-2. Кандидат расходится с production и может откатить уже выпущенные исправления

Факты:

- Production release: `79273de724a97d428baafd7946ce41a74f831caf`.
- Merge base с локальным `HEAD`: `f9861627e091f890f7a854f1f4e85e190cccc32f`.
- `git merge-base --is-ancestor 79273de... HEAD` вернул exit code 1.
- `git diff HEAD..79273de...`: 59 файлов, 1600 вставок, 543 удаления.
- Только в production-линии находятся, среди прочего, user provisioning первого Telegram-входа, IPv6 egress для auth, landing/style fixes, Alpine security update и многочисленные generation-recovery исправления.

Риск: прямой merge/deploy текущей ветки способен вернуть production к старому поведению и повторно открыть уже закрытые дефекты.

Критерий закрытия:

- Кандидат пересобран поверх актуального `main`/production lineage.
- Production commit является предком candidate SHA.
- Конфликты разобраны содержательно, особенно в auth, production config, worker recovery и frontend styles.
- Повторно выполнены полный CI и live acceptance уже для нового SHA.

### P0-3. Новая Prisma-миграция несовместима с текущей release policy

Факты:

- Кандидат добавляет `prisma/migrations/20260831140000_ai_usage_cache_write_tokens/migration.sql` и колонку `AiUsageEvent.cacheWriteTokens`.
- `.github/workflows/release-gates.yml` завершает job ошибкой при любом изменении `prisma/migrations`.
- Release manifest всегда пишет `migrationCompatibility: no-schema-change`.
- `scripts/verify-release-manifest.ps1` и `scripts/deploy-release.sh` принимают только `no-schema-change`.

Риск: кандидат не может получить валидный release manifest штатным путём. Обход gate вручную уничтожит доказательство совместимости и rollback safety.

Критерий закрытия:

- Либо schema change исключён из этого релиза.
- Либо реализована и отдельно принята forward-compatible migration policy: expand/contract, staging migration smoke, backward compatibility со старым API/worker, immutable manifest с новым типом compatibility, deploy/rollback правила и доказанный rollback без потери данных.
- Candidate release run зелёный без ручного обхода gate.

## 4. P1 — launch-blocking операционные и продуктовые риски

### P1-1. Резервное копирование отключено через временный waiver

Факты production:

- `ALLOW_PRODUCTION_WITHOUT_BACKUP=true`.
- `BACKUP_ENABLED=false`.
- В `/opt/studydeck/backups` найдены только локальные pre-migration dumps и staging archive.
- StudyDeck backup/restore timer или cron не найден.
- Доказательства off-site copy и успешного restore drill отсутствуют.

Риск: потеря VPS, volume или ошибочная операция может привести к необратимой потере PostgreSQL/MinIO данных.

Критерий закрытия:

- Waiver выключен, `BACKUP_ENABLED=true`.
- PostgreSQL и MinIO копируются в отдельное off-site хранилище с encryption и retention.
- Есть мониторинг свежести backup.
- Выполнен документированный restore drill в изолированную среду с измеренными RPO/RTO.

### P1-2. Production фактически работает без error monitoring и health alerts

Факты:

- `ADMIN_ALERTS_ENABLED=false`.
- `SENTRY_DSN` в production API отсутствует.
- `POSTHOG_API_KEY` отсутствует.
- За последние 24 часа зарегистрировано 13 `critical` OperationalEvent: все `api/http_error`, `GET`, `ServiceUnavailableException`, HTTP 503, один fingerprint, временное окно 30 августа 21:23:16–21:25:28 UTC.
- Текущий readiness зелёный; значит это исторический краткий эпизод, но без alerting/Sentry нельзя подтвердить время реакции и первопричину.

Риск: критический отказ обнаруживается только при ручной проверке; нет внешнего сигнала, issue correlation и контроля доставки алерта.

Критерий закрытия:

- Подключён Sentry для web/API/worker с environment/release tags и проверенной доставкой тестового события.
- Включены health alerts и доказана доставка в реальный канал.
- Настроены алерты минимум на readiness, worker heartbeat, queue lag/failures, 5xx rate, billing webhook failures, backup freshness и storage capacity.
- Проведён controlled alert drill, зафиксированы owner и response SLA.

### P1-3. Не выполнен live acceptance критических пользовательских путей

Production DB содержит только 1 пользователя и 0 проектов. Агрегаты чистые: нет отрицательной квоты, failed jobs с удержанной квотой, stale active jobs, failed/stale deletion jobs, expired paid access или успешных платежей без активации. Это полезно как sanity check, но не является доказательством рабочих end-to-end потоков.

Не подтверждены на candidate SHA:

- Первый Telegram login и автоматическое создание обычного пользователя.
- Разделение normal user/admin и запрет `/admin` для не-admin.
- Создание проекта, генерация без источника и с источниками, визуалы, narration, сохранение и повторное открытие.
- PPTX/PDF/DOCX export реального результата.
- Правило квоты: reservation при старте, сохранение счётчика только при успешном результате, release на failure/cancel/queue-add failure.
- YooKassa success/cancel/webhook/idempotency и срок paid access.
- Удаление аккаунта и подтверждение удаления/анонимизации связанных данных.
- Mobile layout, keyboard-only navigation, focus order, dialogs, error recovery и screen-reader labels.

Критерий закрытия:

- Один документированный acceptance run на immutable candidate SHA с новым normal user и отдельным admin.
- Для платных действий используется заранее согласованный минимальный сценарий либо sandbox провайдера.
- Сохранены только обезличенные результаты: статус шага, request/job/export IDs при необходимости, без токенов и пользовательского содержимого.
- Повторно проверены desktop и mobile Chromium; критический путь проходим клавиатурой.

### P1-4. Legal/privacy тексты не утверждены для публичного запуска

Факты:

- `/privacy`, `/terms`, `/support` отвечают HTTP 200.
- Privacy прямо говорит, что до публичного запуска оператор обязан утвердить retention, processors и cross-border transfer.
- Terms прямо говорит, что до launch условия должны быть утверждены уполномоченным юристом.
- Support имеет fallback `support@example.com`; production config требует реальный email, но SLA/owner обработки обращений не доказаны.

Критерий закрытия:

- Утверждены оператор, применимое право, страны доступности, privacy/terms, processors, retention, cross-border transfer, payment/refund/cancellation и age policy.
- Реальный support email проверен входящим и исходящим обращением.
- Определены owner и SLA для support, privacy и deletion requests.
- Из пользовательского текста удалены внутренние пометки «до launch».

### P1-5. Release archive содержит отслеживаемые временные и потенциально чувствительные артефакты

Факты:

- Git отслеживает `.audit-bmw/**`, `.tmp-project.json`, `.tmp-e2e-export.pptx` и другие smoke/tmp материалы.
- `.dockerignore` не включает их в image layers, но `scripts/deploy.ps1` передаёт `git archive HEAD`, поэтому tracked artifacts попадают в каждый каталог release на сервере.
- На сервере рядом с production env обнаружены несколько `.env.production.swp/.swo/.swn/.swm` и `.env.production.bak` с mode 600. Их содержимое не читалось.

Риск: лишние документы/JSON увеличивают поверхность утечки, а копии env умножают число мест хранения секретов.

Критерий закрытия:

- Из Git удалены все пользовательские, smoke и render artifacts; тестовые fixtures минимальны и синтетичны.
- Добавлены защитные ignore/secret-scan правила.
- Release archive проверяется allowlist/denylist gate.
- Env swap/backup файлы безопасно инвентаризированы и удалены оператором после проверки; production secret rotation выполнена, если нельзя доказать отсутствие копирования/утечки.

## 5. P2/P3 — следующий приоритет после launch blockers

### P2. Проверяемость локального кандидата на Windows ненадёжна

- Все четыре TypeScript typecheck прошли.
- `prisma validate` прошёл.
- Vitest из корня сначала упал на `EPERM scandir` внутри tracked `.audit-bmw`; package-local запуск затем блокировался sandbox `spawn EPERM`, а разрешённый полный `npm run test` завис без вывода.
- `npm run lint` также завис без результата.
- Production compose config локально не был проверен, потому что по дизайну отсутствует секретный `.env.production`; фактический production compose при этом работает и healthy.

Нужно исключить generated/audit directories из test discovery, обеспечить детерминированный Windows test runner и получать результат lint/test/build на чистом candidate SHA в CI.

### P2. Supply-chain hardening GitHub Actions неполный

Workflow использует major tags вроде `actions/checkout@v4` и `actions/setup-node@v4`, а не полные commit SHA. Для production release workflow рекомендуется pinning SHA с автоматизированным Dependabot/Renovate обновлением.

### P2. Product analytics отсутствует

`POSTHOG_API_KEY` в production отсутствует. Это не причина аварийной остановки, но до публичного growth launch нужно определить минимальные privacy-safe события activation/funnel и consent/retention policy. Нельзя подменять этим error monitoring.

### P3. Minor HTTP hardening

Публичный ответ содержит `X-Powered-By: Next.js`; в `apps/web/next.config.ts` нет `poweredByHeader: false`. Это низкий риск, но легко устраняется после P0/P1.

## 6. Что уже сделано хорошо

- Production release manifest фиксирует exact git SHA и immutable digests; release gate отмечен `passed`.
- GitHub Actions run [33406667772](https://github.com/SamuraiSBS/Presentation/actions/runs/33406667772) для production SHA завершён успешно: quality/migrations/dependencies, secret scan, desktop/mobile Playwright, immutable images/staging smoke и publish.
- Все production containers healthy: web, API, worker, PostgreSQL, Redis, MinIO, ClamAV; наружу опубликованы только 80/443 через Caddy.
- `/api/internal-health` сейчас `ready` и подтверждает configuration, DB, migrations, storage, malware, queues и worker heartbeat.
- Анонимный `/dashboard` перенаправляется на login; `/admin` без сессии отображает login, а не admin data.
- Есть CSP, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, Referrer-Policy и Permissions-Policy.
- Production config fail-closed для dev flags, default secrets, admin allowlist, Telegram, rate limits и malware scanning.
- API rate limiter использует Redis и fail-closed поведение; uploads fail closed при недоступном ClamAV.
- Quota reservation выполняется транзакционно; queue-add и terminal failure release покрыты кодом и существующими тестами. Production-агрегаты аномалий квоты не показали.
- YooKassa webhook не доверяет входному payload: состояние платежа повторно запрашивается у провайдера, проверяются status/paid/amount/currency/metadata, транзакции идемпотентны.
- Health/readiness и bounded graceful shutdown реализованы в коде и production compose.

## 7. Матрица доказательств

| Область | Результат | Статус |
|---|---|---|
| Production release/containers/readiness | Release `79273de...`, все сервисы healthy, readiness green | PASS |
| Public perimeter/auth redirect/headers | Только Caddy 80/443, anonymous redirect, security headers | PASS |
| Production DB sanity aggregates | Аномалий jobs/quota/billing/deletion/migrations не найдено | PASS с малой выборкой |
| Candidate typecheck | shared/API/web/worker прошли | PASS |
| Candidate Prisma schema validation | прошла | PASS |
| Production CI | run 33406667772 green | PASS только для production SHA |
| Candidate ancestry | production не является предком candidate | FAIL |
| Candidate immutability | dirty tree менялся во время аудита | FAIL |
| Candidate migration release path | migration запрещена текущим manifest/gate/deploy | FAIL |
| Candidate lint/unit/build/E2E | нет завершённого результата для стабильного SHA | NOT VERIFIED |
| Backup/restore | waiver true, backup false, restore drill отсутствует | FAIL |
| Monitoring/alerts | alerts false, Sentry DSN отсутствует | FAIL |
| Legal/support approval | страницы доступны, тексты не утверждены | FAIL |
| Authenticated live acceptance | нет двух ролей и полного product flow | NOT VERIFIED |
| UX/mobile/a11y live audit | статический review только; browser session недоступна | NOT VERIFIED |

## 8. Порядок закрытия

1. Остановить добавление изменений в текущий dirty checkout и сформировать чистый candidate commit поверх актуального `main`/production.
2. Решить судьбу schema change: вынести его либо внедрить полноценную forward-compatible migration policy.
3. Удалить tracked audit/tmp artifacts из release scope и провести hygiene production env copies.
4. Запустить полный release CI для immutable candidate SHA; не переиспользовать зелёный run production-коммита как доказательство кандидата.
5. Включить off-site backup и выполнить restore drill.
6. Подключить Sentry и health alerts, провести alert drill.
7. Утвердить legal/privacy/payment/support документы и операционные SLA.
8. Провести один контролируемый live acceptance с normal user и admin, включая quota, export, billing и account deletion.
9. Повторить Go/No-Go review на том же candidate SHA. Любое изменение после CI/acceptance создаёт новый кандидат и требует повторной проверки затронутых gates.

## 9. Решение

**NO-GO для текущего локального кандидата.**

Минимум для смены решения на GO:

- закрыты P0-1, P0-2 и P0-3;
- candidate SHA чистый, immutable и является потомком актуального production/main;
- candidate release CI полностью зелёный;
- backup/restore и monitoring/alerts реально включены и проверены;
- legal/support утверждены;
- live acceptance критических потоков пройден на том же SHA двумя ролями без unresolved P0/P1.

## 10. Побочный эффект аудита

При попытке очистить зависшие test processes были ошибочно завершены три локальных процесса `mcp/server.mjs`, принадлежавшие Codex helper-инфраструктуре, а не Vitest. Репозиторий, Docker и production не затронуты; один helper автоматически перезапустился. Если после этой задачи какой-либо connector в Codex недоступен, достаточно перезапустить Codex desktop. Других процессов после обнаружения ошибки я не завершал.
