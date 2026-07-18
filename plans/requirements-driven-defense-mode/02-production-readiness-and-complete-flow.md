# StudyDeck AI: доведение режима «Защита проекта» до полностью рабочего состояния

## Назначение документа

Это самодостаточный план-промт для нового чата Codex. Его задача — не спроектировать ещё один MVP, а довести уже реализованный режим `requirements_driven` до production-ready состояния и доказать работоспособность полного пользовательского пути на `http://localhost:3010`.

Итоговый пользовательский сценарий должен работать целиком:

1. открыть `/new/defense`;
2. выбрать тип защиты и режим соблюдения требований;
3. заполнить сведения о проекте и авторе;
4. загрузить, удалить и повторно открыть сохранённые материалы;
5. сохранить и отредактировать черновик;
6. явно подтвердить запуск AI-анализа;
7. проверить требования, факты, материалы и конфликты;
8. исправить или подтвердить данные;
9. построить, изменить и утвердить план защиты;
10. сгенерировать речь, слайды, заметки и тайминг;
11. открыть результат в существующем редакторе и внести изменения;
12. запустить compliance-проверку;
13. получить версионированный PDF-отчёт;
14. экспортировать презентацию в PPTX/PDF с backend-проверяемым подтверждением известных проблем.

Работай в существующем монорепозитории `D:\presentation`. Не создавай отдельное приложение, отдельный генератор или параллельную очередь задач. Используй текущие `packages/shared`, Prisma, NestJS API, BullMQ worker, Next.js web, редактор, экспорт и существующие провайдеры AI.

## Обязательный исходный контекст

Перед изменениями полностью прочитай:

- `AGENTS.md`;
- `PRODUCT.md`;
- `DESIGN.md`;
- `plans/requirements-driven-defense-mode/01-product-and-technical-handoff.md`;
- этот документ;
- актуальные версии перечисленных ниже файлов — код мог измениться после подготовки плана.

Первый handoff остаётся продуктовым контрактом. Этот документ уточняет порядок доведения реализации, закрывает найденные runtime/UX-пробелы и добавляет обязательную сквозную верификацию. При расхождении не ослабляй evidence-first, безопасность, версионирование и качество экспорта.

## Правила выполнения

1. Сначала выполни read-only ревизию текущего состояния и `git -c safe.directory=D:/presentation status --short`.
2. Не откатывай и не перезаписывай пользовательские изменения. Изменяй только относящиеся к задаче файлы.
3. Не работай с legacy MVP в корне репозитория.
4. Не ограничивайся фронтендом: сценарий должен реально проходить через shared-контракты, базу, API, очередь, worker, хранилище, редактор и экспорт.
5. Не подменяй работающий backend демо-ответами в браузере. Детерминированные моки допустимы только в автоматических тестах.
6. Не трать реальные AI-квоты до исправления детерминированных ошибок API, маршрутизации и валидации. Сначала добейся полного прохождения тестов с моками, затем выполняй один контролируемый smoke с настроенным провайдером, если ключи доступны.
7. Любой переход состояния, который может быть вызван повторным кликом, retry, обновлением страницы или повторной доставкой job, должен быть идемпотентным.
8. Состояние и разрешённые переходы определяет backend. UI не должен быть единственной защитой от устаревшей ревизии, повторного запуска или экспорта без подтверждения.
9. Не ослабляй существующие проверки качества генерации, схему результата или evidence-first правила ради прохождения happy path.
10. Сохрани поддержку OpenAI, Yandex и разрешённого demo fallback. Сетевые вызовы в тестах должны быть замоканы или включаться только явным env-флагом.
11. После существенных этапов запускай узкие тесты; в конце — полный набор проверок и production-like runtime на `3010`.
12. Не коммить, не пушь и не выполняй удалённый deploy без отдельной команды пользователя.

## Зафиксированные продуктовые инварианты

### Отдельный workflow

- Режим хранится как `workflow = requirements_driven` и не подменяет обычный `Project.mode`.
- Обычный `/new`, стандартная генерация, редактор и экспорт не должны регрессировать.
- Тип защиты: `hackathon` или `diploma`.
- Режим соблюдения: `strict` или `adaptive`.
- `adaptive` позволяет улучшать необязательную структуру и подачу, но никогда не разрешает выдумывать факты.

### Доказательность

- Факт попадает в презентацию только при наличии документа-источника или явного подтверждения пользователя.
- Пользовательский факт имеет provenance «Подтверждено автором проекта».
- Вывод модели, догадка по скриншоту и результат интернет-поиска не являются фактическим доказательством.
- Tavily/image search используется только при `allowWebImages=true`, только для оформления и никогда как источник факта о проекте.
- Пользовательские скриншоты, логотипы и иллюстрации имеют приоритет над найденными в интернете изображениями.
- Если доказательства нет или конфликт не разрешён, в слайдах, речи и отчёте остаётся явный заполнитель/предупреждение.

### Ревизии и экспорт

- Анализ, план, презентация и compliance-отчёт привязаны к явным ревизиям входных данных.
- Изменение релевантных исходников делает зависимые результаты устаревшими и требует осознанного rebuild/rerun.
- Compliance не считается актуальным после изменения презентации или требований.
- Экспорт презентации с нерешёнными проблемами разрешается только после явного подтверждения, проверенного backend.
- PDF compliance report — отдельный артефакт, а не замена PDF презентации.

## Текущее состояние, которое нужно перепроверить

Это снимок аудита, а не предположение о вечном состоянии кода. В начале работы воспроизведи его и зафиксируй, что изменилось.

### P0 — runtime-блокер

- Страница `http://localhost:3010/new/defense` доходила до сохранения, но показывала «Сервис ещё не поддерживает это действие».
- Валидный `POST /api/projects/defense` возвращал `404` из-за отсутствия live-маршрута `POST /v1/projects/defense`.
- `GET /v1/projects/:id/defense` также возвращал `404`.
- В исходниках `DefenseModule` был подключён, а `DefenseController` содержал маршруты, но запущенный API-контейнер был старее web-контейнера и не регистрировал defense endpoints.
- Из-за этого live-аудит не смог честно проверить сохранение, загрузку, AI-анализ и все последующие этапы.

### P1 — функциональность и доступность

- Между `761px` и `1000px` могла исчезать вся основная навигация: legacy CSS скрывал desktop nav до `1000px`, а bottom nav появлялся только до `760px`.
- На ширине до `380px` подписи шагов визуально скрывались и в accessibility tree оставались только номера `1/2/3/4`.
- При ошибке формы фокус оставался на кнопке продолжения; поля не получали `aria-invalid` и связи с конкретной ошибкой через `aria-describedby`.
- Ограничения web-формы расходились с API: title max 140, формат года `YYYY`, максимальные длины author fields и точный whitelist GitHub/GitLab не отражались клиентом.
- После сохранения draft UI блокировал все шаги и убирал «Назад», хотя продуктовый контракт разрешает менять тип и режим до подтверждения плана.

### P2 — взаимодействие и покрытие

- Кастомные кнопки с `role="radio"` не поддерживали ArrowUp/ArrowDown/ArrowLeft/ArrowRight и оставляли все варианты в tab order.
- Часть touch targets была меньше `44x44px`: step chips, обычные кнопки и удаление файла.
- UI не показывал и заранее не проверял backend-лимиты: максимум 20 файлов и 100 MB на файл.
- Имеющийся Playwright-тест доходил до видимости кнопки сохранения, но не нажимал её и не проверял границу web → API.
- До сохранения локальный файл удалялся, но отдельного defense endpoint для удаления уже загруженного source в исходном снимке не было.

### Что уже было хорошо и должно сохраниться

- Контраст проверенных сочетаний был не ниже примерно `4.77:1`.
- Видимый focus state и `prefers-reduced-motion` уже учитывались.
- Конкретные unit-тесты web/shared/API проходили.
- Визуальный язык соответствует StudyDeck: рабочая, понятная студенту поверхность без отдельного «магического AI-приложения».

## Основные области кода

Перепроверь список через `rg --files` и поиск импортов. Не считай его исчерпывающим.

### Shared contracts

- `packages/shared/src/defense/schemas.ts`
- `packages/shared/src/defense/inputs.ts`
- `packages/shared/src/defense/presets.ts`
- `packages/shared/src/defense/compliance.ts`
- `packages/shared/src/defense/index.ts`
- `packages/shared/src/index.ts`

### Persistence

- `prisma/schema.prisma`
- `prisma/migrations/20260717120000_requirements_driven_defense/migration.sql`
- новые миграции, только если актуальная модель действительно не позволяет реализовать lifecycle корректно

### API

- `apps/api/src/app.module.ts`
- `apps/api/src/defense/defense.module.ts`
- `apps/api/src/defense/defense.controller.ts`
- `apps/api/src/defense/defense.service.ts`
- тесты defense service/controller
- интеграции `projects`, `sources`, `jobs`, `exports`

### Worker

- `apps/worker/src/tasks/defense/analysis.ts`
- `archive.ts`, `repository.ts`, `pptx-style.ts`, `screenshot-classifier.ts`
- `grounding.ts`, `provenance.ts`, `plan-builder.ts`
- `compliance.ts`, `compliance-report-pdf.ts`, `jobs.ts`
- интеграции с `main.ts`, presentation generation, narration, image search, extraction, export, job progress и PDF renderer

### Web

- `apps/web/src/app/new/defense/page.tsx`
- `apps/web/src/components/defense/defense-wizard.tsx`
- `defense-review-workspace.tsx`
- `defense-plan-workspace.tsx`
- `defense-compliance-panel.tsx`
- `defense-export-compliance.tsx`
- `creation-mode-picker.tsx`
- `apps/web/src/app/projects/[id]/defense/review/page.tsx`
- `apps/web/src/app/projects/[id]/defense/plan/page.tsx`
- `apps/web/src/app/api/projects/defense/route.ts`
- `apps/web/src/app/api/projects/[id]/defense/[[...path]]/route.ts`
- `apps/web/src/lib/defense-queries.ts`
- `apps/web/src/lib/defense-ui.ts`
- редактор, script/speech route и export UI, куда уже встроен defense mode
- `apps/web/src/app/styles/defense.css`
- `apps/web/src/app/styles/editor.css`
- `apps/web/src/app/styles/editor-legacy.css`
- `apps/web/src/app/globals.css`

### E2E

- `e2e/requirements-driven-defense.spec.ts`
- Playwright fixtures/helpers и тестовые provider/job adapters, если они уже есть

## План реализации

Выполняй этапы по порядку. Не переходи к визуальной полировке, пока не работает backend lifecycle.

### Этап 1. Инвентаризация состояния и runtime-контракта

1. Зафиксируй текущий commit, dirty files, версии Node/npm/Docker и состояние compose.
2. Сопоставь зарегистрированные Nest routes с web route proxies и shared input schemas.
3. Проверь наличие и применение Prisma migration, генерацию Prisma Client и подключение `DefenseModule`.
4. Проверь startup logs API: маршруты `POST /v1/projects/defense` и `GET /v1/projects/:id/defense` должны явно регистрироваться.
5. Добавь автоматический smoke, который падает, если production API image не содержит defense routes. Видимая страница или открытый порт не считаются достаточным сигналом.
6. Проверь согласованность `INTERNAL_API_URL`, `INTERNAL_API_TOKEN`, `TEMP_USER_ID`, `NEXT_PUBLIC_DEMO_PREVIEW=false` для реального локального API.
7. Устрани причину runtime/source desync. Не маскируй 404 клиентским сообщением «не поддерживается», если endpoint обязан существовать.

Критерий этапа: валидные create/read requests работают через web proxy и напрямую в API после production-like rebuild; невалидные возвращают структурированную 4xx ошибку, а не generic 404/500.

### Этап 2. Единые контракты и валидация

1. Сделай shared Zod schemas единственным источником серверных ограничений и экспортируй безопасные для клиента constants/metadata, если это не приводит server-only код в browser bundle.
2. Синхронизируй frontend и backend:
   - title: обязательность, trim, max 140;
   - year: пустое значение допустимо, заполненное — ровно `YYYY` в разрешённом диапазоне;
   - author profile: те же max lengths и нормализация;
   - repository URL: только HTTPS, точные hosts `github.com`/`gitlab.com`, формат owner/repository;
   - защита от credentials, нестандартных портов, fragments, неожиданных redirects и SSRF;
   - file count, size, extensions/MIME и роли материалов.
3. Не дублируй разъезжающиеся magic numbers между web и API.
4. Возвращай machine-readable field errors; web должен связывать их с конкретными полями.
5. Добавь граничные тесты: пустые значения, trim, 140/141 символ, Unicode/кириллица, `www.github.com`, похожие домены, URL с credentials/port, большой файл, 20/21 файл.

Критерий этапа: то, что UI считает валидным, принимает API; то, что API отклоняет, UI заранее объясняет или корректно отображает после ответа.

### Этап 3. Полный lifecycle черновика

1. Сохранение создаёт настоящий `requirements_driven` project и defense config в одной согласованной операции.
2. После успешного сохранения пользователь получает устойчивый URL/идентификатор и может обновить страницу или вернуться позже без потери:
   - типа и режима;
   - количества слайдов и длительности;
   - сведений об авторе;
   - repository source;
   - загруженных материалов и их ролей;
   - согласия на web images.
3. Сделай явный backend-supported edit path для разрешённых до plan confirmation полей. UI должен давать вернуться назад и сохранить изменения.
4. Определи и реализуй transition rules:
   - до подтверждения плана тип и режим редактируются;
   - смена типа пересобирает preset/plan только после понятного подтверждения;
   - загруженные материалы, подтверждённые факты и пользовательские requirements сохраняются;
   - зависимые analysis/plan/compliance revisions становятся stale предсказуемо;
   - после plan confirmation запрещённые изменения отклоняет backend с понятным кодом/сообщением.
5. Повторный click/retry create/save не должен создавать дубликаты. Используй существующий idempotency-паттерн проекта или добавь минимальный совместимый механизм.
6. При частичном сбое загрузки сохрани созданный draft, покажи, что именно загрузилось, и дай повторить только неуспешные операции.

Критерий этапа: черновик переживает reload/reopen, редактируется в разрешённых состояниях, а повторная отправка не создаёт второй проект или второй набор источников.

### Этап 4. Источники, загрузка и удаление

1. Проверь отдельные пути для:
   - основного документа TXT/MD/PDF/DOCX/PPTX;
   - публичного GitHub/GitLab repository;
   - ZIP проекта;
   - технического ТЗ;
   - ТЗ защиты;
   - PPTX style reference;
   - screenshots, logo и user illustrations.
2. До upload показывай допустимые типы и лимиты. Проверяй максимум 20 файлов и 100 MB на файл до network request, не отменяя server validation.
3. Показывай progress/status по каждому файлу, точное сообщение для rejected/failed/duplicate и возможность retry.
4. Реализуй два вида удаления:
   - до сохранения — локальное удаление из selection;
   - после upload/reopen — backend-supported remove/exclude action с ownership check.
5. Для persisted source выбери семантику, сохраняющую provenance:
   - если источник уже участвовал в анализе, предпочтительно soft-exclude с видимым для пользователя удалением из активного набора;
   - физическое удаление MinIO object выполняй только для принадлежащего проекту upload и после безопасной DB-операции/cleanup job;
   - не оставляй dangling fact/evidence references;
   - если source используется, либо транзакционно инвалидируй производные сущности, либо блокируй удаление и перечисляй зависимости;
   - bump input/analysis revision, помечай plan/compliance stale.
6. Repository/ZIP MVP анализирует только README и документацию, не исходный код и secrets. Добавь защиту ZIP от path traversal, zip bomb и чрезмерной распаковки.
7. Для scanned PDF без text layer показывай честное предупреждение; не обещай OCR, если его нет в scope.
8. Проверяй, что PPTX извлекает только style brief и не копирует master/layout/координаты.

Критерий этапа: пользователь может добавить, увидеть после reload, переименовать роль/исключить и безопасно удалить любой принадлежащий ему материал без рассинхронизации provenance.

### Этап 5. Подтверждение AI и запуск анализа

1. До первого платного/внешнего AI-вызова покажи явное подтверждение:
   - какие материалы будут обработаны;
   - что интернет не используется как источник фактов;
   - будет ли выполняться image search;
   - что действие может занять время/использовать AI-квоту.
2. Отмена диалога ничего не enqueue-ит и не меняет draft status.
3. Подтверждение создаёт ровно одну analysis job для актуальной input revision.
4. Двойной клик, reload, retry и повторная доставка BullMQ не создают дубликаты.
5. UI показывает queued/running/succeeded/failed, прогресс и последний успешный результат; polling реализуй через существующий React Query/job pattern.
6. Ошибка provider/queue/extraction должна быть конкретной и повторяемой без пересоздания проекта.
7. После завершения переходи в review workspace; прямое открытие review во время анализа показывает устойчивый loading state, а не пустой экран.

Критерий этапа: отмена не тратит квоту, подтверждение запускает один job, reload продолжает наблюдение, retry не дублирует результат.

### Этап 6. Анализ: requirements, facts, assets и conflicts

1. Покажи четыре проверяемые области до генерации: требования, факты, материалы/ассеты, конфликты.
2. Для каждого extracted fact/requirement храни source id и locator. Backend отклоняет несуществующий, чужой или исключённый evidence source.
3. Разреши пользователю:
   - добавлять факт с provenance «Подтверждено автором проекта»;
   - редактировать/удалять допустимые facts;
   - менять важность requirement и исключать его;
   - исправлять классификацию screenshot/asset;
   - разрешать каждый conflict отдельно.
4. Конфликт без решения не блокирует черновик презентации, но спорное утверждение заменяется placeholder и входит в compliance problems.
5. Изменение анализа увеличивает revision и делает старые plan/compliance результаты stale.
6. Не допускай, чтобы image search, inferred UI meaning или model confidence автоматически превращались в confirmed fact.
7. Empty/loading/error states должны объяснять следующее действие.

Критерий этапа: пользователь видит происхождение каждого утверждения и может осознанно подготовить подтверждённый набор данных для плана.

### Этап 7. План защиты

1. Plan builder использует актуальные confirmed facts, active requirements, resolved conflicts, presets и ограничения по времени/числу слайдов.
2. Пользователь может менять порядок, заголовок, цель, timing и привязку материалов в рамках контракта.
3. Суммарный timing и число слайдов валидируются backend; UI показывает остаток/перерасход.
4. `strict` и `adaptive` заметно различаются в допустимой переработке структуры, но одинаково строго соблюдают factual grounding.
5. Rebuild требует подтверждения, сохраняет входные данные и создаёт новую plan revision.
6. Save и confirm — разные операции. Confirm выполняется с expected revision и отклоняет stale request.
7. После изменения типа защиты preset и plan пересчитываются один раз; не допускай stale plan и скрытого возврата старых defaults.

Критерий этапа: plan можно сохранить, переоткрыть, изменить, пересобрать и подтвердить; backend не подтверждает устаревшую ревизию.

### Этап 8. Речь и генерация слайдов

1. Подтверждение плана запускает существующий speech-first pipeline, а не параллельную генерацию defense-only.
2. На одну подтверждённую plan revision создаётся ровно одна narration/generation sequence. Закрой риск двойного enqueue между API, worker и UI.
3. Полная речь, speaker notes и timing создаются для каждого слайда. Принятый пользователем speech draft становится источником истины для slide generation.
4. Генерация использует только grounded facts и видимые placeholders; selective repair не должен незаметно добавлять неподтверждённые сведения.
5. Поддержи OpenAI, Yandex и schema-valid demo fallback. Provider-specific ошибки не скрывай generic сообщением.
6. Reload/reopen показывает текущую job и готовый результат. Retry для failed job не создаёт второй успешный deck.
7. Убедись, что `workflow=requirements_driven`, defense metadata, revisions и provenance доходят до PresentationData и не ломают shared barrel compatibility.

Критерий этапа: после plan confirmation пользователь получает одну согласованную речь и одну презентацию, а не дубликаты jobs/результатов.

### Этап 9. Редактор и приоритет пользовательских ассетов

1. Готовый deck открывается в существующем editor, без отдельного defense editor.
2. Пользователь может редактировать текст, речь/notes и изображения обычными средствами проекта.
3. При выборе visual source соблюдай порядок:
   1. явно выбранный user asset;
   2. релевантный загруженный screenshot/logo/illustration;
   3. разрешённое web image;
   4. placeholder.
4. Никогда не заменяй пользовательский screenshot найденной картинкой при повторной генерации или enrichment.
5. Изменение слайда/речи/требования помечает compliance report stale и сохраняет audit trail ревизии.
6. Web preview, PPTX и presentation PDF должны использовать согласованные theme/layout/visual contracts.
7. Defense panel в editor показывает актуальность проверки и ведёт к понятному следующему действию.

Критерий этапа: внесённое пользователем изменение сохраняется, пользовательский ассет остаётся приоритетным, а статус compliance честно обновляется.

### Этап 10. Compliance и отдельный PDF-отчёт

1. Compliance check запускается вручную для конкретных presentation/requirements revisions.
2. Объедини детерминированные проверки и разрешённую semantic-проверку без потери конкретных problem codes, severity, slide/requirement references и рекомендаций.
3. Сохраняй историю отчётов; UI показывает current/stale и причину устаревания.
4. Повторная проверка после изменения создаёт новую версию, не переписывая старую.
5. PDF report job идемпотентен, имеет status/progress, download URL с ownership/expiry checks и повторяемый retry.
6. PDF отчёт содержит минимум:
   - проект, тип/режим, дату и номера ревизий;
   - summary по passed/warnings/errors/placeholders;
   - требования и статус покрытия;
   - факты и provenance/locators;
   - конфликты и решения;
   - список проблем по слайдам;
   - происхождение интернет-изображений как визуальных ресурсов, но не доказательств.
7. После изменения deck старый отчёт остаётся доступен в истории, но не может отображаться как актуальный.

Критерий этапа: пользователь запускает проверку, видит проблемы, скачивает читаемый PDF, меняет deck и видит, что предыдущая версия стала stale.

### Этап 11. Экспорт презентации и обязательное подтверждение проблем

1. При отсутствии blocking problems экспорт работает как в стандартном workflow.
2. При наличии известных проблем UI показывает точный список и требует явный acknowledgement.
3. Backend проверяет:
   - актуальный report/revision;
   - наличие problems;
   - acknowledgement пользователя;
   - ownership проекта;
   - отсутствие подмены report id или stale revision.
4. Нельзя обойти подтверждение прямым API request.
5. Экспорт PPTX и presentation PDF сохраняет placeholders, speech notes, visual provenance и согласованность с web preview.
6. Compliance PDF не смешивай с export PDF презентации.

Критерий этапа: export без acknowledgement отклоняется backend, с корректным acknowledgement завершается, а отдельный compliance report продолжает скачиваться независимо.

### Этап 12. UX, адаптивность и доступность

Исправь найденные проблемы без редизайна всего продукта. Сохрани StudyDeck design system, контраст и evidence-first видимость.

1. Устрани navigation gap на всём диапазоне ширин. На `761–1000px` должен быть доступен хотя бы один полноценный навигационный паттерн.
2. Stepper:
   - сохраняет доступные названия шагов на 320–380px;
   - текущий шаг объявляется через `aria-current="step"`;
   - завершённость не передаётся только цветом;
   - touch target не меньше `44x44px`.
3. Формы:
   - конкретная ошибка рядом с полем;
   - `aria-invalid` и `aria-describedby`;
   - после submit фокус на первом invalid field;
   - server errors маппятся на поля или на summary с рабочими ссылками;
   - введённые значения не теряются.
4. Choice groups реализуй native radio или полноценным roving-tabindex pattern:
   - один tab stop на группу;
   - стрелки меняют выбранный вариант;
   - Space/Enter работает;
   - legend/label доступны screen reader.
5. Все основные buttons, file delete, step controls и mobile actions доведи до `44x44px` без потери компактности desktop UI.
6. Покажи file limits и роли до выбора файла; ошибки размера/количества не должны требовать ожидания upload.
7. После сохранения draft не запирай разрешённые предыдущие шаги. Покажи «Черновик сохранён», ссылку/путь продолжения и доступные действия.
8. Подтверждающий AI-диалог должен иметь корректный focus trap, initial focus, Escape/Cancel и возврат фокуса на trigger.
9. Loading использует понятные skeleton/status states; ошибки дают retry; empty states объясняют следующее действие.
10. Проверь keyboard-only и screen reader semantics для wizard, review tabs, reorder plan, dialogs, editor defense panel, compliance и export.
11. Проверь `prefers-reduced-motion`, zoom/text scaling 200%, long Russian labels, high-contrast focus и отсутствие horizontal scroll.
12. Обязательные viewport проверки: `320`, `360`, `375`, `760`, `761`, `1000`, `1001`, `1280`, `1440` px.
13. Не превращай authenticated workflow в landing hero. На малых экранах делай header компактнее, сохраняя идентичность и следующий шаг.

Критерий этапа: полный сценарий выполняется keyboard-only, не теряет навигацию/контент на заданных ширинах и соответствует WCAG 2.2 AA для проверяемых controls и форм.

### Этап 13. Ошибки, восстановление и наблюдаемость

1. Для каждого внешнего участка предусмотрены loading, empty, partial success, failed, retry и reload states:
   - API/auth/token;
   - PostgreSQL;
   - Redis/BullMQ;
   - MinIO;
   - extraction;
   - repository download;
   - AI provider;
   - image search;
   - PDF/PPTX export.
2. Не теряй draft и уже успешные uploads при сбое следующего шага.
3. Локализуй пользовательские ошибки на русский, сохраняя технические причины в structured logs.
4. Используй существующие pino/Sentry patterns. Не логируй file contents, токены, credentials, signed URLs и персональные поля целиком.
5. Добавь correlation identifiers: project id, workflow, revision, job id, operation; этого должно хватать для связи web/API/worker logs.
6. Не показывай «ещё не поддерживается» для неожиданных 404/500: различай действительно unsupported feature, stale runtime, auth, validation и temporary failure.

Критерий этапа: пользователь понимает, что произошло и что делать дальше; разработчик может связать ошибку между сервисами без утечки чувствительных данных.

## Обязательная тестовая стратегия

### Unit и contract tests

Добавь/обнови тесты для:

- shared schemas, presets, compliance и revision contracts;
- frontend/server validation parity;
- exact repository host validation и SSRF edge cases;
- source role, limits, exclude/delete и dangling-reference rules;
- evidence source ownership и locator validation;
- stale revision transitions;
- plan timing/slide count;
- one-job idempotency для analysis/narration/generation/report/export;
- asset precedence: user upload побеждает web image;
- backend export acknowledgement;
- compliance stale/current/version history.

### API/service integration tests

Проверь минимум:

1. create → get → patch config;
2. upload/repository → list after reload → exclude/delete;
3. analyze confirm → enqueue once → status/result;
4. facts/requirements/assets/conflicts mutation с ownership и revision checks;
5. plan build/save/rebuild/confirm;
6. plan confirmation → одна narration/generation sequence;
7. compliance run → history/detail → PDF job/download URL;
8. export rejected without acknowledgement and accepted with it;
9. другой пользователь не читает и не изменяет project/source/report/export;
10. повторный request/retry не создаёт дубликаты.

AI/search calls по умолчанию мокай. Для DB/Redis/MinIO используй существующую тестовую инфраструктуру или реалистичные adapters, не заменяя важные repository/transaction проверки чистыми unit mocks.

### Playwright E2E: полный happy path

Текущий smoke, который только видит кнопку «Сохранить», недостаточен. Добавь детерминированный сквозной сценарий:

1. открыть обычный `/new` и убедиться, что стандартный flow сохранён;
2. перейти в `/new/defense`;
3. пройти wizard keyboard/mouse;
4. заполнить валидные данные;
5. загрузить основной документ, дополнительный материал и screenshot;
6. добавить публичный repository fixture;
7. удалить один локальный файл и убедиться, что он не загрузился;
8. сохранить draft и проверить реальный успешный API boundary;
9. reload/reopen draft и проверить persisted fields/sources;
10. изменить разрешённый config и сохранить;
11. удалить/exclude уже загруженный source и проверить reload/invalidation;
12. открыть AI confirmation, отменить и доказать отсутствие job;
13. подтвердить и доказать ровно одну analysis job;
14. открыть review, изменить fact/requirement, разрешить conflict;
15. построить plan, изменить порядок/timing, сохранить и reopen;
16. подтвердить plan и доказать одну narration/generation sequence;
17. подтвердить/отредактировать речь согласно существующему speech-first flow;
18. дождаться готового deck и открыть editor;
19. изменить текст и заменить изображение user asset;
20. запустить compliance, открыть problems и скачать PDF report;
21. изменить deck, проверить stale report, запустить rerun и получить новую версию;
22. проверить отказ export без acknowledgement;
23. подтвердить проблемы и скачать presentation export;
24. проверить, что downloaded artifacts существуют, имеют корректный content type/ненулевой размер и относятся к текущему проекту.

Для этого сценария используй контролируемые provider/job fixtures, чтобы тест был быстрым, повторяемым и не расходовал реальную квоту. Он должен проходить через настоящий web proxy, API, persistence и transition logic, а не полностью route-fulfill-ить браузерными моками.

### Playwright E2E: ошибки и восстановление

Добавь отдельные сценарии:

- invalid fields + focus first error + `aria-invalid`;
- 21 файл и файл больше 100 MB без реального сохранения огромного fixture;
- unsupported/scanned PDF warning;
- invalid repository и похожий вредоносный host;
- частично неуспешный upload и retry;
- анализ failed → retry;
- reload во время running job;
- stale expected revision;
- двойной клик по analyze/confirm/generate/report/export;
- нерешённый conflict → placeholder, а не выдуманный факт;
- чужой project/report/source → 404/403 без утечки данных;
- устаревший compliance report не разрешает обход export gate.

### Accessibility и responsive regression

1. Добавь автоматические axe-проверки ключевых экранов, если библиотека уже есть; иначе используй совместимый с проектом минимальный подход без тяжёлой параллельной системы.
2. Проверь доступные имена stepper и buttons, field error associations, dialogs, tabs, progress/status live regions и radio keyboard behavior.
3. Снимай/проверяй ключевые breakpoint states, особенно `375`, `761`, `1000`, `1280`.
4. Добавь assertions на отсутствие горизонтального overflow и наличие доступной навигации.
5. Ручной smoke: keyboard-only, 200% zoom/text, reduced motion, mobile touch targets.

### Production-container smoke на localhost:3010

Финальная проверка обязана использовать пересобранные production-like контейнеры, потому что исходный P0 был вызван stale API image.

Проверь:

- API startup logs содержат defense routes;
- `GET http://localhost:4000/v1/health` возвращает healthy response;
- create/get defense endpoints отвечают не 404;
- `http://localhost:3010/new/defense` использует реальный API, а не demo preview;
- полный браузерный happy path проходит хотя бы на mock provider runtime;
- один контролируемый real-provider smoke проходит, если валидные ключи доступны; если их нет, зафиксируй внешний blocker отдельно, не называя весь deterministic flow непроверенным.

## Команды проверки

Сначала используй узкие проверки затронутых workspace, затем полный gate. Актуализируй команды по реальным `package.json`, если они изменились.

```powershell
npm run prisma:generate

npm run typecheck -w @studydeck/shared
npm run test -w @studydeck/shared
npm run typecheck -w @studydeck/api
npm run test -w @studydeck/api
npm run typecheck -w @studydeck/worker
npm run test -w @studydeck/worker
npm run typecheck -w @studydeck/web
npm run test -w @studydeck/web

npm run lint
npm run check
npm run test
npm run build
npm run test:e2e
docker compose config --quiet
```

Для production-like локального runtime используй `WEB_PORT=3010`. Так как изменения затрагивают shared/API/worker/web, не ограничивай rebuild только web:

```powershell
$env:WEB_PORT='3010'
docker compose build web api worker

# Применить миграции новым образом API до финального запуска сервисов.
docker compose run --rm api npm run prisma:deploy

docker compose up -d web api worker
docker compose ps
curl.exe -s http://localhost:4000/v1/health
curl.exe -s -o NUL -w "%{http_code}" http://localhost:3010/new/defense
```

Если менялись только отдельные сервисы на промежуточном этапе, используй узкий rebuild согласно `AGENTS.md`; финальный acceptance всё равно должен проверить совместимые production images web/api/worker.

Не скрывай известный lint warning budget изменением порога. Если repo-wide gate падает на уже существующем baseline, покажи точную разницу до/после и не добавляй новых warnings/errors.

## Матрица приёмки

| Область | Обязательный результат |
|---|---|
| Runtime | Defense routes зарегистрированы в live API; create/get через `3010` больше не дают 404 |
| Wizard | Все шаги, поля, кнопки и варианты доступны мышью и клавиатурой |
| Validation | UI и API согласованы по длинам, year, repository и file limits |
| Draft | Сохраняется, переоткрывается, редактируется и не дублируется при retry |
| Sources | Upload/repository/ZIP работают; локальные и persisted sources можно безопасно удалить/исключить |
| AI consent | Cancel не запускает job; confirm запускает ровно одну job |
| Analysis | Requirements/facts/assets/conflicts видимы, редактируемы и имеют provenance |
| Evidence | Нельзя сослаться на чужой/несуществующий source; web image не становится фактом |
| Plan | Строится, меняется, сохраняется, переоткрывается и подтверждается по актуальной revision |
| Speech | Полная речь, notes и timing создаются один раз для утверждённого плана |
| Slides | Генерация сохраняет grounding/placeholders и открывается в существующем editor |
| Assets | Пользовательское изображение имеет приоритет и не перетирается web enrichment |
| Compliance | Проверка версионируется, становится stale после edit и корректно перезапускается |
| PDF report | Отдельный читаемый отчёт создаётся, скачивается и содержит revisions/provenance/problems |
| Export | Backend блокирует обход acknowledgement; PPTX/PDF презентации создаются после подтверждения |
| Recovery | Ошибки API/queue/provider/storage не уничтожают draft и имеют понятный retry |
| Accessibility | Нет критических axe-ошибок; keyboard flow, errors, radio/dialog/tabs/status семантика работают |
| Responsive | Нет navigation gap/overflow; 320–1440px и 200% text не блокируют сценарий |
| Regression | Обычный `/new`, стандартная генерация, editor, providers и exports продолжают работать |
| Observability | Ошибку можно связать по project/revision/job без утечки секретов |
| E2E | Полный детерминированный путь от `/new/defense` до deck + compliance PDF + export проходит |

## Definition of Done

Задача завершена только когда одновременно выполнено всё ниже:

1. На `http://localhost:3010/new/defense` пользователь без ручных запросов к API/БД проходит путь до готовой редактируемой презентации.
2. Работают сохранение/reopen/edit черновика, загрузка и удаление материалов, AI confirmation, анализ, facts/conflicts, plan, speech, slides, compliance, PDF report и presentation export.
3. Нет дублирующих analysis/narration/generation/report/export jobs при retry, reload или двойном клике.
4. Evidence-first и placeholder правила проверены backend/worker тестами, а не только UI copy.
5. Полный deterministic E2E проходит через настоящий web/API/persistence lifecycle.
6. Production-like web/api/worker images пересобраны совместно, defense routes присутствуют в live API и happy path проверен на `3010`.
7. Выполнены unit/integration/E2E/typecheck/build/lint gates либо честно задокументирован существующий baseline без новых регрессий.
8. Адаптивность и доступность проверены автоматически и вручную на обязательных состояниях.
9. Нет незаявленных изменений legacy flow, ослабления quality gates или незавершённых заглушек, выдаваемых за рабочую функцию.

Нельзя считать задачу завершённой только потому, что страница открывается, кнопка видна, route unit test проходит или Docker port слушает.

## Что не входит в scope

- приватные GitHub/GitLab repositories;
- полноценный анализ исходного кода repository/ZIP;
- OCR сканированных документов, если он не был отдельно утверждён;
- новый visual canvas/editor;
- новый AI provider или новая queue architecture;
- полный редизайн StudyDeck вне defense flow;
- удалённый deploy, commit или push без отдельной команды пользователя.

## Формат финального отчёта исполнителя

В конце работы сообщи:

1. краткий итог по каждому этапу и какие пользовательские сценарии теперь работают;
2. список изменённых файлов, сгруппированный по shared/Prisma/API/worker/web/tests;
3. migrations и env-переменные, которые нужны;
4. все запущенные команды и их фактический результат;
5. результаты production-container smoke, live URL и идентификатор тестового defense project;
6. результат полного deterministic E2E и, отдельно, real-provider smoke;
7. результаты keyboard/a11y/responsive проверки;
8. оставшиеся внешние blockers или риски — без сокрытия под формулировкой «готово»;
9. итоговый `git status --short` и подтверждение, что чужие изменения не затронуты.

Если внешний AI-провайдер недоступен из-за ключа/квоты, deterministic full flow всё равно должен быть доказан. При этом отдельно укажи, что real-provider smoke не пройден, его точную причину и безопасный следующий шаг.
