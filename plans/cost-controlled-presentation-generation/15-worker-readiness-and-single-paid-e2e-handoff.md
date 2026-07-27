# Plan 15 — worker readiness before one paid E2E

## Why this plan exists

The Plan 14 smoke created exactly one narration project and job but made no
provider request: the worker had already received `SIGTERM` before the job was
created. The smoke script polls the API; it cannot make a stopped worker take a
BullMQ job. The job was later cancelled, so the generation queue is empty and
there is no pending charge.

This is an operational sequencing fix, not a change to narration, pricing,
providers, retry policy, source search, or the cost-envelope policy. The goal
is to prove the worker is alive **before** a paid project can be created.

## Locked constraints

- Work in `D:\presentation`; read `AGENTS.md`, this file, Plan 14, and Git
  status before taking action. Preserve unrelated changes.
- Keep the existing AITUNNEL v5 contract, provider/model selection, 18.20 RUB
  policy cap, 21 narration reservations, no hidden retry, and no demo fallback.
- Never print secrets, prompts, sources, narration, raw worker validation
  errors, or request payloads.
- Do not edit application code, `.env` files, Docker configuration, or plan
  files in either prompt. Do not commit.
- Only `worker` may be started or stopped. Do not rebuild any image unless the
  user explicitly asks for a rebuild or the checked diff proves the running
  worker image cannot contain the requested implementation.

## Prompt 15.1 — worker readiness only (no paid E2E)

Run this prompt in a new Codex chat first. It is deliberately operational and
must finish before any later paid decision.

```text
Работай в D:\presentation. Прочитай AGENTS.md,
plans/cost-controlled-presentation-generation/14-effective-bounds-and-narrative-plan-ledger.md,
plans/cost-controlled-presentation-generation/15-worker-readiness-and-single-paid-e2e-handoff.md
и выполни git -c safe.directory=D:/presentation status --short. Сохрани все
несвязанные изменения.

Это только readiness-preflight. Не меняй код, env-файлы, Docker-конфигурацию
или plan-файлы. Не запускай npm run smoke:generation:live, не создавай
project/job, не вызывай AI, не выполняй Docker build/deploy и не коммить.

Контекст инцидента: прошлый worker успешно вывел "studydeck worker started",
затем получил SIGTERM и был остановлен до создания smoke job. Поэтому
прошлый job был отменён; generation queue должна быть пуста. Не пытайся
оживлять или повторять исторический project/job.

Сделай только следующее.

1. Зафиксируй read-only исходное состояние:
   - API health: http://127.0.0.1:4000/v1/health;
   - все ожидательные BullMQ generation-состояния: wait, paused, active,
     delayed, prioritized, waiting-children;
   - worker container и его ExitCode/OOM/restart policy;
   - безопасный статус последнего Plan 14 project/job, без его prompt/error.

2. Если API unhealthy или generation queue не пуста, остановись. Не запускай
   worker и сообщи «не готово к E2E» с безопасными числовыми/status причинами.

3. Если worker не работает, выполни только `docker compose up -d worker`.
   Не используй `docker compose build`, не запускай api/web и не меняй
   restart policy. Если worker уже работает, не перезапускай его.

4. Докажи readiness без provider calls:
   - `docker compose ps worker` показывает running/Up;
   - `docker inspect` подтверждает Running=true, OOMKilled=false и новый
     StartedAt для текущего контейнера;
   - безопасный отфильтрованный worker log после StartedAt содержит ровно
     факт старта worker/queues, без вывода payload, prompt, source, narration
     или ошибок валидации;
   - после короткого стабильного окна (не менее 20 секунд) worker всё ещё
     Running=true;
   - API всё ещё healthy, а все шесть generation queue counts равны 0.

5. Если worker не стартует, завершает работу, queue перестала быть пустой или
   любой обязательный probe не проходит, остановись. Не создавай job и не
   запускай paid smoke. Не скрывай причину за общим «готово».

В финале скажи строго «готово к E2E» или «не готово к E2E». Укажи только
safe статусы/времена/counts, команды и факт, что paid E2E не был начат.
Если готово, worker должен остаться запущенным; следующим сообщением не
запускай E2E сам — дождись отдельного явного разрешения пользователя.
```

## Prompt 15.2 — exactly one paid E2E after a separate decision

Use this only after Prompt 15.1 reports `готово к E2E` and only after the user
explicitly authorizes one new paid validation. It is a fresh run: the cancelled
Plan 14 job must never be resumed or retried.

```text
Разрешаю ровно один новый paid E2E Plan 15 без повторов. Это новый запуск;
никогда не возобновляй и не retry отменённый Plan 14 job.

Работай в D:\presentation. Прочитай AGENTS.md,
plans/cost-controlled-presentation-generation/14-effective-bounds-and-narrative-plan-ledger.md,
plans/cost-controlled-presentation-generation/15-worker-readiness-and-single-paid-e2e-handoff.md
и git -c safe.directory=D:/presentation status --short. Сохрани несвязанные
изменения. Не меняй код, env-файлы, Docker-конфигурацию или plan-файлы и не
коммить.

Перед npm безопасно загрузи из .env только TEMP_USER_ID и INTERNAL_API_TOKEN
в текущий PowerShell-процесс, не печатая их значения. До npm убедись, что обе
переменные непустые. Если хотя бы одна недоступна, остановись до npm-команды,
не создавай project/job и сообщи «paid E2E не начат».

Затем сделай preflight без создания project/job:
- API health проходит;
- worker container Running=true, OOMKilled=false, и после его StartedAt есть
  безопасный startup-признак в log;
- worker остаётся Running=true не менее 20 секунд;
- BullMQ generation queue: wait, paused, active, delayed, prioritized и
  waiting-children — все 0.

Если любой preflight не прошёл, не запускай npm, не создавай project/job и
сообщи «paid E2E не начат». Не пытайся автоматически ремонтировать runtime,
не делай build и не запускай второй worker.

Только при успешном preflight ровно один раз выполни в том же PowerShell:
RUN_LIVE_GENERATION_SMOKE=true; npm run smoke:generation:live
Не создавай второй project/job и не повторяй smoke при любой ошибке.

Сразу после terminal result останови только worker. Затем выполни safe
read-only проверку созданного нового project/job, AiUsageEvent, CostEnvelope,
CostEnvelopeReservation и non-AI CostEvent. Покажи reconciliation:
CostEnvelope.settledRub = AI usage total + non-AI envelope CostEvent total.
Отдельно покажи source-search total.

Особый safe-cleanup договор: если после terminal result именно этот новый job
остаётся queued/active в BullMQ, ты заранее уполномочен отменить только его
штатным локальным API после остановки worker, чтобы будущий запуск worker не
потратил средства. Не retry, не удаляй project и не меняй исторические rows.
После отмены повторно read-only подтверди terminal job status и пустую queue.

Не показывай secrets, prompts, sources, raw narration, raw validation errors
или request payloads. В финале перечисли project/job statuses, safe cost
totals, reconciliation, queue status, worker status и факт отсутствия
повторов/коммитов.
```

## Acceptance criteria

- A worker stopped by `SIGTERM` blocks the run before `npm` and before any
  project/job creation.
- A newly started worker is proved alive and stable before the lone paid call.
- The live smoke is executed at most once and only with explicit authorization.
- A job stranded by a worker shutdown cannot later consume budget unnoticed.
- Ledger reporting remains safe and reconciles envelope settlement against AI
  usage plus non-AI cost events.
