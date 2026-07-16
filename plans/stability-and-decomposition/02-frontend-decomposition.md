# План-промт 02: декомпозиция `globals.css` и `project-editor.tsx`

Ты работаешь в монорепозитории StudyDeck AI по адресу `D:\presentation`.

Реализуй безопасную frontend-декомпозицию полностью. Это утверждённое задание на код. Не останавливайся после анализа или нового плана. Сначала проверь живое состояние репозитория и результаты предыдущего пакета, затем перенеси код небольшими проверяемыми шагами.

## Цель

Снизить риск изменений в frontend, разделив два крупнейших и наиболее связанных файла:

- `apps/web/src/app/globals.css` — сейчас содержит базовую систему, app chrome, страницы, admin, мастер создания и несколько поколений editor-правил;
- `apps/web/src/components/project-editor.tsx` — одновременно управляет данными, сохранением, undo/redo, canvas-взаимодействиями, toolbar, панелями свойств и мобильной навигацией.

Декомпозиция должна сохранить пиксельное и функциональное поведение. Это не редизайн и не изменение продуктового сценария.

## Продуктовые ограничения

- Сохрани существующую тёплую оранжевую систему, Nunito и семантические акценты.
- Редактор остаётся простым Gamma-подобным post-generation редактором.
- Главные правки: текст и изображения.
- Расширенные геометрические свойства не должны возвращаться в основной сценарий.
- Мобильный режим: просмотр, список слайдов и небольшие правки.
- Не создавай новый full-canvas framework и не вводи React Flow для редактора слайдов.
- Используй существующие Tiptap, Radix, Lucide и локальные UI-примитивы.

## Перед началом

1. Прочитай `AGENTS.md`, `DESIGN.md`, этот файл и относящиеся к редактору тесты.
2. Проверь рабочее дерево:

   ```powershell
   git -c safe.directory=D:/presentation status --short
   git -c safe.directory=D:/presentation diff -- apps/web
   ```

3. Найди все импорты `globals.css`, все селекторы, связанные с editor/new/admin/account/projects, и все внешние импорты/использования `ProjectEditor`.
4. Зафиксируй baseline до перемещения:

   ```powershell
   npm run lint
   npm run typecheck -w @studydeck/web
   npm run test -w @studydeck/web
   npm run test:e2e
   ```

5. Если предыдущий план ещё не реализован и baseline красный, не расширяй scope скрытым ремонтом всего UI. Исправляй только то, что необходимо для безопасной декомпозиции, и честно отделяй старые сбои от новых.

## Часть A. Разделить CSS по ответственности

### Целевая структура

Адаптируй имена к фактическому коду, но стремись к структуре такого уровня:

```text
apps/web/src/app/
  globals.css
  landing.css
  styles/
    tokens.css
    base.css
    app-shell.css
    dashboard-projects.css
    new-project.css
    editor.css
    account.css
    admin.css
    responsive.css        # только если общие responsive-правила нельзя оставить рядом с feature
```

Предпочтительно держать media queries рядом с соответствующей feature, а не собирать все мобильные правила в один файл. `responsive.css` создавай только для действительно межстраничных контрактов.

### Правила переноса

- `tokens.css`: `:root`, цветовые, radius, shadow, motion и z-index tokens.
- `base.css`: reset, `box-sizing`, html/body, typography, ссылки, нативные controls, focus-visible и общие utility-примитивы.
- `app-shell.css`: header, app content, navigation, mobile bottom nav, общие page containers.
- `dashboard-projects.css`: dashboard, folders, project list/cards и связанные empty/loading states.
- `new-project.css`: `.new-page`, wizard, источники, speech review, generation review.
- `editor.css`: только editor chrome, rail, canvas shell, properties, toolbar и мобильные editor-состояния. Не перемещай стили, которые являются частью generated slide theme, если они используются renderer/export parity.
- `account.css`: auth/profile/settings/billing/personal-account UI.
- `admin.css`: `.admin-*` и относящиеся keyframes/media queries.
- `landing.css` оставь отдельным, если он уже изолирован и работает.

### Каскад и импорт

Выбери один явный механизм импорта:

- либо `globals.css` импортирует feature-файлы в фиксированном порядке;
- либо root `layout.tsx` импортирует их последовательно.

Не смешивай два механизма без причины. Порядок каскада должен быть документирован коротким комментарием. Не используй массовый `!important` для восстановления приоритетов.

Перед перемещением выяви повторные определения ключевых селекторов (`.wizard-*`, `.editor-*`, `.project-*`) и слои старой/новой визуальной системы. При дубликатах:

- сохраняй итоговое вычисленное поведение;
- объединяй только очевидно эквивалентные правила;
- не проводи большой косметический cleanup одновременно;
- добавь regression test или визуальную проверку для чувствительного места.

Не переводить весь CSS в CSS Modules в этом пакете. Это отдельная миграция с другим профилем риска.

### Желаемый результат CSS

- `globals.css` становится короткой точкой сборки и не хранит feature-страницы целиком;
- feature-стили легко найти по экрану;
- editor generated-canvas и editor chrome различимы;
- порядок каскада детерминирован;
- desktop/mobile внешний вид не изменён неожиданно.

Не ставь искусственную цель по числу строк, но ориентир для `globals.css` после разделения — только импорты и действительно глобальные правила, а не тысячи строк.

## Часть B. Разделить `ProjectEditor`

### Сначала определить реальные границы

Перед переносом составь карту текущего компонента:

- входные props и публичный export;
- состояние проекта и активного слайда;
- выбранный canvas-элемент и режимы editor/mobile;
- сохранение и revision conflict;
- undo/redo;
- resize/drag/pointer interactions;
- замена изображения;
- text fitting;
- toolbar;
- preview/canvas element renderers;
- простая и расширенная панели свойств;
- мобильная навигация;
- pure geometry/formatting helpers.

Сохрани публичный импорт `ProjectEditor` совместимым. Внешние страницы не должны знать о внутренней реструктуризации.

### Целевая структура

Не обязана совпадать побуквенно, но ожидается примерно следующее:

```text
apps/web/src/components/project-editor/
  index.ts
  project-editor.tsx
  editor-top-toolbar.tsx
  slide-rail.tsx
  editor-canvas.tsx
  canvas-element-view.tsx
  object-floating-menu.tsx
  simple-properties-panel.tsx
  advanced-properties-panel.tsx
  mobile-editor-nav.tsx
  save-indicator.tsx
  hooks/
    use-editor-project.ts
    use-slide-history.ts
    use-canvas-interactions.ts
    use-image-replacement.ts
  editor-geometry.ts
  editor-errors.ts
  editor-types.ts
```

Можно оставить `apps/web/src/components/project-editor.tsx` как тонкий compatibility re-export, чтобы не создавать массовый diff импортов.

### Последовательность extraction

Выполняй по одному слою и проверяй typecheck после каждого логического шага:

1. Перенеси pure types/constants/helpers:
   - `Tool`, `ViewMode`, `SaveStatus`, mobile section types;
   - canvas dimensions и безопасные размеры;
   - `clamp`, clone, z-index, style/geometry helpers;
   - нормализацию ошибок и labels.
2. Перенеси leaf-компоненты без собственной бизнес-логики:
   - `SaveIndicator`;
   - `MobileEditorNav`;
   - property sections;
   - отдельные control groups.
3. Перенеси canvas renderers и floating menu, сохранив pointer semantics.
4. Перенеси simple/advanced properties panels.
5. Только после стабилизации выделяй hooks для history/save/interactions.
6. Оставь верхний `ProjectEditor` владельцем orchestration и важных cross-feature переходов.

Не создавай один гигантский `EditorContext`, в который складывается всё состояние. Локальные props допустимы. Контекст вводи только для устойчивой группы часто используемых значений и с узким типизированным API.

### Инварианты редактора

- generated canvas не считается пользовательским до реальной правки;
- custom-canvas marker сохраняется;
- пользовательский custom canvas не перезаписывается нормализацией;
- undo/redo работает на активном слайде и не мутирует прошлые snapshots;
- revision conflict не теряется и не заменяется молчаливым save;
- title/text updates продолжают синхронизировать нужные slide blocks;
- локальная замена изображения сохраняет существующий контракт загрузки;
- resize/drag учитывают canvas scale;
- text fitting не опускает текст ниже текущих guardrails;
- keyboard shortcuts игнорируются при вводе в text fields/Tiptap;
- mobile sections и advanced mode остаются предсказуемыми;
- readonly preview не получает edit handlers.

### Тесты

Добавь или расширь Vitest-тесты для вынесенных pure-функций и наиболее рискованных hooks. Не пытайся покрыть каждую JSX-строку.

Минимальные unit-сценарии:

- clamp/coordinate conversion при scale;
- immutable undo/redo snapshots;
- next z-index;
- text fitting boundary;
- custom marker preservation;
- error normalization;
- title/block synchronization, если helper вынесен.

E2E должен подтвердить:

- editor открывается;
- переключение слайда работает;
- простое редактирование заголовка сохраняет результат;
- undo/redo сохраняется;
- mobile nav переключает нужные секции;
- advanced mode не показывается по умолчанию;
- экспорт/preview route не сломан.

## Ограничения scope

- Не менять shared presentation schema, если это не требуется для сохранения существующего поведения.
- Не менять worker generation/export.
- Не менять API-контракты.
- Не переделывать editor UX.
- Не добавлять новую state-management библиотеку.
- Не менять legacy MVP.
- Не проводить массовое переименование всех CSS-классов.
- Не коммитить `.next`, `dist`, screenshots и `tsconfig.tsbuildinfo`.

## Проверка

После каждого крупного extraction:

```powershell
npm run typecheck -w @studydeck/web
npm run test -w @studydeck/web
```

В конце:

```powershell
npm run lint
npm run typecheck -w @studydeck/web
npm run test -w @studydeck/web
npm run test:e2e
npm run build -w @studydeck/web
git -c safe.directory=D:/presentation diff --check
```

Для визуальной проверки:

```powershell
npm run dev:web:fast
```

Проверить на `http://localhost:3020`:

- dashboard/projects;
- `/new` desktop и 320–390 px;
- demo/editor desktop и mobile;
- account/profile;
- admin, если он доступен в текущем dev-контексте;
- landing page, чтобы убедиться, что порядок CSS не повредил её.

Проверь computed appearance хотя бы для основных поверхностей до/после. Если доступен browser screenshot workflow, сделай before/after снимки одинаковых viewport и сравни визуально. Не добавляй временные снимки в Git.

## Критерии готовности

- `globals.css` больше не содержит все feature-стили одним полотном.
- CSS разделён по понятным зонам, а порядок каскада явный.
- Нет визуальных регрессий на основных desktop/mobile страницах.
- `ProjectEditor` имеет тонкий orchestration-компонент и отдельные leaf-компоненты/helpers/hooks.
- Публичный импорт редактора совместим.
- Все инварианты save/history/custom canvas/mobile сохранены.
- Не возник гигантский context или новый монолитный файл под другим именем.
- Lint, web typecheck, unit/E2E и web build проходят.

## Итоговый отчёт

Покажи:

- итоговое дерево CSS и editor-модулей;
- какие ответственности остались в orchestration-компоненте;
- какие дубликаты CSS были объединены и почему это безопасно;
- результаты тестов и URL preview;
- любые старые baseline-сбои, не вызванные этой работой.
