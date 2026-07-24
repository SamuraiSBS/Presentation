# 18 — AITUNNEL + Gemini 3.6 Flash: отдельный production-provider для narration

## Скопируй это сообщение целиком в новый чат Codex

Работай в `D:\presentation`.

Выполни строго и полностью только этот план: `D:\presentation\plans\future-generation-reliability\18-aitunnel-gemini-flash-production-provider.md`.

Сначала прочитай полностью `AGENTS.md`, затем полностью прочитай:

1. `plans/future-generation-reliability/README.md`;
2. `plans/future-generation-reliability/17-yandex-narration-call-budget-and-no-job-retry.md`;
3. этот файл.

До любых изменений выполни `git status --short` и покажи короткий audit report. Рабочее дерево может быть грязным: не делай `reset`, `checkout`, массовое форматирование или cleanup чужих файлов. Не переходи к другим plan-файлам. Не меняй старые проекты, документы, `Presentation.revision`, сохранённый `speechDraft` или пользовательские canvas. Изменения применяются только к новым jobs после выкладки.

Не выполняй ни одного платного сетевого вызова AITUNNEL, Gemini, Yandex, Tavily, OpenAI или другого AI-провайдера без отдельного нового разрешения пользователя после завершения deterministic-проверок и локального деплоя.

## Контекст и причина

Контролируемый Yandex smoke показал, что существующая narration-цепочка безопасно ограничена одним BullMQ attempt и максимум двумя text calls, но Yandex дважды не прошёл требования к длине русской речи. Это не разрешение ослабить timing gates или добавить скрытые retries.

Пользователь выбрал AITUNNEL как агрегатор и хочет использовать **явно выбранную** модель `gemini-3.6-flash`, а не `model: "auto"`.

AITUNNEL даёт OpenAI-совместимый API (`https://api.aitunnel.ru/v1`) и ключ собственного сервиса. В проекте уже есть частичный универсальный seam `OPENAI_BASE_URL` в `apps/worker/src/openai-client.ts`, но он недостаточен для production-маршрута AITUNNEL: сейчас ключ называется `OPENAI_API_KEY`, provider/usage помечаются как `openai`, а `generateOpenAINarration(...)` допускает до четырёх provider attempts. Нельзя просто записать ключ AITUNNEL в `OPENAI_API_KEY` и объявить задачу выполненной.

## Цель

Добавить явный provider `aitunnel` для **новых** generation/narration jobs:

- при `AI_PROVIDER=aitunnel` используется только AITUNNEL, без fallback в Yandex, OpenAI, demo или demo-fallback;
- основной ID модели по умолчанию — точный `gemini-3.6-flash`; значение `auto` запрещено;
- ключ называется `AITUNNEL_API_KEY`, endpoint по умолчанию — `https://api.aitunnel.ru/v1`;
- narration соблюдает уже принятый жёсткий budget: один initial full narration call и, только если первый ответ не проходит существующие gates, одна fresh full rewrite; максимум две paid narration text calls;
- narration job имеет один BullMQ attempt и не ставится на автоматический retry;
- usage/стоимость маркируются `aitunnel`, фактическая модель и RUB-тарифы видны в `AiUsageEvent`; не маскируй gateway под прямой OpenAI;
- Gemini 3.6 Flash используется только при явном выборе `AI_PROVIDER=aitunnel`. Выбор Yandex и OpenAI сохраняет своё текущее поведение и никогда не расходует AITUNNEL-баланс.

## Неподвижные границы

- Не меняй timing presets, minimum/maximum word gates, `maxTokens`, source relevance, Tavily policy, презентационные темы, canvas, export, billing UI или DB-схему.
- Не ослабляй `normalizeNarrationText(...)`, `validateNarrationSections(...)` и `findSpokenNarrationIssues(...)`; это единственные narration gatekeepers.
- Не создавай fallback между AITUNNEL, Yandex и OpenAI. Ошибка выбранного provider — final safe failure с нейтральным public error.
- Не используй `model: "auto"`, не позволяй `AITUNNEL_NARRATION_MODEL=auto`, и не выбирай модель из ответа провайдера для следующего вызова.
- Не используй OpenAI API key, VPN, `OPENAI_BASE_URL` или OpenAI billing для AITUNNEL-маршрута.
- Не добавляй targeted/per-section rewrite, generic repair loop, третий narration call или повтор job. Внутренние 429-retry агрегатора не должны запускать новый вызов из приложения; зафиксируй это как внешний риск, а не маскируй его дополнительной application-логикой.
- Не записывай narration text, prompt, source text, API key или исходный ответ провайдера в логи, telemetry или public API.
- Не делай paid smoke автоматически и не меняй `.env` с реальными секретами.

## Сначала проведи аудит и зафиксируй факты

Прочитай и свяжи текущую реализацию и тесты:

- `apps/worker/src/openai-client.ts`;
- `apps/worker/src/tasks/presentation/providers/provider-selection.ts`;
- `apps/worker/src/tasks/presentation/providers/generation.ts`;
- `apps/worker/src/tasks/presentation/orchestrator.ts`;
- `apps/worker/src/tasks/generation.ts` и `apps/worker/src/tasks/job-progress.ts`;
- `apps/api/src/jobs/job-options.ts`, `apps/api/src/projects/projects.service.ts` и их tests;
- `apps/worker/src/usage-ledger.ts` и tests;
- `apps/worker/src/tasks/presentation.test.ts`, `apps/worker/src/tasks/job-progress.test.ts`, `apps/worker/src/tasks/generation.test.ts` (если существует);
- `.env.example`, `docker-compose.yml`, worker environment wiring.

Перед правками в commentary/рабочем отчёте назови:

1. где выбирается provider и где сейчас может возникнуть provider fallback;
2. где задаётся одна попытка для narration queue;
3. почему старый OpenAI-compatible seam нельзя использовать с AITUNNEL без отдельной идентичности provider и отдельного narration policy;
4. какие OpenAI endpoints реально применяются для narration и structured stages и совместимы ли они с документированным AITUNNEL API;
5. какие usage fields реально возвращаются текущим SDK/адаптером и как будет сохранена точная модель без сохранения контента.

Если фактический код отличается от этого плана, следуй коду и минимально скорректируй только implementation detail; не расширяй product scope.

## Реализация

### A. Явная конфигурация и provider selection

1. Добавь отдельную конфигурацию AITUNNEL в `apps/worker/src/openai-client.ts` или маленьком соседнем модуле:

   - `AITUNNEL_API_KEY` — обязательный ключ только для AITUNNEL;
   - `AITUNNEL_BASE_URL` — необязательный override, default `https://api.aitunnel.ru/v1`;
   - `AITUNNEL_NARRATION_MODEL` — default `gemini-3.6-flash`;
   - reject/не считай configured пустое значение и `auto`;
   - не читай `OPENAI_API_KEY` для AITUNNEL.

2. Расширь provider union и selector так, чтобы `AI_PROVIDER=aitunnel` возвращал только `["aitunnel"]`, если валидная AITUNNEL-конфигурация существует; иначе provider list пуст и возникает существующая безопасная ошибка отсутствующей конфигурации.

3. Сохрани точную семантику `AI_PROVIDER=yandex` и `AI_PROVIDER=openai`. При неявном `AI_PROVIDER` не добавляй AITUNNEL в список автоматически: пользователь должен выбрать provider явно.

4. Обнови public/internal configuration error так, чтобы он перечислял AITUNNEL нейтрально, без key values и endpoint secrets.

5. В `.env.example` добавь документированные пустые AITUNNEL переменные и комментарий: `AI_PROVIDER=aitunnel`, model must be explicit; реальный ключ никогда не коммитится. Оставь существующий `OPENAI_BASE_URL` как legacy/general OpenAI-compatible seam, не меняй его смысл.

### B. Один явный AITUNNEL/Gemini generation path

1. Добавь `generateWithAitunnel(...)`, `generateAitunnelNarration(...)` и `generateAitunnelPresentationFromNarration(...)` либо минимальные эквиваленты, использующие тот же canonical pipeline: research brief → narrative plan → accepted narration → slide text plans → design → blueprints → presentation → existing deterministic quality gates.

2. Не копируй крупные OpenAI/Yandex pipeline-функции, если можно вынести маленький typed OpenAI-compatible client/options seam. Но narration policy должна быть отдельной и очевидной: не переиспользуй `generateOpenAINarration(...)` с его `OPENAI_NARRATION_MAX_PROVIDER_ATTEMPTS = 4`.

3. Для AITUNNEL narration:

   - первый вызов строится существующим `buildNarrationPrompt(...)` и использует явный `gemini-3.6-flash`;
   - если `findSpokenNarrationIssues(...)`, header, template, repetition, duration или `normalizeNarrationText(...)` не проходят — один раз вызови существующий full-rewrite prompt, который заново создаёт весь текст;
   - после второго ответа повтори ровно те же validators;
   - любая ошибка первого вызова — final provider failure без второго call;
   - невалидный второй ответ — final narration quality failure без третьего call;
   - не передавай старый narration text в telemetry/logs. Его можно передать только в существующий rewrite prompt, если это уже требуется контрактом prompt builder.

4. Введи provider-neutral, ясно названную константу/typed policy для лимита двух paid narration calls, либо сохрани Yandex-константу и добавь ровно эквивалентную AITUNNEL-константу рядом с соответствующим path. Не меняй допустимое число calls для существующего direct OpenAI route в рамках этого плана, кроме случаев, когда общий refactor необходим для сохранения AITUNNEL isolation.

5. Для structured stages и deck generation передавай явный AITUNNEL client и явную модель. Не используй `auto` и не подменяй request model в retry/repair path.

6. Если AITUNNEL не поддерживает конкретный required Responses/structured-output feature на практике, deterministic tests должны выявить адаптерный контракт. Не деградируй в unstructured parsing или demo fallback; остановись на безопасной ошибке и зафиксируй gap.

### C. Queue и наблюдаемость

1. Используй уже реализованные narration-specific BullMQ options `attempts: 1`. Проверь, что новый provider идёт через тот же `kind: "narration"` enqueue path; обычные presentation/export/extraction jobs не меняй.

2. В `job-progress` final failure выбранного AITUNNEL narration не должна публиковать `retry_scheduled` и должна иметь `attemptsMade === 1`.

3. Расширь `recordAiUsage` и типы provider так, чтобы запись была `provider: "aitunnel"`, а `model` — точный выбранный model ID. Не записывай `openai` для Gemini за gateway.

4. Добавь статический versioned price catalog только для `aitunnel/gemini-3.6-flash`:

   - input `455` RUB per million;
   - output `2275` RUB per million;
   - currency `RUB`;
   - источник/version: `proxyapi-pricing-2026-07-24` **не используй** — это другой provider. Для AITUNNEL используй отдельное честное имя version, основанное на проверенной документации/цене на дату реализации. Если цена или model ID не подтверждены в точном источнике во время выполнения, не угадывай: сохраняй `unknown_price`, документируй это и не подставляй ProxyAPI price.

5. Без миграции БД добавь safe fields в structured logs только если нужны: `provider`, resolved `model`, `narrationTextCall` (1/2), `maxNarrationTextCalls`, `recovery` (`none | full_narration_rewrite`), accepted word count/duration или failure category. Никакого content.

6. Не добавляй новые внешние запросы для pricing, currency или provider status во время job.

### D. Deterministic tests

Все AITUNNEL/Gemini/BullMQ/Prisma/Tavily вызовы замокай. Ни один unit test не использует реальный ключ, сеть или деньги.

Добавь/расширь tests как минимум для:

1. `AI_PROVIDER=aitunnel` с валидным explicit key/model выбирает только `aitunnel`; отсутствующий key, пустая model или `auto` не выбираются.
2. AITUNNEL client использует `AITUNNEL_API_KEY` и default/override AITUNNEL base URL; он не использует `OPENAI_API_KEY`.
3. `AI_PROVIDER=yandex` и `AI_PROVIDER=openai` не получают AITUNNEL как fallback; отсутствие `AI_PROVIDER` тоже не включает его автоматически.
4. В narration path valid initial response вызывает ровно один AITUNNEL text call.
5. Short/invalid initial response + valid full replacement вызывает ровно две calls и сохраняет только replacement.
6. Spoken/template/repetition defect сразу ведёт к full rewrite, без targeted/per-section rewrite и без третьей call.
7. Provider error на первом call — final safe failure, без второго call, без `retry_scheduled`, без BullMQ second attempt.
8. Невалидный full replacement — final safe failure после второго call; нет demo, Yandex, OpenAI, local extension, saved speech draft или revision.
9. `AiUsageEvent` для AITUNNEL имеет provider `aitunnel`, exact Gemini model, normalized usage и верную RUB стоимость для fixture; неизвестная модель даёт `unknown_price`, а не 0.
10. Existing Yandex narration call-budget, default routing, public redaction, timing boundaries и old OpenAI tests остаются зелёными.

## Проверки до runtime

Выполни существующие nearest focused suites и затем:

```powershell
npm run test -w @studydeck/worker -- presentation.test.ts generation.test.ts job-progress.test.ts
npm run typecheck -w @studydeck/worker
npm run build -w @studydeck/shared
docker compose config --quiet
git diff --check
```

Если test file отсутствует, не используй `--passWithNoTests`: запусти ближайший существующий suite и явно назови отличие. Если Vitest в sandbox падает с `spawn EPERM`, повтори ту же команду разрешённым способом, не меняя tests.

## Локальный runtime после deterministic-проверок

Если менялись только worker/shared files, пересобери и перезапусти только `worker`; API пересобери только при реально изменённых API/shared runtime dependencies. Не пересобирай web.

Проверь:

```powershell
docker compose ps
curl.exe -s http://localhost:4000/v1/health
curl.exe -k -s https://localhost/api/internal-health
```

Проверь конфигурацию контейнера только наличием/отсутствием флагов, не печатай ключи: `AI_PROVIDER=aitunnel`, `ALLOW_DEMO_GENERATION=false`, AITUNNEL key present, exact narration model is not `auto`, Yandex/OpenAI keys are not needed для выбранного smoke. Не выполняй generation.

## Paid smoke — только после нового явного разрешения

После завершения всех tests и runtime redeploy остановись и запроси отдельное разрешение пользователя. До разрешения итоговый отчёт должен содержать список изменённых файлов, результаты проверок, точную модель, upper bound и неиспользованные риски.

Только если пользователь отдельно разрешит ровно один paid smoke, действуй по протоколу:

1. Один новый изолированный `10-slide university_student` project с одним фиксированным non-WEB fixture source; не переиспользуй старые smoke projects.
2. `AI_PROVIDER=aitunnel`, `AITUNNEL_NARRATION_MODEL=gemini-3.6-flash`, `ALLOW_DEMO_GENERATION=false`; нет Tavily/WEB sources.
3. Ровно один new narration job, `attempts=1`, максимум две paid narration text calls, без retry кнопки/queue retry/второго job.
4. До enqueue сообщи user: model, source scope, max jobs=1, max narration text calls=2, no Tavily, and conservative maximum text budget. Если цена точной AITUNNEL model подтверждена — вычисли cap из worst-case fixture; иначе назови cap unknown и не делай smoke, пока user не примет это отдельно.
5. После завершения зафиксируй: project/job IDs, status, `attemptsMade`, provider, exact resolved model, number of narration calls, input/output tokens, duration, RUB cost/price version, words/minutes, spoken issue count, revision/draft presence, public error и WEB source count. Не раскрывай prompts, narration, source text или secrets.
6. Даже при failure не создавай второй job и не меняй env. Negative result принимается, если доказана безопасная остановка в одной queue attempt.

## Приёмка

Задача принята только если:

- AITUNNEL — отдельный явно выбираемый provider, а не скрытый OpenAI gateway;
- `gemini-3.6-flash` является явным default и `auto` невозможно выбрать;
- выбранный AITUNNEL narration job имеет максимум один BullMQ attempt и максимум две application-level paid narration calls;
- нет provider fallback, demo fallback, targeted repair или третьего call;
- AITUNNEL usage/price честно маркируются и не используют тарифы ProxyAPI;
- существующие Yandex/OpenAI behaviour и сохранённые данные не изменены;
- deterministic tests, typecheck, shared build, compose config и diff check проходят;
- paid calls отсутствуют без отдельного нового разрешения;
- финальный отчёт перечисляет changed files, test results, runtime status, provider/model/call policy, paid cost (только если был отдельно разрешён smoke) и remaining risks.
