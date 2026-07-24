# Надёжные будущие генерации: пакет implementation-промптов

## Статус и границы

Этот каталог — план для последовательной реализации в **новых чатах Codex**. Он создан после разбора проекта `cmrvw6e54000hmq0joh02cprf` («Космос — планета Сатурн»): колода завершилась с `generationMode: "demo-fallback"`, получила нерелевантные веб-источники про станции метро «Академическая», не получила изображений и свернула все 10 слайдов в layout `statement`.

Не менять существующие проекты, их документы, `Presentation.revision` или пользовательские canvas. Новые требования применяются только к новым задачам narration/presentation после выкладки изменений.

## Зафиксированные продуктовые решения

- Основной и единственный провайдер будущих генераций — **Yandex**. Не выполнять автоматическую попытку OpenAI после ошибки Yandex и наоборот.
- Если Yandex не настроен или любая обязательная AI-стадия не удалась, задача должна завершаться понятной пользовательской ошибкой. Не сохранять плохую колоду и не подменять её `demo`/`demo-fallback` документом.
- На типичном учебном слайде: один самостоятельный тезис и 2–3 содержательных буллета. Полная речь остаётся в `speakerNotes`/`speechScript`.
- Для колоды из 10 слайдов ориентир: 5–7 релевантных изображений и 2–3 содержательные схемы/диаграммы; не повторять один layout почти на всех слайдах.
- Веб-поиск изображений включён автоматически. Фактические веб-источники должны быть тематически релевантны и для научных тем приоритизировать NASA, ESA, университеты, научные публикации и профильные агентства.
- Если веб-поиск не дал ни одного релевантного источника, продолжать с корректной AI-речью без WEB-источников. Нерелевантные источники нельзя сохранять, цитировать или использовать для построения сюжета.

## Порядок реализации

Выполнять по одному файлу, в отдельном новом чате, строго в этом порядке:

1. `01-yandex-only-and-fail-loudly.md`
2. `02-relevant-scientific-web-research.md`
3. `03-slide-content-contract.md`
4. `04-visual-coverage-and-layout-variety.md`
5. `05-release-gate-and-runtime-validation.md`
6. `06-late-narration-template-repair-and-runtime-validation.md`
7. `07-yandex-structured-json-recovery-and-runtime-validation.md`
8. `08-yandex-quality-gate-repair-and-runtime-validation.md`
9. `09-yandex-narration-duration-recovery-without-padding.md`
10. `10-spoken-narration-quality-gate-and-yandex-rewrite.md`
11. `11-quality-first-ten-slide-timing-contract.md`
12. `12-full-yandex-narration-rewrite-before-safe-failure.md`
13. `13-yandex-pro-narration-ab-experiment.md`
14. `14-yandex-full-rewrite-duration-compliance-and-controlled-smoke.md`
15. `15-web-search-cost-event-telemetry-repair.md`
16. `16-yandex-narration-output-budget-and-length-compliance.md`

Каждый следующий чат обязан сначала проверить, что предыдущий пункт действительно внедрён и его тесты существуют. Не повторять уже реализованные изменения и не откатывать пользовательские изменения в рабочем дереве.

Пункты 12 и 13 добавлены после live-проверок 23 июля 2026 года. Фактическая цепочка `chunked_duration_recovery` и последующий per-section recovery доказала, что Yandex может вернуть 508, 691 и 827 слов вместо минимума 1170. Пункт 12 заменяет именно эту неудачную duration-ветку одной связной полной rewrite через Yandex, после которой допустим только safe failure. Пункт 13 выполняется только после принятия пункта 12: он вводит управляемую конфигурацию и измерение для сравнения текущего primary alias с явной доступной версией YandexGPT Pro, но не переключает production-модель автоматически.

Пункт 16 выполняется только после принятия пункта 15. Он использует результаты контролируемого baseline/candidate smoke: оба run получили одну initial narration и одну full duration rewrite с одинаковым source fixture и без Tavily. Baseline `yandexgpt/latest` завершился на 441 слове, candidate `yandexgpt-5.1` — на 585 словах; оба результата были корректно отброшены safe failure. Цель 16 — найти детерминированно подтверждаемую причину раннего окончания и исправить только этот seam, не превращая shortfall в дополнительные calls или локальное дописывание текста.

## Дополнительные решения для narration (2026-07-22)

- Yandex остаётся единственным автором речи. Не добавлять OpenAI, `demo` или `demo-fallback` как запасной путь.
- Дополнительные вызовы **Yandex** допустимы, когда deterministic-проверка отклонила плохую речь. Это предпочтительнее локальной подстановки или механического дописывания слов.
- Длительность — ориентир качества, а не повод принять плохой текст. Для 10 слайдов допускается немного более короткая, но естественная речь; точный контракт вводит пункт 11.
- Не сохранять `speechDraft`, если он содержит склейку полей narrative plan, шаблонную мета-инструкцию, массовые повторы или не проходит повторную валидацию.

## Общий технический контекст

- Очередь и оркестрация: `apps/worker/src/tasks/generation.ts`.
- Выбор провайдера: `apps/worker/src/tasks/presentation/providers/provider-selection.ts`.
- Narration и сборка слайдов: `apps/worker/src/tasks/presentation/orchestrator.ts`, `providers/generation.ts`.
- Веб-источники: `apps/worker/src/tasks/web-search.ts`, `prepareGenerationSources(...)` в `generation.ts`.
- Детеминированное качество и repair: `apps/worker/src/tasks/presentation-quality.ts`, `apps/worker/src/tasks/presentation/quality/orchestration.ts`.
- Нормализация, layout и canvas: `apps/worker/src/tasks/presentation/normalization/presentation.ts`, `packages/shared/src/presentation/**`.
- Поиск/скачивание изображений: `apps/worker/src/tasks/image-search.ts`.
- Пользовательская ошибка и прогресс: `apps/worker/src/tasks/job-progress.ts`, API project/job surfaces, `apps/web/src/components/**` и `apps/web/src/app/**` после точечной проверки.

`generatedText` и подтверждённая речь — канонические данные, но больше не являются разрешением тихо создать плохой deck при отказе модели. Пользовательские canvas никогда не перерисовывать автоматически.

## Общие правила для каждого implementation-чата

1. Прочитать `AGENTS.md`, этот README, назначенный файл промпта, затем `git status --short` и фактические затрагиваемые файлы.
2. Не использовать старый проект Сатурна как fixture и не редактировать его запись в БД. Воспроизводить дефекты компактными unit/integration fixtures.
3. Не выводить ключи API, токены и значения из `.env`.
4. Не добавлять новую параллельную pipeline: расширять существующие seam'ы и shared Zod-контракты только при реальной необходимости.
5. Мокать Yandex/Tavily/скачивание изображений в тестах. Реальные запросы — только в явно запрошенной runtime-проверке.
6. После изменения worker-поверхности выполнить targeted tests, typecheck и `git diff --check`. Docker worker пересобирать и проверять `localhost:3010` только когда пользователь отдельно просит применить изменения к локальному runtime.
