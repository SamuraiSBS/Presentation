# Prompt 09 — Gemini section candidates + Flash replacements в envelope 17 ₽

Скопируй весь этот файл в **новый чат Codex**. Это самостоятельный implementation handoff. Он заменяет только unreleasable Lite-only route из Prompt 08; не отменяет source grounding, shared timing contract и safe-failure policy пакета.

## Подтверждённые факты и решение

Последний разрешённый E2E для Lite-per-slide path:

- project `cms0a1l8a0003po0jul0s7bdi`, job `215`;
- `narration_section_1`: Lite, 65 слов, принята (для opening minimum 64);
- `narration_section_2`: Lite, 176 output tokens, не прошла local section validation;
- дальнейших paid calls не было, job завершился `narration_quality_failure`;
- source search и structured Lite stage были учтены, health API/worker был зелёным.

Это доказывает, что Lite-only route не даёт достаточной completion reliability, но safe stop работает. Продуктовое решение пользователя: сохранить Gemini и shared 1170–1560-word contract, разрешить контролируемое увеличение hard ceiling.

Новый путь:

`source snapshot → Lite narrative plan → для каждого слайда: Lite candidate → local validation → при необходимости один Flash full replacement этой же секции → canonical concatenation → local full-document validation`.

Никакого локального дописывания, третьего вызова, provider fallback или повторного запуска job.

## Продуктовый и экономический contract

1. Новый persisted policy version должен иметь hard ceiling **17.00000000 ₽**. Это не целевая средняя стоимость: неиспользованные Flash reservations освобождаются, поэтому успешный Lite-first run должен стоить заметно меньше.
2. До первого narration network call нужно атомарно зарезервировать все потенциальные 20 calls: 10 Lite candidates и 10 Flash fallbacks. Нельзя делать Flash call, если его fallback reservation отсутствует.
3. Обоснование 17 ₽ для текущего компактного section context и 384 output token cap:
   - Lite candidate worst-case при измеренном input около 716 tokens: примерно `0.235 ₽`, bucket `0.25 ₽` на секцию;
   - Flash replacement при том же context и 384 output token cap: примерно `1.20 ₽`, bucket `1.20 ₽` на секцию;
   - sources `0.50`, narrative plan `0.75`, ten Lite `2.50`, ten Flash `12.00`, images `0.50`, export/infra `0.75` = `17.00 ₽`.
4. Эти числа — acceptance boundary, не лицензия на предположения. Реализация обязана вычислить worst-case reservation из фактического system+user prompt, provider catalog и exact max output tokens. Если любой Flash prompt не помещается в `1.20 ₽`, сначала сожми его безопасный context или измени policy/test обоснованно; не запускай вызов и не нарушай cap.
5. Shared contract 10-sentence deck остаётся: 9–12 минут, 1170/1300/1560 слов; role targets 80/140/100 и per-section admissible range ±20%. Бери это исключительно из `packages/shared/src/generation/speech-timing.ts`.

## Режим работы

Рабочий каталог: `D:\presentation`.

До изменений:

1. Прочитай `AGENTS.md` полностью.
2. Выполни `git -c safe.directory=D:/presentation status --short` и изучи staged/unstaged diff.
3. Сохрани чужие изменения; не трогай `.audit-bmw/tmpw120oeib/enlarged.pptx`, legacy MVP, defense, Yandex/OpenAI пути и уже сохранённые decks.

Запреты:

- не запускай paid AI, `npm run smoke:generation:live`, Docker rebuild/deploy или commit без нового явного разрешения;
- не понижай 1170-word minimum и не локально дописывай filler;
- не добавляй другой provider/auto routing;
- не передавай в модель rejected section, raw validation error, stack trace, весь source corpus или full research brief;
- не создавай отдельный envelope на replacement и не допускай более одного Flash replacement для одного slide order.

## Реализация

### 1. Versioned policy и stages

1. В `packages/shared/src/generation/cost-envelope.ts` введи новый policy version и лимит 17 ₽. Сохрани exact-sum invariant в `costEnvelopePolicyIsValid()`.
2. Замени один набор `narration_section_1` … `narration_section_10` на явные candidate/fallback buckets:
   - `narration_section_1_candidate` … `narration_section_10_candidate`: по `0.25 ₽`;
   - `narration_section_1_fallback` … `narration_section_10_fallback`: по `1.20 ₽`.
3. Сохрани отдельные buckets sources/narrative plan/images/export. Structured/narrative-plan Lite stage обязан быть preflighted и settled в том же envelope; он не может быть невидимым расходом.
4. В `apps/worker/src/aitunnel-narration-budget.ts` введи строгие template-literal stage types для candidate/fallback каждого слайда. Candidate model — только `gemini-3.5-flash-lite`, fallback model — только `gemini-3.6-flash`.
5. Section output cap остаётся 384 tokens только если deterministic test показывает, что он достаточен для valid 140-word Russian content section. Не возвращай старый Flash 1350-token ceiling.

### 2. Atomic reservation и lifecycle

1. В `apps/worker/src/tasks/presentation/providers/generation.ts` построй 10 section descriptors, каждый с двумя stages и стабильными idempotency keys внутри одного envelope.
2. Перед первым Lite call сформируй 20 reservation inputs и вызови `reserveCostEnvelopeBatch()` ровно один раз. Проверяй actual worst-case prompt math отдельно для candidate и fallback, а не только наличие fixed bucket.
3. Если batch reservation не проходит, safe-fail с `narration_budget_exhausted_failure` до любого Gemini call.
4. Выполняй slides последовательно:
   - Lite candidate;
   - local section validation;
   - при успехе освободи зарезервированный Flash fallback именно этого слайда и перейди к следующему Lite;
   - при неуспехе отправь **один** Flash full replacement текущей секции с compact prompt и тем же slide-level target;
   - при успехе Flash перейди к следующему Lite;
   - при неуспехе Flash: safe-fail, не вызывай следующий слайд.
5. При любой terminal failure освободи все неиспользованные candidate/fallback reservations. После job failure не должно оставаться rows со статусом `reserved` для не вызванных stages. Исправь найденный defect: после failure section 2 в project `cms0a1l8a0003po0jul0s7bdi` section 4–10 оставались `reserved`.
6. Settled calls остаются settled с actual cost; released calls имеют reason, не меняют actual spend и не могут быть повторно использованы тем же job.
7. Убедись, что replay/crash не может повторно вызвать candidate или fallback по уже созданному idempotency key.

### 3. Compact Flash replacement prompt

1. Создай отдельный builder для replacement одной секции в `apps/worker/src/tasks/presentation/prompts/builders.ts`.
2. Передавай: проектный контекст, current slide order/title/key message, target/range слов из shared budget, один-два short relevant source anchors и safe validation category.
3. Полностью исключи rejected candidate text и raw issue. Flash должен написать новую полную секцию, а не continuation/patch.
4. Стиль: 2–7 естественных русских предложений, конкретное объяснение/доказательство/следствие, canonical `Слайд N: …`; без мета-комментария и заполнителей.
5. Candidate prompt остаётся компактным и не получает предыдущие accepted/generated sections. Cross-section repetition проверяет локальный final validator.

### 4. Quality и public behavior

1. Сохрани section-level local gate: exact order/title, role-range ±20%, 2–7 sentences, no template/formula/repetition/source-grounding violations.
2. После всех десяти accepted sections вызови canonical `normalizeNarrationText()` и existing full-document validation. Если общий 1170–1560 or cross-section quality не проходит — safe-fail без 21-го paid call.
3. Public UI error остаётся спокойным и не раскрывает provider/token/cost/validator detail. Private telemetry включает только stage, slide order, candidate/fallback, safe category, reservation, actual usage/cost и release reason.

## Обязательные тесты

Добавь/обнови tests для следующих случаев:

1. `costEnvelopePolicyIsValid()` для vNext, точная сумма 17 ₽, все 20 section buckets, и structured stage в envelope.
2. Реальный worst-case reservation calculation candidate/fallback на fixture compact prompts: Lite ≤0.25, Flash ≤1.20. Если fixture выходит за диапазон, test должен fail, а не округлять значение.
3. Atomic success резервирует все 20 unique rows до первого provider call; atomic shortage делает ноль calls.
4. Ten valid Lite candidates: 10 Lite calls, ноль Flash calls, Flash reservations release, canonical narration valid.
5. Invalid Lite on arbitrary slide N: один Flash call только для N; valid Flash continues with N+1; no prior/future Flash calls.
6. Invalid Flash on N: exactly candidate+fallback for N, no N+1 call, no incomplete narration, all future reservations released.
7. Candidate provider failure, fallback provider failure, missing usage, actual overrun and replay: no unbounded retries/no duplicate paid call/no lingering `reserved` rows.
8. Flash prompt is compact and excludes sentinel rejected text/raw error/full sources; it contains current role target and safe category only.
9. Final global repetition/duration failure after ten accepted sections makes no 21st call and no local text mutation.
10. Existing source snapshot, economic release gate, generation, image search, presentation, presentation quality, worker/api/web typechecks remain green.

Запусти:

```powershell
npm exec vitest run --workspace @studydeck/worker -- src/cost-envelope.test.ts src/source-snapshot.test.ts src/economic-release-gate.test.ts src/tasks/generation.test.ts src/tasks/image-search.test.ts src/tasks/presentation.test.ts src/tasks/presentation-quality.test.ts src/aitunnel-narration-budget.test.ts
npm run typecheck -w @studydeck/worker
npm run typecheck -w @studydeck/api
npm run typecheck -w @studydeck/web
npm run check
npm run test
git -c safe.directory=D:/presentation diff --check
```

Не добавляй generated `apps/web/tsconfig.tsbuildinfo` и не исправляй unrelated test timeout без отдельной задачи.

## Один будущий paid E2E — только по отдельному разрешению

После всех зелёных deterministic checks попроси отдельное явное разрешение. Лишь затем:

1. Пересобери `api worker`, так как shared policy создаётся в API, а исполнение идёт в worker.
2. Проверь `docker compose ps`, `http://localhost:4000/v1/health`, `https://localhost/api/internal-health`.
3. Запусти `npm run smoke:generation:live` ровно один раз с локально загруженными secret env vars, не печатая их.
4. При успехе: проверь 10 slides, 10 accepted sections, 1170–1560 words, production gate, export, envelope ≤17 ₽, breakdown all candidate/fallback/source costs and released reservations.
5. При failure: не повторяй run. Read-only извлеки `project.error`, `GenerationJob`, `AiUsageEvent`, `CostEnvelope`, all `CostEnvelopeReservation` и worker logs. Покажи только safe category/stages/costs/release statuses.

## Acceptance criteria

- Released 10-slide decks always satisfy shared 1170–1560-word contract without local authored text.
- All potential 20 narration calls are atomically reserved inside the one 17 ₽ envelope before Gemini narration starts.
- Any slide has at most one Lite candidate and one Flash replacement; no automatic provider change or third call.
- A failed job leaves no unused `reserved` reservations and cannot replay paid calls.
- Successful Lite candidates release their unused Flash reservation, so actual cost reflects only calls made.
- No paid validation occurs until the user separately authorizes exactly one run.

## Итоговый отчёт

Укажи изменённые файлы, до/после policy, exact reservation math, results всех tests/checks, staged scope, runtime services needed for a future E2E и все оставшиеся риски. Не коммить без отдельной просьбы.

