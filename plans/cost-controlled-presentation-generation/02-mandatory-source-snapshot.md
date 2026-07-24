# Prompt 02 — обязательные источники и компактный snapshot

Скопируй весь этот файл в новый чат Codex. Эта задача требует выполненного Prompt 01.

## Задача

Сделай источники обязательными для будущих стандартных презентаций и преврати их в компактный, воспроизводимый snapshot, который используется и для narration, и для локальной сборки слайдов без повторного web search.

Сначала прочитай `AGENTS.md`, проверь git status и изучи актуальный persisted cost envelope из Prompt 01. Не переписывай старые проекты и не меняй requirements-driven workflow.

## Контекст

- `apps/worker/src/tasks/generation.ts::prepareGenerationSources()` сейчас вызывает Tavily только при `refreshWeb && (!sources.length || mode === "with_sources")`.
- `apps/worker/src/tasks/web-search.ts` делает один Tavily запрос с `WEB_SEARCH_MAX_RESULTS` (по умолчанию 6) и сохраняет `WEB` sources.
- `buildResearchBrief()` и промпты могут передавать большие excerpts повторно.
- `findFactualRiskIssues()` намеренно пропускает source-less decks; это противоречит новому обязательному правилу.

## Требования

1. Для стандартного будущего пути гарантируй минимум три релевантных source records до первого LLM-вызова. Пользовательские загрузки могут дополнять, но не заменять обязательный web-grounding, если они не содержат достаточной подтверждённой базы.
2. Выполни **не более одного** web-search вызова на один generation envelope. Зарезервируй его стоимость через envelope до Tavily call. Повтор BullMQ job должен переиспользовать успешный snapshot, а не платить за поиск снова.
3. После поиска отфильтруй результаты существующей relevance/domain логикой. Сохрани неизменяемый snapshot для запуска: 3–4 источника, `sourceId`, title, URL, короткий evidence excerpt и pricing/provenance timestamp. Ограничь каждый excerpt и общий контекст постоянным бюджетом.
4. Передавай в план/речь только этот snapshot, без полного текста исходных файлов и без дублирования одного excerpt в нескольких структурах. Сохрани source ids, чтобы локальная проекция могла честно расставить refs.
5. Если Tavily недоступен или даёт меньше трёх подходящих источников, не запускай платную narration. При наличии ранее успешного snapshot этого же envelope можно его использовать; иначе заверши run в контролируемом состоянии с нейтральным public сообщением без provider details.
6. Усиль release checks: для нового экономного режима отсутствие минимального snapshot или source refs на фактических слайдах — blocker. Не ослабляй поведение старых документов и не переписывай их.
7. Не добавляй модельную оценку источников: ранжирование, лимиты и snapshot должны быть локальными.

## Вероятный scope

- `apps/worker/src/tasks/generation.ts`
- `apps/worker/src/tasks/web-search.ts` и тесты
- persisted envelope/Prisma path из Prompt 01
- `apps/worker/src/tasks/presentation/planning/builders.ts`
- `apps/worker/src/tasks/presentation-quality.ts`
- shared contracts только если snapshot требуется в сохранённом document.

## Acceptance criteria

- Для нового standard run поиск вызывается ровно один раз и только до narration.
- Presentation job не делает Tavily source search и использует тот же набор `sourceId`.
- В LLM prompt нет неограниченно длинного source corpus.
- Source-less standard presentation не может получить `ready`.
- Три релевантных источника/refs видны в итоговом документе и экспортируются как attribution.
- Ошибка поиска не тратит деньги на narration и не удаляет старые `WEB` sources.

## Проверка

Добавь изолированные тесты web-search, source preparation, replay/idempotency и production quality gate. Запусти targeted worker/shared tests и typecheck. В конце перечисли точные contracts snapshot, на которые может опереться Prompt 03.

