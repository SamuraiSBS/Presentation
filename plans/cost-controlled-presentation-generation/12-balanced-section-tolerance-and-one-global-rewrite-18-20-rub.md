# Plan 12 — section tolerance ±30% and one global Flash rewrite within 18.20 ₽

Use **one numbered prompt in one new Codex chat**. This plan changes only
future AITUNNEL generations. It does not rewrite saved presentations.

## Product decision locked by this plan

Keep the shared ten-slide speech contract unchanged:

- 9–12 minutes, 1170–1560 words, target 1300;
- target distribution: 80 words on slide 1, 140 on slides 2–9, and 100 on
  slide 10;
- the canonical full-document gate remains the final authority.

Change only the reliability policy around an individual section:

1. The local admissible word range becomes **±30%**, calculated centrally
   from each existing shared target. For ten slides this is 56–104 words on
   slide 1, 98–182 on slides 2–9, and 70–130 on slide 10. The prompt must
   still aim at 80/140/100 rather than deliberately aiming for a boundary.
2. Add exactly one **global extra Flash slot** for the whole narration job.
   It is a complete replacement of the *current failed section*, not a
   rewrite of the whole document. It becomes eligible only after that section
   has failed both its Lite candidate and its per-slide Flash fallback with a
   local quality error. It may be used once across all ten slides.
3. Reserve the global slot before the first provider call, in the same
   persisted envelope as all other narration calls. It must be preflighted
   against the compact rewrite prompt for every possible slide order.
4. Raise the hard ceiling from 17.00 ₽ to **18.20 ₽**. This buys one bounded
   extra Flash section call, not an unbounded retry loop.

The observed failure motivating the plan was safe `word_range` rejection for
both the Lite candidate and the Flash fallback of slide 2. The system safely
stopped, released all unused reservations, and made no further paid calls.
Do not rely on, print, store, or send rejected narration text to a model.

## Exact economic contract

Create a new persisted policy version, for example
`standard-generation-cost-envelope-v5`; never reinterpret existing v4 rows.

| Bucket group | Reservation |
| --- | ---: |
| sources | 0.50 ₽ |
| narrative plan | 0.75 ₽ |
| 10 Lite candidates | 10 × 0.25 ₽ = 2.50 ₽ |
| 10 per-slide Flash fallbacks | 10 × 1.20 ₽ = 12.00 ₽ |
| one global Flash section rewrite | 1.20 ₽ |
| images | 0.50 ₽ |
| export/infra | 0.75 ₽ |
| **exact cap** | **18.20 ₽** |

The new stage and bucket are named `narration_global_rewrite`. It uses only
`gemini-3.6-flash`, keeps the existing 384-token section output cap, and has
one stable idempotency key per envelope:
`<envelopeId>:narration_global_rewrite`.

The global slot is not eligible for provider errors, missing usage, pricing
errors, budget errors, a full-document duration failure, or any later repair.
Those outcomes retain the existing safe failure behavior. If all ten sections
pass without the slot, release it with a safe `global_rewrite_not_needed`
reason. If it was not used at a terminal failure, release it together with all
other unused rows. A settled global call is never released or reused.

## Invariants

- `packages/shared/src/generation/speech-timing.ts` remains the only source
  of truth for targets and the new local tolerance. Do not duplicate 56/104,
  98/182, or 70/130 in worker prompts or validators.
- `normalizeNarrationText()` still enforces the unchanged whole-speech
  1170–1560 range. Passing an individual ±30% section does not bypass the
  final gate.
- All 21 potential narration reservations (10 candidates, 10 fallbacks, one
  global slot) are atomically created before the first AITUNNEL narration
  provider call. If any worst-case prompt exceeds its bucket or the batch is
  rejected, make zero narration provider calls.
- A section can make at most: Lite candidate → per-slide Flash fallback → the
  one global Flash slot only when it has not been used by any earlier slide.
  There is no fourth call, no second global slot, no second job, no automatic
  provider routing, and no local filler/truncation.
- The global slot receives only the original compact context for the current
  slide: project context, current slide order/title/key message, target and
  admissible range, one or two short source anchors, and a safe quality
  category. It must never receive either rejected section, a raw validation
  message, a stack trace, or the full source corpus.
- Existing Plan 11 serial terminal-release behavior must remain intact: no
  unused reservation may remain `reserved` after terminal failure.
- Public errors remain neutral. Private telemetry includes only safe category,
  safe reason, stage, slide order, bucket, reservation/settlement/release
  amounts, and release reason; never secrets, prompts, sources, or narration.

## Likely implementation surfaces

- `packages/shared/src/generation/speech-timing.ts` — export a named helper
  for the section target and inclusive ±30% word bounds.
- `packages/shared/src/generation/cost-envelope.ts` — v5 policy, 18.20 ₽ cap,
  and the global rewrite bucket; keep the exact-sum invariant.
- `apps/worker/src/aitunnel-narration-budget.ts` — add the global-rewrite
  stage to the type union and stage policy as primary/Flash with 384 tokens.
- `apps/worker/src/tasks/presentation/prompts/builders.ts` — use the shared
  bounds in candidate/fallback wording and create a compact global-rewrite
  builder without rejected content.
- `apps/worker/src/tasks/presentation/providers/generation.ts` — reserve and
  release the new slot, preflight all ten possible global prompts, enforce
  one-per-job use, and retain the final full-document gate.
- Deterministic shared and worker tests, especially
  `apps/worker/src/cost-envelope.test.ts`,
  `apps/worker/src/aitunnel-narration-budget.test.ts`,
  `apps/worker/src/tasks/presentation.test.ts`, and
  `apps/worker/src/tasks/presentation/providers/generation.persisted-envelope.test.ts`.

Do not add a database migration unless a schema change is genuinely required;
this policy is persisted as a new snapshot for new envelopes.

## Prompt 12.1 — implement the four locked changes

Start a new Codex chat and paste exactly this text:

```text
Работай в D:\presentation. Прочитай AGENTS.md, проверь
`git -c safe.directory=D:/presentation status --short` и полностью прочитай
`plans/cost-controlled-presentation-generation/12-balanced-section-tolerance-and-one-global-rewrite-18-20-rub.md`.

Выполни только Prompt 12.1 этого плана. Сохрани все несвязанные изменения,
включая .audit-bmw/tmpw120oeib/enlarged.pptx, apps/web/tsconfig.tsbuildinfo и
любые чужие правки. Не меняй legacy MVP, Yandex/OpenAI paths, defense, старые
сохранённые презентации или уже созданные CostEnvelope snapshots.

Реализуй для будущих AITUNNEL generation ровно четыре связанные изменения:

1. Сохрани общий контракт из packages/shared/src/generation/speech-timing.ts:
   10 slides, 1170–1560 words, target 1300, targets 80/140/100. Добавь в
   shared единственный helper для target и inclusive ±30% section word bounds.
   Worker prompt builders и validator должны импортировать его, а не
   дублировать математику. Локальные границы для ten-slide deck: 56–104,
   98–182 и 70–130. Полный canonical document gate не ослабляй.

2. Создай новую persisted policy v5 с hard cap 18.20000000 ₽ и exact buckets:
   sources 0.50, narrative_plan 0.75, ten candidates ×0.25, ten per-slide
   fallbacks ×1.20, narration_global_rewrite 1.20, images 0.50 и export_infra
   0.75. Старые v4 snapshots не меняй. Политика должна иметь точную сумму,
   и создаваемый новый envelope должен сохранять v5 snapshot.

3. Добавь narration_global_rewrite как ровно один Flash/gemini-3.6-flash
   section slot на job с текущим 384-token cap. До первого provider call
   preflight-вычисли worst-case request для candidate/fallback всех 10 slides
   и global rewrite prompt каждого из 10 slides; создай одним
   reserveCostEnvelopeBatch 21 unique reservation rows в одном envelope.
   Сама global row одна, с idempotency key
   <envelopeId>:narration_global_rewrite. Любой preflight/batch failure даёт
   safe failure до narration provider call.

4. Выполняй sections последовательно. После Lite quality failure используй
   существующий Flash fallback текущего слайда. Только если fallback также
   выбросил локальный AitunnelNarrationSectionQualityError и global slot ещё
   не использован, сделай один глобально-единственный Flash replacement этой
   же section. Это не full-document rewrite. Он получает только компактный
   safe prompt: тема/проект, current slide order/title/key message, target и
   shared bounds, 1–2 коротких source anchors и safe quality category. Не
   передавай rejected text, raw validator error, stack trace или full sources.
   Успех продолжает со следующим Lite candidate; global failure либо следующий
   dual quality failure после уже использованного slot — terminal safe failure
   без новых calls. Provider/usage/pricing/budget failures и global final
   1170–1560 failure не получают этот slot.

Сохрани current Plan 11 serial release invariant. При all-Lite или обычном
candidate/fallback success освобождай global row с global_rewrite_not_needed.
При terminal stop освобождай все неиспользованные candidate/fallback/global
rows exactly once; settled rows не переписывай и global slot не используй
повторно. Обнови MAX_AITUNNEL_NARRATION_TEXT_CALLS только если это нужно для
правдивой telemetry upper bound (теперь максимум 21 provider section calls).

Улучши prompt wording так, чтобы модель стремилась к shared target (не к
границе), заранее проверяла свой объём, и сохраняла 2–7 естественных
предложений без filler. Не добавляй локальный padding/truncation и не меняй
модель, provider или max output tokens.

Покрой deterministic tests без сети и paid calls:
- v5 policy exact 18.20 ₽ и ровно 21 narration rows;
- shared bounds 56–104 / 98–182 / 70–130 и неизменный full 1170–1560 gate;
- preflight каждого candidate/fallback/global prompt в своём bucket;
- all-Lite path: 10 calls, все ten fallbacks и global row released;
- observed route: slide 2 Lite and per-slide fallback fail word_range, one
  global Flash replacement succeeds, then path continues without second global call;
- global slot already consumed, later dual quality failure: no second global
  request and every unused row released;
- global provider/usage/price failure, terminal release, replay/idempotency
  and prompt-log safety; no rejected sentinel, raw reason or source corpus in
  prompt/logs;
- all ten individually valid sections but global duration failure: no 22nd
  model call and unused global reservation released.

Запусти targeted shared/worker tests, typecheck worker/api/web, npm run check,
npm run test и git diff --check. Не запускай paid AI, smoke, Docker rebuild or
deploy. Не коммить.

В конце отчитайся: затронутые файлы; точная математика policy; state machine;
результаты всех команд; что осталось для preflight. Остановись и не переходи
к Prompt 12.2 сам.
```

## Prompt 12.2 — deterministic preflight only

Use a **fresh** chat. Paste the full final report from Prompt 12.1 below the
first sentence, then paste this text:

```text
Работай в D:\presentation. Прочитай AGENTS.md, проверь git status и полностью
прочитай `plans/cost-controlled-presentation-generation/12-balanced-section-tolerance-and-one-global-rewrite-18-20-rub.md`.
Выполни только Prompt 12.2. Ни paid AI, ни smoke, ни Docker rebuild/deploy, ни
commit не разрешены. Сохрани несвязанные изменения.

Используй приложенный отчёт Prompt 12.1 как контекст, но проверь состояние
самостоятельно. Выполни только deterministic preflight для Plan 12:

- policy v5 равна 18.20000000 ₽ и exact bucket sum;
- создано 21, а не 20 narration reservation stages; global stage первичный
  Flash/384 tokens и имеет один idempotency key;
- worst-case compact global prompts всех 10 slides попадают в 1.20 ₽;
- shared ±30% bounds используются одинаково builder и validator, но
  whole-document 1170–1560 gate остаётся строгим;
- all-Lite, normal fallback, global rewrite success, second dual failure after
  global use, global failure, terminal release and final-duration failure
  покрыты deterministic tests;
- safe logs не содержат prompt, rejected narration, raw validation error,
  source corpus или секреты;
- никаких route/provider/filler/retry изменений вне этого контракта нет.

При необходимости добавь только отсутствующий deterministic test или
минимальный code fix. Затем выполни relevant worker/shared tests, typecheck
worker/api/web, npm run check, npm run test и git diff --check. Не коммить.

В конце ответь только «готово к E2E» или «не готово к E2E», с доказательствами,
необходимыми сервисами и одной точной будущей smoke-командой. Остановись.
```

## Prompt 12.3 — one paid E2E, only after new explicit permission

Do **not** send this prompt until Prompt 12.2 says `готово к E2E` and the user
separately decides to spend money. Use a fresh chat, attach the Prompt 12.2
report, and paste this exact authorization:

```text
Разрешаю ровно один paid E2E Plan 12 без повторов.

Работай в D:\presentation. Прочитай AGENTS.md и git status. Сохрани
несвязанные изменения. Пересобери только сервисы по diff; для worker-only
изменений это только worker. До запуска проверь пустую queued generation
очередь и API health.

Запусти ровно один isolated live generation smoke с
RUN_LIVE_GENERATION_SMOKE=true и локально загруженными секретами, не печатая
секреты. Не создавай второй project/job и не повторяй smoke при любой ошибке.
Сразу после terminal result останови worker.

При success проверь 10 slides, 10 accepted sections, 1170–1560 words,
production gate, completed export, envelope ≤18.20 ₽, AiUsageEvent costs и
все released reservations. При failure не повторяй: read-only извлеки
project/job, AiUsageEvent, CostEnvelope, все reservations и safe worker logs.
Покажи только safe categories, stages, costs и reservation statuses. Не
коммить.
```

## Operating rules for the user

1. Do not paste this entire file into one chat. Use only Prompt 12.1 first.
2. Create a new Codex chat for Prompt 12.2 and include the previous final
   report. This prevents the agent from silently skipping the verification
   gate.
3. Do not use the word `Разрешаю` before Prompt 12.3. It authorizes exactly
   one paid smoke, not retries or a second project.
4. If an agent reports `не готово к E2E` or a blocker, copy its final report
   back to the next chat. Do not tell it to bypass the failed check.
5. Do not ask it to commit unless you separately want a narrow, reviewed
   commit after the implementation and tests are accepted.
