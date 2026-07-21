# Промт 04: учебный визуальный план и релевантность изображений

Ты работаешь в StudyDeck AI: `D:\presentation`.

Реализуй промт полностью. Перед изменениями прочитай `AGENTS.md`, `plans/future-presentation-quality/README.md`, текущие visual planning/image-search/canvas файлы и тесты. Не создавай альтернативный image pipeline.

## Цель

Для строгой учебной презентации на 5-10 минут система должна заранее выбрать, какой визуал помогает понять каждый тезис, а затем получить релевантное изображение или построить учебную диаграмму.

Реальный дефект: в автомобильной презентации изображения были только на 4 из 14 слайдов; часть фотографий не объясняла заявленную эпоху или конкретную модель, а остальные слайды повторяли текстовые композиции.

## Продуктовый контракт

- Аудитория: школа, колледж, вуз.
- Стиль: строгий учебный, без декоративных stock-photo ради заполнения места.
- Видимый текст короткий и самодостаточный.
- Для предметно богатой темы визуал должен присутствовать на 60-75% content slides, включая реальные фото и полезные диаграммы.
- Не более двух text-only content slides подряд.
- Summary может оставаться text-led.
- Конкретная сущность, эпоха, модель, место или событие должны быть отражены в query и alt text.
- Uploaded/repository/archive images имеют приоритет и не заменяются Tavily.
- Сетевые вызовы в тестах мокируются.

## Актуальные точки входа

- `apps/worker/src/tasks/presentation/planning/builders.ts`
- `apps/worker/src/tasks/presentation/prompts/builders.ts`
- `apps/worker/src/tasks/presentation/normalization/presentation.ts`
- `apps/worker/src/tasks/image-search.ts`
- `apps/worker/src/tasks/image-search.test.ts`
- `apps/worker/src/tasks/presentation-quality.ts`
- `apps/worker/src/tasks/presentation-quality.test.ts`
- `packages/shared/src/presentation/schemas.ts`
- `packages/shared/src/presentation/canvas-builder.ts`
- `apps/web/src/lib/presentation-display.ts`

Текущий код уже имеет `imageStrategy`, `visualPrompt`, `balanceDeterministicVisualDirections(...)`, 50-70% image band при grounded context, `shouldSearchForSlideImage(...)`, `buildSlideImageQuery(...)` и diagram strategy. Расширяй эти механизмы.

## Требуемая реализация

### 1. Сделай visual plan зависимым от slide job

Для каждого content slide классифицируй visual need:

- `documentary_photo`: человек, объект, место, событие, произведение, модель;
- `timeline`: история и последовательность;
- `comparison`: различия моделей/подходов;
- `process_or_cause`: механизм, процесс, причина-следствие;
- `evidence`: источник, документ, диаграмма фактов;
- `text_led`: абстрактный вывод, где изображение только отвлекает.

Сопоставь классификацию с существующими `imageStrategy`, `layoutIntent`, `visualRole` и `sceneTextMode`. Не добавляй новый публичный enum, если хватает текущих полей.

Для темы Porsche ожидаемый план мог бы выбрать:

- историческую фотографию/модель для происхождения;
- timeline поколений;
- comparison культовых версий;
- diagram для технической особенности;
- relevant modern photo для текущего состояния;
- text-led summary.

### 2. Усиль баланс визуалов

Обнови deterministic balancing:

- для concrete visual topics целевой диапазон 60-75% content slides с `real_photo` или `diagram`;
- учитывать успешно назначенные и реально сохранённые изображения, а не только design direction;
- не более двух последовательных `none` среди content slides;
- не превращать evidence/summary в случайные фотографии;
- если photo search не дал релевантный результат, предпочесть diagram/text-led layout вместо нерелевантного stock image.

Не считать uploaded evidence image недостатком или заменять его.

### 3. Сделай query конкретным

`buildSlideImageQuery(...)` должен включать:

- главную сущность проекта;
- slide-specific entity/model/person/place;
- era/year только если они есть в grounded content;
- visual intent (`historical photograph`, `technical diagram`, `comparison`) без общих слов `presentation image`;
- минимальное число лишних topic words.

Добавь query sanitizer и лимит длины, сохранив точные отличительные tokens. Для `Porsche 911 first generation` запрос не должен превращаться в общую современную фотографию Porsche.

### 4. Ранжируй кандидаты по релевантности

Перед выбором/скачиванием оцени кандидата по:

- совпадению entity/model/era tokens в title/description/source URL;
- наличию слов, противоречащих эпохе или модели;
- пригодности формата и размеров;
- source metadata.

Не добавляй отдельную платную модель только для каждого изображения. Сначала сделай детерминированный ranking. При нулевой уверенности переходи к следующему кандидату или safe fallback.

### 5. Добавь quality checks

Новые issues:

- visual coverage ниже целевого диапазона для concrete topic;
- три text-only content slides подряд;
- real-photo prompt не содержит slide-specific anchor;
- downloaded image metadata не содержит ни одного сильного anchor;
- один и тот же image/objectKey повторяется на разных слайдах без явного разрешения.

Issues должны быть repairable. Repair меняет design direction/query/layout, не пользовательский canvas.

### 6. Canvas и доступность

- Изображение получает точный alt text по слайду и candidate description.
- Кадрирование не должно скрывать главный объект; учитывать `contain`/`cover` по visual intent.
- Не размещать основной текст поверх фотографии в строгом учебном стиле.
- Photo attribution остаётся доступным для промта 07.

## Обязательные тесты

1. Concrete automotive deck получает 60-75% photo/diagram directions.
2. Нет трёх text-only content slides подряд.
3. Summary остаётся `none`.
4. Query для first-generation Porsche содержит model/era anchors.
5. Современный нерелевантный candidate проигрывает исторически релевантному.
6. Если релевантных candidates нет, система не берёт случайный stock result.
7. Existing uploaded image не заменяется.
8. Один objectKey не повторяется случайно на нескольких слайдах.
9. Visual coverage issue ремонтируется и проходит второй quality pass.
10. OpenAI/Yandex-independent deterministic behavior покрыт без сети.

## Проверка

```powershell
npm run build -w @studydeck/shared
npm run test -w @studydeck/shared
npm run test -w @studydeck/worker -- src/tasks/image-search.test.ts
npm run test -w @studydeck/worker -- src/tasks/presentation-quality.test.ts
npm run test -w @studydeck/worker -- src/tasks/presentation.test.ts
npm run typecheck -w @studydeck/worker
git diff --check
```

## Критерии готовности

- Визуальный ритм определяется содержанием, а не чередованием шаблонов.
- Concrete topics получают достаточно релевантных визуалов.
- Нерелевантное изображение не используется только ради заполнения места.
- Query сохраняет точную модель/эпоху/объект.
- Uploaded evidence images и custom canvas защищены.
- Пользователь не видит ошибку, если поиск не дал результат: выбирается безопасный diagram/text-led fallback.

## Не входит в задачу

- Обязательная генерация AI-иллюстрации для каждого слайда.
- Новый платный image provider.
- Полный редизайн тем.
- Отображение внутренних visual scores пользователю.
- Remote deploy без отдельного запроса.

