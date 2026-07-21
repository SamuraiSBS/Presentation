# Промт 03: контроль повторов, обрывков и шаблонного текста

Ты работаешь в StudyDeck AI по адресу `D:\presentation`.

Реализуй этот промт полностью. Перед изменениями прочитай `AGENTS.md`, `plans/future-presentation-quality/README.md`, текущие quality helpers и тесты. Не ограничивайся рекомендациями.

## Цель

Новые презентации не должны содержать:

- незаконченные предложения;
- отдельные зависимые фрагменты со строчной буквы;
- повтор одного тезиса в thesis и bullets;
- одинаковые мысли на соседних или удалённых слайдах;
- многократные формулы `инновации, стиль, мощность, уникальные особенности` без нового содержания;
- шаблонные фразы, которые формально проходят текущий banned-phrase filter.

Реальные дефекты Porsche fixture:

- `Porsche 911 показал.`;
- предложение, заканчивающееся на `в.`;
- `продолжая вдохновлять и удивлять своими.`;
- отдельные lowercase fragments на итоговом слайде;
- повтор одного предложения на слайдах про эволюцию и первое поколение;
- одна и та же общая мысль на нескольких слайдах.

## Продуктовый контракт

- Аудитория: школа, колледж, вуз.
- Длительность: 5-10 минут.
- Строгий учебный стиль.
- Мало текста, но каждое поле содержит законченный и самостоятельный смысл.
- Очевидные дефекты исправляются локально и детерминированно, когда это безопасно.
- Модельный repair применяется только там, где требуется переформулировать смысл.
- Пользователь не должен разбираться с quality warning.

## Актуальные точки входа

- `apps/worker/src/tasks/presentation-quality.ts`
- `apps/worker/src/tasks/presentation-quality.test.ts`
- `apps/worker/src/tasks/presentation/quality/orchestration.ts`
- `apps/worker/src/tasks/presentation/normalization/presentation.ts`
- `apps/worker/src/tasks/presentation/narration/processing.ts`
- `apps/worker/src/tasks/presentation/constants.ts`
- `apps/worker/src/tasks/presentation.test.ts`

Сейчас существуют `findDuplicateSlideIssues(...)`, `hasRepeatedSentenceStart(...)`, length checks, generic/meta checks, `looksLikeSentenceFragment(...)` и visible-text repair. Расширяй их без второго набора конкурирующих правил.

## Требуемая реализация

### 1. Проверка целостности каждого visible field

Добавь функцию наподобие:

```ts
findVisibleTextIntegrityIssues(presentation): QualityIssue[]
```

Проверять title, thesis, bullets, text/bullet blocks, definition и visual labels.

Высоконадежные признаки обрывка:

- окончание на короткий предлог/союз: `в`, `на`, `и`, `но`, `для`, `к`, `с`, `of`, `to`, `and`;
- грамматически зависимое начало со строчной буквы после отдельного layout slot;
- 1-3 слова без самостоятельного смысла в content slot;
- незакрытые скобки/кавычки;
- предложение заканчивается на глагол или конструкцию, явно требующую дополнения, только когда это можно определить без риска;
- текст после очистки состоит только из project-title echo и служебной связки.

Не требуй точку у короткого заголовка или label. Различай title, label, bullet и full-sentence thesis.

### 2. Проверка повторов внутри слайда

Обнаруживать:

- exact/normalized duplicate между thesis и bullet;
- один bullet, повторённый в blocks или visual items;
- повтор заголовка в thesis без нового утверждения;
- две фразы, отличающиеся только вводными словами.

Удалять безопасный exact duplicate детерминированно. Если после удаления layout становится слишком пустым, переключить layout или построить новый короткий пункт из accepted narration.

### 3. Проверка deck-wide смысловых повторов

Текущий adjacent Jaccard check недостаточен. Добавь deck-wide сравнение key-message signatures:

- title + thesis + meaningful bullets;
- исключить общие topic anchors, чтобы повтор слова `Porsche` сам по себе не считался дефектом;
- сравнивать не только соседние слайды;
- повышать severity, если повторяется центральное утверждение без нового примера, этапа, причины или следствия.

Не объединяй законные повторения терминов и определения. Timeline stages с общей сущностью должны проходить, если даты/этапы/изменения различаются.

### 4. Targeted repair

Для каждого issue сформировать конкретную instruction:

- завершить фразу из matching accepted narration;
- удалить exact duplicate;
- заменить общий тезис на distinct slide job из narrative plan;
- сохранить факты и sourceRefs;
- не добавлять неподтверждённые даты и числа.

После repair:

- нормализовать visible fields;
- пересобрать generated canvas;
- повторно запустить integrity, duplicate, topic-alignment и schema checks;
- не изменять custom canvas.

### 5. Улучши prompt shaping

В generation/repair prompts явно потребовать:

- каждое отдельное поле является законченной аудиторной формулировкой;
- bullets нельзя начинать как продолжение предыдущего предложения;
- один slide job и один distinct takeaway на слайд;
- не повторять generic descriptors без конкретного объекта, механизма или последствия.

## Обязательные тесты

1. `Porsche 911 показал.` определяется как fragment.
2. `Это позволит модели оставаться одной из самых желанных в.` определяется как fragment.
3. `продолжая вдохновлять и удивлять своими.` в отдельном slot определяется как fragment.
4. Короткий label `1963` или `Carrera RS` не считается fragment.
5. Exact duplicate thesis/bullet удаляется без потери schema validity.
6. Одинаковая мысль на слайдах 3 и 9 определяется deck-wide.
7. Timeline stages с одной сущностью, но разными событиями проходят.
8. Repair сохраняет speakerNotes, speechScript и sourceRefs.
9. Custom canvas не меняется.
10. Повторный quality pass не возвращает исправленные issues.

## Проверка

```powershell
npm run test -w @studydeck/worker -- src/tasks/presentation-quality.test.ts
npm run test -w @studydeck/worker -- src/tasks/presentation.test.ts
npm run typecheck -w @studydeck/worker
git diff --check
```

## Критерии готовности

- Все отдельные visible slots содержат законченный смысл.
- Exact duplicates удаляются безопасно.
- Deck-wide повтор центральной мысли обнаруживается даже не на соседних слайдах.
- Корректные повторяющиеся термины не дают массовых false positives.
- Repair не делает речь беднее и не трогает пользовательские canvas.
- Пользователь получает готовую презентацию без блокирующего предупреждения.

## Не входит в задачу

- Полноценный grammar checker или новая внешняя NLP-служба.
- Переписывание всей речи только ради стилистического разнообразия.
- UI для ручного подтверждения каждого исправления.
- Remote deploy без отдельного запроса.

