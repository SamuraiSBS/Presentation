# Prompt 05 — две фотографии максимум, остальное локальные диаграммы

Скопируй весь этот файл в новый чат Codex. Эта задача требует выполненных Prompts 01–04.

## Задача

Сделай визуальный этап предсказуемым по цене для economic standard run: максимум две веб-фотографии на 10 слайдов, один Tavily image query на слайд, а все абстрактные/процессные/сравнительные темы — локальные диаграммы и canvas без сети.

## Контекст

- `apps/worker/src/tasks/image-search.ts` сейчас ищет изображения только у `real_photo`, но до трёх refined queries на один слайд и без deck-wide cap.
- `buildDesignBrief()` уже умеет локально назначать layout/image strategy.
- Mermaid и shared canvas поддерживают flowchart/sequence/timeline/mindmap.
- Пользователь явно выбрал веб-фото плюс локальные диаграммы; генерировать AI illustrations нельзя.

## Требования

1. Введи deterministic visual allocation для economic standard run. Лимит: не более двух `real_photo` slide directions для 10 слайдов; для меньшего/большего числа слайдов задай явную пропорцию и hard maximum. Title/summary не обязаны иметь фото.
2. Изображение искать только при конкретном предметном anchor (объект, человек, место, исторический период, устройство и т. п.). Для концепции, процесса, сравнения, причин/следствий, классификации и итогов — локальная диаграмма либо text-led layout.
3. На слайд допустим ровно один Tavily image search request. Зарезервируй bucket images до запроса; при отсутствии бюджета или неудаче сразу использовать локальный fallback без повторных поисков.
4. Сохрани атрибуцию URL/title в `visual.image` и экспорт. Не подменяй загруженную пользователем картинку.
5. Все local diagram directions должны иметь безопасный Mermaid spec/fallback, проходить schema/canvas/export checks и не требовать модели.
6. Сжатие, размерные лимиты, таймауты и storage telemetry остаются, но image storage/retry не должны снять больше image bucket.
7. Не меняй прошлые presentations и их изображения.

## Acceptance criteria

- В 10-slide fixture максимум две Tavily image-search операции и не более двух сохранённых web images.
- В abstract fixture — ноль image-search и минимум один локальный diagram/text-led visual.
- Ошибка Tavily/download даёт валидную диаграмму/text-led slide, не повторяет поиски и не блокирует готовность.
- Источник изображения экспортируется в PPTX/PDF attribution.
- Canvas audit проходит с фото и без фото.

## Проверка

Добавь tests на deck-wide cap, один query на слайд, abstract fallback, budget refusal, download failure, source attribution. Запусти targeted worker/shared/export tests и typecheck. Не делай Docker rebuild, пока не будет Prompt 06.

