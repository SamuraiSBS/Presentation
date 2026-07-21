# Промт 05: читаемая типографика и безопасная плотность layout

Ты работаешь в StudyDeck AI: `D:\presentation`.

Реализуй этот промт полностью. Перед изменениями прочитай `AGENTS.md`, `plans/future-presentation-quality/README.md`, shared canvas, web renderer, PPTX/PDF export и соответствующие тесты.

## Цель

Новые презентации должны читаться с проектора в школьной, колледжной или вузовской аудитории. Система должна сначала сокращать текст или менять композицию и только потом уменьшать размер шрифта в пределах безопасного минимума.

Реальные дефекты Porsche fixture:

- основной текст 16.5-18 pt;
- узкие колонки разбивали слова на множество строк;
- вокруг тесного текста оставалось много неиспользованного пространства;
- некоторые layouts содержали декоративную пустую область вместо полезной композиции;
- случайный форматный штрих появился внутри слова.

## Продуктовый контракт

- Длительность: 5-10 минут.
- Стиль: строгий учебный.
- Небольшой объём текста, но самостоятельный смысл.
- Проекторная читаемость важнее количества сохранённых слов.
- Web, PPTX и PDF используют одну типографическую логику.
- Custom canvas пользователя не переписывать.
- Старые сохранённые презентации не мигрировать.

## Актуальные точки входа

- `packages/shared/src/presentation/canvas-builder.ts`
- `packages/shared/src/presentation/canvas-helpers.ts`
- `packages/shared/src/presentation/canvas-audit.ts`
- `packages/shared/src/presentation/themes.ts`
- `packages/shared/src/presentation/layouts.ts`
- `apps/web/src/lib/presentation-display.ts`
- `apps/web/src/lib/presentation-display.test.ts`
- `apps/worker/src/tasks/export.ts`
- `apps/worker/src/tasks/export.test.ts`
- `apps/worker/src/tasks/presentation-quality.ts`
- `apps/worker/src/tasks/presentation-quality.test.ts`

Сейчас PPTX canvas переводит CSS pixels в points с коэффициентом 0.75; часть legacy renderers использует 12-18 pt и `fit: shrink`. Не лечи только один renderer.

## Требуемая реализация

### 1. Введи общие semantic typography tokens

В shared presentation package создай единый набор ролей, например:

```ts
presentationTypography = {
  deckTitle,
  slideTitle,
  mainClaim,
  body,
  supporting,
  label,
  sourceCredit,
  slideNumber,
};
```

Рекомендуемые минимумы для новых generated canvas:

- deck title: 50-64 px canvas, примерно 37.5-48 pt;
- slide title: 40-48 px, примерно 30-36 pt;
- main claim: 44-58 px;
- body: не меньше 27 px, примерно 20.25 pt;
- supporting/label: не меньше 24 px, примерно 18 pt;
- исключения только для source credit и slide number.

Точные значения подбери по существующим canvas dimensions 1280x720 и визуальным тестам. Theme может выбирать font family/weight, но не опускать semantic role ниже минимума.

### 2. Удали опасный shrink-to-fit

Для новых generated slides:

1. Сократить visible text по существующим sentence-aware helpers.
2. Уменьшить число bullets/visual items.
3. Расширить text box или изменить column ratio.
4. Переключить layout на statement/image-focus/sequence с подходящей плотностью.
5. Только затем применить bounded auto-fit, не ниже semantic minimum.

Нельзя сохранять весь текст за счёт 12-16 pt. Legacy documents должны продолжать экспортироваться, но новая генерация обязана использовать safe typography path.

### 3. Добавь layout capacity model

Для каждого layout определить:

- доступную ширину и высоту text slots;
- максимальное число строк;
- допустимое число слов/символов для текущего font role;
- минимальную ширину колонки;
- правила переноса длинных слов и URL.

Если content не помещается, normalizer/quality repair должен сократить текст или выбрать другой layout до построения canvas.

Особое внимание:

- comparison/cards/timeline с узкими колонками;
- hero/statement с длинными названиями;
- source footer;
- mixed image/text layouts;
- кириллица и длинные русские слова.

### 4. Усиль canvas audit

Добавь проверки:

- text element ниже semantic minimum;
- оценочное переполнение по строкам/высоте;
- text box слишком узкий для role/content;
- элементы выходят за safe margins;
- unintended overlap;
- decoration пересекает glyph area;
- `autoFit` может уменьшить шрифт ниже минимума.

Quality issue должен указывать конкретный slide/element и быть repairable для generated canvas.

### 5. Синхронизируй web, PPTX и PDF

- Web preview использует те же font sizes, line heights и box geometry из canvas.
- PPTX conversion сохраняет semantic size после px -> pt.
- PDF canvas path использует те же CSS values.
- Legacy template renderers, которые всё ещё нужны, получают хотя бы безопасные минимумы и capacity guards.
- Не вводить независимые magic numbers без общего источника.

## Обязательные тесты

1. Body text generated slide экспортируется не ниже проекторного минимума.
2. Три длинных русских пункта не сжимаются до 12-16 pt: текст сокращается или layout меняется.
3. Узкая comparison column определяется audit.
4. Длинное слово не создаёт overflow за canvas.
5. Source credits и slide numbers разрешены ниже body minimum.
6. Web/PPTX/PDF используют согласованные semantic sizes.
7. Custom canvas с пользовательским размером не переписывается quality repair.
8. Existing legacy deck остаётся schema-valid и экспортируется.
9. Fixture со случайной decorative line, пересекающей text box, получает audit issue.
10. Повторная генерация canvas устраняет issue.

## Визуальная проверка

Добавь deterministic fixture deck минимум с:

- title hero;
- split image/text;
- comparison;
- timeline;
- summary;
- source footer.

Проверь не только snapshot данных, но и геометрию canvas. Если локальный render workflow доступен, отрендери fixture в web/PPTX/PDF и визуально проверь все страницы. Не делай наличие LibreOffice обязательным для unit tests.

## Проверка

```powershell
npm run build -w @studydeck/shared
npm run test -w @studydeck/shared
npm run test -w @studydeck/web -- src/lib/presentation-display.test.ts
npm run test -w @studydeck/worker -- src/tasks/export.test.ts
npm run test -w @studydeck/worker -- src/tasks/presentation-quality.test.ts
npm run typecheck -w @studydeck/web
npm run typecheck -w @studydeck/worker
git diff --check
```

## Критерии готовности

- Новые слайды не используют основной текст меньше согласованного минимума.
- Overflow исправляется содержанием/layout, а не бесконтрольным shrink.
- Узкие колонки и пересечения обнаруживаются до экспорта.
- Web, PPTX и PDF сохраняют сопоставимую читаемость.
- Пользовательские canvas и старые документы не переписываются.

## Не входит в задачу

- Новый визуальный бренд.
- Замена Tiptap или редактора.
- Pixel-perfect миграция всех старых PPTX.
- Пользовательский диалог о слишком длинном тексте.
- Remote deploy без отдельного запроса.

