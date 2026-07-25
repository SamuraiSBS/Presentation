# Prompt 08 — Gemini Lite: десять ограниченных narration sections вместо одного длинного ответа

Скопируй весь этот файл в **один новый чат Codex**. Это implementation handoff, а не разрешение на платный прогон.

## Решение и исходные данные

Проверенные пути не готовы к релизу:

- монолитная narration на 10 слайдов от Gemini/Yandex систематически не проходит duration gate;
- Gemini Flash 5+5 для project `cms08q1t10017o60j3cosiwkq`, job `214`, был остановлен **до** Flash-вызовов: `narration_budget_exhausted_failure` на atomic preflight;
- source search, retry protection и публичная safe-failure обработка при этом отработали корректно; retries после stop-condition не запускались.

Не меняй провайдера. Реализуй и подготовь к одному будущему E2E новый **Gemini Lite per-slide path**:

`source snapshot → Lite narrative plan → 10 заранее зарезервированных Lite narration sections (по одной на слайд) → локальная валидация каждой → canonical concatenation → accepted narration`.

Это не локальное дописывание текста: каждая сохранённая фраза должна быть ответом модели, прошедшим локальную проверку. Нельзя создавать filler, заменять невалидную секцию шаблоном или выпускать неполную речь.

## Режим работы и границы

Работай в `D:\presentation`.

Перед редактированием:

1. Полностью прочитай `AGENTS.md`.
2. Выполни `git -c safe.directory=D:/presentation status --short` и изучи staged/unstaged изменения.
3. Сохрани чужие изменения. Не трогай `.audit-bmw/tmpw120oeib/enlarged.pptx`, legacy MVP, defense/Yandex/OpenAI пути и уже сохранённые presentations.

Запреты:

- не запускай paid AI-вызовы, `npm run smoke:generation:live`, Docker rebuild/deploy или commit без отдельного явного разрешения пользователя;
- не добавляй нового provider, `auto` routing или автоматический provider fallback;
- не ослабляй 10-slide contract: 9–12 минут, 1170/1300/1560 слов. Единственный источник этих чисел — `packages/shared/src/generation/speech-timing.ts`;
- не передавай в модель rejected narration, raw validation errors, stack traces, полный `researchBrief` или полный текст всех sources;
- не допускай дополнительных hidden retry: в новом пути максимум десять заранее зарезервированных paid narration calls, по одному на слайд.

## Почему именно Lite и по одному слайду

`gemini-3.5-flash-lite` уже является approved economic model и существенно дешевле Flash в provider catalog. Задача каждого запроса становится ограниченной: одна секция, один key message, один slide-level timing target и минимум source context. Это надо подтвердить расчётом reservation и тестами; не считай экономичность доказанной до этого.

Старое ограничение «ровно два narration calls» из Prompt 03 отменяется **только** для этого нового per-slide Lite route. Новое ограничение сильнее с точки зрения денег: до первого сетевого вызова должны быть атомарно зарезервированы все десять section calls и все прочие платные стадии текущего run. Если это не помещается, вызовов должно быть ноль.

## Требования к реализации

### 1. Новый явный per-slide маршрут

1. В `apps/worker/src/tasks/presentation/providers/generation.ts` замени Flash 5+5 route только для нового economic AITUNNEL narration path на десять упорядоченных section requests (`slideOrder` 1…10).
2. Используй `gemini-3.5-flash-lite` для всех десяти section stages. Не используй Flash как fallback в этой задаче.
3. Дай каждому request стабильный stage и idempotency key, например `narration_section_1` … `narration_section_10`; не перегружай старые `narration_part_1/2` семантики.
4. Выполняй section calls последовательно. Перед вызовом следующего допускается только локальная проверка уже принятой секции; никакой model-based critique/repair.
5. После десяти accepted sections склей канонический текст строго в порядке 1…10 и обязательно прогони существующие full-document `normalizeNarrationText()`/quality checks. Не меняй accepted content при склейке.

### 2. Компактный section prompt и source grounding

1. Добавь отдельный builder в `apps/worker/src/tasks/presentation/prompts/builders.ts`, а не приспосабливай монолитный `buildNarrationPrompt()` строковыми заменами.
2. Prompt должен включать только:
   - тему и учебный контекст проекта;
   - номер, semantic title и key message текущего слайда;
   - target/range слов текущего слайда из `getRussianStudentSpeechTimingBudget()`;
   - естественную структуру 2–7 полных русских предложений;
   - один или максимум два коротких, релевантных source anchors из уже зафиксированного source snapshot;
   - прямое требование вернуть только одну секцию в каноническом формате `Слайд N: …`.
3. Для title/conclusion/content используй existing `titleWordTarget`, `conclusionWordTarget`, `contentWordTarget` из shared budget. Не добавляй независимые hard-coded 80/140/100.
4. Сократи системный контекст до section-specific contract только если все обязательные safeguards existing `NARRATION_SYSTEM_PROMPT` явно сохранены. Не оставляй без доказательства, что большой system prompt нужен для одного слайда.
5. Не передавай предыдущие или отвергнутые section texts обратно в модель. Межслайдовые повторы и целостность должен ловить локальный final validator.

### 3. Атомарный cost envelope и real reservation math

1. Сначала исправь accounting contract, затем routing. Current `COST_ENVELOPE_BUCKETS` уже резервирует 10 ₽ целиком, но live structured Lite stage тоже стоил деньги. Новый путь не должен считать этот расход «вне envelope».
2. В `packages/shared/src/generation/cost-envelope.ts` введи явные корзины для всех реально платных стадий standard run: mandatory source search, Lite structured/narrative-plan stage, десяти Lite narration sections, bounded images и export/infrastructure. Их сумма должна точно равняться `COST_ENVELOPE_LIMIT_RUB` и быть не больше 10 ₽.
3. Не назначай суммы на глаз. Для каждого per-slide request расчитай worst-case reservation из фактического compact system+user prompt, approved Lite price catalog и его exact max output tokens. Выдели helper/тест, который доказывает сумму всех десяти worst cases вместе с остальными buckets.
4. Max output tokens section request должен быть получен из deterministic contract: достаточен для target/range одного слайда, но не является старым 1350-token Flash ceiling. Выбери конкретное число только после расчёта и теста, который связывает его с accepted Russian word fixture. Не уменьшай word contract ради того, чтобы пройти preflight.
5. До первого section call зарезервируй **одной batch-операцией** все десять section reservations. Также гарантируй, что structured paid stage имеет свой preflight/reservation до сети. При невозможности зарезервировать любую часть: `narration_budget_exhausted_failure`, ноль section calls, понятная публичная ошибка и точная private category.
6. При provider/usage/quality failure на секции `N`: не делай retry, не вызывай `N+1`, освободи только неиспользованные reservations корректным existing envelope API и не создавай новый envelope. Usage/CostEvent должны остаться точными.
7. Приведи `apps/worker/src/aitunnel-narration-budget.ts` и `AitunnelStage` к новым stage names. Удали/изолируй устаревшую Flash 5+5 policy, чтобы она не была достижима для economic standard run. Не ломай другие AITUNNEL stage policies.

### 4. Local quality и safe failure

1. Создай/переиспользуй local validator section-level contract: exact order, title, 2–7 sentences, role-specific word range, no generic/template formula, source-grounded factual claims where applicable.
2. Сохрани безопасные typed timing/quality reason codes из Prompt 07. Логи и telemetry могут хранить только code, slide order, stage, model, reservation/actual cost и безопасную category — не raw generated text/issue/source excerpt.
3. Если final full narration не проходит cross-section repetition или global 9–12-minute validation, safe-fail. Не дописывай локальный filler и не запускай одиннадцатый call.
4. Существующий public error не должен раскрывать provider, токены, цену или внутреннюю validation detail.

## Обязательные тесты

Добавь/обнови детерминированные tests минимум для:

1. Десяти Lite calls в строгом порядке 1…10, каждый с корректным stage/model/section prompt.
2. Valid ten sections → canonical accepted narration; финальный текст проходит shared timing и quality validators.
3. Каждый role target (opening/content/conclusion) читается из shared timing budget, а не дубля констант.
4. Невалидная секция 1 и невалидная секция в середине: нет retry, нет дальнейших calls, нет неполной сохранённой narration.
5. Global failure после десяти sections: нет одиннадцатого call и нет local content mutation.
6. Prompt не содержит sentinel rejected text, raw validation detail, полный source corpus или full research brief; содержит только current slide и bounded source anchors.
7. Atomic preflight всех десяти Lite sections: при недостаточной любой корзине provider не вызывается вообще; при успехе создаются десять уникальных reservations.
8. Reservation math: structured + sources + 10 Lite sections + images + export точно укладываются в 10 ₽; actual overrun/usage missing/duplicate replay fail closed.
9. Existing source snapshot, cost-envelope, economic-release-gate, generation, image-search, presentation и presentation-quality tests не регрессируют.

Запусти по порядку:

```powershell
npm exec vitest run --workspace @studydeck/worker -- src/cost-envelope.test.ts src/source-snapshot.test.ts src/economic-release-gate.test.ts src/tasks/generation.test.ts src/tasks/image-search.test.ts src/tasks/presentation.test.ts src/tasks/presentation-quality.test.ts src/aitunnel-narration-budget.test.ts
npm run typecheck -w @studydeck/worker
npm run typecheck -w @studydeck/api
npm run typecheck -w @studydeck/web
npm run check
npm run test
```

Если test/typecheck создаёт `apps/web/tsconfig.tsbuildinfo`, не включай его в diff. Не удаляй и не восстанавливай пользовательские файлы.

## Runtime и единственный будущий E2E

Не выполняй этот раздел без нового прямого разрешения пользователя «разрешаю один paid E2E».

После успешных deterministic checks:

1. Пересобери узко затронутые runtime services. Для worker-only изменений — `worker`; если shared cost contract потребляет API при создании envelope — `api worker`.
2. Проверь `docker compose ps`, `http://localhost:4000/v1/health` и `https://localhost/api/internal-health`.
3. Запусти `npm run smoke:generation:live` ровно один раз. Не повторяй его при любой ошибке.
4. При успехе проверь project/job, 10 sources-grounded sections, 10 slides, accepted narration, production quality gate, export, все 10 reservation rows, real Lite usage и полный envelope ≤10 ₽.
5. При ошибке только read-only извлеки `project.error`, `GenerationJob`, `AiUsageEvent`, `CostEnvelope`, reservations и worker logs. Покажи stage/безопасную category/cost, но не narration и не секреты.

## Acceptance criteria

- Economic standard path не использует Flash/Yandex/OpenAI для narration.
- У него ровно 10 возможных Lite section calls и ноль скрытых retries; любой call возможен только после successful atomic reservation всех ten sections.
- Все реально платные этапы, включая structured generation, учтены в persisted envelope ≤10 ₽.
- Полученная речь содержит ровно 10 валидных sections и проходит shared 9–12-minute contract без локальной генерации текста.
- Failure на любой стадии не создаёт extra paid call, неполную речь или плохой deck.
- По завершении deterministic checks есть один понятный запрос пользователю на один paid E2E, а не серия повторов.

## Итоговый отчёт

Кратко перечисли: изменённые файлы, до/после cost allocation, точный worst-case preflight calculation, результаты всех checks, staged scope, runtime scope и ограничения. Не коммить без отдельной просьбы пользователя.

