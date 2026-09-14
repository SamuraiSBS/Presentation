# План-промт 02: бесплатный text-lift прототип на референсах

Ты работаешь в `D:\presentation`. Реализуй локальный исследовательский прототип восстановления редактируемого текста из готового raster-слайда. Не подключай его к production generation и не запускай никакие платные AI/search/vision вызовы.

## Перед началом

Полностью прочитай:

- `D:\presentation\AGENTS.md`;
- `D:\presentation\plans\image-first-editable-slides-v1\00-product-contract.md`;
- `D:\presentation\plans\image-first-editable-slides-v1\01-content-lock-and-economics.md`;
- `D:\presentation\plans\image-first-editable-slides-v1\reports\01-content-lock-and-economics.md`;
- актуальный native canvas/editor/export renderer;
- содержимое `D:\presentation\референц слайдов`.

Выполни `git status` и сохрани все чужие изменения. Отчёт Плана 01 должен иметь `FOUNDATION ACCEPTED`. Если его нет, не реализуй этот этап: зафиксируй `RECONSTRUCTION BLOCKED BY FOUNDATION` и вернись в отдельный remediation-чат Плана 01. Последовательность пакета нельзя обходить даже бесплатным lab, потому что exact-string и semantic-zone contracts являются входом реконструкции.

## Цель

Бесплатно доказать или опровергнуть центральную гипотезу:

> цельный raster-слайд с текстом можно локально преобразовать в визуально близкий слайд, где исходные точные строки являются native editable text, а raster-текст удалён без заметных заплаток.

Источник слов — не OCR. В production точные строки уже будут известны из `DeckContentLock`. OCR/CV нужен для геометрии, line boxes, стиля, наличия лишнего текста и проверки очистки.

## Scope

Разрешено:

- добавить изолированный lab/script/fixtures/tests;
- использовать уже установленные локальные библиотеки и `sharp`;
- использовать бесплатный локальный OCR/CV engine, если он уже доступен или может быть добавлен без облачного API;
- создавать артефакты под `.codex-artifacts/image-first-editable-slides-v1/reference-lab/`;
- использовать native canvas/PDF/PPTX primitives проекта.

Запрещено:

- изменять production routing;
- вызывать GPT Image, Luna, vision API, Tavily или другой платный сервис;
- портить исходные файлы в `референц слайдов`;
- считать ручную маску доказательством полностью автоматического production пути;
- подменять провал белым bullet-template;
- добавлять тяжёлую зависимость без проверки существующего стека и объяснения необходимости.

## Этап 1. Инвентаризация и gold fixtures

1. Перечисли фактические PNG/JPEG в reference folder, их размеры, цветовой профиль и hash. Не полагайся на старое число файлов.
2. Сохрани source images read-only; работай с копиями/буферами.
3. Для каждого слайда вручную зафиксируй gold semantic fixture:
   - точные видимые смысловые строки;
   - semantic IDs;
   - тип: title, thesis, conclusion, label, number, date, decorative;
   - приблизительная gold zone;
   - что должно остаться raster decoration, а что должно стать native text.
4. Decorative microtext или watermark не переносить как смысловой editable content, но фиксировать для контроля unexpected text.
5. Если отдельный символ нельзя уверенно прочитать, пометь его как unresolved и не выдавай OCR-догадку за точный текст.

Для автоматической количественной приёмки нужен gold set. Начни с одного репрезентативного слайда, затем прогони весь фактический набор.

## Этап 2. Геометрия: planned zones first, OCR/CV second

Спроектируй API так, чтобы production-вход принимал:

- точные строки и semantic IDs;
- planned semantic zones из deck blueprint;
- raster 16:9;
- visual family typography tokens.

Алгоритм:

1. Planned zone задаёт допустимую область поиска и безопасный layout envelope.
2. Локальный OCR/CV ищет word/line boxes внутри и рядом с zone.
3. Fuzzy matching сопоставляет распознанные куски с уже известной строкой, но не заменяет ею источник истины.
4. Определяются line count, baseline, alignment, примерный font size/weight/color и направление чтения.
5. Неизвестный посторонний текст вне разрешённых semantic IDs создаёт hard diagnostic.
6. Для reference fixtures, где production planned zones ещё не существовали, gold zones играют роль plan input; отдельно измерь, насколько CV может уточнить их автоматически.

Сохраняй confidence по каждому блоку и причину fallback. Не объединяй соседние подписи только потому, что OCR их склеил.

## Этап 3. Локальная очистка raster-текста

1. Построй mask по подтверждённым glyph/line boxes с контролируемым padding.
2. Не меняй пиксели вне расширенной mask, кроме технически объяснимого anti-alias boundary.
3. Используй локальный deterministic/inpainting метод без внешнего AI API.
4. После очистки снова запусти локальное text detection:
   - читаемые ghost-буквы запрещены;
   - фрагменты цифр/формул запрещены;
   - заметные однотонные «заплатки» и сломанные контуры создают visual failure.
5. Сохраняй mask, cleaned background, diff heatmap и diagnostics для каждого fixture.

Не выполняй второй image call и не используй облачный image edit.

## Этап 4. Нативное восстановление

1. Наложи исходные exact gold strings как отдельные native text elements.
2. Используй ближайший реально поддерживаемый font из visual family; не rasterize текст обратно.
3. Сохрани иерархию, alignment, line count и ритм исходной композиции настолько близко, насколько это возможно без потери читаемости.
4. Все labels/dates/numbers, которые имеют смысл, остаются отдельными editable elements.
5. Номер страницы создаётся нативно и locked.
6. Background locked; смысловой текст editable.
7. Один и тот же canonical canvas используется в editor, PDF и PPTX.

Проверь замену каждой строки коротким и длинным значением. Reflow не должен автоматически вызывать модель.

## Этап 5. Хороший native fallback

Для каждого вида failure создай бесплатный fallback renderer той же visual family:

- OCR/geometry confidence ниже порога;
- очищенная зона повреждает композицию;
- остался неожиданный raster text;
- exact text не помещается в безопасные размеры;
- исходный слайд содержит конфликтующую точную таблицу/формулу;
- export parity нарушен.

Fallback должен:

- использовать exact strings;
- быть полностью нативным;
- сохранять palette/typography/visual mood;
- иметь цельную flat/editorial composition;
- не использовать универсальную сетку карточек;
- не печатать диагностику на слайде.

Сделай минимум несколько разных archetypes, чтобы последовательные fallback-слайды не выглядели одинаковым шаблоном.

## Этап 6. Измеримая приёмка

Для каждого reference slide сохрани side-by-side:

```text
original | detected zones | mask | cleaned background | native reconstruction | fallback
```

Минимальные hard checks:

- 100% зафиксированных смысловых строк представлены native editable elements;
- итоговый native текст byte/Unicode-normalized exact с gold fixture;
- raster background после очистки не содержит читаемых дубликатов смыслового текста;
- за пределами расширенных mask исходные пиксели не изменены необъяснимо;
- нет overflow, overlap и разрушительного crop в эталонной строке;
- web/editor/PDF/PPTX используют одинаковые строки и геометрию;
- background locked, semantic text editable, page number locked;
- любой failed reconstruction выдаёт валидный fallback без внешней стоимости.

Visual GO для метода: минимум 5 из 6 референсов, если фактический набор по-прежнему равен шести, должны выглядеть естественно после text lift. Если набор изменился, используй порог не ниже 80%, но покажи каждый failed case отдельно. Нельзя считать fallback успешным text-lift кейсом в этой метрике.

## Тесты и команды

Добавь deterministic fixtures для:

- кириллицы;
- двухстрочного заголовка;
- светлого текста на сложном фоне;
- текста рядом с главным объектом;
- дат/чисел;
- ложного OCR match;
- unexpected text;
- ghost glyph после cleanup;
- длинной пользовательской замены;
- export parity;
- fallback при каждом hard failure.

Запусти только релевантные tests/typechecks и `git diff --check`. Если нужен render, используй локальные assets; сеть запрещена.

## Отчёт и STOP

Создай:

`D:\presentation\plans\image-first-editable-slides-v1\reports\02-local-reference-reconstruction.md`

Укажи:

- verdict `RECONSTRUCTION GO`, `RECONSTRUCTION NO-GO` или `RECONSTRUCTION BLOCKED BY FOUNDATION`;
- изменённые файлы;
- использованные локальные engines/libraries;
- таблицу по каждому reference fixture;
- ссылки на side-by-side artifacts;
- точность exact string restoration;
- pixel-change/ghost-text evidence;
- какие случаи ушли в fallback;
- результаты editor/PDF/PPTX checks;
- `paid calls: 0`;
- следующий подтверждённый шаг.

Если очистка регулярно повреждает композицию, exact strings нельзя восстановить или менее 80% слайдов проходят visual review, дай `RECONSTRUCTION NO-GO`. При NO-GO запрещено переходить к платному image benchmark: сначала предложи один минимальный бесплатный технический эксперимент.
