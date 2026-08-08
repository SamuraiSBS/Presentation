# 03i — автономный economic-gate repair и ограниченное completion proof

## Цель

Последний реальный run 03h дошёл до accepted narration, реальных WEB sources,
одного envelope и расхода ниже cap, но был ошибочно отклонён release gate:
`EconomicReleaseGateError: cost_envelope,slide_count`.

Данный prompt исправляет этот конкретный runtime defect, проходит бесплатные
gates и завершает один финальный user-visible E2E. Он автономен для
детерминированных проблем, но не допускает неограниченных платных retries.

## Жёсткий бюджет действий

- Разрешены локальные diagnosis/edit/test/build cycles, только пока каждый
  меняет доказанную root cause и документируется.
- Разрешён максимум один новый E2E project run после passing preflight.
- После старта E2E нельзя создавать второй project, retry или новый external
  source/AI call вне штатного flow, даже если он упадёт.
- Push/deploy запрещены; local commit разрешён только при полном успехе.

Этот prompt гарантирует автономное исправление бесплатных причин, но не может
гарантировать ответ внешнего AI/search provider.

## Рабочая область и инварианты

Работай исключительно в candidate:

`D:\presentation\.worktrees\generation-recovery-autonomous`

ветка `codex/generation-recovery-autonomous`. Исходный `D:\presentation`
не трогай. Не изменяй provider routing/model, keys, prices, FX policy,
cap `27.90000000 RUB`, demo policy, source requirements или quality thresholds.
Candidate-only runtime может использовать уже разрешённый `AI_PROVIDER=aitunnel`.

## Фаза A — диагностировать и исправить economic gate

1. Извлеки read-only saved project/job/envelope/presentation-candidate
   diagnostics 03h. Подтверди точные code branches, породившие
   `cost_envelope,slide_count`.
2. Исправь gate так, чтобы он использовал contract/project/envelope truth, а
   не hard-coded legacy значения:

   - cap проверяется по persisted `settled + reservations <= envelope.limit`,
     а не сравнением limit с константой `10`;
   - slide count проверяется относительно `project.slideCount` / валидного
     presentation contract, а не обязательных 10 slides;
   - отсутствующий/невалидный envelope, over-cap, source mismatch и invalid
     presentation по-прежнему честно блокируются.

3. Не обходи gate, не возвращай unconditional pass и не ослабляй source/text/
   canvas/quality requirements.

## Фаза B — обязательные бесплатные доказательства

Добавь targeted deterministic tests минимум для:

1. 8-slide project с валидной accepted narration, valid presentation и одним
   envelope limit `27.90`, settled `15.34934`, zero reservations — release
   проходит;
2. 10-slide project проходит только при согласованном 10-slide contract;
3. `settled + reservations > limit` блокирует release;
4. invalid source/speech/canvas/presentation всё ещё блокирует release;
5. local accepted-narration recovery сохраняет один envelope и не вызывает
   provider/Tavily;
6. прежние OpenAI/AITunnel pricing, FX, source snapshot и narration 8-section
   regression tests не регрессируют.

После каждой code правки запускай только relevant worker/API tests,
typechecks и `git diff --check`. Исправляй только провалившийся доказанный
code path; не делай широких refactor или unrelated fixes.

## Фаза C — autonomous free preflight

Когда все tests зелёные:

1. Пересобери/recreate candidate API/worker из этой worktree; не меняй
   original worktree.
2. Докажи candidate image/container IDs, health, worker, Redis/Postgres/MinIO,
   demo off, AITunnel/Tavily presence без keys, cap/FX/start ledger и пустые
   generation queues.
3. Если preflight блокируется локальной configuration/build проблемой,
   исправь её автономно только в candidate и повтори бесплатный preflight.
   Если проблема требует изменения provider keys/routing/prices/cap или внешней
   инфраструктуры — остановись до E2E с evidence.

## Фаза D — один final E2E

После полного preflight создай ровно один новый `with_sources` учебный project
и запусти один normal user-visible AITunnel flow. Не делай diagnostic search,
manual retry, второй project или повтор provider call вне штатного bounded
flow.

Собери project/job/envelope IDs, real WEB URLs/refs, accepted speech/notes/
slide text, quality diagnostics, Presentation/slides/canvas/export evidence,
полный CostEnvelope/CostEvent/AiUsageEvent ledger, FX snapshot и table
fact-versus-cap.

Успех только при `ready`, valid Presentation, real sources, одном envelope,
`settled <= cap` и отсутствии demo/mock/user-visible error. При success создай
один local commit candidate branch. При failure остановись без commit и без
любых новых external calls.

## Финальный отчёт

Покажи root cause → exact fix → tests, candidate diff/status, runtime IDs,
E2E evidence/стоимость, commit SHA при успехе либо честный stop. Подтверди
отсутствие push/deploy и неизменность original worktree. После отчёта
остановись.
