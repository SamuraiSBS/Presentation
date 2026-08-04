# 02 — Лендинг, создание проекта и видимый текущий workflow-шаг

## Скопируй этот файл целиком в новый чат Codex

Работай в `D:\presentation`. Реализуй полностью и только Prompt 02. Он выполняется только после принятого Prompt 01; приложенный отчёт предыдущего этапа используй как контекст, но перепроверь текущий код.

Сначала полностью прочитай `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, README пакета, audit, этот prompt и отчёт Prompt 01. Выполни `git status --short`; сохрани все чужие изменения. Если доступен `impeccable`, используй `adapt` для существующей системы, без редизайна.

## Цель

Устранить три P1:

1. финальный interactive artifact лендинга обрезан справа на 390 px;
2. активный WorkflowProgress на editor/script/export скрыт за правой границей;
3. на `/new` при 320x568 основное поле начинается под fold и перекрывается fixed bottom navigation.

## Зоны кода

Начни с актуального аудита, а не слепой правки строк:

- `apps/web/src/app/landing.css`;
- `apps/web/src/components/landing/landing-final-cta-artifact.tsx`;
- `apps/web/src/components/workflow-progress.tsx`;
- `apps/web/src/app/styles/workflow-review.css`;
- `apps/web/src/app/new/page.tsx`;
- `apps/web/src/components/new-project-form.tsx`;
- `apps/web/src/app/styles/new-project.css` и `new-project-shell.css`;
- bottom navigation/safe-area styles только в объёме, необходимом для устранения overlap `/new`.

## Реализация

### A. Финальный artifact лендинга

- Сделай artifact адаптивным внутри реальной ширины контейнера 320–412 px.
- Масштабируй/reflow дочерние slide/card/hint элементы согласованно, а не скрывай правый край parent `overflow:hidden`.
- Сохрани интерактивность, текущую композицию, animation semantics и reduced-motion behavior.
- Не допускай document-level horizontal overflow и не уменьшай содержимое до нечитаемого состояния.

### B. WorkflowProgress

- На первом render и при смене `currentStep` автоматически помещай активный шаг в видимую часть собственного scroll container.
- Не прокручивай document и не отбирай фокус у пользователя.
- Учитывай `prefers-reduced-motion`: smooth scrolling не должен нарушать настройку.
- Покажи ненавязчивый overflow cue/edge treatment, если существуют скрытые шаги. Это должна быть подсказка, не декоративный градиент, закрывающий label/control.
- Сохрани semantics текущего шага (`aria-current` или актуальный эквивалент), keyboard interaction и desktop layout.
- Проверь editor, script и export, включая последние шаги 4–6.

### C. Первый экран `/new`

- На 320x568 поле темы должно быть видимо или явно начато на первом экране, а основной action не должен оказываться под bottom nav.
- Сократи вертикальную перегрузку через responsive rhythm/content prioritization; не удаляй существенную информацию и не превращай форму во вложенный scroll trap.
- Учти safe-area и фактическую высоту нижней навигации через единый отступ/переменную, а не magic number для одного устройства.
- Keyboard-open состояние, focus и переход между шагами формы должны оставаться рабочими.
- На 360/390/412 и desktop не должно появиться лишнего пустого пространства или overlap.

## Детерминированные тесты

Расширь существующие Playwright tests. Докажи DOM-измерениями:

- landing artifact и его смысловые дочерние элементы находятся внутри контейнера/viewport на 320, 390 и 412;
- на `/new` при 320x568 topic field виден без initial scroll, а после `scrollIntoViewIfNeeded` action не пересекается с bottom nav;
- document не имеет horizontal overflow;
- active workflow step виден внутри scroll container при прямом входе на editor/script/export;
- автопозиционирование не меняет document `scrollY` и не крадёт focus;
- reduced-motion режим остаётся корректным;
- desktop landing/new/workflow не регрессировали.

Используй demo project/E2E fixtures и mocked/local data. Не создавай проект, generation job или export job.

## Проверка

```powershell
npm run typecheck -w @studydeck/web
npm run test -w @studydeck/web
npm run test:e2e -- --project=chromium e2e/wow-redesign.spec.ts e2e/studydeck-core.spec.ts e2e/ui-accessibility-regressions.spec.ts
git diff --check
```

Вручную проверь матрицу из README на `http://localhost:3020` через `npm run dev:web:fast`. Не rebuild/restart Docker и не меняй `localhost:3010`.

## Acceptance criteria

- Три P1 воспроизводимо устранены.
- CTA artifact не обрезан и остаётся понятным/интерактивным.
- Активный workflow step сразу виден на editor/script/export без document scroll/focus side effects.
- `/new` начинает основной сценарий на 320x568 и не перекрывается bottom nav/keyboard/safe-area.
- Есть устойчивые geometry/behavior tests и полный отчёт.

## Не делать

- Не исправлять admin drawer/tables, системный touch audit или progressive disclosure страницы речи — это Prompts 03–04.
- Не переписывать тексты лендинга и не менять product flow.
- Не делать commit/deploy/Docker build и не начинать Prompt 03.

