# 03 — Мобильная админка, таблицы и touch-accessibility

## Скопируй этот файл целиком в новый чат Codex

Работай в `D:\presentation`. Реализуй полностью и только Prompt 03 после принятия Prompts 01–02. Прочитай `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, README пакета, audit, этот prompt и принятый отчёт Prompt 02. Проверь актуальный код и `git status --short`; не перетирай уже внедрённые responsive fixes и чужие изменения.

Если доступен `impeccable`, используй `harden` и `typeset`: цель — надёжность и доступность существующего интерфейса, не новый дизайн.

## Цель

Устранить P2:

1. открытый admin drawer не блокирует background scroll;
2. подтверждённые интерактивные цели меньше 44x44 px;
3. административные таблицы остаются desktop-only шириной около 920 px;
4. подписи нижней навигации уменьшаются до 8.5 px на <=360 px.

## Обязательный baseline

Проверь:

- `apps/web/src/components/admin/admin-shell.tsx`;
- `apps/web/src/app/styles/admin.css`;
- admin routes/users/profile/tables и существующий `e2e/admin-dashboard.spec.ts`;
- shared shell/dialog/tab/back-link/export controls, перечисленные audit;
- `apps/web/src/app/styles/dashboard-projects.css` и реальную bottom-nav markup;
- уже изменённые Prompt 01 editor styles и Prompt 02 new/workflow styles до любой общей правки.

Составь до кода компактную таблицу confirmed targets: selector/component, текущий bounding box на coarse pointer, ожидаемый контракт. Не делай слепое глобальное `min-height:44px` для каждого `<a>`/`<button>`: inline links и текстовые ссылки требуют достаточной hit area только там, где они являются standalone controls.

## Реализация

### A. Admin drawer как модальный navigation layer

- При открытии блокируй background scroll и после закрытия возвращай прежнюю позицию без скачка.
- Добавь корректный focus lifecycle: focus в drawer, keyboard navigation, Escape close, возврат focus на trigger.
- Overlay click закрывает drawer, взаимодействие с фоном недоступно.
- Предпочти уже установленный Radix/local dialog primitive, если он подходит текущей архитектуре; не устанавливай новую библиотеку.
- Drawer navigation сохраняет route behavior и закрывается после перехода там, где это ожидаемо.

### B. Touch contract

- Доведи standalone mobile/coarse-pointer controls до минимум 44x44: shell brand/control, export tabs, admin menu/nav, drawer close, dialog close, admin back link и profile tabs — после перепроверки актуальной markup.
- Сохрани desktop density: при необходимости используй coarse-pointer/media rules или расширенную hit area без визуального раздувания.
- Не создавай overlapping invisible hit boxes и не ухудшай focus ring.
- Иконки должны иметь accessible names; не добавляй tooltip как замену label для критического действия.

### C. Admin tables

- Для `/admin/users`, `/admin/audit`, `/admin/generations`, `/admin/errors`, `/admin/logs`, `/admin/costs`, `/admin/revenue` выбери общий mobile pattern на основе реального содержимого.
- Предпочтение: semantic compact cards/definition rows на mobile при сохранении настоящей table на desktop. Если общий компонент делает карточки чрезмерно сложными, допустима прокрутка со sticky identity column и явным scroll cue, но решение должно позволять сопоставлять сущность со статусом/суммой/временем.
- Не дублируй business mapping по семи страницам; вынеси минимально общий presentational primitive при реальной повторяемости.
- Сохрани table semantics на desktop, loading/empty/error states, row links/actions и форматирование данных.

### D. Bottom navigation typography

- Убери 8.5 px и отрицательный letter-spacing как способ вместить пять русских labels.
- Сохрани читаемость минимум около 11 px иерархически, допуская перенос/сокращение только если смысл и accessible name остаются полными.
- Сохрани пять направлений, active state, safe-area и отсутствие перекрытия content.

## Тесты

Расширь Playwright `admin-dashboard.spec.ts` и подходящие shared UI tests. Mock admin API как в текущем suite; не использовать реальные sensitive данные.

Минимально докажи:

- `scrollY` не меняется от wheel/touch-like scroll фона при открытом drawer и восстанавливается после close;
- Escape/overlay/nav закрывают drawer ожидаемо, focus возвращается trigger;
- mobile drawer не вызывает horizontal overflow;
- подтверждённые standalone controls имеют bounding box >=44x44 в coarse-pointer mobile project;
- выбранный table pattern позволяет увидеть identity + ключевые поля на 320/390 без document horizontal overflow;
- desktop admin table и route navigation сохраняются;
- bottom-nav labels не меньше принятого размера, не налезают друг на друга и controls имеют 44x44 hit area.

Не делай только CSS snapshot: проверь behavior и bounding boxes.

## Проверка

```powershell
npm run typecheck -w @studydeck/web
npm run test -w @studydeck/web
npm run test:e2e -- --project=chromium --project=mobile e2e/admin-dashboard.spec.ts e2e/personal-account.spec.ts e2e/studydeck-core.spec.ts
git diff --check
```

Проверь admin/public authenticated shells на матрице README через `http://localhost:3020`. Не rebuild/restart Docker, не меняй `localhost:3010`.

## Acceptance criteria

- Drawer имеет корректный scroll/focus/close lifecycle.
- Все подтверждённые standalone touch controls достигают 44x44 на coarse pointer без desktop regression.
- Семь admin data routes имеют понятный единый mobile pattern.
- Bottom-nav labels читаемы и не зависят от 8.5 px.
- Tests и отчёт доказывают behavior, geometry, mobile и desktop.

## Не делать

- Не менять admin API/permissions/sensitive data contracts.
- Не перерабатывать dashboard information architecture.
- Не исправлять длинную страницу речи — Prompt 04.
- Не делать commit/deploy/Docker build и не начинать следующий prompt.

