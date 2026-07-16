# План-промт 04: декомпозиция worker-пайплайна `presentation.ts`

Ты работаешь в монорепозитории StudyDeck AI по адресу `D:\presentation`.

Реализуй безопасную декомпозицию `apps/worker/src/tasks/presentation.ts` полностью. Это утверждённая задача на код. Не останавливайся после аудита или нового плана. Работай поэтапно, сохраняя поведение генерации и запуская targeted tests после каждого extraction.

## Цель

Разделить крупный worker-файл генерации презентаций на модули с ясной ответственностью, чтобы последующие улучшения качества содержания, автоматической проверки фактов и provider-specific repair можно было делать локально.

Декомпозиция не должна:

- ухудшать содержание презентаций;
- ослаблять quality gates;
- менять принятый narration как источник истины;
- ломать OpenAI или Yandex;
- отключать demo fallback;
- менять shared contracts без необходимости;
- менять число слайдов, layout/theme выбор или export output случайным образом.

## Продуктовый контекст

- Аудитория: студенты и школьники.
- Главная пользовательская претензия: качество содержания.
- StudyDeck должен максимально автоматически проверять факты и внутреннюю согласованность.
- Продукт готовится к платным продажам в России в течение нескольких недель.
- Полный рассказ находится в accepted narration, `speakerNotes` и `speechScript`; видимый слайд остаётся компактным.
- Уже приняты направления Gamma/modern presentation, смешанная плотность текста, topic-based mood и realistic/documentary images для конкретных тем.

Эта задача создаёт архитектурные швы для дальнейших улучшений, но сама не должна превращаться в переписывание всех prompts или новый generation pipeline.

## Текущий контекст кода

Перед реализацией проверь живые определения. Исторически `apps/worker/src/tasks/presentation.ts` содержит:

- public orchestration:
  - `generatePresentation`;
  - `generateNarrationDraft`;
  - `generatePresentationFromNarration`;
  - `selectAiProviders`;
- OpenAI/Yandex provider requests и structured generation;
- system/user/repair/critic prompts;
- research brief, deck story, design brief, narrative plan, blueprint/text plan builders;
- narration parsing, validation, compression и local repair;
- presentation normalization;
- slide/visual/diagram normalization и fallbacks;
- quality critique/repair orchestration;
- raw/final quality assertions;
- layout assignment и deterministic design-direction fallback.

Рядом уже существуют:

- `apps/worker/src/tasks/presentation-quality.ts`;
- `apps/worker/src/tasks/presentation.test.ts`;
- `apps/worker/src/tasks/presentation-quality.test.ts`;
- `apps/worker/src/tasks/generation.ts`;
- `apps/worker/src/tasks/web-search.ts`;
- `apps/worker/src/tasks/image-search.ts`;
- `apps/worker/src/tasks/export.ts`.

Shared contracts и canvas builder после предыдущего плана могут уже быть разделены внутри `packages/shared/src/**`. Используй public imports из `@studydeck/shared`, если нет доказанной причины для другого.

## Перед началом

1. Прочитай полностью:
   - `AGENTS.md`;
   - этот файл;
   - `apps/worker/src/tasks/presentation.ts`;
   - `presentation-quality.ts`;
   - оба основных тестовых файла;
   - актуальные shared presentation/generation schemas;
   - относящиеся планы в `plans/generation-improvements/` и `plans/gamma-student-level/`, чтобы не потерять уже реализованные инварианты.
2. Проверь рабочее дерево:

   ```powershell
   git -c safe.directory=D:/presentation status --short
   git -c safe.directory=D:/presentation diff -- apps/worker packages/shared
   ```

3. Построй реальную карту функций и импортов. Определи private functions, которые тестируются только через public orchestration, и exported helpers, которые уже импортируются тестами/другими файлами.
4. Зафиксируй baseline:

   ```powershell
   npm run build -w @studydeck/shared
   npm run test -w @studydeck/shared
   npm run typecheck -w @studydeck/worker
   npm run test -w @studydeck/worker -- src/tasks/presentation.test.ts
   npm run test -w @studydeck/worker -- src/tasks/presentation-quality.test.ts
   npm run test -w @studydeck/worker -- src/tasks/export.test.ts
   ```

5. Не выполняй реальные платные AI-вызовы в тестах. Network/provider calls должны быть mocked или env-gated.

## Архитектурный результат

Адаптируй имена к фактической связности, но стремись к такой структуре:

```text
apps/worker/src/tasks/presentation/
  index.ts
  orchestrator.ts
  types.ts
  constants.ts
  providers/
    index.ts
    provider-selection.ts
    structured-generation.ts
    openai.ts
    yandex.ts
    provider-errors.ts
  prompts/
    system.ts
    narrative-plan.ts
    narration.ts
    presentation.ts
    design-brief.ts
    quality.ts
  research/
    research-brief.ts
    vocabulary.ts
  planning/
    narrative-plan.ts
    deck-story.ts
    design-brief.ts
    slide-blueprints.ts
    slide-text-plans.ts
  narration/
    parser.ts
    validation.ts
    repair.ts
    formatting.ts
  normalization/
    presentation.ts
    slide.ts
    visual.ts
    diagram.ts
    sources.ts
  quality/
    raw-quality.ts
    slide-text.ts
    repair-orchestrator.ts
    model-prompts.ts
  fallbacks/
    presentation.ts
    slide.ts
    visual.ts
  layout/
    assignment.ts
    guards.ts
```

Это ориентир, а не требование создать максимальное число файлов. Избегай двух крайностей:

- нового монолита под именем `orchestrator.ts`;
- десятков файлов по 10–20 строк с постоянными cross-imports.

Каждый модуль должен иметь одну устойчивую причину для изменения.

## Публичная поверхность

Сохрани совместимость существующего пути:

```ts
import {
  generateNarrationDraft,
  generatePresentation,
  generatePresentationFromNarration,
  selectAiProviders,
} from "./presentation";
```

Допустимый вариант:

- оставить `apps/worker/src/tasks/presentation.ts` как compatibility facade, реэкспортирующий новый folder module;
- либо использовать folder `presentation/index.ts`, только если TypeScript module resolution и все текущие импорты однозначны.

Предпочти тонкий facade, если одновременно существуют файл и директория и это снижает риск массового diff.

Не экспортируй все private helpers только ради тестов. Pure helpers можно экспортировать из внутреннего модуля и тестировать напрямую по внутреннему пути, но публичный production API должен оставаться узким.

## Границы модулей

### 1. Provider layer

Отдели:

- выбор OpenAI/Yandex и fallback order;
- OpenAI AI SDK structured path;
- legacy OpenAI path, если он ещё существует;
- Yandex text/JSON response parsing;
- schema compatibility handling;
- usage/observability recording;
- retry/repair structured generation.

Инварианты:

- provider order и env semantics не меняются;
- ошибки сохраняют provider context;
- usage/operation/schemaName observability не теряется;
- Yandex несовместимый JSON Schema не отправляется как будто поддерживается;
- demo fallback разрешён только существующими env/режимами;
- нет silently swallowed provider errors.

Provider layer не должен знать детали построения canvas или slide layouts.

### 2. Prompt layer

Вынеси большие prompt-константы и builders по этапам:

- narrative plan;
- narration;
- design brief;
- final presentation;
- critic/repair.

Инварианты prompts:

- one narration section per slide;
- accepted narration не переписывается более коротким fallback;
- видимый текст компактнее речи;
- запрещены generic/template/meta phrases;
- сохраняется source grounding;
- смешанный text rhythm и topic-based visual direction остаются;
- prompts не просят raw CSS/HTML/coordinates;
- OpenAI/Yandex получают эквивалентные продуктовые требования с учётом provider contract.

На этом этапе не переписывай формулировки prompts без необходимости. Перемести их и добавь snapshot/substring tests для критических требований.

### 3. Planning layer

Сгруппируй deterministic и model-normalized planning:

- research brief;
- narrative plan;
- deck story;
- design brief;
- slide blueprints;
- slide text plans;
- deterministic visual directions и scene text modes.

Инварианты:

- точное requested slide count;
- title/section/content/summary роли;
- финальный сильный вывод;
- topic-based theme/mood;
- concrete subjects -> real photo;
- abstract/process -> diagram или none;
- соседние layouts/text modes разнообразны, но sparse slide не получает content-hungry layout.

### 4. Narration layer

Вынеси вместе:

- parse headers/sections;
- normalize raw narration;
- validate count/order/content;
- sentence counting;
- overlong compression;
- short-section repair;
- generic/prompt echo detection;
- first/last edge repetition;
- formatting back to canonical generated text.

Критический инвариант: после подтверждения пользователем accepted narration является единым источником истины. `generatedText`, `speakerNotes` и `speechScript` не должны расходиться или быть заменены более слабым repair/fallback.

Repair разрешён только для структурно полного текста, который можно безопасно исправить. Missing slides, malformed order, пустой или слишком тонкий материал не становятся «repairable» автоматически.

### 5. Normalization layer

Раздели:

- whole document normalization;
- slide/block normalization;
- sources/source refs;
- visuals/images;
- Mermaid/graph/diagram specs;
- speaker notes/speech script;
- legacy/partial data fallbacks.

Normalization должна быть mostly deterministic и не вызывать provider API.

Инварианты:

- requested slide count;
- source refs не теряются;
- visual image metadata сохраняется;
- custom canvas не перезаписывается;
- legacy documents остаются читаемыми;
- Mermaid/diagram sanitization остаётся безопасной;
- нормализация не создаёт generic content вместо валидного accepted content.

### 6. Quality layer

Существующий `presentation-quality.ts` уже является домом для детерминированной оценки. Не дублируй его целиком в новом folder.

Разделение должно прояснить:

- raw provider-output assertions;
- deterministic presentation quality (`presentation-quality.ts`);
- slide text issue detection;
- model critic/repair orchestration;
- local safe repair;
- финальный повторный quality gate.

Предпочтительная последовательность:

```text
raw output
  -> structural normalization
  -> deterministic quality checks
  -> selective local/model repair
  -> normalization after repair
  -> same deterministic checks again
  -> accept or fail
```

Не ослабляй проверки, чтобы сделать тесты зелёными. Repair должен быть точечным и затем проходить те же правила.

### 7. Fallback и layout

Отдели deterministic fallback content/visual/layout helpers от provider code.

Сохрани:

- demo generation behavior;
- fallback slide title/content rules;
- content-density guards;
- no forbidden template text;
- diverse layout assignment;
- compatibility с shared canvas builder;
- явное различие между recoverable provider issue и demo mode.

## Characterization-тесты до extraction

Добавь недостающие тесты до перемещения кода. Минимальные группы:

### Provider selection

- OpenAI only;
- Yandex only;
- ordered fallback;
- missing configuration;
- demo allowed/forbidden.

### Narration

- точное число секций;
- русские и допустимые legacy headers;
- 5–6 предложений, если это текущий контракт;
- overlong structural-complete repair;
- missing section не repairable;
- repeated openings/endings;
- prompt echo и generic filler;
- canonical formatting.

### Planning

- exact slide count;
- role sequence;
- mixed scene text modes;
- concrete/abstract visual strategy;
- deterministic output для одного input.

### Normalization

- partial provider document;
- legacy visual fields;
- source refs;
- diagram fallback;
- accepted narration preservation;
- custom canvas preservation.

### Quality orchestration

- quality passes без repair;
- repairable issue проходит repair и повторную проверку;
- unrecoverable issue падает;
- failed repair не маскируется;
- provider critic не перезаписывает fuller accepted narration.

Не использовать реальную сеть. Инъецируй callbacks/clients или mock на существующей границе.

## Порядок extraction

Рекомендуемый порядок, чтобы минимизировать риск:

1. Pure constants/types и prompt builders.
2. Provider selection и provider request helpers.
3. Narration parser/validation/repair.
4. Planning builders.
5. Normalization helpers.
6. Fallback/layout helpers.
7. Quality repair orchestration.
8. Тонкий public orchestrator/facade.

После каждого шага:

- typecheck worker;
- targeted `presentation.test.ts`;
- просмотр diff;
- проверка отсутствия дублированной старой реализации.

Не оставляй старые и новые функции одновременно «на всякий случай». После переключения импортов и зелёных тестов удали старое определение в том же этапе.

## Ограничения scope

- Не менять API/Prisma/billing.
- Не менять web/editor UI.
- Не менять export renderer, если только импорт shared type не потребовал механической адаптации.
- Не вводить новый AI SDK или provider abstraction package.
- Не менять модель ценообразования.
- Не запускать реальные AI/search запросы.
- Не ослаблять strict quality gates.
- Не переписывать старые сохранённые presentations.
- Не менять legacy root MVP.
- Не коммитить `dist`, logs или `*.tsbuildinfo`.

## Проверка

После каждого extraction:

```powershell
npm run typecheck -w @studydeck/worker
npm run test -w @studydeck/worker -- src/tasks/presentation.test.ts
```

После narration/quality этапов:

```powershell
npm run test -w @studydeck/worker -- src/tasks/presentation-quality.test.ts
```

Финально:

```powershell
npm run build -w @studydeck/shared
npm run test -w @studydeck/shared
npm run typecheck -w @studydeck/worker
npm run test -w @studydeck/worker
npm run test -w @studydeck/worker -- src/tasks/export.test.ts
npm run check
npm run test
npm run build
docker compose config --quiet
git -c safe.directory=D:/presentation diff --check
```

Если изменения затронули только `apps/worker` и shared, production-like runtime проверяется самым узким набором сервисов. По правилам `AGENTS.md` shared, используемый worker, требует rebuild worker:

```powershell
$services = @("worker")
docker compose build @services
docker compose up -d @services
docker compose ps
```

Не rebuild web без frontend-изменений. Не делай remote deploy без отдельного запроса пользователя.

## Критерии готовности

- Старый импорт public generation functions совместим.
- `presentation.ts` стал тонким facade/orchestrator, а не многотысячным доменным монолитом.
- Provider, prompt, narration, planning, normalization, quality и fallback обязанности разделены.
- Нет циклических зависимостей и дублированных реализаций.
- OpenAI, Yandex и demo contracts сохранены.
- Accepted narration остаётся источником истины.
- Все repair paths повторно проходят те же quality gates.
- Exact slide count, sources, visual direction, layouts и custom canvas не регрессировали.
- Targeted и полный worker test suite проходят без реальной сети.
- Shared/worker build и общий check зелёные.
- Декомпозиция создаёт понятное место для будущей автоматической фактологической проверки, но не симулирует её реализацию в этом scope.

## Итоговый отчёт

Покажи:

- итоговое дерево `apps/worker/src/tasks/presentation`;
- краткую карту пайплайна и зависимостей;
- что осталось в public facade/orchestrator;
- какие characterization tests добавлены;
- как доказано сохранение OpenAI/Yandex/demo поведения;
- как проверено сохранение accepted narration и quality gates;
- результаты команд;
- какие будущие улучшения качества теперь можно реализовывать локально, не смешивая их с этой задачей.
