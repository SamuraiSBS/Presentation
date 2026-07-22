# 04 — Автоматические изображения и разнообразие учебных слайдов

## Роль

Реализуй только визуальный контракт новых generation jobs. Не добавляй пользовательский canvas editor и не модифицируй уже сохранённые презентации.

## Целевой результат для колоды из 10 слайдов

- 5–7 слайдов имеют реальное тематически релевантное изображение, найденное автоматически;
- 2–3 слайда используют полезную диаграмму/схему/таймлайн/сравнение вместо изображения;
- content-слайды не сводятся почти полностью к `statement`;
- выбор layout основан на материале: comparison требует сопоставимых данных, timeline — временных этапов, diagram — связей/процесса; декоративная схема не заменяет объяснение;
- если изображение не найдено/не скачалось/не прошло проверку, разрешён содержательный diagram-layout, но не пустой statement и не случайный stock image.

## Обязательное исследование

Прочитай `AGENTS.md`, README пакета, `git status --short`, затем:

- `apps/worker/src/tasks/image-search.ts` и tests;
- `planning/builders.ts`, `prompts/builders.ts` и design brief/slide directions;
- `normalization/presentation.ts` (`inferContentLayout`, `diversifySlideLayouts`, canvas generation);
- `presentation-quality.ts`, canvas audit и shared canvas contract;
- `apps/web/src/lib/presentation-display.ts` и `apps/worker/src/tasks/export.ts` только для проверки совместимости, без ненужного refactor.

Сначала зафиксируй реальные ограничения image pipeline: когда вызывается поиск, что считается candidate, как проверяются домен/релевантность/скачивание, как формируются attribution и что происходит при отсутствии картинки.

## План реализации

1. В design brief введи явный целевой visual role для каждого слайда: `photo`, `diagram`, `timeline`, `comparison`, `metric`, `text_only` с обоснованием. Сгенерированный plan не должен назначать photo всем слайдам подряд.
2. Сделай детерминированную deck-level проверку visual coverage: для обычной 10-slide учебной колоды ожидать 5–7 валидных image slides и 2–3 содержательных non-image visual slides. Адаптируй пороги к меньшему/большему slideCount и тематике; не требуй фото для абстрактной темы без безопасного визуального источника.
3. Ужесточи image relevance: query строится из конкретного topic/slide purpose, candidate сверяется с темой и слайдом, дубликаты URL/domain/сцены подавляются. Используй одобренные science-приоритеты из пункта 02 там, где они применимы.
4. Если поисковая картинка отсутствует, создавай только semantic fallback (diagram/сравнение/таймлайн), наполненный данными из narration/plan; не создавай generic decorative shapes. Если данных для fallback нет, пусть quality gate вернёт ошибку согласно пункту 01.
5. После enrichment и перед сохранением заново собери только generated canvas, затем запусти canvas/layout audit. Пользовательский custom canvas никогда не перезаписывать.

## Тесты

- 10-slide fixture с 6 подходящими изображениями и 3 смысловыми схемами проходит coverage gate.
- 10 одинаковых `statement` slides без изображений не проходят с понятной технической категорией качества.
- Нерелевантный/повторяющийся image candidate отвергается; релевантный принимается и получает attribution metadata.
- При сбое загрузки изображения создаётся содержательная diagram/timeline fallback только при наличии данных.
- Layout diversity не выбирает comparison/timeline без достаточной структуры и сохраняет canvas безопасным.
- Web renderer/export tests не получают регрессию для поддерживаемых layouts.

## Проверка

```powershell
npm run test -w @studydeck/worker -- src/tasks/image-search.test.ts src/tasks/presentation-quality.test.ts src/tasks/presentation.test.ts
npm run test -w @studydeck/worker -- src/tasks/export.test.ts
npm run test -w @studydeck/web -- src/lib/presentation-display.test.ts
npm run typecheck -w @studydeck/worker
npm run typecheck -w @studydeck/web
git diff --check
```

В финальном отчёте укажи распределение visual roles на fixture, число фото/диаграмм и любые осмысленные исключения.

