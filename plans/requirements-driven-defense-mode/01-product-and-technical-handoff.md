# StudyDeck AI: режим «Защита проекта по ТЗ»

## Назначение документа

Это самодостаточный продуктовый и технический handoff-промт для нового чата Codex. Нужно реализовать в текущем монорепозитории `D:\presentation` отдельный режим StudyDeck для подготовки студенческой защиты проекта по формальным требованиям.

Работай с существующим приложением, а не создавай отдельный прототип и не меняй legacy MVP в корне. Реализация должна пройти сквозь `packages/shared`, Prisma, NestJS API, BullMQ worker, Next.js web, редактор, экспорт и тесты.

Перед изменениями:

1. Полностью прочитай `AGENTS.md`, `PRODUCT.md` и `DESIGN.md`.
2. Проверь `git -c safe.directory=D:/presentation status --short` и не откатывай чужие изменения.
3. На момент подготовки этого handoff в worktree был изменён `package-lock.json`. Это пользовательское изменение: заново проверь diff и не перезаписывай его вслепую, особенно если добавляешь зависимость.
4. Просмотри актуальные версии файлов, перечисленных в разделе «Текущие точки расширения»: код может измениться после создания документа.
5. Не коммить изменения и не перестраивай production web-контейнер без отдельной просьбы пользователя.
6. Для frontend-проверки используй `npm run dev:web:fast` и `http://localhost:3020`. `localhost:3010` требует production Docker rebuild и нужен только по явному запросу.

## Цель

Добавить отдельный пользовательский режим **«Защита проекта»** с пояснением **«Презентация по ТЗ»**. Пользователь загружает описание своего сайта/приложения, техническое ТЗ, требования к защите, PPTX-референс, скриншоты и другие материалы. StudyDeck:

1. извлекает только подтверждённые факты;
2. распознаёт и классифицирует требования;
3. показывает факты, требования, материалы и противоречия до генерации;
4. позволяет пользователю разрешать каждый конфликт;
5. строит план защиты с таймингом;
6. генерирует слайды и речь без выдуманных сведений;
7. ставит явные заполнители при нехватке материала;
8. по кнопке проверяет готовую презентацию на соответствие ТЗ;
9. сохраняет версии отчётов и экспортирует отчёт в PDF;
10. разрешает экспортировать PPTX/PDF с проблемами только после обязательного предупреждения и явного подтверждения.

## Зафиксированные продуктовые решения

Не переоткрывай эти решения без реальной технической причины.

### Аудитория и язык

- Первая аудитория: участники студенческих хакатонов и студенты с дипломными проектами.
- Пользователь всегда вручную выбирает тип: `hackathon` или `diploma`.
- Первая версия работает только на русском языке.
- Максимум 20 слайдов и 15 минут выступления.

### Режим соблюдения требований

- `strict`: активные требования соблюдаются буквально; при нехватке факта или материала создаётся заполнитель и предупреждение.
- `adaptive`: обязательные требования сохраняются, а StudyDeck один раз получает разрешение улучшать всё необязательное: порядок, формулировки, композицию, распределение содержания и локальный тайминг.
- Адаптивность никогда не разрешает придумывать факты.
- Пользователь может сменить тип защиты и режим позже. Загруженные материалы, подтверждённые факты и пользовательские требования сохраняются; стандартный план и распределение материалов пересчитываются после подтверждения.

### Источники

Для запуска достаточно одного источника о проекте:

- TXT, MD, PDF с текстовым слоем, DOCX или PPTX;
- публичный GitHub/GitLab-репозиторий;
- ZIP-архив проекта.

В публичном репозитории и ZIP анализируются только README и файлы документации. Исходный код, зависимости и конфигурация в MVP не анализируются. Приватные репозитории не поддерживаются. OCR сканов и фотографий документов не входит в MVP.

Дополнительно можно загрузить:

- техническое ТЗ;
- ТЗ защиты;
- PPTX как визуальный референс;
- скриншоты интерфейса;
- логотипы;
- пользовательские иллюстрации.

### Достоверность

- В презентацию попадают только факты, подтверждённые документом или самим пользователем.
- Факт пользователя имеет источник «Подтверждено автором проекта».
- Вывод модели, догадка по интерфейсу или факт из интернет-поиска не считается подтверждённым.
- Интернет в этом режиме не используется как источник фактов.
- Внутренний отчёт хранит источник и локатор каждого факта/требования; ссылки на источники не добавляются на слайды автоматически.

### Требования и конфликты

Требования имеют важность:

- `required` — обязательное;
- `recommended` — рекомендуемое;
- `preference` — пожелание.

Пользователь может менять важность и нажать «Не учитывать». Объяснение для исключения не требуется. Если документы противоречат друг другу, StudyDeck показывает варианты, а пользователь разрешает каждый конфликт отдельно. Неразрешённый конфликт не блокирует создание черновика: вместо спорного содержания используется заполнитель/предупреждение.

### Стандартные пресеты

Если ТЗ защиты отсутствует, применять версионированный встроенный пресет.

`hackathon-v1`, ориентир 10 слайдов / 7 минут:

1. Название проекта и команда.
2. Проблема.
3. Целевая аудитория.
4. Решение.
5. Ключевые функции.
6. Демонстрация интерфейса.
7. Технологический стек.
8. Архитектура или принцип работы.
9. Результаты и дальнейшее развитие.
10. Завершение и контакты.

`diploma-v1`, ориентир 12 слайдов / 10 минут:

1. Титульный слайд.
2. Актуальность.
3. Цель и задачи.
4. Объект и предмет работы.
5. Требования к системе.
6. Архитектура.
7. Использованные технологии.
8. Реализация основных функций.
9. Интерфейс и демонстрация.
10. Тестирование и результаты.
11. Выводы.
12. Завершающий слайд.

Это запасная структура, а не источник фактов. Не добавляй отдельный слайд литературы/источников, если его не требует загруженное ТЗ.

### Персональные данные

Стандартные поля диплома:

- ФИО;
- учебное заведение;
- кафедра;
- группа;
- руководитель;
- город;
- год.

Для хакатона дополнительно полезны команда и название мероприятия. Все поля необязательны: при отсутствии нужного значения создаётся заполнитель.

### Скриншоты и интернет-изображения

- Сервис автоматически классифицирует скриншоты и распределяет их по подходящим слайдам.
- Пользователь может исправить классификацию и заменить изображение в редакторе.
- Поиск интернет-изображений запускается только при явном `allowWebImages=true`.
- Интернет-изображение допустимо как фон, тематическая фотография или общая иллюстрация.
- Интернет-изображение нельзя подставлять вместо интерфейса проекта, его результата, метрики, реальной архитектуры или доказательства функции.
- Если собственного доказательного изображения нет, создавай явный заполнитель «Добавьте скриншот …».
- Происхождение интернет-изображений показывай во внутреннем отчёте, не добавляй автоматически на слайд.

### PPTX-референс

PPTX используется только как источник визуального стиля:

- основные цвета;
- шрифты;
- логотипы;
- фоновые/графические мотивы;
- общая светлая/тёмная тональность.

Не нужно сохранять исходные мастер-слайды, точные координаты или существующую структуру. Полученный style brief должен переводиться в текущий `PresentationTheme`/`DesignBrief`, чтобы web preview, PPTX и PDF оставались согласованными.

### Речь и тайминг

- Генерировать полный текст выступления, speaker notes и тайминг каждого слайда.
- Не генерировать вопросы жюри.
- Предупреждать, если расчётное время чтения слайда/заметок превышает выделенный тайминг.
- Сумма `timingSeconds` должна укладываться в пользовательский лимит, если только активное ТЗ явно не создаёт конфликт; такой конфликт показывается пользователю.

### Проверка и экспорт

- Проверка запускается вручную кнопкой **«Проверить по ТЗ»** после генерации или правок.
- Каждый запуск создаёт неизменяемую версию отчёта, привязанную к revision презентации и revision анализа.
- Отчёт показывает отдельные итоги по обязательным, рекомендуемым и пожеланиям, а не маскирует обязательные нарушения одним процентом.
- Отчёт хранит выполненные, частичные, невыполненные, исключённые и требующие проверки требования; конфликты; заполнители; источники фактов; интернет-изображения; перегруженные слайды.
- Отчёт доступен в StudyDeck и экспортируется отдельным PDF.
- Экспорт презентации с конфликтами/заполнителями разрешён, но backend требует явного подтверждения актуального предупреждения.

## Что не входит в MVP

- OCR сканированных документов и фотографий ТЗ.
- Приватные GitHub/GitLab-репозитории и OAuth к ним.
- Анализ исходного кода, `package.json`, lock-файлов, Docker и архитектуры по коду.
- Несколько альтернативных планов на выбор.
- Английский язык.
- Вопросы жюри.
- Точное воспроизведение PPTX-шаблона и его master layouts.
- Автоматическое подтверждение найденных в интернете фактов.
- Незаметная замена отсутствующего скриншота стоковой картинкой.

## Текущее состояние репозитория и точки расширения

Не дублируй существующие механизмы.

### Shared contracts

- `packages/shared/src/projects/inputs.ts`: `createProjectInputSchema`, slide/narration/generation inputs.
- `packages/shared/src/projects/schemas.ts`: project statuses, `Source`, source refs.
- `packages/shared/src/generation/schemas.ts`: progress stages, research/design/pipeline artifacts.
- `packages/shared/src/presentation/schemas.ts`: `Slide`, `timingSeconds`, `sourceRefs`, visuals и canvas.
- `packages/shared/src/presentation/document.ts`: `PresentationDocument`.
- `packages/shared/src/index.ts`: публичные exports shared package.

Текущий `Project.mode` описывает способ генерации/источников (`fast_draft`, `with_sources`, `explain_simpler`). Не перегружай его значением нового продуктового workflow.

### Prisma/API

- `prisma/schema.prisma`: `Project`, `Source`, `Presentation`, `GenerationJob`, `Export`.
- `apps/api/src/projects/projects.service.ts`: создание проекта, narration/presentation queues, revision-safe slide edits.
- `apps/api/src/projects/projects.controller.ts`: project endpoints.
- `apps/api/src/sources/sources.service.ts` и `sources.controller.ts`: загрузка до 8 файлов в MinIO и создание `Source`.
- `apps/api/src/access/project-access.service.ts`: owner/editor/viewer boundary; используй её для всех новых endpoints.
- `apps/api/src/exports/exports.service.ts`: presentation exports и revision check.
- `apps/api/src/storage/project-storage.service.ts`: удаление/дублирование project prefix; новые объекты должны оставаться внутри `projects/{projectId}/...`.

### Worker

- `apps/worker/src/tasks/generation.ts`: единый BullMQ handler, подготовка source text, narration и presentation pipeline.
- `apps/worker/src/tasks/extract.ts`: TXT/MD/CSV, DOCX через `mammoth`, PPTX через `jszip`, PDF через `pdf-parse`.
- `apps/worker/src/tasks/presentation/**`: provider selection, prompts, planning, normalization, quality.
- `apps/worker/src/tasks/image-search.ts`: Tavily image search, `sharp`, MinIO и provenance.
- `apps/worker/src/tasks/export.ts`: PptxGenJS и Puppeteer PDF с общей геометрией canvas.
- `apps/worker/src/main.ts`: queues `generation`, `exports`, `admin-maintenance`.

Сейчас `handleGenerationJob` различает только narration и presentation по имени job. Перед добавлением analysis/compliance сделай явный dispatcher; неизвестный job не должен автоматически считаться presentation.

### Web

- `apps/web/src/components/new-project-form.tsx`: компактный стандартный мастер `/new`; не превращай его в перегруженную форму.
- `apps/web/src/lib/project-queries.ts`: TanStack Query hooks и polling.
- `apps/web/src/lib/account-types.ts`: web-facing project types; по возможности импортируй shared contracts вместо дублирования.
- `apps/web/src/components/project-script-review-query.tsx`: проверка источников и запуск AI.
- `apps/web/src/components/project-editor/**`: редактор и optimistic revision handling.
- `apps/web/src/components/export-panel*.tsx`: export UX.
- `apps/web/src/components/ui/*`: Button, Dialog, Dropdown, Progress, Select, Tabs, Tooltip.
- `apps/web/src/components/motion/*`: существующие motion primitives с reduced-motion.
- `apps/web/src/app/styles/*.css` и `globals.css`: текущая разбивка стилей.

## Решение по библиотекам

### Основной MVP уже покрыт установленными библиотеками

- `zod`: все request/response, AI artifacts и persisted JSON contracts.
- Prisma/PostgreSQL: конфигурация, факты, требования, конфликты, отчёты и revisions.
- BullMQ: анализ, generation, compliance и report export jobs.
- `jszip`: ZIP и контейнер PPTX.
- `mammoth`, `pdf-parse`: текст документов.
- `sharp`: metadata, thumbnails, безопасная нормализация скриншотов/логотипов.
- `openai`, `ai`, `@ai-sdk/openai`: structured extraction и optional screenshot vision.
- текущий Yandex adapter: текстовая генерация должна продолжить работать.
- Tavily pipeline: только разрешённые пользователем интернет-иллюстрации.
- TanStack Query, Radix, Lucide, Tiptap, Motion: web UI.
- PptxGenJS и Puppeteer: презентация и PDF-отчёт.

Не добавляй `simple-git`, Octokit/GitLab SDK, отдельный unzip-пакет, OCR, вторую queue-систему, другой ORM, отдельный state manager или новый UI kit. Публичные GitHub/GitLab README/docs получай через ограниченные HTTP API/raw endpoints; репозиторий не клонируй.

### Одна рекомендуемая новая зависимость

Добавь `fast-xml-parser` для безопасного и поддерживаемого разбора `ppt/theme/*.xml`, masters/layout relationships и font/color declarations внутри PPTX. Не строй production parser на regex по XML. Настрой parser без выполнения/расширения внешних сущностей. Если при реализации выяснится, что актуальная версия Node и простой ограниченный XML reader уже покрывают нужный subset, можно обойтись без зависимости, но это решение зафиксируй в handoff результата.

Новая библиотека для определения file type не обязательна: проверяй allowlist расширений/MIME и magic bytes/ZIP signatures на backend, а изображения декодируй через `sharp`. Не доверяй только имени файла.

## Предлагаемая доменная модель

Названия можно слегка адаптировать, но сохраняй разделение конфигурации, фактов, требований, конфликтов и неизменяемых отчётов.

### Prisma enums

- `ProjectWorkflow`: `standard`, `requirements_driven`.
- `DefenseType`: `hackathon`, `diploma`.
- `ComplianceMode`: `strict`, `adaptive`.
- `DefenseAnalysisStatus`: `draft`, `queued`, `analyzing`, `review_ready`, `ready`, `failed`.
- `SourceRole`: `project_document`, `technical_spec`, `defense_spec`, `style_reference`, `screenshot`, `logo`, `supporting_image`, `repository_document`, `archive_document`, `web_image`.
- `RequirementPriority`: `required`, `recommended`, `preference`.
- `RequirementOrigin`: `builtin`, `source`, `user`.
- `RequirementState`: `active`, `ignored`.
- `FactConfirmation`: `source`, `user`.
- `ConflictState`: `unresolved`, `resolved`, `ignored`.
- `ComplianceItemResult`: `satisfied`, `partial`, `unsatisfied`, `ignored`, `needs_review`.

### `Project`

Добавь `workflow ProjectWorkflow @default(standard)` и optional one-to-one relation к defense workspace. Не меняй смысл существующего `mode`. Для нового режима используй factual web search disabled; `allowWebImages` управляет только image search.

### `DefenseWorkspace`

Минимальные поля:

- `id`, `projectId @unique`;
- `defenseType`, `complianceMode`, `language` (`ru` в MVP);
- `targetSlideCount` (4..20), `targetDurationSeconds` (до 900);
- `allowWebImages`;
- `authorProfile Json`, валидируемый shared Zod schema;
- `standardPresetVersion`;
- `analysisStatus`, `analysisRevision`;
- `styleBrief Json?`, валидируемый shared schema и совместимый с `PresentationTheme`/`DesignBrief`;
- `plan Json?`, `planRevision`;
- `analysisError?`, timestamps.

### `Source`

Расширь существующую модель:

- `role SourceRole?` для backwards compatibility;
- `metadata Json?` для repository locator, page/slide locator, image dimensions/classification, parent archive/reference и provenance;
- при необходимости `parentSourceId String?` для извлечённых README/docs/assets.

Старые Source без role продолжают работать в стандартном режиме.

### `ProjectFact` и `FactEvidence`

`ProjectFact`:

- `id`, `workspaceId`;
- optional stable `key`, `statement`, optional structured `value Json`;
- состояние active/removed или soft delete;
- timestamps.

`FactEvidence`:

- `factId`;
- `confirmation` (`source` или `user`);
- `sourceId?`;
- `locator?` (`стр. 3`, `slide 2`, `README#stack`);
- короткий `excerpt?`;
- actor/timestamp для пользовательского подтверждения.

Факт нельзя считать подтверждённым без хотя бы одного evidence. Model-only guess не сохраняй как active fact; сохраняй максимум как unresolved suggestion/conflict, не передавай в generation grounding bundle.

### `ProjectRequirement`

- `id`, `workspaceId`;
- `text`, optional normalized `key`;
- `priority`, `origin`, `state`;
- `sourceId?`, `locator?`, `excerpt?`;
- optional structured rule Json: slide position, exact count, palette, required field, image count/type, timing и т.д.;
- timestamps.

Пользователь может менять priority и state. Встроенные пресеты материализуй в требования с `origin=builtin` и версией, чтобы отчёт был воспроизводим.

### `ProjectConflict`

- `id`, `workspaceId`, `kind` (`fact`/`requirement`/`timing`/`style`);
- `summary`;
- `options Json` с evidence/source locators;
- `state`;
- `resolution Json?`, `resolvedById?`, `resolvedAt?`.

Generation может продолжаться при unresolved, но disputed value не становится фактом; создаётся placeholder.

### `ComplianceReport`

- `id`, `workspaceId`;
- `status` (`queued`, `processing`, `ready`, `failed`);
- `presentationRevision`, `analysisRevision`, `planRevision`;
- `document Json`, валидируемый shared schema;
- денормализованные counts required/recommended/preference для быстрого UI;
- `pdfObjectKey?`, `pdfStatus?`, `error?`, timestamps.

Отчёты append-only. Повторная проверка создаёт новую строку. Не переписывай старый отчёт после изменения презентации.

### Jobs

Расширь `GenerationJobKind` и shared schema видами `requirements_analysis` и `compliance` либо создай эквивалентную typed job abstraction. Добавь progress stages для extraction, requirements/facts, screenshot classification, style extraction, plan, compliance и report saving. Сохрани текущие narration/presentation jobs и admin retry/cancel behavior.

## Shared Zod-контракты

Создай отдельный доменный модуль, например:

```text
packages/shared/src/defense/
  schemas.ts
  inputs.ts
  presets.ts
  compliance.ts
```

Экспортируй его через `packages/shared/src/index.ts`.

Нужны схемы:

- defense config и author profile;
- source role/metadata;
- fact/evidence;
- requirement/structured rule;
- conflict/options/resolution;
- style brief;
- defense plan и slide direction с requirement/fact/asset IDs;
- screenshot classification;
- content placeholder;
- compliance report document и summary;
- API inputs для patch/confirm/ignore/resolve/check/export acknowledgement.

Не дублируй эти shapes в web/API/worker.

### Структурированные заполнители

Не кодируй placeholder только строкой в `thesis`. Добавь в shared presentation schema структурированный `contentPlaceholder`, например:

- `id`;
- `requirementId?`;
- `kind`: `text`, `identity`, `metric`, `screenshot`, `diagram`, `conflict`;
- `label`;
- `resolved`;
- `severity`.

Добавь `placeholders` в `Slide` с default `[]`, сохранив совместимость старых documents. Unresolved placeholder должен:

- быть заметен в web editor;
- иметь понятный способ заменить/разрешить;
- отображаться в PPTX/PDF, если пользователь подтвердил экспорт с предупреждением;
- учитываться compliance check;
- не проходить как подтверждённый факт.

Согласуй `canvas-builder`, web renderer и exporter. Не создавай overlay, который виден только в браузере, но исчезает из PPTX.

## Безопасный ingestion pipeline

### Обычные загрузки

Текущий upload endpoint принимает только массив файлов без ролей и ограничен 8 файлами. Для defense mode добавь typed manifest или отдельные endpoints, чтобы роль каждого файла была известна backend. Не принимай роль только из имени файла.

Проверяй:

- project editor access;
- существующий plan byte limit;
- число файлов и допустимые расширения;
- MIME и magic signature;
- имя/путь;
- изображения через `sharp` decode;
- ZIP/PPTX как ZIP-контейнер, без path traversal.

Сохраняй только под `projects/{projectId}/...`. Дублирование/удаление проекта должно переносить/удалять новые assets и переписывать object keys/source IDs.

### ZIP проекта

Используй `jszip`, но защищайся от zip bomb и path traversal:

- не извлекай всё на filesystem;
- нормализуй entry paths и отвергай absolute/`..` paths;
- ограничь количество просматриваемых entries, размер одного entry и суммарный uncompressed size;
- игнорируй `.git`, `node_modules`, build output и исходный код;
- принимай README в корне и документы из явных docs/documentation paths с allowlist расширений;
- создавай child Source с locator внутри архива;
- не считай имя файла подтверждённым фактом.

Все численные limits вынеси в constants/plan limits и покрой тестами; не разбрасывай magic numbers.

### Публичный GitHub/GitLab

Не выполняй `git clone` и не запускай содержимое репозитория.

1. Принимай только `https` URL.
2. Allowlist host: `github.com` и `gitlab.com`; запрети credentials, IP literals, localhost и нестандартные порты.
3. Разбери owner/project/ref/path; используй публичные API/raw endpoints.
4. При redirect заново валидируй host.
5. Ограничь timeout, redirect count, число файлов и response bytes.
6. Получи README и документы из `docs`/`documentation` с allowlist типов.
7. Не обходи весь repo бесконтрольно.
8. Поддержи optional server-side tokens через env для rate limits, но не требуй их и не отправляй клиенту.
9. В тестах mock fetch; network-dependent tests выключены по умолчанию.

Если API rate limit исчерпан, покажи восстановимую ошибку и предложи загрузить ZIP/README.

### Извлечение документов

Переиспользуй `extractTextFromSource`. Расширь результат с provenance chunks, а не только одной плоской строкой:

- source ID;
- page/slide/section locator, когда доступен;
- excerpt;
- normalized text.

PDF без текстового слоя помечай как `needs_review` с сообщением «В первой версии сканы не распознаются», а не выдавай пустой документ за успешно обработанный.

### PPTX style extraction

Сделай отдельный worker module, например `tasks/defense/pptx-style.ts`:

- открой PPTX через `jszip`;
- разбери theme, presentation, master/layout relationships через XML parser;
- извлеки dominant theme colors, major/minor fonts и embedded logo candidates из master/первых слайдов;
- raster assets проверь/нормализуй через `sharp`;
- создай logo Sources или assets в MinIO;
- нормализуй результат в shared `DefenseStyleBrief`;
- маппируй style brief в текущий `PresentationTheme` и `DesignBrief`;
- если PPTX неполон, используй текущую тему StudyDeck и сохрани warning.

Не копируй исходные coordinates/layouts и не ломай export parity.

### Скриншоты

Создай provider-capability boundary для image understanding. Текущий generation provider может быть OpenAI, Yandex или demo; не ломай Yandex text generation.

- Используй установленный OpenAI client/Responses API для vision, если явно настроен `VISION_PROVIDER=openai` и есть key.
- Не делай скрытый платный vision-вызов без отражения в usage ledger.
- Для provider без image capability используй filename + `sharp` metadata только как слабый сигнал и пометь asset `needs_review`, а не выдумывай экран.
- Structured output: predicted screen kind, short Russian label, visible purpose, confidence, matching confirmed fact/requirement IDs.
- Не превращай распознанный текст интерфейса в подтверждённый продуктовый факт.
- Пользователь может исправить label/kind в UI.

OCR документов при этом остаётся вне MVP: vision используется только для пользовательских скриншотов/логотипов.

## Анализ ТЗ и фактов

Добавь job `analyze-defense-brief`.

Pipeline:

1. Загрузить workspace, sources и active preset.
2. Извлечь provenance chunks.
3. Отдельными structured passes получить candidate facts и candidate requirements.
4. Нормализовать/дедуплицировать детерминированно.
5. При каждом факте сохранить evidence; без evidence факт не подтверждать.
6. Найти противоречия между значениями и требованиями.
7. Извлечь PPTX style brief.
8. Классифицировать screenshots/assets.
9. Материализовать встроенный preset, если нет defense spec.
10. Сохранить всё транзакционно, увеличить `analysisRevision`, выставить `review_ready`.

AI output всегда проходит Zod. Prompts должны прямо запрещать:

- дополнять отсутствующие сведения;
- смешивать проектное ТЗ и ТЗ защиты;
- считать дизайн-пожелание фактом о продукте;
- выводить факт только из названия файла;
- использовать интернет как evidence.

Повторный analysis не должен уничтожать пользовательские факты, ручные priority/state и conflict resolutions. Сделай merge по stable keys/evidence fingerprint и тесты идемпотентности.

## Plan builder

После review пользователь запускает «Составить план защиты».

План должен содержать:

- slide order/title/purpose;
- target timing;
- IDs требований, которые выполняет слайд;
- IDs подтверждённых фактов;
- IDs пользовательских assets;
- необходимость placeholder;
- visual strategy;
- reason for any adaptive change.

Строгий режим сохраняет exact count/order/position constraints. Адаптивный может менять только необязательную часть. Неразрешённый конфликт или отсутствующий факт превращается в structured placeholder.

Покажи план до narration. Пользователь может редактировать порядок, заголовки и timing, затем подтверждает. Смена типа защиты перестраивает только preset-derived часть после confirm dialog.

## Интеграция с текущей генерацией

Не создавай второй независимый presentation generator.

1. Построй `DefenseGroundingBundle` из active requirements, confirmed facts, resolved conflicts, approved plan, style brief и classified assets.
2. Передавай bundle в существующие planning/prompt/provider/normalization layers через typed context.
3. Для defense workflow не запускай `searchWebSources` для фактов. `Project.mode` оставь совместимым, но добавь явный workflow branch.
4. Narration должна следовать плану и timing, быть на русском и не включать вопросы жюри.
5. Design generation использует extracted style brief и текущий theme resolver.
6. Сначала распределяй пользовательские screenshots/logos; Tavily вызывай только при `allowWebImages` и только для недоказательных visual roles.
7. Если нужен интерфейс/метрика/архитектура без пользовательского evidence, ставь placeholder.
8. Сохрани `sourceRefs` для внутреннего provenance, но UI слайда не обязан их отображать.
9. После generation выполняй текущие schema/layout audits плюс defense-specific deterministic audit.

Demo fallback должен создавать schema-valid defense deck с placeholders, а не выдуманными данными.

## Compliance engine

Добавь job `check-defense-compliance`, запускаемый только по кнопке.

Раздели проверку на два слоя.

### Детерминированные проверки

- slide count;
- first/last/exact slide positions;
- total and per-slide timing;
- presence of required author fields;
- unresolved placeholders/conflicts;
- required screenshot/logo counts and roles;
- required palette/theme properties;
- slide text overflow/layout audit;
- existence of speech/notes;
- stale report versus current presentation revision.

### Семантические проверки

Модель сопоставляет active requirements с реальным содержанием слайдов/notes, но обязана вернуть evidence:

- slide ID/order;
- matched text fragment;
- fact/requirement IDs;
- result/reason.

Model semantic result не может отменить deterministic failure. Zod validation обязателен. При provider failure сохрани deterministic report и отметь semantic items `needs_review`, а не проваливай весь отчёт.

### Отчёт

Показывай:

- counts `x/y` отдельно по каждой priority;
- список satisfied/partial/unsatisfied/ignored/needs_review;
- placeholders, conflicts, image provenance, timing overloads;
- differences versus previous report (исправлено/появилось);
- presentation revision и время проверки.

PDF-отчёт рендери через вынесенный из текущего exporter общий безопасный HTML-to-PDF helper. Не смешивай PDF отчёта с PDF презентации. Можно либо добавить typed compliance export job/record, либо хранить `pdfStatus/objectKey` на `ComplianceReport`; выбери минимальную модель с polling, idempotency и повторной попыткой.

## Export acknowledgement

Расширь shared export input и backend preflight.

Если defense project имеет:

- unresolved required/semantic issues;
- unresolved conflicts;
- unresolved placeholders;
- отсутствующий или устаревший compliance report;

API сначала возвращает structured warning payload. UI показывает обязательный Dialog со списком проблем. Повторный request содержит:

- `acknowledgeWarnings: true`;
- ID актуального compliance report или preflight token;
- expected presentation revision.

Backend повторно проверяет revision и только после этого создаёт export. Нельзя реализовать подтверждение только клиентским checkbox. Viewer/editor export permissions должны сохранить текущую продуктовую политику; изменение presentation/requirements доступно editor/owner.

## API surface

Используй NestJS modules/services/controllers и shared parseInput. Рекомендуемый namespace:

```text
GET    /v1/projects/:id/defense
PATCH  /v1/projects/:id/defense/config
POST   /v1/projects/:id/defense/analyze
POST   /v1/projects/:id/defense/repositories
POST   /v1/projects/:id/defense/uploads

POST   /v1/projects/:id/defense/facts
PATCH  /v1/projects/:id/defense/facts/:factId
DELETE /v1/projects/:id/defense/facts/:factId

PATCH  /v1/projects/:id/defense/requirements/:requirementId
PATCH  /v1/projects/:id/defense/assets/:sourceId
POST   /v1/projects/:id/defense/conflicts/:conflictId/resolve

PUT    /v1/projects/:id/defense/plan
POST   /v1/projects/:id/defense/plan/rebuild

POST   /v1/projects/:id/defense/compliance-checks
GET    /v1/projects/:id/defense/compliance-reports
GET    /v1/projects/:id/defense/compliance-reports/:reportId
POST   /v1/projects/:id/defense/compliance-reports/:reportId/pdf
```

Точный shape можно упростить, но не делай один бесконтрольный endpoint, который перезаписывает весь analysis JSON. Мутации должны проверять project access и принадлежность вложенной сущности project/workspace.

Добавь соответствующие Next route proxies под `apps/web/src/app/api/projects/[id]/defense/**`. Не вызывай internal API напрямую из client components.

## Web UX

### Вход в режим

На `/new` добавь компактный выбор:

- «Обычная презентация» — текущий flow без регрессий;
- «Защита проекта» — переход на отдельный `/new/defense`.

Не раздувай текущий `NewProjectForm`. Новый мастер может быть отдельным компонентом/route.

### `/new/defense`

Компактные шаги:

1. Тип и правила: hackathon/diploma, strict/adaptive, slides, duration.
2. Проект: файл, публичная GitHub/GitLab ссылка или ZIP; нужен хотя бы один вариант.
3. ТЗ и материалы: role-aware uploads, PPTX style, screenshots, logos, `allowWebImages`.
4. Данные автора: optional fields, понятное предупреждение о placeholders.

Сначала создаётся draft и загружаются материалы; AI запускается только после отдельного подтверждения с существующим cost-warning паттерном.

### Review workspace

Отдельный route, например `/projects/[id]/defense/review`, с tabs:

- «Требования»;
- «Факты»;
- «Материалы»;
- «Противоречия».

На одном экране должны быть видны counts, источник/locator, confidence/status и следующий action. Orange — действие, green — подтверждено, purple — AI processing/editor, red — проблема. Следуй `DESIGN.md`, WCAG AA, keyboard navigation, long Russian labels, 320px и reduced motion.

### План

Route `/projects/[id]/defense/plan` либо совместимый отдельный этап перед текущим script review:

- reorder/edit plan;
- timing по слайдам и total;
- badges requirements/facts/assets/placeholders;
- confirm plan и запуск narration;
- type-switch confirmation.

### Editor/compliance

Не переписывай editor. Добавь defense-specific panel/badge:

- «Проверить по ТЗ»;
- last report summary и stale indicator;
- unresolved placeholders с переходом к слайду;
- timing overload warning;
- history reports.

Изменение слайда уже увеличивает presentation revision; после правки старый report визуально помечается устаревшим. Автопроверку не запускай.

### Export

Покажи report PDF отдельно от presentation PDF/PPTX. При проблемах используй обязательный confirmation dialog и backend acknowledgement flow.

## Совместимость и миграция

- Все новые Prisma fields для старых проектов имеют safe defaults/nullable relations.
- Старые projects продолжают проходить текущий `/new -> script -> editor -> export` flow.
- Старые `PresentationDocument` валидируются: новые arrays/fields имеют defaults.
- Не ломай demo preview поведение и `NEXT_PUBLIC_DEMO_PREVIEW`.
- Duplicate project копирует defense workspace, sources/assets, facts, requirements, resolutions и последний editable state; compliance report history можно не копировать, но решение должно быть явным и протестированным.
- Delete project удаляет все related rows и MinIO objects cascade/prefix cleanup.
- Shared user/project access применяется ко всем nested entities.
- Обнови admin retry mapping для новых GenerationJobKind или запрети неподдержанный retry явно; не отправляй compliance job как presentation.

## Наблюдаемость и стоимость

- Все AI passes регистрируй в существующем `AiUsageEvent`/usage ledger с понятными operation/schema/stage.
- Tavily, storage и PDF compute используют существующий cost ledger.
- Добавь trace spans/stages для ingestion, requirement analysis, screenshot classification, plan build, compliance и report PDF.
- Ошибки отправляй через текущие Sentry/pino helpers без утечки текста приватных документов в logs.
- Логируй IDs/counts/durations, но не полные facts, author profile или extracted source text.

## Тесты

AI/network должны быть mocked или env-gated.

### Shared/Vitest

- config limits and author placeholders;
- enums/inputs strict parsing;
- facts require evidence;
- presets are deterministic/versioned;
- old presentation documents remain valid;
- structured placeholders round-trip;
- compliance report schema.

### API/Vitest

- access: owner/editor/viewer across all endpoints;
- nested entity cannot be accessed through another project ID;
- config/type switch;
- fact add/update/delete;
- requirement priority/ignore;
- conflict resolve;
- repository URL validation and SSRF/redirect rejection;
- ZIP/file limits and role validation;
- analysis/compliance job idempotency;
- export warning requires acknowledgement and rejects stale revision/report;
- duplicate/delete storage behavior.

### Worker/Vitest

- ZIP allowlist, path traversal and zip bomb limits;
- GitHub/GitLab fetch adapters with mocked responses/rate limits;
- PDF without text layer returns warning;
- PPTX theme/font/logo extraction fixtures;
- candidate extraction never confirms fact without evidence;
- repeated analysis preserves user edits/resolutions;
- strict/adaptive plan behavior;
- screenshot classifier structured output and no-vision fallback;
- no web factual research for defense mode;
- no stock image replacing screenshot/evidence roles;
- timing allocation and overload detection;
- deterministic/semantic compliance merge;
- report history/diff;
- PPTX/PDF renders unresolved placeholders when acknowledged.

### Web/Vitest/Playwright

- standard `/new` regression;
- defense wizard from each source type;
- AI does not start before confirmation;
- review tabs and conflict resolution;
- manual fact and requirement priority/ignore;
- plan edit/type switch;
- editor report stale after slide edit;
- manual «Проверить по ТЗ»;
- export warning confirmation;
- report PDF request;
- keyboard, focus, narrow mobile and reduced motion smoke coverage.

## Порядок реализации

Выполняй вертикальными этапами, сохраняя работоспособность стандартного flow.

### Этап 1. Foundation

- Shared schemas/presets/placeholders.
- Prisma migration/models/defaults.
- API read/update workspace contracts.
- Compatibility tests.

### Этап 2. Ingestion

- Role-aware uploads.
- GitHub/GitLab README/docs adapters.
- ZIP README/docs extraction.
- provenance chunks.
- PPTX style extraction.
- screenshot asset preprocessing/classification boundary.

### Этап 3. Analysis review

- BullMQ analysis dispatcher/job/progress.
- facts/requirements/conflicts persistence and merge.
- review APIs and `/new/defense` + review UI.

### Этап 4. Plan and generation

- strict/adaptive plan builder.
- plan review UI.
- DefenseGroundingBundle integration into current narration/presentation pipeline.
- user assets, web image consent and placeholders.

### Этап 5. Compliance and export

- deterministic/semantic check.
- version history/diff.
- editor/report UI.
- PDF report.
- backend export acknowledgement.

### Этап 6. Hardening

- observability/usage/cost.
- duplicate/delete/admin retry.
- E2E, accessibility and mobile.
- full regression.

После каждого этапа запускай узкие тесты затронутых workspaces; перед handoff — полный набор ниже.

## Критерии приёмки MVP

1. Пользователь создаёт defense project из одного файла, public GitHub/GitLab или ZIP.
2. Без OCR текстовые PDF/DOCX/PPTX/TXT/MD корректно разбираются; скан получает честное предупреждение.
3. До AI-генерации пользователь видит и редактирует требования, факты, материалы и конфликты.
4. Ни один факт без source/user evidence не попадает в grounding bundle.
5. Каждый конфликт разрешается отдельно; unresolved не блокирует draft.
6. Встроенные hackathon/diploma presets работают без defense spec.
7. Strict/adaptive различаются только в допустимой свободе подачи, не в достоверности.
8. PPTX влияет на palette/fonts/logo/style, но не копирует layout.
9. Screenshots классифицируются автоматически при наличии vision provider, исправляются пользователем и имеют честный fallback.
10. Tavily вызывается только при consent и никогда не заменяет project evidence.
11. Презентация содержит речь, notes, timing и явные placeholders; вопросов жюри нет.
12. Кнопка «Проверить по ТЗ» создаёт versioned report, привязанный к revisions.
13. После slide edit предыдущий отчёт отмечен stale, но новый check не запускается сам.
14. Report PDF скачивается отдельно.
15. Presentation export с проблемами возможен только после backend-validated acknowledgement.
16. Стандартный StudyDeck flow, Yandex support, demo fallback, web/PPTX/PDF parity и shared access не регрессируют.

## Проверка

Минимум:

```powershell
npm run prisma:generate
npm run build -w @studydeck/shared
npm run typecheck -w @studydeck/shared
npm run test -w @studydeck/shared
npm run typecheck -w @studydeck/api
npm run test -w @studydeck/api
npm run typecheck -w @studydeck/worker
npm run test -w @studydeck/worker
npm run typecheck -w @studydeck/web
npm run test -w @studydeck/web
npm run check
npm run test
docker compose config --quiet
```

Если изменялась Prisma schema, создай нормальную migration, проверь generated client и migration deploy path. Для frontend visual verification:

```powershell
npm run dev:web:fast
# http://localhost:3020/new
# http://localhost:3020/new/defense
```

Playwright:

```powershell
npm run test:e2e
```

Если Vitest/Playwright падает с `spawn EPERM`, сначала установи, что это ограничение окружения, а не регрессия кода. Не маскируй реальные failures.

## Финальный handoff нового Codex

В конце:

1. перечисли реализованные вертикальные этапы;
2. укажи migration и новые env variables;
3. отдельно сообщи, добавлен ли `fast-xml-parser` и почему;
4. перечисли команды и фактические результаты проверок;
5. сообщи URL dev preview;
6. перечисли оставшиеся ограничения MVP;
7. покажи `git status --short` и не включай чужие изменения в свой итог.
