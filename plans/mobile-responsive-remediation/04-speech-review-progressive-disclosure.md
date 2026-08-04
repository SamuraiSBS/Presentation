# 04 — Progressive disclosure длинной страницы проверки речи

## Скопируй этот файл целиком в новый чат Codex

Работай в `D:\presentation`. Реализуй полностью и только Prompt 04 после принятия Prompts 01–03. Прочитай `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, README, audit, этот prompt и отчёт Prompt 03. Выполни `git status --short`, перепроверь текущие компоненты и сохрани все предыдущие/чужие изменения.

Если доступен `impeccable`, используй `distill`: уменьши когнитивную и моторную нагрузку, не удаляя содержание и возможности редактирования.

## Цель

Исправить P2 страницы:

`/projects/cmrfbvk050001qh0jt18vvbrs/script`

В audit 6 источников и 14 речевых секций одновременно раскрывают документ примерно до 6402 px. Нужны progressive disclosure, быстрый переход к нужному слайду и постоянно понятное состояние сохранения.

## Зоны кода

- `apps/web/src/components/project-script-review-query.tsx`;
- `apps/web/src/app/styles/workflow-review.css` в его актуальном состоянии после Prompt 02;
- связанные speech/source editor components и save mutation/query logic;
- текущие workflow/project tests и Playwright fixtures.

Не меняй narration text, persistence/API contract или content generation. Это только presentation/interaction layer.

## Требуемый UX-контракт

### A. Источники

- Показывай компактный summary списка; длинные excerpts/details раскрываются по запросу.
- Пользователь должен видеть количество, статус/тип и уметь раскрыть конкретный источник.
- Semantics disclosure должны быть keyboard/screen-reader friendly (`button`, `aria-expanded`, `aria-controls` или установленный accordion primitive).

### B. Секции речи

- Добавь быстрый переход к секции/слайду: компактный sticky или доступный горизонтальный jump nav, который показывает текущую позицию.
- Не раскрывай все 14 больших editors одновременно на mobile. Выбери один понятный режим: один активный editor, accordion с ограниченным числом раскрытых секций или summary + edit-on-demand.
- Не размонтируй несохранённый draft при collapse/navigation. Пользовательский текст и selection/state должны сохраняться.
- Текущая секция должна иметь явный heading/status, previous/next navigation и корректный scroll offset под sticky UI.
- На desktop можно показывать больше информации, но UX и data flow должны оставаться едиными.

### C. Save/status

- Save action/status должен быть доступен после длинного редактирования без ручного возврата на тысячи пикселей.
- Sticky action не перекрывает bottom nav, keyboard, focused editor или safe-area.
- Сохрани существующие pending/saved/error states и защиту от потери правок. Не симулируй успешное сохранение.

## Тесты

Добавь детерминированные component/Playwright tests с demo/local data, достаточным количеством sections/sources. Докажи:

- на initial mobile render раскрыт ограниченный объём, а не 6 excerpts + 14 full editors;
- jump к последней секции делает её активной/видимой и не вызывает horizontal overflow;
- keyboard может раскрыть источник, перейти к секции и добраться до save;
- изменение текста переживает collapse → reopen/section switch до сохранения;
- sticky save/status не пересекается с bottom nav на 320x568 и 390x844;
- save pending/success/error feedback остаётся доступным;
- active WorkflowProgress из Prompt 02 остаётся видимым;
- desktop сценарий редактирования речи не регрессировал.

Используй устойчивые roles/test ids и измерения. Высота страницы не обязана быть фиксированно меньше конкретного числа, но initial render должен перестать материализовывать весь тяжёлый документ и требовать многотысячный scroll для базового управления.

## Проверка

```powershell
npm run typecheck -w @studydeck/web
npm run test -w @studydeck/web
npm run test:e2e -- --project=chromium e2e/ui-accessibility-regressions.spec.ts e2e/studydeck-core.spec.ts
git diff --check
```

Если для script flow нужен отдельный spec, создай узкий файл в `e2e/` и включи его в команду. Визуально проверь 320x568, 390x844, 412x915 и 1280x800 на `http://localhost:3020`. Не rebuild/restart Docker.

## Acceptance criteria

- Initial mobile page больше не раскрывает все sources/sections одновременно.
- Есть доступная навигация к любой речевой секции и видимое save/status управление.
- Draft не теряется при disclosure/navigation.
- Нет overlap с bottom nav/keyboard/safe-area и нет document horizontal overflow.
- Workflow и desktop flow не регрессировали; tests доказывают ключевые состояния.

## Не делать

- Не менять API, Prisma, worker narration generation, speech timing/quality validators или сам текст речи.
- Не вводить autosave, если существующий продукт его не имеет и это меняет контракт.
- Не делать commit/deploy/Docker build и не начинать Prompt 05.

