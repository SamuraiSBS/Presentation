# 03e — автономное восстановление recovery bundle и единственное re-proof

## Полномочия пользователя

Пользователь явно разрешил этому одному prompt без промежуточных запросов:

- создавать отдельную чистую Git-worktree и ветку-кандидат;
- изменять код, contracts и детерминированные tests только в созданной
  worktree;
- запускать необходимые npm tests/typechecks/build checks и узкие Docker
  build/recreate/checks;
- выполнить **ровно один** новый локальный paid E2E generation run;
- при полном успехе создать **один локальный commit** в candidate branch.

`push`, remote deploy, reset/clean исходной рабочей копии, удаление данных и
любые дополнительные paid runs не разрешены.

Этим prompt пользователь заменяет прежний запрет на повтор Prompt 03 только
для одного нового re-proof ниже. Это не разрешение на второй retry, если этот
новый run завершится неуспешно.

## Цель

В исходном worktree Prompt 03 завершился failed live-run: было создано семь
envelope и не было `Presentation`. Prompt 03a подтвердил deterministic
remediation, но 03c/03d установили, что текущий dirty diff невозможно
безопасно отделить по файлам.

Создай чистый, связный candidate recovery bundle от `HEAD`, докажи его
детерминированно, затем проведи один normal user-visible paid run с одним
project и одним presentation generation. При успехе закоммить candidate. При
любой неустранимой проблеме остановись с evidence; не трать второй paid run.

## Обязательные материалы

До действий прочитай:

- `AGENTS.md`;
- `plans/generation-recovery-hardening/README.md`;
- этот prompt;
- `03-one-real-end-to-end-proof.md`, `03a-presentation-retry-envelope-remediation.md`,
  `03b-presentation-regression-triage.md`, `03c-nonpaid-diff-disposition-review.md`,
  `03d-isolated-diff-manifest.md`;
- все сохранённые отчёты Prompt 01, 02, 03, 03a, 03b, 03c и 03d.

## Непереговорные ограничения

- Исходный `D:\presentation` — read-only reference после фиксации status;
  не редактируй, не stage, не commit и не переключай его. Особенно не трогай
  `.audit-bmw/tmpw120oeib/enlarged.pptx`.
- Вся реализация идёт только в новой clean worktree от текущего `HEAD`, на
  новой ветке `codex/generation-recovery-autonomous` (или свободном варианте
  с тем же префиксом). Не используй текущий dirty diff как Git index.
- Не копируй весь dirty worktree автоматически. Каждый переносимый change
  должен войти в подтверждённый dependency closure и быть объяснён в отчёте.
- Не меняй provider keys, provider/model routing, стоимость моделей, cap,
  demo/mock policy или product requirements, чтобы «добиться» успешного run.
- Не ослабляй quality gates, не добавляй generic/demo text и не подменяй
  runtime-доказательство статическим test.
- Не выполняй remote действия (`push`, deploy, SSH, cloud changes).
- Paid E2E допускается только один раз, только после всех preflight gates.
  Если он failed, timed out, достиг cap, даёт неполные sources/quality или
  runtime не соответствует candidate — остановись без retry.

## Фаза A — изоляция и сборка dependency closure

1. В исходном worktree сохрани raw `git status --short`, current branch/HEAD
   SHA и список worktree. Ничего там не меняй.
2. Создай чистую worktree от этого SHA в новом явном пути внутри репозитория,
   например `D:\presentation\.worktrees\generation-recovery-autonomous`, на
   новой `codex/` ветке. Не удаляй существующие worktree/ветки.
3. В candidate worktree собери связный bundle вручную, используя исходный
   worktree только как read-only reference и отчёты как evidence. Начни с
   полного dependency closure, а не только с пяти 03d hunks. Включи только
   изменения, необходимые для:

   - одного inherited attempt-group / `CostEnvelope` на пользовательский run;
   - reuse source snapshot без повторного Tavily;
   - атомарного cap/reservation до каждого оплачиваемого stage;
   - local deterministic recovery из accepted narration и saved sources;
   - сохранения исходного diagnostic;
   - совместимости shared/API/worker contracts и quality gates.

4. Для каждого copied/reconstructed hunk зафиксируй: исходный файл/строки,
   prerequisite, report evidence и причину включения. Не переноси plan files,
   audit deletion, unrelated UI или неизвестные hunks.
5. Обязательно расследуй два failure из `presentation.test.ts` на candidate:
   baseline `HEAD`, candidate before/after и причинную цепочку. Если они
   являются regression candidate bundle, исправь минимальную действительную
   причину; если baseline также fails, зафиксируй как baseline limitation и
   не маскируй его.

## Фаза B — deterministic gates

В candidate worktree добавь/адаптируй минимальные tests, затем запусти
узкие проверки. Они обязаны доказывать:

1. Повтор presentation того же user run получает тот же envelope и тот же
   source snapshot; новых envelope/snapshot/Tavily calls нет.
2. `settled + reservations + new reservation > cap` атомарно блокируется до
   provider, и ни одна provider stage (narrative/design/presentation/repair)
   не вызывается.
3. При accepted speech и достаточных saved artifacts cap-blocked/terminal путь
   создаёт ровно одну local `Presentation`, проект становится `ready`,
   speaker notes/speech/slide text/source refs сохраняются.
4. Недостаточные или generic artifacts честно оставляют terminal failure,
   без Presentation/envelope/provider/Tavily.
5. Исходный operational diagnostic не заменяется public/cleanup текстом.
6. Targeted `presentation.test.ts` либо проходит на candidate, либо его
   failure доказано идентичным baseline `HEAD` и не связано с candidate.

Минимум запусти relevant worker/API tests, worker/API typechecks и
`git diff --check` в candidate. При необходимости добавь только ближайший
contract test. Не запускай широкие suites без потребности.

Перед paid run обязательны все условия:

- candidate имеет только объяснённый recovery bundle;
- relevant tests/typechecks прошли, либо baseline limitation явно отделён и
  не относится к candidate;
- `git diff --check` проходит для candidate files;
- Docker/API/worker runtime можно собрать именно из candidate worktree;
- проверены provider/model names, live `ALLOW_DEMO_GENERATION` выключен,
  demo path недоступен, а ключи не раскрываются;
- зафиксированы run cap, zero/start usage, envelope policy и отсутствие
  активных/очередных jobs для будущего нового project.

Если хотя бы один gate не проходит, не делай paid run: устрани дефект в scope
и повтори только бесплатные проверки; если неустранимо — остановись с отчётом.

## Фаза C — один локальный paid E2E

1. Из candidate worktree узко собери и recreate только затронутые runtime
   сервисы (`api`, `worker`; `web` — только если без него нельзя выполнить
   normal user-visible flow). Проверь API health, worker, Redis/Postgres/MinIO
   и зафиксируй candidate revision в runtime. Не раскрывай secrets.
2. Создай ровно один новый обычный учебный project с включёнными sources и
   запусти ровно один normal user-visible generation flow через приложение или
   его штатный API path. Не вставляй записи напрямую в БД и не используйте
   test-only shortcut, который не моделирует user flow.
3. Дождись terminal state. Никаких повторов, ручных retry и второго project.
4. Собери read-only evidence для одного project:

   - project ID, все job IDs, один attempt-group/envelope ID и final state;
   - provider/model без ключей; Tavily WEB source IDs, URLs и source refs;
   - saved accepted speech, speaker notes и slide text; quality diagnostics;
   - `Presentation` row, slide count, source refs, canvas checks и доступные
     export/parity checks;
   - полный CostEnvelope/CostEvent/AiUsageEvent ledger по stages;
   - таблицу `fact versus cap` с фактическим settled usage, cap и остатком.

При успешном re-proof обязаны одновременно выполняться: `ready`, ровно один
envelope lineage, реальный provider/model, реальные Tavily URLs, валидная
Presentation и `settled <= cap`. Иначе re-proof failed: не делать retry.

## Фаза D — commit или честная остановка

### Успех

Только если все deterministic и live criteria пройдены:

1. Проверь final candidate diff/status; убедись, что нет планов, отчётов,
   `.audit-bmw` или unrelated файлов.
2. Создай один локальный commit на candidate branch с узким conventional
   сообщением, например `fix: harden generation recovery budget lineage`.
3. Не push и не deploy.
4. Отчёт должен содержать commit SHA, exact candidate worktree path/branch,
   tests, runtime evidence и указание, что original dirty worktree не менялся.

### Неуспех

Если re-proof запрещён preflight или единственный paid run не проходит:

- не commit candidate как готовое решение;
- не переносить candidate в исходный worktree;
- не выполнять второй paid run;
- оставь candidate worktree для inspect и передай полный failure evidence.

## Итоговый отчёт и остановка

Передай один self-contained отчёт:

1. исходный HEAD, исходный status и подтверждение, что original worktree
   остался неизменным;
2. candidate worktree path, branch и полный list изменённых candidate files;
3. таблицу `requirement → files/hunks → deterministic evidence → live evidence`;
4. exact commands и raw results tests/typechecks/build/runtime checks;
5. paid-run evidence и таблицу cost fact-versus-cap, либо точную причину,
   почему paid run не выполнен;
6. commit SHA при успехе или отсутствие commit при failure;
7. явное указание: push/deploy не выполнялись.

После отчёта остановись. Не начинай другие plans автоматически: успешный
commit даёт пользователю чистую основу для следующего отдельного плана.
