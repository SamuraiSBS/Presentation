# 16 — Yandex narration: output budget и соблюдение длины без новых paid retries

## Скопируй этот prompt в новый чат Codex

Работай в `D:\presentation`.

Сначала прочитай `AGENTS.md`, затем строго по порядку:

- `plans/future-generation-reliability/README.md`;
- `plans/future-generation-reliability/14-yandex-full-rewrite-duration-compliance-and-controlled-smoke.md`;
- `plans/future-generation-reliability/15-web-search-cost-event-telemetry-repair.md`;
- этот файл.

Перед любыми изменениями выполни `git status --short`. Рабочее дерево может быть грязным: сохрани чужие изменения, не делай `reset`, `checkout`, массовое форматирование или cleanup чужих файлов. Выполни **только** этот пункт; не переходи к следующему plan-файлу.

Не изменяй старые проекты, документы, `Presentation.revision`, `speechDraft` существующих проектов или пользовательские canvas. Изменение относится только к новым narration jobs.

## Неподвижные продуктовые границы

- Единственный author речи — Yandex. Нельзя добавлять OpenAI, `demo`, `demo-fallback`, второго provider или provider fallback.
- Default narration model остаётся текущим `yandexgpt/latest`. Не оставляй `YANDEX_NARRATION_*` override в `.env` и не повышай candidate автоматически.
- Для 10-slide `university_student` сохраняется диапазон 1170–1560 слов / 9–12 минут. Не ослабляй minimum и не меняй presets 6/8/12/14.
- Сохраняется ровно один full duration rewrite. Нельзя добавлять третий narration call, chunk/per-section extension, автоматический rerun job или локальное добивание слов.
- `normalizeNarrationText(...)`, `validateNarrationSections(...)` и `findSpokenNarrationIssues(...)` остаются единственными gatekeepers. Не создавай параллельный validator и не принимай короткий text по новой эвристике.
- Не копируй narrative-plan поля, не склеивай invalid draft с новым текстом и не показывай provider payload, старый draft или внутреннюю ошибку в public UI.
- Не трогай web-search/source relevance, CostEvent fix из пункта 15, planning/design provider tiers, billing prices или admin UI.

## Подтверждённые наблюдения, а не готовый диагноз

После пункта 14 были выполнены два изолированных narration smoke с одним и тем же текстовым Saturn fixture, `fast_draft`, 10 slides, `university_student` и без Tavily:

| Run | Narration model | Initial + full rewrite | Final shortfall | Yandex narration output tokens |
|---|---|---:|---:|---:|
| baseline | `yandexgpt/latest` | 2 text calls | 441 words / 3.4 min | 497 + 697 |
| candidate | `yandexgpt-5.1` | 2 text calls | 585 words / 4.5 min | 616 + 884 |

Оба job правильно стали safe failure, `speechDraft` не был сохранён. Candidate длиннее, быстрее и дешевле, но всё ещё не прошёл gate и поэтому не может быть production default.

В текущем коде `requestYandexText(...)` передаёт `completionOptions.maxTokens` (по умолчанию `8000`), но narration callers не задают отдельный explicit output budget. Это **гипотеза для проверки**, а не разрешение просто увеличить число: сначала установи фактический request payload, ответ/finish signal, provider usage и применимый Yandex limit. Не делай вывод только из output-token count.

## Цель

Устранить подтверждённую техническую причину преждевременно короткой full narration либо, если такой причины в request path нет, усилить только наиболее узкий, доказуемо слабый narration output-contract seam. После изменения новая 10-slide narration должна иметь максимальную вероятность вернуть цельный, содержательный текст в 1170–1560 слов без filler, plan leakage или повторов.

Это не разрешение ухудшать quality-first policy ради количества. Если diagnosis не даёт воспроизводимой причины и не позволяет предложить минимальное безопасное изменение, не вноси speculative production change: закончи с evidence report и запроси направление пользователя.

## 1. Фактический аудит до кода

Прочитай и свяжи реальные вызовы и тесты:

- `apps/worker/src/tasks/presentation/narration/processing.ts` — `requestYandexText`, completion request/response, usage recording и error path;
- `apps/worker/src/tasks/presentation/providers/generation.ts` — initial narration, one full duration rewrite, `NARRATION_MAX_PROVIDER_ATTEMPTS`;
- `apps/worker/src/tasks/presentation/prompts/builders.ts` — initial/full-rewrite builders и `getYandexModelConfig(...)`;
- `apps/worker/src/tasks/presentation/constants.ts` — `NARRATION_SYSTEM_PROMPT`;
- `packages/shared/src/generation/speech-timing.ts` — shared budgets;
- `apps/worker/src/tasks/presentation.test.ts`, `apps/worker/src/tasks/presentation/prompts/builders.test.ts`, `apps/worker/src/tasks/web-search.ts` и `apps/worker/src/usage-ledger.ts` — existing mocks/contracts/telemetry.

Ответь доказательствами из кода на каждый вопрос:

1. Какой exact `completionOptions` у initial narration и full rewrite: `maxTokens`, temperature, response format и model URI/tier?
2. Одинаков ли output-budget path для initial text, full rewrite и targeted spoken rewrite? Если различается, почему?
3. Какие completion-response поля могут различить provider truncation, stop by model, empty alternative, unsafe output или обычное раннее завершение? Есть ли они в локальном `YandexCompletionResponse` type и сохраняются ли безопасно в logs/usage?
4. Применим ли declared `maxTokens: 8000` к доступному Yandex model URI и реальному API, или этот параметр может быть silently capped/ignored? Для current external API fact используй только актуальную официальную Yandex Cloud документацию; не делай paid request ради проверки.
5. Имеет ли prompt/previous invalid answer такой размер, что оставляет недостаточный output context, или model останавливается задолго до лимита? Измеряй characters/tokens детерминированно на fixture, не печатай user source/prompt в report/logs.
6. Убедись, что full rewrite действительно имеет только один provider call после shortfall, а `shouldRetryNarration(...)` не создаёт скрытый third call.
7. Убедись, что current safe failure discards invalid speech and keeps neutral public error.

Сделай короткую diagnosis matrix «гипотеза → deterministic evidence → вывод → действие/не-действие». Не предполагай, что `maxTokens` уже является причиной только потому, что оно существует.

## 2. Выбор минимального изменения

После аудита выбери только одну ветку, которая подтверждена кодом/tests/docs.

### Ветка A — request/output-budget defect

Если параметр отсутствует, неверно передан, расходится между initial/rewrite или ниже подтверждённого необходимого Yandex limit:

1. Добавь один именованный локальный narration output-budget constant/config рядом с narration request seam. Его значение должно быть подтверждено официальной документацией и достаточным для 1170–1560 русских слов с headers, но не применяться к economy planning, design, structured slides или image/search tasks.
2. Передай его явно только в initial full narration, full duration rewrite и, если технически тот же full-speech contract нужен, targeted spoken rewrite. Не меняй `requestYandexText` default для остальных callers без доказанной необходимости.
3. Сохрани current temperature/model routing/default alias. Не добавляй environment override для normal users, если static supported budget достаточен.
4. В safe structured logs/telemetry добавь только technical metadata: model alias, requested output budget, returned output tokens when present, word count/duration after validation и recovery kind. Не сохраняй/не логируй сам text, prompt, source excerpt, key или folder ID.

### Ветка B — budget уже корректен, слаб только output contract

Если request действительно отправляет достаточный supported budget и ответ заканчивается сильно раньше лимита:

1. Не повышай число calls и не дроби narration. Измени только `buildNarrationPrompt(...)`/`buildFullNarrationDurationRewritePrompt(...)` или маленький pure helper рядом с ними.
2. Сохрани установленную редакционную структуру из пункта 14: один section на slide, 10 headers, 105+ слов на первом, 130+ на финальном и 115–145 на средних sections для 10 slides.
3. Добавь model-visible preflight checklist: перед выводом модель сверяет, что все required headers есть ровно один раз, sections развивают explanation/example/evidence/consequence и суммарный текст находится в budget. Сформулируй как требование к готовому тексту, а не как visible planner fields или meta-commentary.
4. Прямо запрети «сократить ответ, потому что источников мало»: при thin fixture допустимы осторожные качественные объяснения, но нельзя выдумывать факты, повторять формулы или оставлять sections пустыми.
5. Не вставляй в prompt synthetic filler, подсчёт слов после каждого предложения, forced одинаковые фразы или previous invalid narration как материал для продолжения.

### Ветка C — причина не доказана

Если provider docs/response shape не позволяют отличить cap от model choice, или ни A, ни B не имеет детерминированной проверки:

- не меняй production behavior;
- сохрани findings и конкретный blocked question в final report;
- не делай paid retry;
- не переходи к экспериментам или model promotion без нового отдельного plan и разрешения пользователя.

## 3. Обязательные deterministic tests

Все Yandex/Tavily/Prisma/network calls mock. Fixtures должны честно проходить `normalizeNarrationText` и headers contract; не скрывай дефект локальной искусственной длиной.

Добавь или расширь focused tests для выбранной ветки:

1. Initial narration и единственный full duration rewrite передают одинаковый подтверждённый narration-only output budget; non-narration Yandex callers не меняются. Для ветки B вместо этого докажи отсутствие изменения request options.
2. 10-slide full-rewrite prompt содержит 1170–1560, десять sections, budget-derived section guidance, preflight/self-check requirement и запреты на filler/planner leakage.
3. Prompt для 6/8/12/14 slides использует их shared budget, а не ten-slide numbers.
4. Short initial + valid full replacement делает ровно два Yandex text calls; short replacement делает safe failure, без третьего call/OpenAI/demo/local extension.
5. Existing targeted spoken rewrite остаётся awaited и при duration shortfall всё ещё переходит к единственному full rewrite.
6. Request payload exposes only permitted technical telemetry и never includes narration/source text in new log fields.
7. Existing Yandex-only/no-demo/no-OpenAI, timing boundary (1170/1560 valid; 1169/1561 invalid) и public error/redaction tests остаются зелёными.

Если добавляется pure helper, помести его рядом с prompt/request seam и test directly. Не добавляй DB migration только ради debug metadata, пока current `AiUsageEvent`/`OperationalEvent`/structured log cannot satisfy observability requirement.

## 4. Проверки до runtime

Выполни:

```powershell
npm run test -w @studydeck/worker -- presentation.test.ts presentation-quality.test.ts prompts/builders.test.ts
npm run typecheck -w @studydeck/worker
npm run build -w @studydeck/shared
docker compose config --quiet
git diff --check
```

Если Vitest в sandbox падает с `spawn EPERM`, повтори ту же команду разрешённым способом. Не ослабляй tests ради обхода sandbox.

## 5. Paid smoke только после отдельного нового разрешения

Не выполняй paid Yandex/Tavily request автоматически, даже после всех зелёных checks. Сначала сообщи пользователю:

- exact resolved narration model и отсутствие/наличие override;
- fixed source context: один fixture или explicit empty WEB set;
- что будет создан **один** новый isolated 10-slide `university_student` project, без Tavily;
- maximum job count = 1, maximum narration text calls = initial + one full rewrite;
- expected pricing per million tokens и консервативный RUB estimate.

После явного разрешения:

1. Пересобери/перезапусти только worker, если source/worker code менялся.
2. Runtime-проверкой докажи `AI_PROVIDER=yandex`, `ALLOW_DEMO_GENERATION=false`, пустой `OPENAI_API_KEY`, default alias без override. Не показывай секреты.
3. Создай новый project, не используй smoke/A-B projects 23.07.2026. Для baseline не меняй `.env`; для candidate нужен отдельный будущий plan и отдельное разрешение.
4. После job зафиксируй: resolved model, request budget, actual text-call count, input/output tokens, text latency, RUB cost, words, duration, spoken issue count, project/job status и public error. Отрицательный outcome обязан показать safe failure без сохранённого draft.
5. Не повторяй job. Не делай automatic retry и не меняй configuration после failure.

## Приёмка

Пункт принят, если:

- diagnosis отделил подтверждённый request/provider fact от гипотезы;
- внесён только минимальный доказуемый change либо честно зафиксирован blocker без speculative change;
- default provider/model, timing minimum, one-full-rewrite policy, safe failure и старые данные не изменены;
- deterministic tests подтверждают output contract, отсутствие лишних calls/fallback и сохранность других presets;
- paid calls не сделаны без нового разрешения;
- final report содержит root cause/evidence, затронутые файлы, test results, production model, live result (если разрешён), total paid cost и remaining risk.

