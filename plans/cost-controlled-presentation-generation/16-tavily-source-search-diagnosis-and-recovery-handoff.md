# Plan 16 — Tavily source-search diagnosis and guarded recovery

## Current evidence and hard boundary

Two fresh Plan 15 smoke projects are historical and immutable. The latest one
terminated before narration: its mandatory `sources` reservation became
`provider_error`, while `AiUsageEvent` and `CostEvent` are both empty. This
proves only that the worker did not get a successful Tavily response far enough
to persist a source-search event. It does **not** prove whether the cause was
credentials, an HTTP rejection, rate limiting, network/DNS, or the request
shape.

The previous worker-only change makes a *successful* mandatory source search
write its non-AI `CostEvent` with the same policy RUB amount that settles its
reservation. That change is covered by deterministic tests, but it has not yet
been proven by a successful live source-search response.

This plan deliberately separates diagnosis, an optional deterministic code
repair, a single paid Tavily probe, and a later full presentation E2E. Run one
prompt per new Codex chat. Do not combine prompts and do not proceed past a
stop condition.

## Invariants for every prompt

- Work only in `D:\presentation`.
- Read `AGENTS.md`, this file, Plans 14 and 15, and run
  `git -c safe.directory=D:/presentation status --short` before action.
- Preserve all unrelated worktree changes. The worker reconciliation diff may
  be present but uncommitted; do not discard, reset, rebase, or widen it.
- Never resume or retry historical Plan 14/15 jobs. Never delete their
  projects, jobs, envelopes, reservations, or telemetry rows.
- Keep the AITUNNEL v5 policy, explicit models, 18.20 RUB cap, 21 narration
  reservations, no provider fallback, and no demo fallback unchanged.
- Never reveal secrets, prompts, sources, narration, raw error bodies, raw
  validation messages, request payloads, or provider response content.
- A new provider request of any kind requires the exact explicit authorization
  stated by the corresponding prompt. Do not infer it from this plan.

## Prompt 16.1 — read-only source-search postmortem

Run this first, in a new chat. It must not create a project/job, call Tavily,
call AI, start/stop/rebuild containers, edit files, or commit.

```text
Работай в D:\presentation. Сначала полностью прочитай AGENTS.md,
plans/cost-controlled-presentation-generation/README.md,
plans/cost-controlled-presentation-generation/14-effective-bounds-and-narrative-plan-ledger.md,
plans/cost-controlled-presentation-generation/15-worker-readiness-and-single-paid-e2e-handoff.md
и plans/cost-controlled-presentation-generation/16-tavily-source-search-diagnosis-and-recovery-handoff.md.
Затем выполни git -c safe.directory=D:/presentation status --short и сохрани все несвязанные изменения.

Это только read-only postmortem последнего проекта с title "Live generation smoke".
Не создавай project/job, не запускай npm smoke, не вызывай Tavily/AI, не меняй код, .env,
Docker-конфигурацию или plan-файлы, не запускай/не останавливай/не пересобирай контейнеры
и не коммить.

Последний smoke завершился до narration: у его CostEnvelope sources reservation status=provider_error,
а AiUsageEvent и CostEvent пусты. Исторические rows immutable и их нельзя retry/delete/rewrite.

Сделай только следующее.

1. Безопасно найди последний проект title="Live generation smoke" и его jobs/envelope.
   Покажи только IDs, statuses, stage, timestamps, counts и monetary totals; не выводи prompt,
   sources, narration или полный error text.
2. Классифицируй terminal source-search failure без раскрытия текста ошибки:
   - применяй SQL CASE/boolean checks только для категорий `missing_credential`, `http_400`,
     `http_401_403`, `http_429`, `http_5xx`, `network_or_dns`, `mandatory_source_search_insufficient`,
     `query_length`, `other_sanitized`;
   - если точное соответствие не доказано, скажи `unclassified_safe` — не угадывай.
3. Прочитай worker logs только для интервала job и отфильтруй их до безопасных полей:
   timestamp, service/stage, HTTP status (если он есть), error class/name и безопасная category.
   Не показывай body, URL с query, headers, key, request JSON, prompt, source text или raw error.
4. Выполни read-only проверку конфигурации внутри текущего worker container:
   `TAVILY_API_KEY` только как present/non-empty, `WEB_SEARCH_PROVIDER` как нормализованное имя,
   `WEB_SEARCH_MAX_RESULTS` как безопасное число. Не печатай значение ключа и не меняй env.
   Если worker stopped, зафиксируй это как blocker и не запускай его.
5. Read-only проверь generation queue (wait, paused, active, delayed, prioritized,
   waiting-children), API health и worker state; не лечи runtime.
6. Сопоставь кодовый путь `prepareGenerationSources()` -> `searchWebSources()` ->
   `recordCostEvent()` только чтением. Подтверди, почему `provider_error` до успешного HTTP response
   не создаёт CostEvent, и что successful mandatory path теперь передаёт policy source RUB в CostEvent.

Финал строго в этом формате:
- `diagnosis: <одна из категорий или unclassified_safe>`;
- evidence: только safe statuses/counts/flags;
- next route: ровно один из `16.2A`, `16.2B`, `16.2C` или `blocked`;
- `paid request started: no`.
Остановись. Не начинай следующий prompt сам.
```

## Prompt 16.2A — credential/provider/network route

Use only when Prompt 16.1 reports `missing_credential`, `http_401_403`,
`http_429`, `http_5xx`, `network_or_dns`, or `unclassified_safe`.

```text
Работай в D:\presentation. Прочитай AGENTS.md, Plans 14–16 и git status; сохрани несвязанные изменения.
Выполняй только route 16.2A из Plan 16. Последний диагностированный safe category: <ВСТАВЬ CATEGORY>.

Это read-only operational report. Не меняй code/.env/Docker/plans, не запускай контейнеры,
не вызывай Tavily/AI, не создавай project/job, не retry historical jobs и не коммить.

Проверь только безопасные configuration flags, API/worker/queue states и уже сохранённые telemetry/log
categories. Не показывай secret values, raw error body, request payload, prompt или source text.

Дай одно конкретное external/user action:
- missing_credential или 401/403: пользователь должен проверить/обновить Tavily credential вне этого
  запуска; ты не редактируешь .env;
- 429: ждать снятия rate limit;
- 5xx/network/DNS: ждать восстановления provider/network;
- unclassified_safe: запросить отдельное разрешение только на один app-shaped Tavily probe по Prompt 16.3.

Финал: diagnosis, safe evidence, owner следующего действия, и `paid request started: no`.
Остановись.
```

## Prompt 16.2B — deterministic request-shape repair

Use only when Prompt 16.1 proves a local, reproducible `http_400` or
`query_length` defect in the code path. Do not use it for credential, rate
limit, 5xx, DNS, or an unclassified failure.

```text
Работай в D:\presentation. Прочитай AGENTS.md, Plans 14–16 и git status; сохрани несвязанные изменения.
Выполняй только route 16.2B из Plan 16. Read-only evidence доказало локальный defect:
<ВСТАВЬ SAFE CATEGORY И КРАТКОЕ SAFE EVIDENCE>.

Не запускай Tavily/AI, npm smoke или любой provider request. Не создавай/не retry project/job.
Не меняй .env, Docker-конфигурацию, policy cap, providers/models, narration policy или historical rows.

1. Найди только worker seam, который формирует Tavily query/request:
   `apps/worker/src/tasks/web-search.ts` и непосредственно вызывающий path в `generation.ts`.
2. Внеси минимальный детерминированный fix. Не добавляй fallback provider, автоматический retry,
   paid probe или изменение source-snapshot contract.
3. Добавь/обнови targeted Vitest test, который воспроизводит defect локально и доказывает fix
   без сети. Сохрани существующий лимит запроса и безопасное telemetry поведение.
4. Выполни targeted worker tests, worker typecheck и `git diff --check`.
5. Не rebuild/redeploy и не commit без отдельного явного запроса пользователя.

Финал: files, exact deterministic verification, residual risk, `paid request started: no`.
Остановись и дождись отдельного решения о worker rebuild или Tavily probe.
```

## Prompt 16.2C — source sufficiency route

Use only when Prompt 16.1 proves `mandatory_source_search_insufficient` after
a successful provider response.

```text
Работай в D:\presentation. Прочитай AGENTS.md, Plans 14–16 и git status; сохрани несвязанные изменения.
Выполняй только route 16.2C: successful Tavily response не дал обязательные 3–4 пригодных sources.

Это read-only analysis. Не вызывай Tavily/AI, не создавай/не retry project/job, не меняй code/.env/Docker/plans
и не коммить. Не печатай sources, query, prompt или raw provider data.

Проверь safe counts: returned candidates, accepted candidates, rejected count по category, snapshot presence,
reservation/envelope statuses и AI usage count. Сопоставь их с deterministic relevance/filter rules.
Скажи, относится ли следующий шаг к topic coverage, filter strictness или недостаточной observability.
Не ослабляй mandatory 3–4 source contract и не меняй narration policy.

Финал: safe diagnosis, recommended scoped plan (если нужен code change), и `paid request started: no`.
Остановись.
```

## Prompt 16.3 — one paid Tavily probe only after explicit authorization

Use only after Prompt 16.1/16.2 explicitly recommends it and the user sends
the exact authorization: **«Разрешаю ровно один paid Tavily probe Plan 16 без
повторов.»** This is a provider request, but it must not create a project/job
or call AI.

```text
Разрешаю ровно один paid Tavily probe Plan 16 без повторов.

Работай в D:\presentation. Прочитай AGENTS.md, Plans 14–16 и git status; сохрани несвязанные изменения.
Не меняй code/.env/Docker/plans и не коммить. Не создавай project/job, не запускай npm smoke,
не вызывай AI и не retry historical jobs.

Перед probe безопасно загрузи из .env только TAVILY_API_KEY в текущий process, не печатая значение.
Если ключ пустой или недоступен — остановись до provider request и скажи `Tavily probe не начат`.

Сделай preflight без provider request: API health, worker state и пустая generation queue.
Если он не проходит — остановись, ничего не ремонтируй и скажи `Tavily probe не начат`.

Только при успешном preflight ровно один раз выполни app-shaped Node fetch к Tavily:
- POST JSON через `fetch` + `JSON.stringify`, не PowerShell curl;
- один короткий academic query для AI in higher education;
- max_results не больше текущего configured limit;
- не логируй Authorization header, query, response body, source text или URL.

Не повторяй запрос при любой ошибке. Покажи только: request count=1, HTTP status/class,
response `results` count, worker/queue state и факт отсутствия project/job/AI call.
Остановись. Новый full E2E требует отдельного нового разрешения.
```

## Prompt 16.4 — later full paid E2E

Use only after a successful 16.3 probe (or a deterministic repair/redeploy
proved the source route healthy) and a separate user authorization for **one
new** full paid E2E. Reuse the operational controls from Plan 15.2 verbatim:
fresh project only, credentials precheck, 20-second worker readiness, empty
queue, exactly one smoke command, immediate worker stop, safe ledger
reconciliation, and API cancellation only for a newly stranded queued/active
job. Never retry historical jobs.

## Acceptance criteria for the package

- No new paid request occurs during 16.1, 16.2A, 16.2B, or 16.2C.
- A provider problem is classified from safe evidence before any code or
runtime repair is attempted.
- The source-search `CostEvent` reconciliation repair stays deterministic and
future-only; historical rows remain untouched.
- Any Tavily probe and any full E2E are separately, explicitly authorized and
executed at most once.
