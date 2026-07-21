# 08. Исправление контракта «число слайдов → длительность речи»

## Роль этого задания

Работай в репозитории `D:\presentation`. План 02 (speech director) уже реализован. Не откатывай и не переписывай его целиком: сначала проверь текущую реализацию и внеси узкую корректировку, чтобы она точно соответствовала выбору объёма в форме создания проекта.

Это изменение относится только к **новым генерациям**. Не мигрируй и не блокируй старые, импортированные, display/export или уже готовые проекты.

## Обязательный продуктовый контракт

Карточки выбора объёма в `apps/web/src/components/new-project-form.tsx` — источник истины для пользователя:

| Слайдов | Подпись | Длительность выступления |
| --- | --- | --- |
| 6 | Короткое выступление | 5–7 минут |
| 8 | Доклад на паре | 7–9 минут |
| 10 | Обычная презентация | 10–12 минут |
| 12 | Подробный доклад | 12–15 минут |
| 14 | Защита проекта | от 15 минут |

Не сохраняй старое глобальное правило «7–10 минут для любого deck». В частности, 10 слайдов не должны быть отклонены как слишком длинные при 10–12 минутах, а 14 слайдов не должны считаться готовыми при 10 минутах.

## Сначала изучи

- `packages/shared/src/generation/speech-timing.ts` и его exports в `packages/shared/src/index.ts`;
- `apps/worker/src/tasks/presentation-quality.ts` — `findSpeechTimingIssues`;
- `apps/worker/src/tasks/presentation/prompts/builders.ts` — narrative/speech prompts;
- `apps/worker/src/tasks/presentation/planning/builders.ts` — `speechWordTarget`;
- `apps/worker/src/tasks/presentation/narration/processing.ts`;
- `apps/web/src/components/new-project-form.tsx` — `slideOptions` и `studentPrompt`;
- тесты shared, worker quality/presentation и web form, которые уже появились после prompt 02.

Перед редактированием выполни `git -c safe.directory=D:/presentation status --short`. Рабочее дерево может содержать незакоммиченную реализацию prompt 02: считай её исходной точкой, не удаляй её изменения и не перезаписывай чужие правки.

## Что исправить

### 1. Единый typed preset в shared

В `packages/shared` создай или доработай единственный экспортируемый источник истины, например `getRussianStudentSpeechTimingBudget(project)`.

- Он возвращает named preset для новых student/university generation с точным `slideCount` 6, 8, 10, 12 или 14.
- Preset содержит: видимый label, min/target/max minutes (или `minMinutes` и отсутствующий hard max для 14), words-per-minute, min/target/max words, а также budget для title/content/conclusion.
- Используй одну документированную константу скорости русской устной речи. Не дублируй расчёты в web и worker.
- Число слов вычисляй из минут и скорости речи; не оставляй старые clamp `900–1200`, которые делают 10–14 слайдов неверными.
- Для 14 слайдов соблюдай буквальное «от 15 минут»: quality gate обязан ловить только недобор относительно 15 минут. Не выдумывай пользовательский верхний предел. Если для защиты от runaway нужен технический ceiling, он не должен превращать UI-обещание в другой диапазон и должен быть ясно документирован.
- Для count, которого нет среди карточек, не подставляй тайно «7–10 минут». Выбери и задокументируй безопасное поведение: вернуть `null` и не применять preset-quality gate, либо отдельный явно согласованный interpolation policy. В этом задании предпочтителен `null`, пока продукт не покажет пользователю обещание для такого count.
- Возвращай `null` для legacy/display/export/imported mode и неподходящих аудиторий, как уже требует план 02.

### 2. Один контракт в UI, prompt и quality gate

- `slideOptions` не должны быть вторым вручную поддерживаемым набором минут. Используй shared preset везде, где это возможно в границах Next.js; если прямой импорт нежелателен, добавь test, сравнивающий локальные UI labels с shared contract.
- `studentPrompt`, narrative plan prompt и speech generation prompt обязаны явно получать требуемую длительность выбранного варианта и соответствующий word target. Модель не должна сама угадывать, чем «обычная презентация» отличается от «подробного доклада».
- `speechWordTarget` распределяй по ролям. Обложка и conclusion короче content slides; сумма targets должна соответствовать target word budget данного preset.
- `findSpeechTimingIssues` проверяет правильный min/max каждого выбранного preset. Текст внутреннего issue/recovery сообщает конкретный диапазон, а не зашитые 7–10 минут.
- Не меняй на этой задаче договорённость, что visible slides краткие, а полный объём остаётся в `generatedText`, `speakerNotes` и `speechScript`.

### 3. Совместимость и корректность данных

- `accepted narration/generatedText` остаётся source of truth; timing repair не заменяет полный текст коротким ответом модели.
- После repair синхронизируй `speakerNotes`, `speechScript` и вход DOCX export.
- Не меняй существующие лимиты создания проекта, billing maxSlides или defence workspace. Это только обычный student creation flow.
- Не добавляй пользователю новый обязательный выбор длительности: он уже выбрал её через карточку числа слайдов на скриншоте.

## Обязательные тесты

Добавь table-driven unit tests в shared и integration/quality tests в worker. Минимальный набор:

1. Ровно 6, 8, 10, 12 и 14 слайдов возвращают соответственно 5–7, 7–9, 10–12, 12–15 и min 15 минут.
2. 6 слайдов больше не выключены из контроля времени.
3. Для 10 слайдов текст на 9.9 минуты получает blocker, на 10–12 проходит, на 12.1 получает blocker.
4. Для 12 слайдов 12–15 проходит; 10-минутная речь не проходит.
5. Для 14 слайдов речь короче 15 минут не проходит, а речь длиннее 15 не получает искусственный hard-max blocker.
6. `studentPrompt`/narration prompt для каждого preset содержит правильную минутную цель и не содержит противоречащего «7–10 минут».
7. Сумма `speechWordTarget` близка к target word budget, а title/conclusion не получают content budget.
8. 7, 9, 11, 13, 4, 20 слайдов не получают скрытый preset 7–10; legacy/export/imported docs также не получают timing blocker.
9. Regression: старый helper с `Math.max(900,...)` / `Math.min(1200,...)` не может вернуться.

Проверь границы по словам без округлительных флапов: определите один policy для дробных минут и используй его во всех тестах.

## Команды проверки

```powershell
npm run build -w @studydeck/shared
npm run test -w @studydeck/shared
npm run test -w @studydeck/worker -- src/tasks/presentation-quality.test.ts
npm run test -w @studydeck/worker -- src/tasks/presentation.test.ts
npm run typecheck -w @studydeck/worker
npm run typecheck -w @studydeck/web
git diff --check
```

Если есть тест для `new-project-form`, добавь его в запуск. Не заявляй, что browser UI проверен, если не поднимал web preview.

## Критерии приёмки

- Карточка 6/8/10/12/14, prompt, narration plan и final quality gate используют один и тот же временной контракт.
- 6 → 5–7, 8 → 7–9, 10 → 10–12, 12 → 12–15, 14 → минимум 15 минут.
- Новая презентация не становится `ready`, если её речь не соответствует выбранному объёму.
- Старые/импортированные deck и неподдерживаемые промежуточные counts не получают ложный blocker.
- Исправление сохраняет результаты plan 02: естественную речь, quality repair и согласованность `generatedText` / `speakerNotes` / `speechScript`.

В финальном отчёте перечисли текущую найденную реализацию, изменённые файлы, точную таблицу word budgets, результаты тестов и любые сознательно оставленные ограничения.
