# 19 — AITUNNEL Gemini: контроль output/thinking tokens и жёсткий лимит стоимости narration job

## Скопируй это сообщение целиком в новый чат Codex

Работай в `D:\presentation`.

Выполни строго и полностью только этот план: `D:\presentation\plans\future-generation-reliability\19-aitunnel-gemini-output-thinking-and-hard-cost-cap.md`.

Сначала прочитай полностью `AGENTS.md`, затем:

1. `plans/future-generation-reliability/17-yandex-narration-call-budget-and-no-job-retry.md`;
2. `plans/future-generation-reliability/18-aitunnel-gemini-flash-production-provider.md`;
3. этот файл.

До любых изменений выполни `git status --short`. Рабочее дерево грязное и может содержать изменения других задач: не делай `reset`, `checkout`, cleanup или массовое форматирование. Не меняй старые проекты, documents, `Presentation.revision`, сохранённые `speechDraft` или пользовательские canvas. Не выполняй платных вызовов AITUNNEL/Gemini/Yandex/OpenAI/Tavily без отдельного нового разрешения пользователя.

## Зафиксированный факт

Контролируемый AITUNNEL smoke (`aitunnel / gemini-3.6-flash`) безопасно остановился после одного job и двух narration calls, но фактический расход оказался **79.083550 RUB**:

| Operation | Input | Output | RUB |
|---|---:|---:|---:|
| Narrative plan | 932 | 2,719 | 6.609785 |
| Narration call 1 | 5,075 | 11,495 | 28.460250 |
| Narration call 2 | 7,713 | 17,804 | 44.013515 |

Причина огромного output пока не доказана: это могут быть visible completion tokens, thinking tokens, или provider-specific usage normalisation. Не называй это доказанным thinking без проверяемого поля ответа. Но AITUNNEL документирует, что Gemini thinking tokens тарифицируются как output, а для Gemini 3 их фактический расход определяется Google.

## Цель

Для **новых AITUNNEL narration jobs** с `gemini-3.6-flash` ввести доказуемую application-level policy:

- максимум один BullMQ attempt;
- максимум два narration text calls (initial + одна полная rewrite);
- explicit, model-specific `max_tokens` для каждого narration call;
- `reasoning.effort: "minimal"` для Gemini narration, только если документированный AITUNNEL OpenAI-compatible endpoint принимает этот параметр;
- job-level reserve-before-send и budget ledger, чтобы второй narration call не стартовал, если его worst-case резерв не помещается в остаток;
- default hard budget **20 RUB только для двух paid narration text calls**. Narrative plan, design, slide generation, images, TTS, Tavily и export не входят в этот конкретный cap и не меняются данным планом;
- если первый call фактически превышает свой расчётный reservation из-за поведения provider, не запускать rewrite, завершить job final safe failure и зафиксировать техническую budget-overrun категорию без content;
- никакого fallback, третьего call, queue retry, demo, локального дописывания или неявного изменения модели.

`20 RUB` — сознательный консервативный default. Для 10-slide `university_student` narration он должен быть достаточным только при строгом контроле output; если preflight не может доказать, что обе calls помещаются в cap, job должен отказаться **до первого paid call**, а не перерасходовать деньги.

## Неподвижные границы

- Не ослабляй existing timing, word, template, repetition, header или spoken validators.
- Не меняй Yandex, direct OpenAI, AITUNNEL structured stages, изображения, Tavily, DB schema, billing/admin UI или pricing других provider.
- Не используй `model: "auto"`.
- Не делай сетевой token-count/preflight вызов: он может быть платным, зависимым от provider и не даёт гарантию final usage. Preflight должен быть локальным и детерминированным.
- Не записывай narration/prompt/source/reasoning content, API key или raw provider response. `reasoning.exclude: true` скрывает content из ответа, но **не** считается механизмом экономии денег.
- Не утверждай, что лимит «абсолютно жёсткий», пока deterministic test и provider contract не доказывают, что `max_tokens` ограничивает billable output вместе с thinking. Если такого доказательства нет, в документации и отчёте называй его `application reservation cap with provider-overrun fail-stop`.

## Аудит до кода

Прочитай:

- `apps/worker/src/tasks/presentation/providers/generation.ts`;
- `apps/worker/src/tasks/presentation/narration/processing.ts`;
- `apps/worker/src/openai-client.ts`;
- `apps/worker/src/usage-ledger.ts` и tests;
- `apps/worker/src/tasks/presentation.test.ts`;
- `apps/worker/src/tasks/job-progress.ts` и test;
- `.env.example` и worker environment wiring.

До правок в рабочем отчёте покажи:

1. точный endpoint/SDK method, которым AITUNNEL narration сейчас вызывается;
2. где сейчас задаётся `max_tokens`/`max_output_tokens` или почему его нет;
3. какие usage поля реально normaliseятся (`inputTokens`, `outputTokens`, `reasoningTokens`) и как всё это ценится;
4. сохраняется ли raw `reasoning_tokens` отдельным полем в фактическом AITUNNEL response, не раскрывая content;
5. почему post-call telemetry не может предотвратить стоимость уже отправленного запроса;
6. как будет рассчитан worst-case reserve для initial/rewrite с учётом локальной оценки input tokens, output cap и текущего versioned AITUNNEL RUB-price catalog.

Если текущий код отличается от плана, следуй реальному коду и выбери минимальный seam. Не расширяй scope.

## Реализация

### A. Конфигурация и локальная budget policy

1. Добавь маленький typed AITUNNEL narration budget module рядом с provider/client code. Он не читает БД и не делает network calls.

2. Добавь только эти AITUNNEL-specific env settings в `.env.example`:

   ```env
   # Per narration job; applies only to AITUNNEL Gemini narration text calls.
   AITUNNEL_NARRATION_JOB_BUDGET_RUB=20
   AITUNNEL_NARRATION_MAX_OUTPUT_TOKENS=2400
   AITUNNEL_NARRATION_REASONING_EFFORT=minimal
   ```

   Требования к parsing:

   - defaults ровно `20`, `2400`, `minimal`;
   - пустые/некорректные/отрицательные значения не приводят к unlimited: безопасно используй default или конфигурационную final error, выбери один последовательный вариант и протестируй;
   - `max output` не может быть ниже существующего минимального объёма, достаточного для 10-slide 9-minute contract. Выведи minimum из existing timing/word contract и выбранной консервативной token estimation; не угадывай фиксированное число без объяснения;
   - разрешённые reasoning effort: `minimal`, `low`, `medium`, `high`; в production default только `minimal`.

3. Не добавляй конфигурацию с budget=0 как «безлимитный режим». `0` — invalid/final config error.

### B. Ограничение request и thinking

1. Для каждого AITUNNEL narration request передавай явный `max_tokens`/`max_output_tokens`, соответствующий документированному endpoint, из `AITUNNEL_NARRATION_MAX_OUTPUT_TOKENS`. Не применяй этот override к Yandex/OpenAI или к non-narration AITUNNEL stages.

2. Передавай `reasoning: { effort: "minimal", exclude: true }` только если это поддерживается именно используемым endpoint и TypeScript SDK allows it. При несовместимости добавь маленький typed `extra_body`/request adapter; не обходи types через небезопасный broad `as any` без isolated boundary и теста shape.

3. Не используй `reasoning.max_tokens` для Gemini 3, если AITUNNEL docs не подтверждают буквальный hard-token budget для этой модельной семьи. Gemini 3 управляет thinking level, а фактический объём определяет Google.

4. После response извлеки only numeric usage metadata. Если доступны `reasoning_tokens`, сохраняй их раздельно; если нет — оставь `undefined`, не вычисляй reasoning как `output - visibleTextTokens` и не делай выводов по длине текста.

### C. Preflight reservation и fail-stop

1. До первого paid narration call создай in-memory job-scoped budget state. Он живёт только в рамках одного worker execution и не требует Prisma migration.

2. Введи pure functions с integer/decimal-safe arithmetic:

   - `estimateInputTokens(text)` — консервативная локальная верхняя оценка на основе сериализованного request payload. Не используй приблизительное деление на четыре как единственный аргумент; выбери documented/объяснимый коэффициент и safety margin, покрой boundary tests;
   - `reserveNarrationCall({ estimatedInputTokens, maxOutputTokens, price })`;
   - `canStartCall({ remainingBudget, reservation })`;
   - `settleCall({ reservation, actualUsage, price })`, возвращающий actual charge и overrun без floating point;
   - `remainingBudget`.

3. Reservation должен включать:

   - worst-case input по текущему request;
   - весь `AITUNNEL_NARRATION_MAX_OUTPUT_TOKENS` по output price;
   - output reservation включает thinking, потому что provider billable thinking считается output;
   - текущую versioned цену `aitunnel/gemini-3.6-flash` в RUB.

4. До первого call зарезервируй его worst-case стоимость. Не резервируй rewrite заранее как списание, но до запуска rewrite проверь остающийся budget по его новому prompt (который может быть длиннее, потому что содержит invalid first answer). Если reservation rewrite не помещается — final `narration_budget_exhausted` без второго paid call.

5. После first response вычисли actual cost из provider usage. Если `actual > reservation`, категоризируй `narration_budget_overrun`, не запускай rewrite и safe-fail. Это честно ограничивает дальнейший ущерб, но не отменяет уже выставленного provider счёта.

6. После любого accepted/failed call возвращай unused reservation в remaining budget. Не считай неизвестную usage как zero: final safe failure `narration_usage_unavailable` и запрети rewrite.

7. Не используйте cost из `AiUsageEvent` как runtime source of truth: database write асинхронен/может fail. Рассчитывай budget из локального numeric usage и того же immutable price catalog, затем независимо записывай telemetry.

8. Public error остаётся нейтральным. В internal safe metadata допустимы только: `budgetRUB`, reservation, actualCostRUB (если известна), remainingRUB, `provider`, model, call ordinal, failure category и token counts — без content.

### D. Правдивая гарантия и внешняя защита

1. Добавь в операторскую документацию/plan report явное разделение:

   - application не отправит call, reservation которого не помещается в 20 RUB;
   - application не сделает второй call после overrun;
   - абсолютная гарантия «provider never bills more than max_tokens» зависит от AITUNNEL/Gemini contract и не доказывается unit test.

2. Добавь необязательную ручную операционную рекомендацию, не автоматизацию: создать отдельный AITUNNEL API key для worker и настроить у агрегатора минимально возможный ключевой/дневной budget. Не записывай key budget через API и не считай его заменой per-job application cap.

3. Не делай новый paid smoke в ходе этой задачи. После локальных проверок запроси отдельное разрешение.

## Deterministic tests

Все provider/Prisma/BullMQ requests замокай. Никакой реальной сети и денег.

Минимальные тесты:

1. Default settings дают 20 RUB, 2400 output, `minimal`; invalid values не превращают policy в unlimited.
2. Gemini narration request содержит выбранный explicit model, output cap и documented reasoning shape; Yandex/OpenAI requests не меняются.
3. Reservation вычисляется decimal-safe, includes input plus full output cap, и не плавает на дробных RUB prices.
4. Initial reservation, затем valid response ниже reservation: один call, unused amount released, accepted narration unchanged.
5. Initial invalid response: rewrite стартует только если его own reservation помещается в остаток; иначе одна paid call и `narration_budget_exhausted`.
6. Actual first-call usage превышает reservation: нет rewrite, нет retry, `narration_budget_overrun` и нейтральный public error.
7. Usage absent/malformed: нет rewrite, нет zero-cost assumption, `narration_usage_unavailable`.
8. Valid replacement в оставшемся budget: ровно две calls и только replacement сохраняется.
9. Existing limits `attempts=1`, max two narration calls, no fallback, no draft/revision after safe failure остаются зелёными.
10. `AiUsageEvent` по-прежнему хранит exact provider/model/usage/price, а `reasoningTokens` остаётся undefined, если response его не сообщил.

## Проверки и runtime

Выполни focused tests, typecheck worker, shared build, `docker compose config --quiet` и `git diff --check`. Затем пересобери только затронутые services (worker, а API только если действительно изменён его runtime dependency), проверь health endpoints. Не выполняй generation.

В финальном отчёте укажи: изменённые файлы, exact cap semantics, используемый output cap/reasoning effort, результаты tests, runtime health и remaining provider-level risk.

## Paid smoke — только после нового отдельного разрешения

Если пользователь после завершения всего плана даст отдельное разрешение, допустим один новый isolated project: один job, `attempts=1`, максимум две narration calls, no Tavily, no retry. До enqueue сообщи фиксированный 20 RUB narration-call cap и честную оговорку о provider-overrun risk. После job сообщи actual reserve, actual usage/cost, reasoning tokens only if provider returned them, status, attempts, calls, draft/revision, public error и WEB count. Не запускай второй job даже при budget-overrun или quality failure.

## Приёмка

План принят только если AITUNNEL Gemini narration имеет explicit request limits, preflight reservation, fail-stop при overrun/unknown usage, максимум два calls/один attempt, отсутствие fallback, честную telemetry и ни одного нового платного вызова без разрешения.
