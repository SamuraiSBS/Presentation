# Промт 02: семантическое соответствие слайда и текста выступления

Ты работаешь в монорепозитории StudyDeck AI: `D:\presentation`.

Реализуй этот промт полностью в новом чате. Сначала прочитай `AGENTS.md`, `plans/future-presentation-quality/README.md` и актуальные затрагиваемые файлы. Не создавай новый план вместо реализации.

## Цель

Для каждого номера слайда видимый текст, `speakerNotes`, элемент `speechScript` и соответствующая секция принятого `generatedText` должны раскрывать одну и ту же мысль.

Реальный дефект: DOCX с речью правильно рассказывал о текущем влиянии и будущем Porsche 911, а слайды с теми же номерами говорили о международном конфликте. Экспорт технически отработал успешно и закрепил расхождение.

## Продуктовый контракт

- Аудитория: школа, колледж, вуз.
- Выступление: 5-10 минут.
- Стиль: строгий учебный.
- Слайд должен быть кратким, но самодостаточным.
- Речь расширяет слайд примером и объяснением, а не меняет его тему.
- `generatedText`/accepted narration остаётся главным источником истины.
- Расхождения исправляются автоматически, без пользовательских предупреждающих экранов.
- Не менять пользовательский custom canvas.

## Актуальные точки входа

- `apps/worker/src/tasks/presentation/quality/orchestration.ts`
- `apps/worker/src/tasks/presentation-quality.ts`
- `apps/worker/src/tasks/presentation-quality.test.ts`
- `apps/worker/src/tasks/presentation/narration/processing.ts`
- `apps/worker/src/tasks/presentation/normalization/presentation.ts`
- `apps/worker/src/tasks/presentation/planning/builders.ts`
- `apps/worker/src/tasks/presentation/prompts/builders.ts`
- `apps/worker/src/tasks/presentation.test.ts`

В текущем коде уже есть `preserveAcceptedNarration(...)`, parsing narration sections, quality repair и восстановление canvas. Расширяй эти seams, не создавай параллельные поля речи.

## Требуемая реализация

### 1. Сформируй per-slide semantic contract

Добавь внутреннее представление наподобие:

```ts
type SlideSemanticContract = {
  slideOrder: number;
  narrativeTitle: string;
  keyMessage: string;
  acceptedNarration: string;
  speakerNotes: string;
  speechScript: string;
  visibleText: string;
};
```

Строить его после нормализации narration sections и до окончательного canvas/export readiness pass.

Проверь строгие структурные инварианты:

- один speechScript item на каждый slide order;
- совпадение `slideTitle` с актуальным названием слайда после нормализации;
- непустые accepted narration, notes и script для content slides;
- отсутствие сдвига на один слайд;
- сохранение порядка после selective repair.

### 2. Добавь детерминированный alignment score

Сравни значимые токены и смысловые anchors между:

- visible text и accepted narration;
- visible text и narrative key message;
- speakerNotes и speechScript;
- notes/script и accepted narration.

Короткий слайд не обязан повторять все слова речи. Хороший visible text считается согласованным, если он выражает центральный тезис и содержит достаточно anchors. Для title/summary использовать отдельные мягкие пороги.

Добавь функции наподобие:

```ts
scoreSlideSpeechAlignment(...)
findSlideSpeechAlignmentIssues(...)
```

Используй существующие category `off_topic` или `bad_narration` в зависимости от повреждённой стороны. Не расширяй schema без необходимости.

### 3. Определи правильное направление repair

- Если accepted narration, notes и script согласованы, а visible text нет: переписывать visible text.
- Если visible text и accepted narration согласованы, а notes/script повреждены: восстанавливать notes и script из accepted narration.
- Если один `speechScript` item сдвинут или отсутствует: восстановить структуру по slide order.
- Если сам accepted narration невалиден, передать проблему существующему narration repair, а не угадывать содержание из слайда.

Никогда не переписывать хороший accepted narration так, чтобы он соответствовал постороннему visible text.

### 4. Сделай слайды краткими и самодостаточными

Repair visible text должен создавать:

- topic-specific title;
- один законченный тезис;
- 2-3 коротких пункта только если они добавляют смысл;
- понятные существительные вместо местоимений без контекста;
- никаких фраз `это показывает`, `эта модель`, `данный процесс`, если объект не назван на самом слайде.

Речь должна добавлять контекст, пример или причинно-следственную связь и не быть дословной копией visible text.

### 5. Интегрируй в существующий repair loop

- Выполнять alignment check после `preserveAcceptedNarration(...)` и после каждого repair/fallback branch.
- Rebuild только generated canvas затронутых слайдов.
- После repair снова выполнить schema, alignment, topic relevance, duplicate и export-readiness checks.
- Ограничить число модельных попыток существующим max repair attempts.
- При недоступности модели применить детерминированное сокращение полного предложения из matching narration.

## Обязательные тесты

1. Correct Porsche notes + geopolitical visible text создают alignment issue.
2. Repair меняет только visible fields и generated canvas.
3. `speakerNotes`, `speechScript` и canonical `generatedText` сохраняются.
4. Сдвинутый speechScript order обнаруживается и восстанавливается.
5. Краткий заголовок с синонимом, но правильным смыслом не даёт false positive.
6. Видимый текст не становится дословной длинной копией notes.
7. Слайд после repair понятен без местоимений с потерянным контекстом.
8. Custom canvas остаётся неизменным.
9. Второй quality pass не создаёт повторный alignment issue.

## Проверка

```powershell
npm run build -w @studydeck/shared
npm run test -w @studydeck/worker -- src/tasks/presentation-quality.test.ts
npm run test -w @studydeck/worker -- src/tasks/presentation.test.ts
npm run typecheck -w @studydeck/worker
git diff --check
```

## Критерии готовности

- Каждый slide order имеет один согласованный narrative/narration/notes/script/visible contract.
- Повреждённая сторона восстанавливается из правильного источника истины.
- Слайды краткие, но понятны без докладчика.
- Речь добавляет содержание, а не повторяет слайд дословно.
- Пользователь не видит техническую ошибку или блокирующий quality flow.

## Не входит в задачу

- Редизайн редактора.
- Изменение количества слайдов после пользовательской ручной правки.
- Проверка всех фактов по интернету.
- Новая база данных или Prisma migration.
- Remote deploy без отдельного запроса.

