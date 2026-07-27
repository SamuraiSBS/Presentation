# Plan 18 — full-speech recovery and editable best draft within 20 ₽

Use **one numbered prompt in one fresh Codex chat**. This plan replaces the
unreliable per-slide narration experiment for future standard AITUNNEL
generations. It does not retry historical jobs, reinterpret v4/v5 envelopes,
or rewrite saved projects.

## Why the previous route must be replaced

The latest runtime evidence is no longer ambiguous:

- the source-search, worker-readiness and cost-ledger paths work;
- the first short opening section can pass, while a normal content section
  repeatedly fails the floor-aware `word_range` gate;
- Lite candidate, per-slide Flash fallback and the one-use so-called global
  rewrite can all complete at the provider and still return too little text;
- the current `narration_global_rewrite` is not global: it rewrites only the
  current section;
- deterministic fixtures prove the state machine and reservation lifecycle,
  but they fabricate exact-length outputs and cannot prove live model length
  compliance;
- raising local section floors prevents a short deck from being accepted, but
  does not make the model produce a longer coherent speech.

The product decision is therefore to stop generating ten independent
sections. A future run must create one coherent draft, measure it locally,
give a real full-document rewrite the previous draft plus exact safe length
diagnostics, and retain a usable best draft if bounded recovery is exhausted.

## Locked product decisions

1. The user wants a Russian university speech for 10 slides in the existing
   **9–12 minute / 1170–1560 word** range, with a meaningful target of 1300
   words. `packages/shared/src/generation/speech-timing.ts` remains the single
   source of truth.
2. Reliable delivery is more important than preserving the old 18.20 ₽ cap.
   The new hard ceiling is exactly **20.00000000 ₽** for one complete standard
   generation envelope.
3. The previous generated draft may be sent back to the same AITUNNEL provider
   for a bounded rewrite. It must not be printed or placed in logs/telemetry.
4. When precise source anchors are insufficient, the narration may use
   cautious general educational explanation: definitions, mechanisms,
   causes, consequences, examples, limitations and conclusions. It must not
   invent precise names, dates, statistics, quotations or citations.
5. If all bounded AI recovery stages are exhausted, preserve the best
   structurally usable draft in `Project.speechDraft` for manual editing.
6. Do **not** tell the user how many words are missing. Do not add a banner such
   as `Черновик содержит 1034 из 1170 слов` or `Добавьте 136 слов`. The normal
   “Речь по слайдам” editor may retain its existing total time/word indicator,
   but recovery internals and numeric deficit instructions remain private.
7. A saved editable best draft is not accepted narration. Presentation
   assembly remains unavailable until the current user-edited text passes the
   canonical server-side narration contract.

## New bounded narration state machine

For future 10-slide AITUNNEL standard jobs use:

`mandatory source snapshot → Lite narrative plan → full Lite speech draft → local validation → optional full Flash rewrite → optional one-call Lite targeted repair → accepted narration or editable best draft`.

There are at most **three narration text calls** in one job:

1. `narration_full_candidate`
   - model: `gemini-3.5-flash-lite`;
   - one complete ten-section speech;
   - target 1300 words, canonical `Слайд N: ...` headers;
   - suggested maximum output budget: 4500 tokens, subject to deterministic
     provider-catalog preflight.
2. `narration_full_rewrite`
   - model: `gemini-3.6-flash`;
   - eligible only when the candidate returned usable text but did not pass
     the complete local narration contract;
   - receives the complete previous draft, total word count, per-section word
     counts, safe issue codes, fixed narrative plan and bounded factual
     context;
   - rewrites the **entire speech**, rather than one section;
   - suggested maximum output budget: 4500 tokens, subject to deterministic
     preflight.
3. `narration_targeted_repair`
   - model: `gemini-3.5-flash-lite`;
   - eligible only after a structurally usable full Flash rewrite remains
     outside the contract because of a bounded set of section defects;
   - receives the current complete draft, safe per-section diagnostics and
     requests replacement text only for the affected slide orders;
   - replacements are merged locally by exact slide order and the complete
     result is revalidated;
   - exactly one call, suggested maximum output budget 1800 tokens, subject to
     deterministic preflight.

There is no fourth narration call, no second targeted repair, no second job,
no automatic provider change, and no BullMQ retry after a terminal narration
result. Provider, missing-usage, pricing and budget failures never authorize
an extra call.

## Prompt and content contract

### Full candidate

The candidate prompt must contain enough material to support a long speech:

- project topic and request;
- exact 10-slide narrative plan with title, purpose, key message,
  evidence/explanation and why-it-matters fields;
- a bounded source snapshot with compact evidence, not just one 40–120
  character anchor for the current slide;
- explicit permission to add cautious general educational explanation when
  sources do not support additional precise facts;
- whole-speech range 1170–1560 and target 1300;
- soft distribution targets 80 / 140 / 100 from shared timing;
- natural spoken Russian, approximately 5–9 sentences for a normal content
  section when meaning requires it;
- an instruction to count and review the whole response before returning it.

Do not make the floor-aware independent-section bounds the automatic hard
acceptance rule for a full-document model answer. The whole-document range is
authoritative. Per-section checks should reject only empty, fragmentary or
pathologically unbalanced sections; the model may distribute a coherent
speech unevenly when the argument requires it.

### Full rewrite

The Flash rewrite is an actual correction loop. It receives:

- the complete candidate text;
- safe typed issue codes;
- exact total and per-section word counts;
- target total and soft per-slide targets from shared timing;
- the exact amount and location of under/over-allocation as structured
  numeric data;
- the fixed plan and bounded source snapshot.

It must return a fresh complete ten-section speech. It may preserve strong
content from the candidate, expand thin reasoning, remove repetition and
redistribute detail. It must never expose validation language to the user.

### Targeted repair

The final Lite call is a single batch, not a per-slide loop. It may replace one
or several explicitly identified sections. The response schema must map exact
slide orders to complete replacement sections. Local code must reject missing,
duplicate or unexpected slide orders and must never concatenate a partial
provider response blindly.

## Automatic acceptance versus editable recovery

Introduce an internal typed narration outcome, for example:

```ts
type NarrationGenerationOutcome =
  | { kind: "accepted"; text: string; stage: NarrationRecoveryStage }
  | { kind: "editable_draft"; text: string; stage: NarrationRecoveryStage };
```

The exact name may follow existing conventions, but callers must no longer
receive only `string` or an exception.

### Accepted outcome

Return `accepted` only when the complete text has:

- exactly 10 unique ordered sections;
- total length 1170–1560 words;
- no empty/fragmentary section;
- no planning formulas, provider commentary, prompt echo, generic filler or
  severe repetition;
- natural readable speech and valid canonical headers.

Persist it as the canonical `speechDraft`. Existing local presentation
assembly remains unchanged and must reproduce it in `generatedText`,
`speakerNotes` and `speechScript` without new model calls.

### Editable-draft outcome

When all eligible calls are exhausted, select the best **structurally usable**
attempt. An attempt is eligible only when it contains exactly ten ordered,
non-empty sections and does not contain provider commentary, prompt leakage,
template placeholders or another severe quality/safety defect.

Rank eligible attempts deterministically:

1. fewer severe and structural issues;
2. complete canonical section coverage;
3. text within the 1560-word maximum;
4. smaller distance from the 1300-word target;
5. when both are below target and otherwise equal, prefer the longer draft;
6. use stage order only as the final tie-breaker, never assume Flash is better
   merely because it is newer or more expensive.

Persist only the chosen best text; rejected alternatives remain in memory for
the duration of the job and are never logged or stored. If no attempt is
structurally usable, keep the existing neutral terminal failure and do not
save misleading content.

For an editable draft:

- set the project to the normal editable speech state (`script_ready`) and
  clear the old public `narration_quality_failure` message;
- complete the narration job without presenting recovery as a provider error;
- open the ordinary “Речь по слайдам” editor;
- do not add a new warning banner, numeric deficit, “add N words” instruction,
  provider/model reference or technical quality category;
- keep internal safe telemetry for stage, issue codes, word counts, token
  usage, costs, reservation lifecycle and outcome kind;
- do not enqueue or build a presentation automatically.

When the user later requests presentation assembly, validate the **current
edited text** on the server. If it is still invalid, remain on the speech page
and use only the existing neutral review guidance, without a numerical deficit
message. Once it passes, save it as accepted and run the existing deterministic
presentation job with zero narration AI calls.

## Exact v6 economic contract

Create a new persisted policy version, for example
`standard-generation-cost-envelope-v6`. Never reinterpret historical v4/v5
snapshots.

| Bucket | Model / purpose | Reservation |
| --- | --- | ---: |
| `sources` | mandatory Tavily snapshot | 0.50 ₽ |
| `narrative_plan` | Lite structured plan | 0.75 ₽ |
| `narration_full_candidate` | Lite full speech | 2.50 ₽ |
| `narration_full_rewrite` | Flash complete rewrite | 13.50 ₽ |
| `narration_targeted_repair` | Lite one-call section batch | 1.50 ₽ |
| `images` | bounded visuals | 0.50 ₽ |
| `export_infra` | local assembly/export allowance | 0.75 ₽ |
| **exact cap** |  | **20.00 ₽** |

Before the first narration provider request:

- build the real bounded candidate request;
- build a deterministic maximum-shape rewrite request using the candidate
  output ceiling, maximum bounded plan/source context and diagnostic payload;
- build a deterministic maximum-shape targeted-repair request;
- calculate reservations from the persisted AITUNNEL catalog and exact token
  caps;
- prove candidate ≤2.50 ₽, rewrite ≤13.50 ₽ and repair ≤1.50 ₽;
- atomically create exactly three narration reservations in the same envelope.

If any request cannot fit its bucket, make zero narration calls. Do not silently
shrink the 1170-word product contract. First reduce redundant prompt context or
return a deterministic preflight failure.

Reservation lifecycle:

- accepted candidate releases rewrite and repair;
- accepted rewrite releases repair;
- targeted repair settles normally if used;
- editable-draft recovery releases every unused row;
- provider/budget/usage failure releases every still-unused row while keeping
  settled calls immutable;
- replay cannot repeat a settled/released stage or create duplicate calls.

## Likely implementation surfaces

- `packages/shared/src/generation/cost-envelope.ts`
  - v6 policy, new buckets and exact 20.00 ₽ sum;
  - preserve historical snapshots.
- `packages/shared/src/generation/speech-timing.ts`
  - keep the existing 1170/1300/1560 contract;
  - add shared helpers only if needed to distinguish full-document hard rules
    from soft section distribution.
- `apps/worker/src/aitunnel-narration-budget.ts`
  - replace future section-stage policies with the three v6 narration stages;
  - explicit models and output caps.
- `apps/worker/src/tasks/presentation/prompts/builders.ts`
  - full candidate, full rewrite and targeted-repair builders;
  - previous draft allowed in rewrite/repair but never logs.
- `apps/worker/src/tasks/presentation/providers/generation.ts`
  - three-call state machine, typed outcomes, best-attempt scoring, atomic
    reservation and ordered release.
- `apps/worker/src/tasks/presentation/narration/processing.ts`
  - separate full-document acceptance, salvage eligibility and safe metrics;
  - avoid destructive local filler or truncation.
- `apps/worker/src/tasks/presentation/orchestrator.ts`
  - propagate the typed narration outcome.
- `apps/worker/src/tasks/generation.ts`
  - persist both accepted and editable outcomes safely;
  - do not turn an editable draft into project failure.
- `apps/api/src/projects/projects.service.ts`
  - validate the current edited draft before accepting and queueing slides;
  - preserve neutral public behavior.
- `apps/web/src/components/project-script-review-query.tsx`
  - no new numeric recovery warning;
  - if touched, use the shared timing rate instead of a divergent local rate;
  - preserve the ordinary editable speech experience.
- deterministic worker/shared/API/web tests.

Avoid a database migration unless a durable new field is genuinely required.
The minimal route reuses `speechDraft`, `speechDraftUpdatedAt`, `script_ready`
and the existing job/usage/envelope records. Do not overload `Project.error`
with private metrics.

## Prompt 18.1 — shared policy, prompts and validation contract

Run in a fresh Codex chat. This prompt is deterministic only.

```text
Работай в D:\presentation. Полностью прочитай AGENTS.md,
plans/cost-controlled-presentation-generation/17-plan-14-16-execution-summary.md,
plans/cost-controlled-presentation-generation/18-full-speech-recovery-and-editable-best-draft-20-rub.md
и выполни git -c safe.directory=D:/presentation status --short. Сохрани все
несвязанные изменения.

Выполни только Prompt 18.1. Не запускай paid AI, smoke, Docker rebuild/deploy,
не создавай project/job и не коммить.

Реализуй фундамент Plan 18 для будущих AITUNNEL standard generations:

1. Создай persisted policy v6 с exact cap 20.00000000 ₽ и buckets:
   sources 0.50, narrative_plan 0.75, narration_full_candidate 2.50,
   narration_full_rewrite 13.50, narration_targeted_repair 1.50, images 0.50,
   export_infra 0.75. Не меняй historical v4/v5 snapshots.
2. В aitunnel stage policy добавь ровно три будущих narration text stages:
   Lite full candidate, Flash full rewrite и Lite targeted repair. Начальные
   output ceilings 4500/4500/1800 tokens допустимы только если реальные
   deterministic worst-case requests помещаются в buckets по persisted catalog.
3. Создай три prompt builders. Candidate получает весь compact plan и bounded
   source snapshot. Rewrite получает полный предыдущий draft, safe total/per-slide
   word counts и issue codes. Repair получает текущий draft и возвращает typed
   replacements только нужных slide orders. Разреши осторожное общеобразовательное
   объяснение без выдуманных точных фактов. Не используй per-slide 2–7 sentence
   constraint как причину снова сделать речь короткой.
4. Раздели canonical full-document acceptance и salvage eligibility. Hard success:
   10 sections, 1170–1560 words, no severe quality issues. Full-document total —
   authority; section targets 80/140/100 являются soft distribution guidance.
5. Добавь typed outcome accepted/editable_draft и deterministic best-attempt
   selector по правилам Plan 18. Никакой текст attempts не логируется и не
   сохраняется на этом этапе.

Покрой shared/worker unit tests: exact policy sum, models/caps, worst-case prompt
preflight, safe prompt contents, full acceptance, salvage eligibility и ranking.
Fixtures должны использовать правдоподобные token usage и не выдавать искусственный
exact word output за доказательство поведения live model.

Запусти targeted tests, worker/shared typecheck и git diff --check. Не переходи
к Prompt 18.2. В финале перечисли files, policy math, contracts, test results и
оставшиеся gaps.
```

## Prompt 18.2 — worker state machine and silent editable recovery

Use a fresh chat and attach the complete Prompt 18.1 report.

```text
Работай в D:\presentation. Прочитай AGENTS.md, Plan 18, git status и приложенный
отчёт Prompt 18.1. Сохрани несвязанные изменения. Выполни только Prompt 18.2.
Не запускай paid AI, smoke, Docker rebuild/deploy или commit.

Реализуй bounded future AITUNNEL narration state machine:
candidate → optional full rewrite → optional one-call targeted repair.
До первого call атомарно резервируются ровно три narration rows одного v6 envelope.
Provider/budget/usage failures не создают дополнительный call. BullMQ narration
job не retry.

Rewrite обязан получать полный candidate и фактические safe counts/issues.
Targeted repair обязан возвращать typed complete replacements только запрошенных
slide orders; merge локальный и повторно валидирует весь документ. Сохрани в памяти
все structurally usable attempts до terminal decision и выбери best draft
детерминированно.

Измени orchestration/persistence:
- accepted outcome сохраняется как canonical speechDraft;
- после исчерпания recovery editable_draft также сохраняется в speechDraft,
  project становится script_ready, job завершается без public quality error;
- не enqueue presentation автоматически;
- если usable draft отсутствует, остаётся neutral safe failure;
- unused reservations освобождаются последовательно, settled rows immutable.

Не показывай пользователю word deficit, “добавьте N слов”, provider/model,
qualityReason или recovery banner. Не записывай эти данные в Project.error.
В private safe telemetry допустимы counts/codes/stages/costs, но не speechDraft,
prompts, sources или provider response.

Добавь deterministic tests минимум для:
1. valid candidate: one call, accepted, later rows released;
2. short candidate → valid full rewrite: two calls;
3. candidate/rewrite invalid → valid targeted repair: three calls;
4. all three structurally usable but still short: best draft saved, script_ready,
   no public error, no presentation job;
5. malformed/no usable attempt: terminal safe failure, no saved bad draft;
6. provider/usage/budget failure after a usable earlier draft: no extra call,
   best draft recovery where accounting remains safe;
7. replay/idempotency and ordered terminal releases;
8. no attempt text in logs or persisted telemetry.

Запусти targeted worker tests, worker typecheck и git diff --check. Не переходи
к Prompt 18.3. В финале дай files, state transitions, persistence behavior,
tests и gaps.
```

## Prompt 18.3 — API/UI acceptance and deterministic preflight

Use a fresh chat and attach reports from Prompts 18.1–18.2.

```text
Работай в D:\presentation. Прочитай AGENTS.md, Plan 18, git status и приложенные
отчёты 18.1–18.2. Сохрани несвязанные изменения. Выполни только Prompt 18.3.
Никаких paid AI, smoke, Docker rebuild/deploy или commit.

Заверши API/UI contract и полный deterministic preflight.

1. Обычная страница “Речь по слайдам” должна открывать editable best draft так
   же, как обычный speechDraft. Не добавляй warning/banner с числом слов,
   недостающим количеством или инструкцией “добавьте N слов”. Не показывай
   provider/recovery/quality internals.
2. При accept/generate сервер валидирует текущий пользовательский draft. Пока
   он не проходит canonical 10-section / 1170–1560 / severe-quality contract,
   presentation job не создаётся. Public response остаётся нейтральным и без
   числового дефицита. После ручной правки valid text принимается и существующая
   local presentation assembly выполняется без narration AI.
3. Если UI продолжает показывать обычную оценку времени/слов, используй shared
   130 words/minute contract, а не отдельное деление на 120. Это обычный счётчик,
   не recovery warning.
4. Проверь v6 exact 20 ₽, три narration reservations, prompt maximum shapes,
   all state-machine branches, best-draft persistence, API queue gate, no public
   numeric warning, release behavior, source/ledger reconciliation and absence
   of regressions in deterministic presentation assembly.

Запусти relevant shared/worker/API/web tests, typecheck worker/api/web,
npm run check, npm run test и git diff --check. Если Windows даёт spawn EPERM,
повтори только affected Vitest suite в single-thread и честно отчитай обе команды.

В конце ответь только “готово к E2E” или “не готово к E2E”: evidence, changed
files, required runtime services и одна exact future smoke command. Остановись.
```

## Prompt 18.4 — exactly one paid E2E after separate authorization

Use only after Prompt 18.3 reports `готово к E2E` and only after a new explicit
user authorization.

```text
Разрешаю ровно один новый paid E2E Plan 18 без повторов.

Работай в D:\presentation. Прочитай AGENTS.md, Plan 18, git status и приложенный
отчёт Prompt 18.3. Сохрани несвязанные изменения. Не коммить.

Пересобери только services, доказанно затронутые diff. До smoke проверь API
health, worker Running/OOM/startup stability и пустые BullMQ generation states.
Если preflight не прошёл, не создавай project/job и сообщи “paid E2E не начат”.

Только при зелёном preflight ровно один раз запусти isolated
RUN_LIVE_GENERATION_SMOKE=true; npm run smoke:generation:live с локально
загруженными secrets без их вывода. Не создавай второй project/job и не повторяй
smoke при любом исходе. После terminal result останови только worker.

Read-only проверь safe project/job state, outcome accepted/editable_draft,
наличие 10-section speechDraft, narration call stages/count, AiUsageEvent,
v6 CostEnvelope, reservations, CostEvent reconciliation, queue и worker state.
Не показывай speech text, prompts, sources, raw validation errors или secrets.

Accepted outcome обязан иметь 1170–1560 words. Editable-draft outcome считается
корректным recovery, если project=script_ready, usable speechDraft сохранён,
public error отсутствует, presentation job не создан и UI не показывает
числовой deficit/recovery warning. Не retry для получения более красивого исхода.
```

## Acceptance criteria

- Future standard AITUNNEL narration uses at most three text calls, not 21
  independent section calls.
- A full Flash rewrite sees the previous full draft and exact safe length
  diagnostics.
- A single targeted Lite repair can replace a bounded set of sections without
  another per-slide loop.
- Automatically accepted narration always contains 10 sections and 1170–1560
  words.
- Exhausted but usable output is preserved as an editable `speechDraft` rather
  than discarded behind `narration_quality_failure`.
- The user is not shown a numeric deficit, “add N words” instruction, provider
  detail or recovery banner.
- A still-invalid edited draft cannot enqueue presentation generation; a valid
  edited draft continues through the existing zero-AI local slide assembly.
- The v6 envelope is exactly 20.00 ₽, has exactly three narration reservations,
  releases unused rows, reconciles costs and cannot replay provider calls.
- Historical projects, jobs, v4/v5 snapshots and saved presentations remain
  unchanged.

## Operating rules for the user

1. Start with Prompt 18.1 in a fresh chat.
2. Use one numbered prompt per fresh chat and attach the preceding final report.
3. Do not combine implementation, preflight and paid validation.
4. Do not write `Разрешаю` before Prompt 18.4. It authorizes exactly one new
   paid smoke, never a retry.
5. If any prompt reports a blocker or `не готово к E2E`, pass that report to a
   new diagnostic chat instead of skipping the failed gate.
6. Do not ask for a commit until implementation and deterministic verification
   have been reviewed separately.
