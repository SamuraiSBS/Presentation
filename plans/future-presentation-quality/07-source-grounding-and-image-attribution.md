# Промт 07: источники, привязка утверждений и авторство изображений

Ты работаешь в StudyDeck AI: `D:\presentation`.

Реализуй этот промт полностью. Сначала прочитай `AGENTS.md`, `plans/future-presentation-quality/README.md`, shared presentation schemas, source preparation, image search, canvas и export code.

## Цель

Строгая учебная презентация должна показывать, откуда взяты ключевые факты и изображения, не превращая каждый слайд в список длинных URL.

Система уже хранит `sourceRefs`, image `sourceTitle/sourceUrl/provider`, alt text и частично выводит attribution в template PPTX/PDF. Нужно сделать поведение полным и одинаковым для generated canvas, web, PPTX и PDF.

## Продуктовый контракт

- Аудитория: школа, колледж, вуз.
- Длительность: 5-10 минут.
- Стиль: строгий учебный.
- Слайд должен быть понятен самостоятельно, но source footer не должен конкурировать с тезисом.
- Источники не выдумывать.
- Если precise claim не привязан к source, repair должен либо найти уже имеющийся подходящий sourceRef, либо осторожно обобщить утверждение.
- Uploaded materials являются evidence и сохраняют роль.
- Пользователь не должен вручную чинить attribution перед экспортом.

## Актуальные точки входа

- `packages/shared/src/presentation/schemas.ts`
- `packages/shared/src/presentation/document.ts`
- `packages/shared/src/presentation/canvas-builder.ts`
- `packages/shared/src/presentation/canvas-audit.ts`
- `apps/worker/src/tasks/presentation/normalization/presentation.ts`
- `apps/worker/src/tasks/presentation-quality.ts`
- `apps/worker/src/tasks/image-search.ts`
- `apps/worker/src/tasks/image-search.test.ts`
- `apps/worker/src/tasks/export.ts`
- `apps/worker/src/tasks/export.test.ts`
- `apps/web/src/lib/presentation-display.ts`
- `apps/web/src/lib/presentation-display.test.ts`

Сейчас `findFactualRiskIssues(...)` проверяет unsupported specificity, image search сохраняет source metadata, `imageAttribution(...)` и PDF template figure умеют показывать подпись, но canvas path покрыт не полностью.

## Требуемая реализация

### 1. Нормализуй slide source references

Для каждого слайда:

- удалить ссылки на несуществующий source id;
- дедуплицировать refs;
- сохранить meaningful label;
- ограничить visible footer 1-3 наиболее релевантными refs;
- не потерять полный source list в document data;
- не создавать ссылку только из совпадения общего слова.

Если schema уже достаточна, не добавляй новое поле. Если нужна shared helper, экспортируй её через существующий barrel.

### 2. Добавь claim-to-source quality check

Определи precise/high-risk visible claims:

- даты, числа, проценты;
- имена людей/организаций;
- конкретные исторические события;
- причинные утверждения;
- сравнительные превосходные формулировки.

Проверить, что slide имеет релевантный `sourceRef` или matching uploaded/source context. Не требовать source для чистого вступления или общеизвестного краткого заголовка.

Repair:

- прикрепить существующий matching sourceRef, если связь подтверждается доступными metadata/excerpt;
- иначе обобщить precise unsupported wording;
- никогда не придумывать URL, автора, год или название источника.

### 3. Сделай единый компактный formatter

Добавь shared formatter для видимой подписи:

- content source: короткое название или домен, без длинного query string;
- image source: `Фото: <source title/domain>`;
- user upload: `Источник: материалы пользователя` или исходное имя файла, если это уместно и безопасно;
- несколько refs: компактная нумерация `[1] [2]` или короткая строка, одинаковая во всех форматах.

Полные URLs остаются в metadata/hyperlink, а не занимают ширину footer.

### 4. Добавь attribution в generated canvas

- Source footer и image credit должны быть canvas text elements с semantic role `sourceCredit`.
- Они не должны считаться body text при density limit.
- Они должны быть достаточно контрастными и не пересекаться с slide number/image crop.
- Web, PPTX и PDF отображают одинаковую короткую подпись.
- PPTX по возможности делает source title кликабельным, если текущий API позволяет без нестабильных hacks.

Не дублировать подпись дважды, если canvas уже содержит credit и template renderer тоже пытается его добавить.

### 5. Финальный список источников

Для 5-10 минутной учебной презентации:

- не добавлять отдельный sources slide автоматически, если 1-3 refs помещаются в footers и пользователь не просил bibliography;
- при большом числе значимых источников разрешить компактный final sources appendix после смыслового summary, не заменяя им conclusion;
- сохранить slide count contract или явно обновить narrative/outline/script, если appendix создаётся на этапе новой генерации.

## Обязательные тесты

1. Precise date without sourceRef создаёт factual/source issue.
2. Matching existing sourceRef устраняет issue.
3. При отсутствии источника repair обобщает claim без выдуманной ссылки.
4. Invalid source id удаляется.
5. Image sourceTitle/sourceUrl превращается в компактный credit.
6. Canvas, PPTX и PDF получают одну attribution string без дубля.
7. Длинный URL не ломает layout.
8. User-uploaded source сохраняется и не заменяется Tavily.
9. Source credit разрешён ниже body font minimum, но проходит contrast/bounds audit.
10. Старый документ без sourceRefs продолжает отображаться и экспортироваться.

## Проверка

```powershell
npm run build -w @studydeck/shared
npm run test -w @studydeck/shared
npm run test -w @studydeck/worker -- src/tasks/image-search.test.ts
npm run test -w @studydeck/worker -- src/tasks/presentation-quality.test.ts
npm run test -w @studydeck/worker -- src/tasks/export.test.ts
npm run test -w @studydeck/web -- src/lib/presentation-display.test.ts
npm run typecheck -w @studydeck/web
npm run typecheck -w @studydeck/worker
git diff --check
```

## Критерии готовности

- Ключевые конкретные утверждения имеют реальную source связь или безопасно обобщены.
- Image attribution присутствует во всех форматах.
- Подписи компактны и не ухудшают читаемость.
- Система не придумывает source metadata.
- Web/PPTX/PDF не дублируют credits.
- Legacy documents и uploads остаются совместимыми.

## Не входит в задачу

- Полный библиографический стандарт ГОСТ/APA для всех проектов.
- Автоматическая покупка лицензий на изображения.
- Внешняя fact-checking платформа.
- Пользовательский citation manager.
- Remote deploy без отдельного запроса.

