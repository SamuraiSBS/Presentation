# 01 — Responsive shell редактора: portrait, landscape и tablet

## Скопируй этот файл целиком в новый чат Codex

Работай в `D:\presentation`. Реализуй полностью и только Prompt 01 из:

`D:\presentation\plans\mobile-responsive-remediation\01-editor-responsive-shell.md`

Перед правками полностью прочитай `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, `plans/mobile-responsive-remediation/README.md`, исходный audit и актуальные editor components/styles/tests. Если доступен skill `impeccable`, используй его режим `adapt` для responsive-remediation; не меняй визуальное направление продукта.

Выполни `git status --short`. Worktree содержит чужое состояние: не делай reset/checkout/clean и не восстанавливай `.audit-bmw/tmpw120oeib/enlarged.pptx`.

## Цель

Устранить три P1 редактора:

1. заголовок проекта обрезается слева на 320/390 px;
2. редактор практически не имеет рабочей области в 844x390 landscape;
3. brand, workflow и header actions сталкиваются на 768x1024.

Основной живой маршрут аудита:

`/projects/cmrfbvk050001qh0jt18vvbrs/editor`

Для детерминированных E2E используй demo-маршрут `/projects/demo/editor`. Не создавай проект и не запускай генерацию.

## Сначала зафиксируй baseline

Проверь текущую компонентную структуру и CSS cascade, включая обе editor entry points, прежде чем выбирать файл для изменения:

- `apps/web/src/components/project-editor/project-editor.tsx`;
- `apps/web/src/components/project-editor.tsx`;
- `apps/web/src/app/styles/editor.css` и импортируемые editor foundation/legacy/application styles;
- существующие `editor-geometry.test.ts`, `e2e/studydeck-core.spec.ts`, `e2e/ui-accessibility-regressions.spec.ts`.

Для 320x568, 390x844, 768x1024 и 844x390 измерь до исправления:

- bounding box H1 и header children;
- ширину editor shell относительно viewport;
- видимую площадь canvas/workspace;
- scrollWidth/clientWidth у document и внутренних областей;
- какие элементы скрываются `overflow`.

Если строки audit больше не совпадают, адаптируй пути к актуальному коду, сохранив требования.

## Реализация

### A. Заголовок и mobile header

- На узких экранах явно замени desktop three-column grid на одноколоночную/осмысленную mobile-композицию; не ограничивайся `font-size` и ellipsis.
- Убери desktop `grid-column: 2`/эквивалент у заголовка в mobile/tablet mode.
- H1 должен начинаться внутри viewport, иметь `min-width:0`, предсказуемое truncation/wrapping и accessible полное имя.
- Сохрани понятные navigation/actions и минимум 44x44 для coarse-pointer элементов, затронутых этим header.

### B. Short-height landscape mode

- Добавь намеренный режим для короткой высоты/orientation, а не breakpoint только по ширине.
- При 844x390 пользователь должен видеть полезную рабочую область слайда и иметь доступ к rail/редактированию без document-level clipping.
- Разрешена компактная перестройка или переключаемые области, если состояние и доступность контролов сохраняются. Не создавай новый canvas editor и не меняй presentation data contract.
- Не полагайся на глобальный `overflow-x:hidden` как на исправление.
- Учитывай mobile browser chrome и `dvh`; внутренние scroll regions должны иметь понятные границы и не создавать scroll trap.

### C. Tablet 768 px

- Устрани столкновение brand/workflow/actions на ровно 768 px.
- Выбери breakpoint по реальной геометрии компонентов, а не случайное `760` → `768` без проверки соседних ширин.
- Проверь минимум 760, 768 и 800 px, чтобы не создать однопиксельный разрыв.

### D. Regression protection

- Сохрани desktop layout минимум на 1280x800 и 1440x900.
- Сохрани Tiptap editing, точную правку, slide selection, save/export actions и keyboard focus.
- Не меняй generated slide typography/layout contract и не расходись с export renderer.

## Детерминированные тесты

Расширь существующие Playwright/editor tests, не создавая параллельный тестовый framework. Минимально докажи:

- H1 целиком начинается внутри viewport и не вызывает document overflow на 320/390;
- header children не пересекаются на 768;
- в 844x390 canvas/workspace имеет ненулевую полезную видимую область, а ключевые controls достижимы;
- document `scrollWidth <= clientWidth`;
- desktop editor сохраняет текущий рабочий сценарий редактирования;
- keyboard focus остаётся видимым.

Не делай screenshot-only assertions единственным доказательством. Используй bounding boxes/DOM measurements и устойчивые roles/test ids.

## Проверка

Минимум:

```powershell
npm run typecheck -w @studydeck/web
npm run test -w @studydeck/web
npm run test:e2e -- --project=chromium e2e/studydeck-core.spec.ts e2e/ui-accessibility-regressions.spec.ts
git diff --check
```

Если синтаксис выбора Playwright-тестов в актуальной версии отличается, используй эквивалентную точечную команду и укажи её дословно.

Для визуальной проверки используй `npm run dev:web:fast` и `http://localhost:3020`. Не rebuild/restart Docker и не изменяй production container на `localhost:3010`.

## Acceptance criteria

- Три P1 редактора воспроизводимо устранены на 320x568, 390x844, 768x1024 и 844x390.
- Нет document-level horizontal overflow, скрытого H1 или header collisions.
- Landscape имеет реальную рабочую область, а не только видимый заголовок/панель.
- Desktop и существующие edit/save interactions не регрессировали.
- Есть автоматизированные geometry assertions и полный отчёт по формату README.

## Не делать

- Не переходить к лендингу, `/new`, общему WorkflowProgress, админке или странице речи.
- Не устанавливать зависимости, не трогать backend/worker/shared contracts.
- Не делать commit/deploy/Docker build.
- После отчёта остановиться и ждать решения координатора.

