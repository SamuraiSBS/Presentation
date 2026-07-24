# 21 — AITUNNEL: context-light full narration rewrite внутри существующего лимита

## Скопируй это сообщение целиком в новый чат Codex

Работай в `D:\presentation`.

Выполни строго и полностью только этот план: `D:\presentation\plans\future-generation-reliability\21-aitunnel-context-light-full-narration-rewrite.md`.

Сначала полностью прочитай `AGENTS.md`, затем планы 17, 18, 19, 20 из `plans/future-generation-reliability/` и этот файл. До изменений выполни `git status --short`. Рабочее дерево может содержать чужие изменения: не делай reset, checkout, cleanup или массовое форматирование. Не меняй старые projects/documents/revisions/drafts/canvas. Не выполняй платные provider/Tavily calls без нового отдельного разрешения пользователя.

## Зафиксированный факт

После плана 20 один AITUNNEL project стоил 7.265730 RUB: Lite narrative plan — 0.652760 RUB, initial Gemini 3.6 narration — 6.612970 RUB. Initial narration не прошла quality gate. Full rewrite не была отправлена, потому что rewrite prompt включал полный предыдущий невалидный текст и его worst-case reservation не поместился в остаток 20 RUB narration cap.

Это не разрешение повысить narration budget, ослабить validators или добавить третий вызов. Нужна более компактная **fresh full rewrite** prompt: новый текст должен создаваться с нуля по исходному контракту, а не получать всю неудачную речь в качестве контекста.

## Цель

Только для AITUNNEL/Gemini full narration rewrite:

- сохранить максимум две narration text calls и один BullMQ attempt;
- сохранить `gemini-3.6-flash`, existing output/reasoning settings, 20 RUB narration budget и 30 RUB project budget;
- убрать полный `previousText` из rewrite request;
- передавать только initial source/prompt/narrative plan/research brief, existing timing contract и безопасные категории validation failure;
- rewrite всё равно создаёт все sections полностью заново, не копирует, не дописывает и не склеивает invalid answer;
- уменьшить rewrite input reservation настолько, чтобы deterministic fixture с initial + rewrite могла поместиться в existing 20 RUB narration budget;
- не менять Yandex rewrite prompt и не трогать его текущую diagnostic context policy.

## Неподвижные границы

- Не меняй `buildFullNarrationDurationRewritePrompt(...)` для Yandex: Yandex path остаётся без изменений.
- Не передавай даже обрезанный previous narration text в AITUNNEL rewrite request, logs, telemetry, error payload или public API.
- Не передавай raw `Error.message`: он может содержать derived/provider details. Используй только allowlisted failure categories.
- Не добавляй targeted/per-section rewrite, локальную правку, fallback, retry, новую модель или изменение output cap/budget.
- Не ослабляй timing/word/header/template/repetition/spoken validators.
- Не делай paid smoke в ходе реализации.

## Аудит до кода

Прочитай:

- `apps/worker/src/tasks/presentation/providers/generation.ts`;
- `apps/worker/src/tasks/presentation/prompts/builders.ts`;
- budget module из плана 19/20;
- `apps/worker/src/tasks/presentation.test.ts` и tests prompts/budget, если они существуют.

До изменений зафиксируй:

1. что AITUNNEL сейчас вызывает `buildFullNarrationDurationRewritePrompt(..., initialText, error, ...)`;
2. сколько именно текста прежней речи current builder добавляет и почему это увеличивает input reservation;
3. какие existing validation defects могут быть безопасно сведены к category без контента;
4. expected reservation initial/rewrite для существующего 10-slide fixture до и после нового prompt — расчёт должен использовать real pure budget estimator, а не приблизительную арифметику вручную.

## Реализация

### A. Новый AITUNNEL-only prompt builder

1. Добавь отдельную функцию, например `buildAitunnelFullNarrationRewritePrompt(...)`, в prompt builders рядом с existing full-rewrite builder.

2. Её вход — `project`, `sources`, `narrativePlan`, `researchBrief` и narrow `NarrationRewriteFailureCategory`; **не** `previousText`, **не** `Error`.

3. Она строится на существующем `buildNarrationPrompt(...)`, чтобы сохранить исходные facts, source scope, exact headings, timing preset и slide order. Затем добавляет компактные инструкции:

   - previous draft was rejected and must be discarded completely;
   - return a fresh complete narration for every requested slide;
   - category-specific concise correction instructions;
   - no quote, continuation, merge, patching or reuse of previous text;
   - existing full timing/section/anti-filler instructions remain materially equivalent.

4. Define only an allowlist of safe categories, for example:

   - `duration`;
   - `spoken_quality`;
   - `headers_or_sections`;
   - `template_or_repetition`;
   - `narration_quality`.

   If a validator produces an unmapped/ambiguous error, use generic `narration_quality`; never serialize raw error text.

5. Keep category instructions factual and short. Do not include slide excerpts, word counts from the invalid response, issue sentences, source excerpts beyond those already in the original narration prompt, or model output.

### B. AITUNNEL rewrite callsite

1. In `generateAitunnelNarration(...)`, after initial validation fails, classify the failure to the allowlisted category and build the AITUNNEL-only context-light prompt.

2. Pass that prompt to the existing second-call reservation and request path. Do not change call ordinal, provider/model, `max_output_tokens`, reasoning effort, budget accounting or final safe-failure behavior.

3. Preserve validation of the full second answer with exactly the same `findSpokenNarrationIssues(...)` and `normalizeNarrationText(...)` gates. Only accepted replacement may proceed; initial invalid text is never persisted.

4. If the context-light rewrite reservation still does not fit, preserve current `narration_budget_exhausted` safe failure. Do not borrow from project budget, raise the cap or reduce output cap dynamically.

### C. Safe telemetry

1. Add only the safe rewrite failure category to the AITUNNEL internal structured log if useful for diagnosis.

2. Do not add raw validation message, previous text, prompt, source or response to logs/DB/public API.

3. Keep `AiUsageEvent` model/usage/cost behaviour unchanged.

## Deterministic tests

Mock every provider/BullMQ/Prisma call. No network or paid call.

Add/extend tests for:

1. Context-light AITUNNEL rewrite prompt contains the original contract and fresh-full-rewrite instruction, but does **not** contain a sentinel placed in initial invalid narration, raw error message, or `Previous invalid answer` block.
2. Each validator defect maps to a safe known category; unknown errors map to generic `narration_quality` without their text.
3. Yandex full-rewrite builder/call path is unchanged and existing Yandex rewrite tests remain green.
4. A short/invalid initial AITUNNEL narration with a valid replacement invokes exactly two calls and saves only the replacement.
5. The actual serialized context-light rewrite request has a strictly smaller estimated input reservation than the old full-invalid-text request for the same fixture.
6. Existing 10-slide fixture: initial actual/reservation and the new rewrite reservation fit the 20 RUB narration budget in the pure budget module; this proves only local preflight arithmetic, not provider billing.
7. If a larger source/prompt means the context-light rewrite still cannot fit, no second provider call is made and the job safe-fails as `narration_budget_exhausted`.
8. Existing guarantees remain: attempts=1, no third narration call, no fallback/demo, no draft/revision after failure, neutral public error.

## Verification and runtime

Run focused worker tests, worker typecheck, shared build if affected, `docker compose config --quiet`, and `git diff --check`. Rebuild/restart only worker/shared services required by the diff; verify health endpoints. Do not create a project or call AITUNNEL.

Final report: changed files, old vs new estimated rewrite reservation on the fixture, tests, runtime health, and explicit remaining risk that real provider output/thinking may still overrun a reservation.

## Paid smoke — only after a fresh explicit user message

After implementation and deterministic/runtime proof, stop and ask for permission. If granted, run exactly one new isolated project: one TXT fixture, no WEB/Tavily, one job/attempt, at most two narration calls, no retry/fallback. Before enqueue state both caps and old/new rewrite reservation. After completion report IDs, stages/models/reservations/actual costs, attempts, calls, status, draft/revision, neutral public error and WEB count. Never run a second job.

## Acceptance

Accepted only if the AITUNNEL rewrite uses no previous narration/raw errors, remains a fresh full replacement under the same validators and budgets, deterministically lowers the rewrite reservation, keeps all call/retry/fallback protections, and performs no paid call without fresh permission.
