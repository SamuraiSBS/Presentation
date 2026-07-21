# Промт 06: предэкспортная проверка и согласованность форматов

Ты работаешь в монорепозитории StudyDeck AI: `D:\presentation`.

Реализуй этот промт полностью. Сначала прочитай `AGENTS.md`, `plans/future-presentation-quality/README.md`, текущий export pipeline, shared canvas audit и тесты. Не создавай отдельный внешний сервис рендеринга.

## Цель

Перед созданием PPTX/PDF StudyDeck должен автоматически проверить финальную презентацию как экспортируемый артефакт, исправить безопасные проблемы и отдать пользователю готовый файл без нового блокирующего flow.

Реальный дефект: редактор и PPTX совпадали визуально, но оба содержали off-topic текст, обрывки, мелкий шрифт и плохие колонки. Текущая export readiness в основном проверяет наличие canvas, structural audit и image object keys, поэтому плохой смысл и низкая читаемость могут успешно экспортироваться.

## Продуктовый контракт

- Web, PPTX и PDF одинаково важны.
- Аудитория: школа, колледж, вуз; выступление 5-10 минут.
- Строгий учебный стиль.
- Export click не должен приводить к новому пользовательскому quality wizard.
- Repair выполняется внутри job; при невозможности модельного repair используется лучший безопасный валидный вариант.
- Не скрывать ошибки молча в логах: писать структурированную диагностику, но не показывать технические детали пользователю.
- Не переписывать custom canvas.

## Актуальные точки входа

- `apps/worker/src/tasks/export.ts`
- `apps/worker/src/tasks/export.test.ts`
- `apps/worker/src/tasks/presentation-quality.ts`
- `apps/worker/src/tasks/presentation/quality/orchestration.ts`
- `packages/shared/src/presentation/canvas-audit.ts`
- `packages/shared/src/presentation/canvas-builder.ts`
- `apps/web/src/lib/presentation-display.ts`
- `apps/web/src/lib/presentation-display.test.ts`
- export schemas в `packages/shared/src/exports/**`

Текущий `createPptx(...)` уже предпочитает canvas, PDF имеет canvas/template paths, а `scoreExportReadiness(...)` использует `auditSlideCanvas(...)`. Расширяй этот путь.

## Требуемая реализация

### 1. Добавь единый export preflight report

Создай shared/worker тип наподобие:

```ts
type ExportPreflightReport = {
  passed: boolean;
  repaired: boolean;
  format: "pptx" | "pdf" | "web";
  slideIssues: Array<{
    slideId: string;
    categories: string[];
    repairable: boolean;
  }>;
};
```

Не сохраняй report в Prisma без необходимости. Он может быть внутренним результатом и структурированным логом.

Preflight должен объединять:

- schema validity;
- topic relevance и slide-speech alignment, если эти функции уже реализованы;
- visible text integrity/duplicate checks;
- canvas geometry/overflow/minimum typography;
- missing image object keys;
- source/attribution consistency;
- parity-risk между canvas и fallback template path.

### 2. Выполняй safe repair до export serialization

Порядок:

1. Parse persisted document.
2. Определить generated и custom canvas.
3. Для generated slides применить deterministic safe repairs.
4. При необходимости вызвать существующий bounded model repair через общий quality pipeline, а не изобретать второй model client в export.ts.
5. Перестроить generated canvas.
6. Повторить preflight.
7. Сериализовать один и тот же проверенный document в PPTX/PDF.

Не сохранять автоматический export-only repair обратно в пользовательский документ без явного существующего контракта. Если pipeline уже сохраняет final quality result до export, reuse его. Зафиксируй решение в кодовом комментарии и тесте.

### 3. Проверяй фактическую export geometry

Без обязательного запуска PowerPoint/LibreOffice в production:

- использовать canvas dimensions и element boxes;
- учитывать px -> pt conversion;
- оценивать число строк и text box capacity;
- проверять `fit`, cropping, bounds, overlap, safe margins;
- проверять наличие binary object для каждого objectKey до добавления в export;
- проверять, что PPTX/PDF выбирают canvas path, когда canvas валиден.

Optional local visual render можно оставить как integration/dev command, но unit tests не должны зависеть от установленного Office.

### 4. Исключи незаметное расхождение renderer paths

- Новые generated slides используют общий canvas source of truth.
- Template fallback применяется только к legacy/no-canvas document.
- Если canvas path потерял элемент, export test должен падать.
- PDF и PPTX получают одинаковый slide count, titles, visible strings, images и semantic font roles.
- Speaker notes в PPTX не должны подменять visible text и наоборот.

### 5. Поведение при остаточной проблеме

- Не создавать бесконечный retry.
- Structural blocker, при котором файл невозможно создать, остаётся job failure с обычным сообщением экспорта.
- Исправимые quality issues не должны блокировать пользователя: использовать лучший safe valid candidate.
- Логировать unresolved categories, slide orders, chosen fallback и format, без полного текста.

## Обязательные тесты

Создай parity fixture с 5-6 слайдами: hero, image, comparison, timeline, summary, sources.

Проверить:

1. Preflight видит missing/unsafe canvas.
2. Generated canvas перестраивается и проходит второй audit.
3. Custom canvas не меняется.
4. PPTX/PDF используют один проверенный document.
5. Slide count, titles и visible strings совпадают по форматам.
6. Изображение с отсутствующим objectKey даёт repair/fallback, а не тихо исчезает.
7. Text below minimum/overflow определяется до serialization.
8. Porsche-like off-topic/fragment fixture не экспортируется в повреждённом виде, если соседние промты уже реализованы.
9. Legacy no-canvas presentation по-прежнему экспортируется fallback path.
10. Repair loop имеет жёсткий предел и возвращает best valid candidate.

## Проверка

```powershell
npm run build -w @studydeck/shared
npm run test -w @studydeck/shared
npm run test -w @studydeck/worker -- src/tasks/export.test.ts
npm run test -w @studydeck/worker -- src/tasks/presentation-quality.test.ts
npm run test -w @studydeck/web -- src/lib/presentation-display.test.ts
npm run typecheck -w @studydeck/web
npm run typecheck -w @studydeck/worker
git diff --check
```

Если доступен локальный stack и пользователь попросил runtime-проверку:

- перестрой только затронутые `worker` и при необходимости `web/shared` services;
- сгенерируй fixture project;
- дождись `completed`;
- скачай PPTX и PDF;
- проверь сохранённую presentation shape и обе выгрузки.

## Критерии готовности

- Экспорт проверяет содержательную и геометрическую готовность, а не только schema.
- PPTX/PDF используют общий проверенный canvas document.
- Repair не блокирует обычного пользователя.
- Custom canvas и legacy presentations сохраняют совместимость.
- Остаточные проблемы видны в структурированных логах.
- Unit tests не требуют установленного Microsoft Office.

## Не входит в задачу

- Новый пользовательский экран preflight.
- Обязательный LibreOffice/PowerPoint в production container.
- Remote deploy без отдельного запроса.
- Полная замена `pptxgenjs` или PDF pipeline.

