# 17 — Yandex narration: жёсткий budget вызовов и отсутствие автоматического retry job

## Скопируй этот prompt в новый чат Codex

Работай в `D:\presentation`.

Сначала полностью прочитай `AGENTS.md`, затем строго по порядку:

1. `plans/future-generation-reliability/README.md`;
2. `plans/future-generation-reliability/12-full-yandex-narration-rewrite-before-safe-failure.md`;
3. `plans/future-generation-reliability/14-yandex-full-rewrite-duration-compliance-and-controlled-smoke.md`;
4. `plans/future-generation-reliability/16-yandex-narration-output-budget-and-length-compliance.md`;
5. этот файл.

До любых изменений выполни `git status --short`. Рабочее дерево может быть грязным: не делай `reset`, `checkout`, массовое форматирование или cleanup чужих файлов. Не переходи к следующему plan-файлу. Не изменяй старые проекты, документы, `Presentation.revision`, сохранённый `speechDraft` или пользовательские canvas. Все изменения относятся только к **новым narration jobs** после выкладки.

## Почему нужен этот пункт

Контролируемый smoke пункта 16 выявил два независимых факта:

1. Один вручную созданный narration job получил второй BullMQ attempt после transient `fetch failed`, потому что общие generation options содержат `attempts: 3`. Это может повторно списать деньги и противоречит правилу «не повторять job автоматически».
2. В успешной попытке была цепочка из трёх narration text calls: initial narration → targeted spoken rewrite → full duration rewrite. Это противоречит операторскому лимиту «initial + ровно одна full rewrite» и делает реальную максимальную стоимость менее предсказуемой.

Это не доказательство причины короткого ответа Yandex и не разрешение повышать `maxTokens`, переключать модель или ослаблять gates. Пункт 16 уже показал, что без finish/cap signal нельзя утверждать, почему Yandex закончил ответ раньше `maxTokens`.

## Цель

Для каждого нового Yandex narration job обеспечить понятную и проверяемую границу:

- максимум **один BullMQ attempt**;
- максимум **две** paid Yandex text-generation calls для речи: initial full narration + одна fresh full narration rewrite;
- если initial текст не проходит любой допустимый narration gate, не выполнять targeted/per-section rewrite и не делать generic repair loop: выполнить одну полную rewrite всего текста;
- если полная rewrite не проходит любой gate, завершить job safe failure без третьего Yandex call, OpenAI, demo/demo-fallback, локального дописывания или автоматического rerun;
- structured planning/design/slide calls не являются narration text calls и не меняют этот budget, но этот план не расширяет их retry policy.

## Неподвижные продуктовые границы

- Единственный author речи — Yandex. Не добавляй OpenAI, `demo`, `demo-fallback`, второго провайдера или provider fallback.
- Default narration route остаётся текущим `yandexgpt/latest`; не меняй alias, `YANDEX_NARRATION_*`, pricing, provider tiers или `.env`.
- Не меняй shared timing presets 6/8/10/12/14, minimum 1170 слов / 9 минут для 10-slide `university_student`, `maxTokens`, source relevance, Tavily, CostEvent, billing, admin UI или planning/design contract.
- `normalizeNarrationText(...)`, `validateNarrationSections(...)` и `findSpokenNarrationIssues(...)` остаются единственными gatekeepers. Не создавай альтернативный validator и не принимай короткий текст новой эвристикой.
- Не склеивай old/invalid narration с replacement, не копируй narrative-plan fields в речь, не логируй текст речи, prompt, source text, API key или folder ID.
- Не меняй старые queue jobs в Redis/БД. Новые options применяются только к jobs, поставленным после изменения.

## Аудит до кода

Прочитай и свяжи реальный путь вызовов и тесты:

- `apps/api/src/jobs/job-options.ts`;
- `apps/worker/src/tasks/job-progress.ts`;
- `apps/api/src/projects/projects.service.ts` и `projects.service.test.ts`;
- `apps/worker/src/tasks/generation.ts` и его tests;
- `apps/worker/src/tasks/presentation/providers/generation.ts`;
- `apps/worker/src/tasks/presentation/narration/processing.ts`;
- `apps/worker/src/tasks/presentation/prompts/builders.ts`;
- `apps/worker/src/tasks/presentation.test.ts`;
- `apps/worker/src/tasks/job-progress.test.ts` и `apps/worker/src/tasks/generation.test.ts`, если они существуют.

До правки письменно зафиксируй в рабочем отчёте:

1. Где задаётся `attempts: 3`, как options попадают в narration queue и как worker определяет `willRetry`/`job.discard()`.
2. Отличаются ли queue name, job data `kind` и enqueue-path у narration и full presentation generation.
3. Точную текущую последовательность initial narration, `findSpokenNarrationIssues`, `rewriteSpokenYandexNarration`, `normalizeNarrationText`, duration shortfall и `rewriteShortYandexNarration`.
4. Какие ошибки допускают generic `shouldRetryNarration(...)` loop и может ли он создать третью text call.
5. Как API/public project/job error redaction и отсутствие сохранённого draft проверяются сейчас.

Если код отличается от этого описания, следуй коду и отрази расхождение. Не начинай implementation, пока не определён минимальный seam, который различает narration job от остальных generation jobs.

## Реализация: только один минимальный путь

### A. Queue policy для narration

1. Добавь или используй минимальный типизированный способ задать options **только** для новых narration jobs: `attempts: 1`, без backoff/retry. Не меняй общий retry budget slide-generation/export/extraction jobs без отдельного плана.
2. `enqueueNarration(...)` должен использовать narration-specific options; `enqueueGeneration(...)` сохраняет прежние options, если аудит не докажет, что иначе невозможно изолировать change.
3. Worker должен считать narration job финальным после первого failure: не публикуй `retry_scheduled`, не оставляй retryable queue state и не допускай второй provider attempt.
4. Сохрани нейтральный public error. В internal structured log допустимы только `jobKind`, `attempt`, `maxAttempts`, `failureCategory`, `finalDisposition`, provider и recovery kind; никаких текстов/prompt/source.

### B. Budget narration text calls

1. Сделай policy явной рядом с `generateYandexNarration(...)`: `MAX_YANDEX_NARRATION_TEXT_CALLS = 2` либо эквивалентный локальный typed helper. Это не environment override.
2. Первый call всегда использует `buildNarrationPrompt(...)` и тот же default model/temperature/`maxTokens`, что и сейчас.
3. Если первый ответ проходит `findSpokenNarrationIssues(...)` и `normalizeNarrationText(...)`, принять его без второго call.
4. Если первый ответ не проходит spoken, header, duration, repetition, template или иной существующий narration gate, выполнить **одну** full rewrite через полный prompt. Она должна создавать весь текст заново, а не отдельные sections.
5. Удали из этой future narration path возможность targeted/per-section spoken rewrite и generic full-repair loop. Не оставляй путь, в котором `rewriteSpokenYandexNarration(...)` плюс duration recovery создают третью narration text call.
6. Полная rewrite должна проходить те же `findSpokenNarrationIssues(...)` и `normalizeNarrationText(...)`. Любая ошибка после неё — final safe failure; не вызывать `shouldRetryNarration(...)` для нового provider call.
7. Не ослабляй existing full rewrite prompt из пункта 14. Если его название/формулировка теперь относится не только к duration, внеси минимальное честное переименование и обнови tests; не добавляй old invalid answer в обычные logs/public data.

### C. Безопасная telemetry

Без DB migration добавь или уточни structured logging только там, где это действительно нужно для проверки policy:

- resolved model alias;
- `narrationTextCall` (1 или 2);
- `maxNarrationTextCalls: 2`;
- `recovery: none | full_narration_rewrite`;
- accepted word count/duration после validation либо failure category.

Не дублируй text в `AiUsageEvent`; он уже хранит usage/cost. Не логируй narration/source/prompt content.

## Обязательные deterministic tests

Все Yandex, Redis/BullMQ, Prisma и Tavily calls замокай. Fixtures должны честно проходить существующие headers/normalizer contracts; не маскируй проблему локальной подгонкой длины.

Добавь или расширь focused tests:

1. Новый narration enqueue получает `attempts: 1`; обычная presentation generation сохраняет прежний retry policy.
2. При transient Yandex/fetch failure narration worker выполняет ровно одну очередь-обработку, делает `job.discard()`/final failure и не сообщает `retry_scheduled`.
3. Валидный initial narration использует ровно одну Yandex text call.
4. Short initial + valid full replacement использует ровно две text calls, одну full rewrite и сохраняет только replacement.
5. Initial с spoken issue, повтором или template defect сразу использует full rewrite — без targeted/per-section call; итог всё равно максимум две calls.
6. Short/invalid full replacement завершает safe failure после второй call: нет третьей call, нет OpenAI/demo/local extension, нет сохранённого `speechDraft`/revision.
7. Ошибка в первой provider call завершает safe failure без второй call и без BullMQ retry.
8. Existing 1170/1560 boundaries, 6/8/12/14 presets, Yandex-only/no-demo/no-OpenAI и public redaction tests остаются зелёными.
9. Логи/telemetry содержат только разрешённые технические metadata и не содержат fixture narration/source text.

Если проверяемый API BullMQ не даёт deterministic assert для `discard`, проверь observable contract: `attempts: 1`, `attemptsMade === 1`, final `failed`, отсутствует повторный processor invocation и отсутствует `retry_scheduled`.

## Проверки до runtime

Выполни:

```powershell
npm run test -w @studydeck/api -- projects.service.test.ts
npm run test -w @studydeck/worker -- generation.test.ts job-progress.test.ts presentation.test.ts presentation-quality.test.ts prompts/builders.test.ts
npm run typecheck -w @studydeck/api
npm run typecheck -w @studydeck/worker
npm run build -w @studydeck/shared
docker compose config --quiet
git diff --check
```

Если какой-либо указанный test-file отсутствует, не скрывай это `--passWithNoTests`: запусти ближайший существующий focused suite и явно укажи расхождение. Если Vitest в sandbox падает с `spawn EPERM`, повтори ту же команду разрешённым способом, не меняя тесты.

## Paid smoke — только после отдельного нового разрешения пользователя

Не выполняй paid Yandex/Tavily call автоматически.

После отдельного разрешения:

1. Пересобери и перезапусти **только worker** (и `api`, лишь если действительно изменены API job options). Не пересобирай web.
2. Runtime-проверкой подтверди без вывода секретов: `AI_PROVIDER=yandex`, `ALLOW_DEMO_GENERATION=false`, пустой OpenAI key, default `yandexgpt/latest`, narration override отсутствует.
3. Создай один новый isolated 10-slide `university_student` project с одним фиксированным non-WEB fixture; не используй проекты smoke от 23.07.2026 и не допускай Tavily.
4. До enqueue сообщи user: max jobs = 1, `attempts = 1`, max narration text calls = 2, model, fixed source context и консервативную стоимость.
5. После job зафиксируй project/job status, `attemptsMade`, number of narration text calls, model, input/output tokens, latency, RUB cost, words/duration, spoken issue count, revision, presence/absence draft, public error и WEB source count.
6. Не создавай второй job, не нажимай retry и не меняй `.env` после failure. Отрицательный результат допустим, если он доказуемо safe-fails на первом queue attempt.

## Приёмка

Пункт принят, только если:

- новые narration jobs имеют один queue attempt, а не скрытые BullMQ retries;
- максимум две Yandex text calls на narration job подтверждён тестами;
- targeted/per-section rewrite не может добавить третью narration call;
- default provider/model, timing gates, full-rewrite quality, public redaction и старые данные не изменены;
- tests/typechecks/config/diff-check зелёные;
- paid calls не сделаны без отдельного нового разрешения;
- финальный отчёт перечисляет root cause, изменённые файлы, test results, queue/text-call counts, paid cost (если был smoke) и remaining risks.
