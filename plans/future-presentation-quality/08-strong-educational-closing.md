# Промт 08: сильный учебный итог вместо пустого финального слайда

Ты работаешь в StudyDeck AI: `D:\presentation`.

Реализуй этот промт полностью. Сначала прочитай `AGENTS.md`, `plans/future-presentation-quality/README.md`, narrative planning, prompts, normalization, quality и canvas code.

## Цель

Последний смысловой слайд должен отвечать на исходный вопрос презентации и оставлять 2-3 конкретных вывода. Отдельный слайд `Спасибо за внимание` не должен автоматически занимать место, если он не добавляет смысла.

Реальный дефект: Porsche deck завершался сначала ложным выводом про компромисс и взаимные риски, затем слайдом `Спасибо за внимание` с фрагментами про союзников и эскалацию. Текст выступления при этом содержал более подходящий общий итог.

## Продуктовый контракт

- Аудитория: школа, колледж, вуз.
- Длительность: 5-10 минут.
- Строгий учебный стиль.
- Слайды краткие, но понятные без выступающего.
- Финал не добавляет новые неподтверждённые факты.
- По умолчанию один сильный summary/takeaway slide завершает историю.
- Небольшая подпись `Спасибо` или `Вопросы?` допустима внутри summary, но не заменяет вывод.
- Пользователь не должен вручную исправлять generic ending.

## Актуальные точки входа

- `apps/worker/src/tasks/presentation/planning/builders.ts`
- `apps/worker/src/tasks/presentation/prompts/builders.ts`
- `apps/worker/src/tasks/presentation/normalization/presentation.ts`
- `apps/worker/src/tasks/presentation/quality/orchestration.ts`
- `apps/worker/src/tasks/presentation-quality.ts`
- `apps/worker/src/tasks/presentation-quality.test.ts`
- `packages/shared/src/presentation/canvas-builder.ts`
- `packages/shared/src/presentation/layouts.ts`
- `apps/worker/src/tasks/export.ts`
- `apps/worker/src/tasks/presentation.test.ts`

Сейчас есть `findWeakConclusionIssues(...)`, summary slide kind/layout, `sceneTextMode: takeaway`, summary canvas/template renderers. Усиль их, не создавая новый final-slide type.

## Требуемая реализация

### 1. Зафиксируй job последнего слайда в narrative plan

Последний смысловой narrative item обязан содержать:

- ответ на главный вопрос или центральный takeaway;
- 2-3 разных supporting conclusions;
- связь с темой и предыдущими slide jobs;
- отсутствие нового доказательства, которое раньше не раскрывалось;
- optional audience prompt (`Что важно запомнить?`, `Вопросы?`) только после вывода.

Для chronology/reference deck вывод может быть синтезом, а не рекомендацией.

### 2. Измени generation prompts

Явно запрети:

- generic final slide только с `Спасибо за внимание`;
- `Мы рассмотрели...` без ответа или синтеза;
- выводы, не поддержанные предыдущими слайдами;
- отдельные sentence fragments в supporting slots;
- повтор заголовка проекта вместо заключения.

Попроси модель писать audience-facing conclusion, который можно понять без speaker notes.

### 3. Усиль deterministic conclusion check

Расширь `hasWeakConclusion(...)` / `findWeakConclusionIssues(...)`:

- title/thesis/bullets должны содержать topic anchors;
- main conclusion должен быть законченным утверждением;
- supporting points не дублируют друг друга;
- conclusion должен пересекаться минимум с двумя ключевыми narrative beats для deck длиной 5+ slides;
- `Спасибо`, `Вопросы?`, `Мы рассмотрели` сами по себе не считаются conclusion;
- off-topic conclusion получает `major/off_topic`, generic conclusion - `major/bad_narration` или существующую подходящую category.

Не требовать слова `итог` или `вывод`: человеческий финал может быть сформулирован иначе.

### 4. Targeted repair

Repair строит финал из:

1. принятого narration последнего слайда;
2. центрального takeaway проекта;
3. distinct key messages предыдущих narrative items;
4. grounded sources без новых фактов.

Результат:

- один короткий main conclusion;
- 2-3 supporting points;
- optional small `Спасибо`/`Вопросы?`;
- согласованные `speakerNotes` и `speechScript`;
- regenerated summary canvas.

Если deck уже содержит отдельный пустой thank-you slide на этапе новой генерации, удалить/слить его до фиксации slide contract и синхронно обновить slide count, outline, narrative plan и speech script. Не удалять слайды из старой сохранённой или вручную отредактированной презентации во время просмотра/экспорта.

### 5. Summary layout

- Главный вывод является визуальным центром.
- Supporting points читаются как 2-3 кратких доказанных следствия.
- Не использовать узкую колонку с обрывками.
- Не повторять декоративный card grid без необходимости.
- Source credits остаются видимыми, если вывод содержит конкретные claims.

## Обязательные тесты

1. Слайд только с `Спасибо за внимание` определяется как weak conclusion.
2. `Мы рассмотрели историю...` без вывода определяется как weak.
3. Geopolitical conclusion в Porsche project определяется как off-topic.
4. Topic-specific synthesis с 2-3 distinct takeaways проходит.
5. Не требуется буквальное слово `итог`.
6. Repair использует предыдущие narrative beats и не придумывает новый факт.
7. Empty thank-you slide сливается только в new-generation pipeline с синхронным обновлением всех order/count structures.
8. Старый пользовательский deck не теряет последний слайд при export/view.
9. Generated summary canvas проходит typography/overflow audit.
10. Speaker notes расширяют conclusion и не противоречат visible text.

## Проверка

```powershell
npm run build -w @studydeck/shared
npm run test -w @studydeck/shared
npm run test -w @studydeck/worker -- src/tasks/presentation-quality.test.ts
npm run test -w @studydeck/worker -- src/tasks/presentation.test.ts
npm run test -w @studydeck/worker -- src/tasks/export.test.ts
npm run typecheck -w @studydeck/worker
git diff --check
```

## Критерии готовности

- Новая 5-10-минутная презентация заканчивается смысловым summary.
- Финал отвечает на исходную тему и понятен без речи.
- `Спасибо` не заменяет вывод.
- Off-topic и fragment endings автоматически исправляются.
- Repair сохраняет accepted narration/source grounding и schema consistency.
- Старые и вручную отредактированные decks не теряют слайды.

## Не входит в задачу

- Обязательный CTA для учебных презентаций.
- Анимация финального слайда.
- UI для выбора типа окончания.
- Перестройка старых презентаций.
- Remote deploy без отдельного запроса.

