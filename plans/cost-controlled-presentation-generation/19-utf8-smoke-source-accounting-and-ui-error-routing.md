# Plan 19 — UTF-8-safe narration smoke, source accounting and honest failure UI

## Зачем нужен этот план

Единственный paid E2E после Plan 18 не дошёл до генерации речи. Он создал один
проект и один narration job, но русские `title` и `prompt`, отправленные ручным
PowerShell-запросом, сохранились как `?`. Tavily получил повреждённую тему,
вернул только один принятый источник, а обязательный source snapshot остановил
job до первого AITUNNEL-вызова.

Этот запуск нельзя использовать как доказательство качества новой
`candidate → full rewrite → targeted repair` схемы. Он также выявил две
отдельные проблемы:

1. состоявшийся Tavily-запрос записал `CostEvent=0.50 RUB`, но envelope остался
   с `settledRub=0`, reservation получил `provider_error`, хотя HTTP-запрос был
   успешным и расход уже возник;
2. UI показал сообщение о провале проверки качества «после всех попыток», хотя
   narration provider не вызывался и попыток восстановления речи не было.

Plan 19 исправляет только эти доказанные блокеры и подготавливает один новый
E2E. Он не меняет речевой контракт Plan 18, модели, лимит 20 RUB или количество
narration-вызовов.

## Зафиксированные свидетельства

- Historical project: `cms3e0fy30003o10j0rry52mx`.
- Historical GenerationJob: `cms3e0g5y0005o10j87mt54ut`; BullMQ job `231`.
- Project/job: `failed`; sources: `1`; `speechDraft`: отсутствует.
- `AiUsageEvent`: `0`; AITUNNEL narration calls: `0`.
- Один Tavily `CostEvent`: `0.50000000 RUB`.
- Envelope v6: limit `20`, reserved `0.5`, settled `0`, status `exhausted`.
- Source reservation: `provider_error`, reason
  `mandatory_source_search_insufficient`.
- В сохранённых title/prompt нет кириллицы; русские символы заменены на `?`.
- На странице речи показано ошибочное сообщение о quality recovery.

Все эти записи исторические и неизменяемые. Не retry, не delete и не
переписывать их для получения более красивого результата.

## Неподлежащие изменению условия

1. Рабочий каталог: `D:\presentation`; перед каждым prompt полностью читать
   `AGENTS.md`, Plan 18, этот файл и проверять
   `git -c safe.directory=D:/presentation status --short`.
2. Сохранять все несвязанные изменения грязного рабочего дерева.
3. Future standard envelope остаётся
   `standard-generation-cost-envelope-v6` с hard cap ровно `20.00000000 RUB`.
4. Речь: 10 секций, 1170–1560 слов, 9–12 минут при 130 слов/мин.
5. Не более трёх narration-вызовов:
   `narration_full_candidate → narration_full_rewrite → narration_targeted_repair`.
6. Модели и caps Plan 18 остаются прежними, если отдельный детерминированный
   расчёт не докажет блокер:
   Lite `4500`, Flash `4500`, Lite repair `1400`.
7. При usable, но не принятой речи сохраняется редактируемый лучший черновик.
8. Пользователю нельзя показывать числовой дефицит слов, provider/model,
   recovery internals или raw validation reason.
9. Ни один prompt 19.1–19.4 не вызывает Tavily/AI, не создаёт paid request и не
   делает commit/deploy.
10. Prompt 19.5 разрешён только после отдельной точной пользовательской
    авторизации. Любой результат — терминальный; повтор запрещён.

## Целевая схема

```text
UTF-8-safe narration-only smoke
  → one project
  → one narration job
  → mandatory Tavily search with exact Russian topic
  → charged search reconciled whether sources are sufficient or not
  → candidate / optional rewrite / optional repair
  → accepted speech or editable best draft
  → stop; no presentation job and no export job
```

## Prompt 19.1 — UTF-8-safe narration-only smoke harness

Запускать в новом чате. Это только реализация и детерминированные тесты, без
Docker и provider calls.

```text
Работай в D:\presentation.

Полностью прочитай AGENTS.md,
plans/cost-controlled-presentation-generation/18-full-speech-recovery-and-editable-best-draft-20-rub.md,
plans/cost-controlled-presentation-generation/19-utf8-smoke-source-accounting-and-ui-error-routing.md
и проверь:

git -c safe.directory=D:/presentation status --short

Сохрани все несвязанные изменения. Выполни только Prompt 19.1. Не запускай
Tavily, AI, live smoke, Docker rebuild/deploy и не делай commit.

Исправь live narration smoke seam так, чтобы будущий Plan 19 E2E:

1. Принимал явные параметры title и prompt/topic, а не использовал
   захардкоженную тему.
2. Передавал JSON в API гарантированно как UTF-8:
   - явный `application/json; charset=utf-8`;
   - явные UTF-8 bytes либо Node `fetch + JSON.stringify`;
   - не полагался на неявную кодировку Windows PowerShell.
3. Создавал ровно один project и ровно один narration GenerationJob.
4. Останавливался после terminal narration result (`script_ready` или
   `failed`) и никогда не вызывал narration PATCH accept, presentation
   generation или export.
5. Не имел автоматического retry и не создавал второй project/job при timeout,
   HTTP error или terminal failure.
6. Безопасно печатал только project ID, GenerationJob ID, queue job ID,
   статусы и stage; не печатал prompt, speechDraft, sources или secrets.
7. Имел deterministic/dry-run режим, который не обращается к API и доказывает:
   - русская тема после serialize/deserialize полностью совпадает с исходной;
   - есть кириллические символы и нет замены на `?`;
   - body имеет UTF-8 content type;
   - flow содержит один create и один narration enqueue, без accept/export.

Не исправляй source accounting и UI в этом prompt.

Добавь релевантные тесты. Запусти targeted tests, нужный typecheck,
npm run check и git diff --check для затронутого scope. В конце дай полный
отчёт: files, контракт harness, тесты, ограничения и `paid request started: no`.
Не переходи к Prompt 19.2.
```

## Prompt 19.2 — точный учёт стоимости Tavily при insufficient sources

Запускать в новом чате с отчётом 19.1. Никаких provider calls.

```text
Работай в D:\presentation. Полностью прочитай AGENTS.md, Plans 18–19,
git status и приложенный отчёт Prompt 19.1. Сохрани несвязанные изменения.
Выполни только Prompt 19.2.

Не запускай Tavily, AI, live smoke, Docker rebuild/deploy и не делай commit.

Исправь reconciliation для обязательного source search.

Доказанный сценарий:
- Tavily HTTP request успешно вернулся;
- recordCostEvent записал web_search 0.50 RUB;
- после relevance filtering осталось меньше трёх источников;
- envelope получил exhausted/provider_error, но settledRub остался 0.

Требуемый контракт:

1. Различай:
   - provider request не состоялся или завершился transport/HTTP failure;
   - provider request состоялся и тарифицируется, но accepted sources
     недостаточно для mandatory snapshot.
2. Во втором случае source reservation обязан учесть фактически возникший
   policy cost ровно один раз:
   - CostEvent и reservation относятся к одному project/job/envelope;
   - envelope.settledRub отражает 0.50 RUB;
   - reserved/settled/released totals остаются арифметически согласованными;
   - envelope может стать exhausted из-за source insufficiency, но уже
     состоявшийся расход не маскируется как нулевой и не называется provider
     transport error.
3. Не делай второй Tavily call и не разрешай narration после insufficient
   mandatory snapshot.
4. Replay/idempotency не должен повторно settle CostEvent или reservation.
5. Исторические envelopes/rows не изменяй и не делай backfill.
6. Общий v6 limit остаётся 20 RUB, source bucket — 0.50 RUB.

Добавь тесты минимум для:
- successful sufficient search → settled source reservation;
- successful but insufficient search → charged exactly once, envelope
  exhausted, narration calls zero;
- HTTP/provider failure до chargeable success;
- replay после каждого исхода;
- суммы CostEvent/reservation/envelope;
- отсутствие prompt/source text в telemetry.

Запусти targeted worker tests, worker typecheck, npm run check, npm run test и
git diff --check. В финале дай before/after ledger math, files, tests,
remaining limitations и `paid request started: no`. Не переходи к 19.3.
```

## Prompt 19.3 — честная API/UI маршрутизация ошибки

Запускать в новом чате с отчётами 19.1–19.2.

```text
Работай в D:\presentation. Прочитай AGENTS.md, Plans 18–19, git status и
приложенные отчёты 19.1–19.2. Сохрани несвязанные изменения. Выполни только
Prompt 19.3.

Не запускай Tavily, AI, live smoke, Docker rebuild/deploy и не делай commit.

Исправь API/UI classification так, чтобы источник ошибки не выдавался за
исчерпание попыток качества речи.

Требования:

1. Введи или используй существующий безопасный typed reason для публичной
   маршрутизации, например source_preparation_failed, narration_failed,
   editable_draft и accepted. Не отдавай raw internal error.
2. Если mandatory source preparation завершилась до первого narration call:
   - UI не показывает «Автоматическая подготовка не прошла проверку качества
     после всех попыток»;
   - UI показывает нейтральное честное сообщение о том, что речь подготовить
     не удалось и проект сохранён;
   - сообщение не утверждает, что текст/черновик сохранён, если speechDraft
     отсутствует;
   - допустима кнопка ручного повторного запуска, но UI сам её не нажимает и
     backend не делает automatic retry.
3. Если usable editable best draft сохранён:
   - открывается обычный редактор «Речь по слайдам»;
   - нет recovery banner, numeric deficit, provider/model и quality internals;
   - обычный счётчик слов/времени допустим.
4. Если accepted speech сохранена, обычный flow не меняется.
5. Project.error и API response остаются безопасными, локализованными и не
   содержат raw reason, число недостающих слов или provider detail.
6. Не меняй речевой контракт, v6 budget или provider routing.

Добавь API и web tests минимум для source failure without draft, malformed
failure without draft, editable draft, accepted speech и запрета numeric
warning. Запусти targeted API/web tests, typecheck API/web, npm run check,
npm run test и git diff --check.

В финале покажи state → public UI mapping, files, tests и
`paid request started: no`. Не переходи к 19.4.
```

## Prompt 19.4 — детерминированный preflight и localhost readiness

Запускать в новом чате с отчётами 19.1–19.3. Разрешён только локальный rebuild
затронутых сервисов; paid provider requests запрещены.

```text
Работай в D:\presentation. Полностью прочитай AGENTS.md, Plans 18–19,
git status и приложенные отчёты 19.1–19.3. Сохрани несвязанные изменения.
Выполни только Prompt 19.4.

Никаких Tavily/AI calls, live smoke, новых project/job, deploy или commit.

1. Самостоятельно проверь diff и все изменения 19.1–19.3.
2. Запусти полный deterministic gate:
   - UTF-8 round-trip русской темы;
   - narration-only one-project/one-job control flow;
   - никакого accept/presentation/export;
   - Tavily sufficient/insufficient/provider-failure ledger math;
   - source failure → честное UI message;
   - editable draft → обычный editor без recovery warning;
   - v6 exact 20 RUB и max production shapes всех narration stages;
   - 1170–1560 words / 10 sections / at most 3 calls;
   - historical v5 и сохранённые проекты не меняются.
3. Запусти npm run check и npm run test.
4. Если deterministic gate зелёный, пересобери и пересоздай только реально
   затронутые localhost services. Не делай broad deploy.
5. После rebuild проверь:
   - API health;
   - web 3010;
   - worker running without OOM/restarts;
   - BullMQ generation states все 0;
   - queued/active GenerationJob отсутствуют;
   - worker содержит v6 policy и актуальный smoke harness;
   - startup logs безопасны.
6. Выполни dry-run harness внутри фактической runtime-среды без HTTP POST и
   докажи сохранность кириллицы и отсутствие provider request.

Если любой gate не пройден, не запускай paid E2E и дай подробный blocker
report. Если всё пройдено, ответь «готово к одному paid E2E Plan 19» вместе с
полными доказательствами. Не ограничивайся одной фразой и не переходи к 19.5.
```

## Prompt 19.5 — ровно один новый paid E2E после отдельной авторизации

Использовать только после успешного 19.4 и только если пользователь в новом
чате явно написал приведённую ниже авторизацию.

```text
Разрешаю ровно один новый paid E2E Plan 19 без повторов.

Работай в D:\presentation. Прочитай AGENTS.md, Plans 18–19, git status и
приложенный отчёт Prompt 19.4. Сохрани все несвязанные изменения. Не коммить и
не делай deploy.

Выполни только Prompt 19.5.

Перед provider request проверь API health, worker stability, пустую BullMQ
generation queue и отсутствие queued/active GenerationJob. Если gate не
пройден, не создавай project/job и сообщи `paid E2E не начат`.

Только при зелёном gate запусти ровно один раз новый UTF-8-safe
narration-only smoke:

- title: `Французская революция: причины, основные этапы и последствия`;
- prompt: содержательная русскоязычная университетская речь по этой теме;
- slideCount: 10;
- mode: with_sources;
- target: 1170–1560 слов, 9–12 минут при 130 слов/мин.

Разрешено:
- ровно один новый project;
- ровно один narration GenerationJob;
- один обязательный Tavily search этого job;
- максимум три narration calls по v6 state machine;
- общий hard cap одного envelope ровно 20 RUB.

Запрещено:
- второй project/job;
- retry smoke, job, Tavily или provider call при любом исходе;
- accept narration, presentation job или export;
- исправление кода после обнаруженной ошибки;
- расширение бюджета.

После terminal narration result останови только worker и собери read-only:
- project ID, GenerationJob ID, queue job ID и statuses;
- сохранность русской title/prompt только как safe Unicode counts/hash, без
  полного вывода prompt;
- sources count и source snapshot status;
- 10 speech sections, total/per-section word counts и минуты;
- outcome accepted/editable_draft/no_usable_draft;
- candidate/rewrite/repair stages и число calls;
- model, actual input/output usage и cost каждой вызванной стадии;
- AiUsageEvent, CostEvent, envelope/reservations, reserved/settled/released;
- отсутствие превышения 20 RUB либо точный overrun;
- фактический UI страницы «Речь по слайдам»;
- отсутствие misleading quality message при source failure;
- отсутствие numeric deficit/recovery warning при editable draft;
- queue и worker state после завершения.

Не показывай speech text, source text, prompts, secrets или raw provider body.
Дай полный отчёт независимо от результата. Не повторяй запуск.
```

## Acceptance criteria Plan 19

- Русская тема гарантированно проходит через smoke harness и API как UTF-8.
- Paid validation создаёт один project и один narration job, без скрытого
  presentation/export continuation.
- Chargeable Tavily response учитывается в envelope даже при insufficient
  accepted sources; CostEvent и settledRub не противоречат друг другу.
- Source insufficiency не называется provider transport error или narration
  quality exhaustion.
- UI не показывает сообщение «после всех попыток», если narration calls не
  начинались.
- Editable best draft открывается как обычная редактируемая речь без numeric
  recovery warning.
- Речевой контракт Plan 18, три вызова и hard cap 20 RUB остаются неизменными.
- Historical projects/envelopes/jobs не retry, не delete и не rewrite.
- Только Prompt 19.5 может создать новый paid request, ровно один раз и после
  отдельной авторизации пользователя.

## Как пользоваться планом

1. Открыть новый чат и выполнить только Prompt 19.1.
2. Передать его полный отчёт в новый чат Prompt 19.2.
3. Аналогично выполнить 19.3 и 19.4, каждый в новом чате.
4. Не писать «разрешаю» до успешного отчёта 19.4.
5. После `готово к одному paid E2E Plan 19` открыть новый чат, вставить Prompt
   19.5 и только тогда дать точную авторизацию одного запуска.
6. При любом blocker остановиться; не переходить к следующему prompt.
