# 20 — AITUNNEL: Gemini 3.5 Flash Lite для простых этапов и общий budget cap проекта

## Скопируй это сообщение целиком в новый чат Codex

Работай в `D:\presentation`.

Выполни строго и полностью только этот план: `D:\presentation\plans\future-generation-reliability\20-aitunnel-economy-gemini-routing-and-project-budget-cap.md`.

Сначала полностью прочитай `AGENTS.md`, затем по порядку:

1. `plans/future-generation-reliability/17-yandex-narration-call-budget-and-no-job-retry.md`;
2. `plans/future-generation-reliability/18-aitunnel-gemini-flash-production-provider.md`;
3. `plans/future-generation-reliability/19-aitunnel-gemini-output-thinking-and-hard-cost-cap.md`;
4. этот файл.

До изменений выполни `git status --short` и сохрани чужие изменения. Не делай `reset`, `checkout`, cleanup или массовое форматирование. Не меняй старые projects, documents, `Presentation.revision`, `speechDraft` или пользовательские canvas. Не делай никаких paid AITUNNEL/Gemini/Yandex/OpenAI/Tavily вызовов без отдельного нового разрешения пользователя после deterministic checks и локального deploy.

## Контекст

Первый AITUNNEL smoke показал, что `gemini-3.6-flash` может списать 23.107630 RUB только за narrative-plan structured call, хотя он не входил в narration-only cap. Второй smoke подтвердил, что narration cap безопасно запрещает дорогой rewrite до отправки, но не ограничивает ранние structured stages.

Продуктовое решение:

- **`gemini-3.5-flash-lite`** применяется только для явно перечисленных простых AITUNNEL structured tasks;
- **`gemini-3.6-flash`** остаётся primary model для full Russian narration, full narration rewrite и presentation document generation;
- `auto` запрещён;
- все оплачиваемые AITUNNEL stages нового проекта учитываются в одном project-level budget до отправки запроса.

## Цель

Для новых `AI_PROVIDER=aitunnel` jobs:

1. Снизить стоимость раннего planning без ухудшения narration quality:
   - `gemini-3.5-flash-lite` — только `narrative plan`, `design brief` и deterministic-quality critique, если этот critique действительно вызывает модель;
   - `gemini-3.6-flash` — narration, narration rewrite, presentation JSON, slide-text repair и quality repair;
   - research brief, deck story, slide text projection и прочие существующие local/deterministic transforms остаются локальными и не получают model call.
2. Ввести default **`AITUNNEL_PROJECT_BUDGET_RUB=30`** для всех paid AITUNNEL generation stages одного project/job flow.
3. Сохранить из плана 19 отдельный narration budget 20 RUB, один BullMQ attempt и максимум две narration calls.
4. До каждого paid AITUNNEL call локально резервировать worst-case стоимость; если stage не помещается в remaining project budget — safe-fail **до** provider request.
5. Не делать automatic provider/model fallback. Если Lite stage не проходит schema validation или budget, нельзя автоматически повторять его на Flash или 3.6.

`30 RUB` — default, не обязательство потратить 30 RUB. Это верхняя application reservation policy: job может завершиться раньше с меньшими расходами. Если provider не соблюдает документированный output cap, приложение fail-stops после факта и не запускает следующие paid calls; это не отменяет уже списанные provider деньги.

## Неподвижные границы

- Не ослабляй narration timing/word/template/repetition/header gates и не меняй 20 RUB narration-call cap.
- Не меняй Yandex/OpenAI маршруты, API/web UI, Prisma schema, export, Tavily/image policy или сохранённые данные.
- Не используй `model: "auto"`, implicit routing или model fallback.
- Не вводи second job/retry, targeted rewrite, demo fallback, local padding narration или скрытый change user prompt.
- Не используй цену ProxyAPI для AITUNNEL. Не делай external price/token-count request в runtime.
- Не логируй content/prompt/source/API key/raw thinking. Допустимы только безопасные numeric usage, model, reservation, actual cost, remaining budget и failure category.

## Аудит до кода

Прочитай текущие implementation и tests, особенно:

- `apps/worker/src/openai-client.ts`;
- `apps/worker/src/tasks/presentation/providers/generation.ts`;
- `apps/worker/src/tasks/presentation/orchestrator.ts`;
- module из плана 19 с narration reservation/cap;
- `apps/worker/src/usage-ledger.ts` и tests;
- `apps/worker/src/tasks/presentation.test.ts`;
- `.env.example` и `docker-compose.yml` worker environment.

До реализации зафиксируй:

1. точные schemaName/operation для narrative plan, design brief, critique, presentation, narration и repair;
2. какие из этих stages уже local/deterministic и не требуют provider call;
3. где можно централизованно выбрать model per stage без копирования pipeline;
4. где request получает `max_tokens`, `reasoning` и usage metadata;
5. какой versioned AITUNNEL RUB-price catalog уже есть для `gemini-3.6-flash`, и есть ли подтверждённая цена для `gemini-3.5-flash-lite`;
6. как narration cap из плана 19 будет вложен в project-level cap без double-spend или double-reservation.

Если цена Lite не подтверждена точным официальным AITUNNEL источником на дату выполнения, не угадывай. `AI_PROVIDER=aitunnel` должен final safe-fail до Lite provider call с `aitunnel_price_unavailable`, а не расходовать деньги с `unknown_price`.

## Реализация

### A. Явный model routing

1. Введи маленькую typed функцию/таблицу `aitunnelModelForStage(stage)` с фиксированным allowlist:

   | Stage | Модель |
   |---|---|
   | `narrative_plan` | `gemini-3.5-flash-lite` |
   | `design_brief` | `gemini-3.5-flash-lite` |
   | `quality_critique` | `gemini-3.5-flash-lite` |
   | `narration`, `narration_rewrite` | `gemini-3.6-flash` |
   | `presentation`, `slide_text_repair`, `quality_repair` | `gemini-3.6-flash` |

   Если реальный pipeline не имеет одного из stage, не создавай вызов ради routing: просто не применяй запись.

2. Добавь `AITUNNEL_ECONOMY_MODEL=gemini-3.5-flash-lite` в `.env.example`, но валидируй его против exact allowed default. `auto`, пустое значение или arbitrary model ID не принимаются для economy route.

3. Сохрани `AITUNNEL_NARRATION_MODEL=gemini-3.6-flash` как primary contract. Не позволяй economy setting изменить narration/rewrite/presentation path.

4. Для Lite structured tasks передавай documented минимальный reasoning effort и отдельный stage-specific output cap. Не применяй expensive/default Gemini reasoning к простому JSON plan.

5. Caps должны быть constants/config с объяснимым контрактом и тестами, а не magic number в callsite:

   - `AITUNNEL_NARRATIVE_PLAN_MAX_OUTPUT_TOKENS`: enough only for validated 6/8/10/12/14-slide plan, no prose narration;
   - `AITUNNEL_DESIGN_BRIEF_MAX_OUTPUT_TOKENS`: only compact visual constraints;
   - `AITUNNEL_QUALITY_CRITIQUE_MAX_OUTPUT_TOKENS`: compact issue list;
   - existing narration output cap from plan 19 stays untouched.

   Derive lower bounds from schema/contracts and fixtures. Do not lower a cap until its existing deterministic fixture still validates.

### B. Единый project-level budget state

1. Вынеси/расширь pure budget module из плана 19 до job-scoped `AitunnelProjectBudget`.

2. Он должен иметь independent ledgers:

   - `projectBudgetRUB` — 30 RUB over all paid AITUNNEL stages;
   - `narrationBudgetRUB` — 20 RUB only for narration/rewrite;
   - active reservations by a stable stage/call key;
   - settled actual costs.

3. Перед любым AITUNNEL call:

   - determine exact stage and fixed model;
   - verify a known versioned RUB price for that exact model;
   - conservatively estimate serialized input and reserve full configured output cap (including potentially billable thinking);
   - require the reservation to fit **both** project budget and, for narration, narration budget;
   - only then submit the provider request.

4. После response:

   - settle exact numeric usage against the same price catalog;
   - release unused reservation;
   - preserve separate `reasoningTokens` only when provider supplied them;
   - if actual cost exceeds either reservation/budget, record `aitunnel_project_budget_overrun`, safe-fail, and prohibit every subsequent AITUNNEL call in that job.

5. Если usage missing/malformed/unknown price, do not assume zero. Settle nothing, final safe-fail and prohibit further paid stages.

6. Stage rejected by schema/quality after a successful paid call still settles actual cost. It does not receive a higher-model retry.

7. Do not persist a new DB budget table or change past jobs. In-memory state must follow one worker execution; existing `AiUsageEvent` remains independent audit telemetry.

### C. Correct failure and telemetry behavior

1. Internal categories must distinguish at least:

   - `aitunnel_project_budget_exhausted_preflight`;
   - `aitunnel_narration_budget_exhausted_preflight`;
   - `aitunnel_project_budget_overrun`;
   - `aitunnel_usage_unavailable`;
   - `aitunnel_price_unavailable`;
   - existing schema/quality/provider failures.

2. Public project/job error remains neutral and contains no budget, provider, model or source detail.

3. Safe structured logs may contain stage, model, configured output cap, reservation, actual cost, remaining project/narration budget and numeric token counts. No content.

4. `AiUsageEvent` records exact selected Lite/Flash model, provider `aitunnel`, price version, usage and actual RUB cost. Unknown price remains `unknown_price`, never zero.

## Deterministic tests

Mock every provider/Prisma/BullMQ call. No network or money.

Add focused coverage for:

1. The routing table uses Flash Lite only for the three simple allowlisted stages and Flash for narration/presentation/repair; `auto` and arbitrary economy model are rejected.
2. Local stages make no AITUNNEL call.
3. Lite narrative-plan request has its own compact output cap/minimal reasoning and returns schema-valid plan fixture.
4. Invalid Lite plan does not retry on Flash, Yandex, OpenAI or demo.
5. Known Lite price gets correct RUB reservation/cost; unknown Lite price blocks before request.
6. Project reservation blocks a costly narrative plan before provider call when it cannot fit 30 RUB.
7. After a settled Lite plan, remaining project budget is correctly reduced; primary narration needs to fit both its 20 RUB narration budget and remaining project budget.
8. Actual cost overrun/missing usage at any structured stage prevents narration and all later paid stages.
9. Initial narration/rewrite behavior from plan 19 still has one queue attempt and no more than two narration calls.
10. Yandex/OpenAI existing tests remain green and never use AITUNNEL config.

## Verification and runtime

Run nearest focused worker tests, worker typecheck, shared build, `docker compose config --quiet`, and `git diff --check`. Rebuild/restart only required worker/shared runtime services; do not rebuild web. Verify API/internal health, but do not generate a project.

The final report must show model-to-stage table, all configured caps, project/narration reservation semantics, tests, changed files and remaining provider-level risk.

## Paid smoke — only with fresh permission

Do not perform one during this plan. After deterministic checks and deploy, request separate authorization. If granted, use exactly one new isolated project, one job with `attempts=1`, one TXT fixture, no WEB/Tavily, no retry, and at most two narration calls. Before enqueue state the project cap 30 RUB, narration cap 20 RUB, exact models and all known reservations. After completion report every stage's model/reservation/actual cost, project total, narration total, calls, attempts, status, draft/revision, public error and WEB count. Do not run a second project after failure.

## Acceptance

Accepted only when Lite is restricted to explicitly simple tasks, Flash is retained for narration/complex generation, every AITUNNEL call is preflight-reserved against the 30 RUB project cap, narration is also bounded by 20 RUB, unknown/overrun usage safe-fails, no fallback/retry appears, and no paid call occurs without fresh user permission.
