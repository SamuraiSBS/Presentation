# Экономная генерация презентаций: очередь независимых задач

## Зафиксированная продуктовая цель

Снизить переменную себестоимость полного создания одной русскоязычной презентации до **средней 6–7 ₽** и жёсткого максимума **10 ₽** для стандартного сценария: 10 слайдов, 9–12 минут выступления, обязательные веб-источники, максимум две веб-фотографии и локальные диаграммы для абстрактных слайдов.

Пользователь видит один обычный сценарий создания, без выбора «дешёвый / премиум». После принятия речи слайды, тезисы, bullets, source refs, диаграммы, canvas, quality-проверки и экспорт не должны требовать нового платного LLM-вызова.

## Порядок выполнения

Запускайте **по одному файлу в новом чате Codex** и только после завершения предыдущего:

1. [01-cost-envelope-and-provider-catalog.md](./01-cost-envelope-and-provider-catalog.md)
2. [02-mandatory-source-snapshot.md](./02-mandatory-source-snapshot.md)
3. [03-budgeted-narration-and-silent-recovery.md](./03-budgeted-narration-and-silent-recovery.md)
4. [04-deterministic-presentation-from-accepted-narration.md](./04-deterministic-presentation-from-accepted-narration.md)
5. [05-bounded-visuals-and-local-diagrams.md](./05-bounded-visuals-and-local-diagrams.md)
6. [06-release-gate-observability-and-runtime-proof.md](./06-release-gate-observability-and-runtime-proof.md)

Не объединяйте эти задачи в один diff и не начинайте следующий файл, пока не выполнены его тесты и acceptance criteria.

## Неподлежащие изменению правила

- Рабочий каталог: `D:\presentation`; сначала прочитать `AGENTS.md` и проверить `git -c safe.directory=D:/presentation status --short`.
- Сохранить существующие пользовательские правки; не трогать legacy MVP и не переписывать уже сохранённые презентации.
- Провайдер для экономного будущего пути — только AI Tunnel, `AI_PROVIDER=aitunnel`; не включать `auto` и не делать provider fallback.
- Не отправлять в модель полный текст всех источников. Передавать только фиксированный source snapshot.
- Не допускать бесконечных repair/retry-циклов. Все платные попытки должны быть заранее зарезервированы в одном сквозном бюджете.
- Результат локальной сборки не должен маркироваться `demo` или `demo-fallback`, потому что это не демо и не должно обходить production quality gates.
- В конце каждой задачи выполнить релевантные тесты и дать честный отчёт: файлы, команды, результаты, оставшиеся ограничения. Не выполнять Docker rebuild, если задача этого прямо не требует.

## Текущее состояние, от которого нужно отталкиваться

- Narration job: `prepareGenerationSources()` → narrative plan → narration; сейчас artefacts кроме `speechDraft` не сохраняются.
- Presentation job повторно вызывает narrative plan, design brief, полную модельную JSON-сборку слайдов и иногда model-based repair. Это должен заменить локальный путь.
- `buildSafePresentationFromNarration()` уже существует, но сейчас не включён в основной путь и использует `demo-fallback` — это только отправная точка, не готовое решение.
- `apps/worker/src/aitunnel-narration-budget.ts` содержит in-memory бюджет по job, дефолт 30 ₽, а цены захардкожены. Этого недостаточно для гарантии 10 ₽ на весь путь.
- Поиск источников и изображений — Tavily; оба отдельно пишут `CostEvent`, но их расходы не резервируются в AI-бюджете.

