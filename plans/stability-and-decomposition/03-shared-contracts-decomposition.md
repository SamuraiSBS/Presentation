# План-промт 03: декомпозиция `packages/shared/src/index.ts`

Ты работаешь в монорепозитории StudyDeck AI по адресу `D:\presentation`.

Реализуй декомпозицию shared-пакета полностью. Это утверждённая задача на изменение кода, а не запрос дополнительного плана. Сначала проверь текущее состояние после предыдущих чатов, затем перенеси схемы и helpers по тематическим модулям, сохранив публичный API и runtime-поведение.

## Цель

Превратить `packages/shared/src/index.ts` из многотысячного файла в стабильную публичную точку входа, которая реэкспортирует тематические модули.

Shared — критическая граница между:

- `apps/web`;
- `apps/api`;
- `apps/worker`;
- web preview/editor;
- generation normalization;
- PPTX/PDF export.

Поэтому этот пакет не должен менять форму данных или генерацию слайдов под видом механической декомпозиции.

## Основной принцип

Первая итерация — **move without redesign**:

- переместить существующие объявления;
- сохранить имена exports;
- сохранить Zod defaults, preprocess/refine/transform и optional/nullable semantics;
- сохранить порядок и значения enum;
- сохранить deterministic canvas output;
- оставить `packages/shared/src/index.ts` как barrel;
- не переводить потребителей на deep imports.

Изменение контракта допускается только при доказанной существующей ошибке и должно быть выделено отдельно с regression test. Не улучшай схемы «заодно».

## Перед началом

1. Прочитай `AGENTS.md`, этот файл и существующие shared-тесты:
   - `packages/shared/src/index.test.ts`;
   - `packages/shared/src/layout.test.ts`;
   - все другие актуальные тесты shared.
2. Проверь рабочее дерево:

   ```powershell
   git -c safe.directory=D:/presentation status --short
   git -c safe.directory=D:/presentation diff -- packages/shared apps/web apps/api apps/worker
   ```

3. Получи полный список публичных exports текущего `index.ts` и список импортов `@studydeck/shared` во всех приложениях.
4. Зафиксируй baseline:

   ```powershell
   npm run build -w @studydeck/shared
   npm run typecheck -w @studydeck/shared
   npm run test -w @studydeck/shared
   npm run check
   npm run test
   ```

5. Сохрани снимок публичной поверхности автоматически или тестом. Например, извлеки runtime export keys из собранного пакета и type-level imports для ключевых symbols. Не полагайся только на ручной список.

## Предлагаемая модульная структура

Адаптируй к живому коду, но границы должны оставаться тематическими:

```text
packages/shared/src/
  index.ts
  admin/
    schemas.ts
  projects/
    schemas.ts
    summaries.ts
  generation/
    schemas.ts
    artifacts.ts
  presentation/
    schemas.ts
    layouts.ts
    themes.ts
    canvas-schemas.ts
    canvas-builder.ts
    canvas-audit.ts
    editorial-canvas.ts
    premium-canvas.ts
  collaboration/
    schemas.ts
  billing/
    schemas.ts
    limits.ts
  exports/
    schemas.ts
```

Не создавай папку ради одного случайного типа. Если фактическая связность лучше выражается меньшим числом файлов, выбери более компактную структуру и объясни её в итоговом отчёте.

## Карта ответственности

### Admin

Перенести вместе:

- period/time range/list query;
- money/metrics/overview;
- user rows/details;
- admin actions и reason/plan override.

Admin-модуль не должен зависеть от canvas/theme builder.

### Projects и collaboration

Сгруппировать:

- plan/scenario/project status;
- access/member roles;
- folders;
- sources и source review;
- create/update/duplicate/list project inputs;
- invitation/member contracts;
- project/folder/dashboard summaries.

Не ломай `optional`, `nullable` и preprocessing пустых query-значений.

### Generation

Сгруппировать:

- generation progress/job kinds;
- generation brief;
- narrative plan;
- research brief;
- deck story;
- design brief;
- slide blueprints/text plans;
- quality critique/issues/dimensions;
- pipeline artifacts.

Эти схемы используют worker structured output. Любое изменение Zod shape может сломать OpenAI/Yandex пути, поэтому переносить их нужно дословно и с тестами parse/compatibility.

### Presentation schemas

Сгруппировать:

- slide block/kind/layout;
- visual types, diagram/mermaid specs;
- canvas element/background schemas;
- slide canvas/slide/document;
- speech script;
- theme schema.

Не меняй порядок discriminated unions и defaults без необходимости.

### Layouts и themes

Отделить registry/selection helpers:

- `SLIDE_LAYOUT_DEFINITIONS`;
- `slideLayoutDefinition` и `slideLayoutOptions`;
- theme presets;
- premium theme registry/IDs;
- `resolvePremiumPresentationTheme`;
- `resolveThemeFromDesignBrief`;
- `resolvePresentationTheme` и topic keyword tables.

Сохрани deterministic selection: одинаковый input до и после должен давать одинаковую тему.

### Canvas

Canvas builder — большой самостоятельный домен. Раздели минимум на:

- schemas/types;
- public orchestration (`ensureEditableCanvas`, `buildSlideCanvas`, `auditSlideCanvas`);
- editorial builders;
- premium/directed builders;
- shared element/text/geometry helpers.

Не дублируй внутренние константы между файлами. Создай внутренний `canvas-constants.ts` или `canvas-helpers.ts`, если это уменьшает связанность.

Сохрани:

- размеры canvas;
- safe margins;
- font guardrails;
- порядок и z-index элементов;
- стабильные element IDs, если от них зависит editor;
- canvas audit;
- custom canvas preservation;
- defensive behavior на partial/legacy slides.

## Управление зависимостями

Спроектируй однонаправленный граф, например:

```text
primitive schemas
  -> project/generation contracts
  -> presentation schemas
  -> themes/layout registries
  -> canvas builders
  -> public index barrel
```

Не допускай циклов `schemas -> builder -> schemas`. Используй `import type`, когда значение не требуется в runtime. Не создавай runtime barrel внутри внутренних модулей, если он провоцирует циклический импорт.

`index.ts` должен быть публичным barrel, но внутренние файлы могут импортировать друг друга напрямую по конкретному пути.

## Совместимость публичного API

Обязательно:

- все прежние публичные names доступны из `@studydeck/shared`;
- приложения продолжают использовать `@studydeck/shared`, а не `@studydeck/shared/dist/...`;
- package `main` и `types` остаются корректными;
- TypeScript declaration output содержит все прежние типы;
- runtime exports Zod schemas/functions доступны;
- не экспортируются случайно десятки внутренних helpers, если раньше они были private.

Добавь защиту от drift. Возможные варианты:

- тест списка runtime exports для критических функций/схем;
- compile-only fixture, импортирующий основные public types/schemas;
- golden fixtures parse/serialize для `PresentationDocument`, `DesignBrief`, `CreateProjectInput`, admin responses.

Не обязательно фиксировать абсолютно каждый ключ строковым snapshot, если это сделает обновления болезненными. Но критическая поверхность должна быть защищена.

## Characterization-тесты до переноса

До изменения builder-логики добавь/уточни детерминированные fixtures:

1. Parse полного `PresentationDocument` и partial legacy document.
2. `resolvePresentationTheme` для нескольких topic categories.
3. `buildSlideCanvas` для:
   - title/hero;
   - content/talk;
   - diagram;
   - comparison;
   - summary;
   - image-led slide.
4. `auditSlideCanvas` для валидного и проблемного canvas.
5. `ensureEditableCanvas`:
   - создаёт canvas при отсутствии;
   - не перезаписывает существующий custom canvas.
6. Layout options и hidden layouts.

Проверяй существенные поля и инварианты, а не хрупкий snapshot всего объекта, если порядок не является частью контракта.

## Порядок реализации

1. Добавить characterization-тесты.
2. Вынести наименее связанные admin/project/billing schemas.
3. Вынести presentation primitive schemas.
4. Вынести generation artifacts/design schemas.
5. Вынести theme/layout registries.
6. Вынести canvas builders последними.
7. Превратить `index.ts` в явные `export { ... }` / `export type { ... }` или контролируемые `export *`, проверив collisions.
8. Пересобрать shared и затем проверить все приложения.

После каждого этапа shared build/test должен быть зелёным. Не переносить весь файл одним непросматриваемым commit-sized diff.

## Ограничения scope

- Не менять Prisma.
- Не менять API routes.
- Не менять AI prompts и generation quality logic.
- Не редизайнить canvas.
- Не менять web/editor UX.
- Не добавлять новую schema library.
- Не вводить deep imports в приложениях.
- Не менять legacy MVP.
- Не коммитить `dist` и `*.tsbuildinfo`, если они не являются отслеживаемой частью репозитория.

## Проверка

После каждого этапа:

```powershell
npm run build -w @studydeck/shared
npm run typecheck -w @studydeck/shared
npm run test -w @studydeck/shared
```

Финальная проверка:

```powershell
npm run build -w @studydeck/shared
npm run test -w @studydeck/shared
npm run typecheck -w @studydeck/api
npm run typecheck -w @studydeck/web
npm run typecheck -w @studydeck/worker
npm run test -w @studydeck/api
npm run test -w @studydeck/web
npm run test -w @studydeck/worker
npm run check
npm run build
git -c safe.directory=D:/presentation diff --check
```

Если web визуально не менялся, Docker rebuild не нужен. Если менялся только shared source, локальные приложения должны проверяться после обязательной сборки shared. Для dev web после изменения shared перезапусти `npm run dev:web:fast`.

## Критерии готовности

- `packages/shared/src/index.ts` стал небольшим публичным barrel.
- Код разложен по устойчивым доменным модулям, а не просто по произвольным кускам.
- Нет циклических runtime imports.
- Все прежние public imports из `@studydeck/shared` продолжают компилироваться.
- Zod parse/default/refine semantics не изменились неожиданно.
- Theme/layout/canvas output сохраняет прежнее детерминированное поведение.
- Web, API и worker проходят typecheck/tests после rebuild shared.
- Новые characterization-тесты защищают наиболее рискованные контракты.
- Не произошло скрытого изменения качества генерации или внешнего вида слайдов.

## Итоговый отчёт

Покажи:

- итоговое дерево `packages/shared/src`;
- граф основных зависимостей;
- размер/роль нового `index.ts`;
- как проверена обратная совместимость;
- какие characterization fixtures добавлены;
- результаты всех проверок;
- любые намеренно оставленные крупные модули и почему их пока не следует дробить дальше.
