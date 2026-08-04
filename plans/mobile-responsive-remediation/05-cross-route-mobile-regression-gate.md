# 05 — Cross-route mobile regression gate и финальный узкий polish

## Скопируй этот файл целиком в новый чат Codex

Работай в `D:\presentation`. Это финальный implementation/review gate после принятых Prompts 01–04. Прочитай `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, весь README, исходный audit, этот prompt и полный принятый отчёт Prompt 04. Затем прочитай актуальный diff всех UI-изменений и выполни `git status --short`.

Если доступен `impeccable`, используй `polish` для повторного визуального прохода. Это не разрешение на редизайн: исправляй только доказанные regression/gap в границах audit.

## Цель

Доказать, что все 6 P1 и 5 P2 закрыты вместе, а не по отдельности, и что исправления не сломали desktop, keyboard, safe areas, data states или соседние маршруты.

## Жёсткий порядок

### 1. Read-only reconciliation

До новых правок составь таблицу всех 11 audit findings:

- статус `pass / fail / blocked`;
- маршрут и viewport;
- DOM/behavior evidence;
- автоматизированный test, который защищает результат;
- изменённый owning component/style.

Не верь предыдущим отчётам без текущей проверки. Если все пункты pass, не делай косметических изменений ради diff.

### 2. Route matrix

На матрице viewport из README проверь применимые маршруты:

- `/`;
- `/new` и несколько шагов wizard;
- dashboard/projects и authenticated bottom navigation;
- `/projects/demo/editor`;
- demo/local script review;
- `/projects/demo/export`;
- account/profile/dialog routes;
- `/admin` и доступные admin data routes с mocked local responses;
- loading, empty, error и long-Russian-text states там, где fixtures уже позволяют это безопасно.

Проверяй минимум:

- document horizontal overflow;
- clipping и overlap fixed/sticky UI;
- active workflow visibility;
- heading/control bounding boxes;
- touch targets на mobile/coarse pointer;
- scroll lock/focus return/Escape;
- keyboard reachability и visible focus;
- reduced motion;
- desktop layout 1280x800 и 1440x900.

### 3. Только узкие исправления

Если gate обнаружил regression или незакрытый audit criterion, внеси минимальное исправление в owning component/style и добавь test, воспроизводящий именно этот gap.

Запрещены broad CSS reset, новая система breakpoints, переписывание layout architecture, новые зависимости или opportunistic refactor. Не меняй продуктовый текст/IA без прямой связи с pass criterion.

### 4. Автоматизированная защита

Сведи повторяющиеся geometry helpers разумно, но не создавай тяжёлый visual-regression framework. Tests должны быть детерминированными, использовать demo/mocked data и не обращаться к AI/search/paid services.

Обязательны assertions, что:

- `documentElement.scrollWidth <= clientWidth` на ключевых маршрутах;
- важные элементы не выходят за viewport/container;
- fixed/sticky слои не перекрывают основное действие;
- active item видим в horizontal scroller;
- drawer focus/scroll lifecycle работает;
- mobile touch controls соответствуют 44x44;
- desktop workflows редактора/создания/export/admin остаются рабочими.

## Проверка

Запусти сначала targeted tests затронутых файлов, затем:

```powershell
npm run typecheck -w @studydeck/web
npm run test -w @studydeck/web
npm run lint
npm run test:e2e
npm run check
docker compose config --quiet
git diff --check
```

Не запускай production `npm run build`, если он не нужен для найденной ошибки: `npm run check` уже выполняет web/shared typecheck/build dependencies по репозиторному contract. Если какая-либо проверка падает из-за уже существующей/чужой проблемы, отдели baseline evidence от своей регрессии и не маскируй падение.

Если test/build изменил `apps/web/tsconfig.tsbuildinfo`, не включай generated artifact в будущий commit; в отчёте отдельно покажи его статус. Не трогай чужие файлы.

Визуальную проверку делай на `http://localhost:3020` через `npm run dev:web:fast`. Не rebuild/restart Docker, не обновляй `localhost:3010`, не создавай project/job/export и не вызывай providers.

## Acceptance criteria

- Все 11 findings имеют текущий evidence-backed `pass`, либо prompt завершается `blocked` с точной воспроизводимой причиной.
- Полная viewport/route matrix не обнаруживает clipping, document overflow или critical overlap.
- Keyboard, focus, scroll lock, reduced motion, touch sizes и safe-area доказаны.
- Targeted web tests, full Playwright gate, repo check и `git diff --check` проходят либо их независимый baseline blocker документирован.
- Нет Docker/deploy/commit и нет unrelated changes.

## Финальный отчёт

Кроме общего формата README обязательно приложи:

1. итоговую таблицу 11 findings;
2. route x viewport coverage;
3. точные команды и exit results;
4. список оставшихся рисков;
5. разбиение будущего commit scope, но не выполняй staging/commit;
6. вердикт ровно `готово к commit-readiness review` или `не готово к commit-readiness review`.

После отчёта остановись. Production-container rebuild на `localhost:3010`, commit и deploy требуют отдельных явных команд пользователя.

