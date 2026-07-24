# Prompt 07 — точная диагностика тайминга AITUNNEL narration и управляемое восстановление

Этот файл — последовательность из четырёх самостоятельных handoff-prompts для **четырёх новых чатов Codex**. Не объединяй их в один diff и не переходи к следующему пункту, пока предыдущий не завершён, проверен и честно отчитан.

## Зафиксированный контекст

- Рабочий каталог: `D:\presentation`.
- Сначала всегда прочитать `AGENTS.md` и проверить `git -c safe.directory=D:/presentation status --short`.
- Сохранять чужие изменения. В частности, не трогать пользовательский файл `.audit-bmw/tmpw120oeib/enlarged.pptx` и не добавлять generated `apps/web/tsconfig.tsbuildinfo`.
- Уже staged изменения пакета включают cost envelope, source-query shaping, compact AITUNNEL fallback prompt и безопасную quality telemetry. Не откатывать их и не смешивать с legacy/defense/Yandex путями.
- Последний контролируемый smoke: project `cmrzar1zp000bqu0k6cjoc9bm`, job `208`. Candidate Lite и fallback Flash оба были отклонены локальным quality gate с нормализованной причиной `duration`. Fallback стоил `5.802615` и не превысил reservation `6.5`; это **не** budget overrun.
- Действующий contract 10-слайдовой русской университетской речи живёт только в `packages/shared/src/generation/speech-timing.ts`: 9–12 минут, 1170/1300/1560 слов и targets 80/140/100. Не копировать эти числа в новую независимую конфигурацию.
- Любой реальный AI-вызов платный. Без отдельного явного разрешения пользователя нельзя запускать `npm run smoke:generation:live`, повторять job или делать provider call.

## Порядок

1. Prompt 07.1 — структурированные безопасные причины timing rejection.
2. Prompt 07.2 — направляемый fallback prompt для каждой timing причины.
3. Prompt 07.3 — детерминированные тесты и release checks.
4. Prompt 07.4 — один контролируемый runtime/E2E прогон (только после отдельного разрешения пользователя).

---

## Prompt 07.1 — структурированные безопасные причины timing rejection

Скопируй этот раздел в новый чат Codex.

```text
Работай в D:\presentation. Сначала полностью прочитай AGENTS.md, проверь git status и изучи staged/unstaged изменения. Не меняй и не откатывай несвязанные пользовательские изменения.

Выполни только Prompt 07.1 из plans/cost-controlled-presentation-generation/07-aitunnel-narration-timing-recovery-handoff.md. Не выполняй Prompt 07.2–07.4, не запускай paid AI-вызовы и не делай deploy без отдельного разрешения.

Цель: вместо одного слишком широкого AITUNNEL qualityReason="duration" получить структурированную безопасную timing-причину, достаточную для следующего fallback prompt, но не сохранять текст ответа модели, source excerpts, raw validation message или stack trace.

Контекст кода:
- apps/worker/src/tasks/presentation/narration/processing.ts: validateNarrationSections() сегодня создаёт строковые issues для whole-speech и per-slide ограничений.
- apps/worker/src/tasks/presentation/providers/generation.ts: validateAitunnelNarration() и classifyAitunnelNarrationRewriteFailure() сейчас сводят timing к "duration".
- packages/shared/src/generation/speech-timing.ts — единственный источник timing budget.

Требования:
1. Введи небольшой тип/структуру безопасной диагностики именно для AITUNNEL narration. Она должна отличать как минимум:
   - whole speech below minimum;
   - whole speech above maximum;
   - section below its lower boundary;
   - section above its upper boundary;
   - section sentence-count violation.
   Не кодируй в ней generated text, title слайда, excerpt, реальное число слов, raw Error.message или provider detail.
2. Получай эту структуру детерминированно на уровне локальной narration validation. Предпочти typed result/issue code вместо парсинга произвольного текста Error.message. Существующий public error и общий failure category должны остаться безопасными.
3. Передай безопасную timing-причину в AITUNNEL telemetry и в контекст fallback. Сохрани совместимость существующей широкой категории NarrationRewriteFailureCategory, если она нужна остальному коду: timing detail не должен ломать Yandex или другие пути.
4. Не логируй и не сохраняй отвергнутую narration, raw issue string, source text или provider response. В log/event допустимы только короткие перечислимые коды.
5. Не меняй cost envelope, provider/model routing, число попыток или shared timing contract в этой задаче.

Добавь узкие unit/regression tests для каждого safe timing code и для отсутствия raw detail в telemetry/prompt-facing data. Запусти релевантные worker tests и typecheck. В финале перечисли файлы, тесты, безопасные коды и оставшиеся ограничения. Не коммить и не запускай Docker/E2E без отдельного запроса.
```

## Prompt 07.2 — направляемый fallback prompt

Скопируй этот раздел в следующий новый чат только после завершения Prompt 07.1.

```text
Работай в D:\presentation. Сначала прочитай AGENTS.md, проверь git status и результаты Prompt 07.1. Не меняй и не откатывай несвязанные пользовательские изменения.

Выполни только Prompt 07.2 из plans/cost-controlled-presentation-generation/07-aitunnel-narration-timing-recovery-handoff.md. Не запускай paid AI-вызовы, не делай Docker rebuild и не переходи к Prompt 07.3–07.4 без отдельного указания.

Цель: AITUNNEL Flash fallback должен получать компактную, точную и безопасную инструкцию, соответствующую typed timing reason из Prompt 07.1, чтобы исправлять именно short/long whole speech или section-level проблему без отправки отвергнутого текста.

Требования:
1. Работай в apps/worker/src/tasks/presentation/prompts/builders.ts и связанных типах. Используй getRussianStudentSpeechTimingBudget() из packages/shared/src/generation/speech-timing.ts; не дублируй 1170/1300/1560 и per-slide targets в новой константе.
2. Для каждого timing reason сформулируй отдельное направление:
   - whole speech below minimum: развить содержательное объяснение и доказательства по плану, распределить объём по всем секциям, без filler;
   - whole speech above maximum: сократить повторения и второстепенные детали, не выбрасывая причинно-следственную линию;
   - section below/above: исправить распределение объёма в секциях при сохранении общего диапазона;
   - sentence-count violation: соблюсти локальные границы предложений и естественную устную форму.
3. Prompt должен оставаться context-light: фиксированный plan (order/title/key message), до четырёх коротких source snapshot excerpts, safe reason и shared budget. Не передавай rejected narration, raw validation error, stack trace, полный research brief или все тексты sources.
4. Не ослабляй 10-slide timing contract. Не меняй max_output_tokens, cost buckets или число provider calls без отдельного доказательства и отдельной задачи.
5. Сохрани остальные recovery rules: Lite candidate, максимум один Flash fallback, никакого третьего paid call, safe public failure при двух rejects.

Добавь tests, которые доказывают, что каждая timing reason приводит к нужному compact guidance, использует shared budget и не включает sentinel rejected text/raw detail. Запусти targeted worker tests и typecheck. В финале покажи файлы, тесты, размер/границы prompt и оставшиеся риски. Не коммить, не запускай Docker и не делай paid E2E.
```

## Prompt 07.3 — детерминированные tests и release checks

Скопируй этот раздел в следующий новый чат только после завершения Prompt 07.2.

```text
Работай в D:\presentation. Сначала прочитай AGENTS.md, проверь git status и результаты Prompts 07.1–07.2. Не меняй и не откатывай несвязанные пользовательские изменения.

Выполни только Prompt 07.3 из plans/cost-controlled-presentation-generation/07-aitunnel-narration-timing-recovery-handoff.md. Не запускай paid AI-вызовы и не делай runtime/Docker проверку: это отдельный Prompt 07.4.

Цель: закрепить timing recovery deterministic tests так, чтобы новый E2E был единственной недетерминированной проверкой, а не способом отладки базовой логики.

Требования:
1. Добавь или обнови fixture-based tests для:
   - whole speech below minimum -> safe short reason -> один Flash prompt с short guidance;
   - whole speech above maximum -> safe long reason -> один Flash prompt с long guidance;
   - section-level short/long и sentence-count причины -> точная category/guidance;
   - отсутствие rejected text/raw detail в prompt, logger/event payload и thrown public path;
   - valid Lite candidate -> один narration call;
   - invalid Lite -> valid Flash -> ровно два calls;
   - оба invalid -> ровно два calls и no third call;
   - fallback reservation/usage failure -> no extra call.
2. Проверь, что tests используют shared speech timing contract вместо захардкоженных 10-slide чисел там, где это возможно.
3. Запусти сначала целевые worker tests: presentation, narration budget, cost envelope, source snapshot, economic release gate, generation, image search, presentation quality. Затем `npm run check` и `npm run test`.
4. Если check/test создаёт apps/web/tsconfig.tsbuildinfo, не включай его в diff и не затирай пользовательские изменения. Не вноси unrelated cleanup.
5. Проверь `git diff --check`, staged/unstaged scope и подготовь краткий список ровно затронутых файлов. Не коммить.

В финале дай честный отчёт: результаты каждой команды, изменённые файлы, точный contract safe timing reasons, и готовность/неготовность к одному paid E2E. Если всё зелёное, попроси отдельное явное разрешение на Prompt 07.4.
```

## Prompt 07.4 — один контролируемый runtime/E2E прогон

Скопируй этот раздел в новый чат только после Prompts 07.1–07.3 и только когда пользователь отдельно написал «разрешаю один paid E2E».

```text
Работай в D:\presentation. Сначала прочитай AGENTS.md, проверь git status, результаты Prompts 07.1–07.3 и staged scope. Не меняй и не откатывай несвязанные пользовательские изменения.

Пользователь явно разрешил ровно один paid E2E. Выполни только Prompt 07.4 из plans/cost-controlled-presentation-generation/07-aitunnel-narration-timing-recovery-handoff.md.

Запреты: не повторяй smoke, не ставь второй job, не делай deploy и не выполняй другой платный AI-вызов независимо от результата. Не раскрывай секреты из .env.

Порядок:
1. Выполни read-only preflight: docker compose ps, API health http://localhost:4000/v1/health и Caddy internal-health. Если runtime code менялся только в worker, пересобери/перезапусти только worker после успешных deterministic checks; если менялся shared/API contract, пересобери минимальный корректный набор API+worker. Не пересобирай web без причины.
2. Запусти один раз npm run smoke:generation:live с RUN_LIVE_GENERATION_SMOKE=true, TEMP_USER_ID и INTERNAL_API_TOKEN, загруженными локально без вывода значений.
3. При успехе проверь project/job, 10 slides, sources, accepted narration, production quality gate, export, envelope reservations/settlements и total ≤10 ₽. Дай breakdown candidate/fallback/source costs и укажи, был ли fallback.
4. При неуспехе не повторяй run. Read-only извлеки project.error, GenerationJob, AiUsageEvent, CostEnvelope/CostEnvelopeReservation и последние worker logs. Сообщи только safe timing reason, без narration/provider response и секретов.
5. В финале коротко укажи project/job id, результат, число paid calls, cost breakdown, safe reason (если есть), live URLs, изменённые файлы и единственный следующий шаг. Не коммить без отдельного запроса.
```

## Готовый порядок для пользователя

Открывай **по одному новому чату** и отправляй только короткое сообщение вида:

```text
Работай в D:\presentation. Прочитай AGENTS.md, проверь git status и открой plans/cost-controlled-presentation-generation/07-aitunnel-narration-timing-recovery-handoff.md. Выполни только Prompt 07.1. Сохрани несвязанные изменения, не запускай paid AI и не делай deploy.
```

После отчёта и проверки результата замени `07.1` на `07.2`, затем на `07.3`. Для последнего чата сначала явно добавь разрешение:

```text
Работай в D:\presentation. Прочитай AGENTS.md, проверь git status и выполни только Prompt 07.4 из plans/cost-controlled-presentation-generation/07-aitunnel-narration-timing-recovery-handoff.md. Разрешаю ровно один paid E2E без повторов.
```

