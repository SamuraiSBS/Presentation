# Промт 01: тематическая релевантность и незаметное исправление

Ты работаешь в монорепозитории StudyDeck AI: `D:\presentation`.

Реализуй этот промт полностью. Не создавай новый план и не ограничивайся аудитом. Сначала прочитай `AGENTS.md`, `plans/future-presentation-quality/README.md` и актуальные файлы, перечисленные ниже.

## Цель

Новая учебная презентация не должна содержать текст из другой темы, даже если провайдер вернул смешанный ответ или поздний repair восстановил старый шаблонный текст.

Реальный дефект: в презентации о Porsche 911 появились формулировки про международную напряжённость, решения лидеров, переговоры, локальный конфликт и мировой кризис. Отдельный текст выступления при этом оставался тематически корректным.

Проблема должна исправляться автоматически до сохранения. Пользователь не должен видеть ошибку, экран блокировки или просьбу вручную исправить презентацию.

## Продуктовые ограничения

- Аудитория: школа, колледж, вуз.
- Длительность: 5-10 минут.
- Стиль: строгий учебный.
- Видимый текст краткий, но понятный без речи.
- OpenAI, Yandex и demo fallback сохраняются.
- Исправимые off-topic ошибки используют repair-and-continue.
- Если модельный repair недоступен, построить безопасный тематический visible text из уже принятой речи или narrative plan.
- Не переписывать пользовательский custom canvas.
- Не мигрировать старые презентации.

## Актуальные точки входа

- `apps/worker/src/tasks/presentation-quality.ts`
- `apps/worker/src/tasks/presentation-quality.test.ts`
- `apps/worker/src/tasks/presentation/quality/orchestration.ts`
- `apps/worker/src/tasks/presentation/normalization/presentation.ts`
- `apps/worker/src/tasks/presentation/narration/processing.ts`
- `apps/worker/src/tasks/presentation/planning/builders.ts`
- `apps/worker/src/tasks/presentation.test.ts`
- `packages/shared/src/presentation/schemas.ts`

Сейчас category `off_topic` уже существует, но детерминированная критика в основном проверяет generic/meta текст, длину, соседние дубликаты и factual risk. Не создавай второй quality pipeline.

## Требуемая реализация

### 1. Построй тематический профиль проекта

Добавь компактный внутренний тип наподобие `TopicProfile`, который собирается из:

- `project.title` и `project.prompt`;
- релевантных полей `generationBrief`;
- `researchBrief.topic`, `angle`, `vocabulary`, если они доступны;
- заголовков и key messages `narrativePlan`;
- коротких source titles/excerpts без логирования полного пользовательского текста.

Профиль должен содержать нормализованные значимые токены и устойчивые topic anchors. Используй существующие helpers нормализации и стоп-слова. Не добавляй тяжёлую NLP-зависимость.

Учитывай русские словоформы без попытки реализовать полноценную морфологию: нормализация регистра, `ё/е`, пунктуации и разумные stem-like префиксы допустимы. Проверка не должна считать off-topic короткий переходный или титульный слайд только из-за малого количества токенов.

### 2. Добавь детерминированную проверку cross-topic leakage

Добавь экспортируемую функцию, например:

```ts
findTopicRelevanceIssues(presentation, project): QualityIssue[]
```

Для каждого слайда сравни:

- title/thesis/bullets/blocks;
- speakerNotes и соответствующий `speechScript`;
- matching narrative-plan item;
- общий topic profile.

Считать проблему `major/off_topic`, когда выполнено одно из условий:

- видимый текст имеет сильные признаки другого домена и почти не содержит topic anchors;
- visible text противоречит тематически корректным notes/script;
- несколько полей одного слайда согласованно уводят историю в постороннюю тему;
- в одной части слайда есть topic echo, но остальные фразы явно относятся к другому сюжету.

Не использовать одну глобальную таблицу запрещённых слов как основной механизм. Слова `конфликт`, `рынок`, `кризис` могут быть корректны для других учебных тем. Нужен контекстный сигнал: project anchors + narrative item + narration.

### 3. Включи проверку в существующий quality score

Добавь issues в `critiquePresentationDeterministically(...)` и в targeted repair. Не меняй публичный enum category, если `off_topic` уже покрывает задачу.

Model critic должен получать project topic, краткий narrative plan и только необходимые slide fields. Запрети модели считать тематически корректным текст, который повторяет название проекта, но затем раскрывает другой сюжет.

### 4. Сделай repair незаметным

Порядок восстановления для off-topic visible text:

1. Сохранить принятые `generatedText`, `speakerNotes` и `speechScript`.
2. Переписать только title/thesis/bullets/blocks/visual labels затронутого слайда на основе matching narration и narrative plan.
3. Перенормализовать и перестроить только generated canvas этого слайда.
4. Повторно выполнить topic relevance и schema validation.
5. Если модельный repair не помог, детерминированно создать короткий законченный тезис и 2-3 смысловых пункта из корректных предложений accepted narration.
6. Сохранить лучший валидный вариант и записать структурированный warning без полного пользовательского текста.

Не восстанавливай off-topic fallback из исходного повреждённого visible text. Не изменяй правильную речь, чтобы она стала соответствовать неправильному слайду.

### 5. Наблюдаемость

Логировать:

- `projectId`, provider, slide order;
- issue category и repair strategy;
- score до/после;
- число repaired slides;
- fallback source: `model`, `accepted_narration`, `narrative_plan`.

Не логировать полный prompt, source excerpt или текст речи.

## Обязательные тесты

Добавь компактный Porsche fixture без внешних файлов:

- project title: история Porsche 911;
- корректные notes про современное влияние модели;
- visible thesis: `Контекст показывает, почему локальный конфликт стал мировым кризисом.`;
- bullets про решения лидеров и переговоры.

Проверить:

1. Детектор создаёт `major/off_topic`.
2. Одного topic echo в начале плохой фразы недостаточно, чтобы issue исчез.
3. Repair заменяет visible text и сохраняет правильные notes/script.
4. Результат проходит `presentationSchema.parse(...)`.
5. Custom canvas не меняется.
6. Тема, где конфликт действительно является предметом презентации, не даёт false positive.
7. Титульный слайд с коротким названием не считается off-topic.
8. Demo fallback остаётся детерминированным и валидным.

## Проверка

```powershell
npm run build -w @studydeck/shared
npm run test -w @studydeck/worker -- src/tasks/presentation-quality.test.ts
npm run test -w @studydeck/worker -- src/tasks/presentation.test.ts
npm run typecheck -w @studydeck/worker
git diff --check
```

## Критерии готовности

- Porsche fixture не может сохраниться с геополитическим visible text.
- Правильная принятая речь остаётся источником истины.
- Исправление не требует действий пользователя.
- Валидная презентация на тему конфликта не ломается.
- Повторный quality pass больше не видит off-topic issue.
- Старые документы и пользовательские canvas не переписываются.

## Не входит в задачу

- UI для показа quality score.
- Блокировка экспорта диалогом.
- Полная система fact-checking.
- Новая векторная база или внешняя NLP-служба.
- Remote deploy без отдельного запроса.

