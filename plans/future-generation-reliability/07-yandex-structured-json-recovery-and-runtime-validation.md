# 07 — Yandex structured JSON recovery и runtime-проверка

## Контекст и границы

Выполни только этот пункт в новом чате Codex после планов 01–06. Runtime 2026-07-22 показал: narration Saturn-проекта прошла и была принята, но Yandex на `building_slides` вернул обрезанный JSON (`Unterminated string in JSON`). Обычный retry не собрал документ; job безопасно завершилась `failed`, `presentationRevision` остался `0`.

Не редактируй и не перезапускай существующие проекты: `cmrvw6e54000hmq0joh02cprf`, `cmrwdh1ig0003l90jpd2c119u`, `cmrwenx810009l90jkh5osuuz`, `cmrwf2bst000fl90jmybxo4zc`. Не меняй custom canvas, старые revisions, release gate, safe public errors или status model. Не добавляй OpenAI fallback, `demo`/`demo-fallback` или новую очередь.

## Цель

После исчерпания обычных попыток Yandex для recoverable structured-output failure worker делает ограниченное Yandex-only chunked recovery. Он сохраняет accepted narration как canonical `speakerNotes`/`speechScript`, source grounding, quality/release checks и атомарность: сохраняется только полный валидный document; иначе job остаётся `failed` без revision.

## Исследование перед изменениями

Прочитай `AGENTS.md`, корневой `README.md`, README пакета, планы 01–06 и выполни `git status --short`. Не откатывай чужие изменения.

Проследи `runGenerationJob(...)`; `generatePresentationFromNarration(...)`; `generateYandexPresentationFromNarration(...)`; `generateStructuredWithProvider(...)`; `requestYandexText(...)`; `isYandexJsonSchemaCompatible(...)`; `generateAndValidate(...)`; `parseJsonText(...)`; `assertCompleteStructuredPresentation(...)`; `normalizePresentation(...)`; `finalizeGeneratedPresentation(...)`; `productionQualityReleaseResult(...)`; `buildGenerationPrompt(...)` и narration chunk recovery. Найди все tests Yandex-only, accepted narration, safe failed state и revision atomicity.

## Реализация

### 1. Узкая классификация recovery errors

В provider layer добавь predicate только для невалидного/неполного structured presentation output: JSON `SyntaxError` (EOF/`Unterminated string`), non-object result, отсутствие `slides`, неверное число slides и структурная/Zod validation response. Не включай network/auth/provider, narration, grounding, quality/release или неизвестные errors. Техническая классификация остаётся в worker/Sentry logs без ключей, prompt/source payload или provider detail в `project.error`.

### 2. Yandex-only chunked presentation recovery

После исчерпания обычных попыток и только при classified error запроси presentation компактными последовательными chunk-ами через существующий `requestYandexText(...)` и Yandex provider. Для 10 slides используй 2–3 chunk-а с явным малым budget.

- Каждый chunk покрывает requested `slideOrder` ровно раз; все chunks — каждый slide ровно один раз и в исходном порядке.
- Prompt получает только свой range slide plan, canonical accepted narration и нужный source/research context.
- Response — один JSON object, только requested slides, без Markdown/fences.
- Сразу валидируй JSON, schema, exact count/order и отсутствие missing/extra/duplicate slides.
- Склеивай лишь валидные chunks. Затем запускай существующие `normalizePresentation(...)`, `finalizeGeneratedPresentation(...)`, quality checks и `productionQualityReleaseResult(...)` на full deck.
- Невалидный chunk/исчерпанный budget => `failed`, safe error, no partial save/revision.

### 3. Narration и grounding

Recovery не переписывает accepted narration. `speakerNotes`/`speechScript` следуют принятому тексту. Не добавляй числа, даты, URLs, citations или entity assertions вне narration, narrative plan и проверенных sources. Сохрани source relevance gate; неgrounded slide => `failed`.

### 4. Отдельный compact prompt builder

Добавь отдельный builder для chunk recovery, не inline-конкатенацию. Он требует one JSON object, exact requested orders, запрет extra slides, canonical narration без переписывания, текущие layout/visual/content contracts и substantive conclusion без новых фактов.

### 5. Failure/release contract

Если recovery не прошёл, job остаётся `failed`; UI получает текущий safe error; `presentationRevision` не увеличивается; старые documents/custom canvases не меняются. Не ослабляй `productionQualityReleaseResult(...)`.

## Детерминированные тесты

Добавь compact fixtures без network/real IDs:

1. Predicate принимает truncated JSON/structural errors и отвергает network/auth/narration/quality errors.
2. Валидные 10-slide chunks склеиваются в exact ordered deck и проходят final validation.
3. Missing, duplicate, out-of-order или extra slide отклоняет recovery.
4. Invalid JSON chunk не создаёт partial presentation.
5. Recovery вызывает только Yandex, без OpenAI/demo.
6. Speaker notes/speech script сохраняют accepted narration.
7. Recovery не добавляет facts вне fixture narration/plan/sources.
8. Final failure даёт safe error и revision `0`.
9. Valid monolithic Yandex success не запускает recovery.

Расширь `apps/worker/src/tasks/presentation.test.ts`, `apps/worker/src/tasks/generation.test.ts` и существующие provider tests.

## Runtime и проверки

После зелёных tests/typecheck проверь без секретов `AI_PROVIDER=yandex`, `ALLOW_DEMO_GENERATION=false`; пересобери и пересоздай только `worker`; зафиксируй image/container provenance. Создай новый UTF-8 Saturn-проект через `POST /api/projects`, не используя старые ID. Пройди narration до `script_ready`/`failed`; при ready raw UTF-8 bytes проверь 10 sections, отсутствие template phrase и Saturn relevance, затем прими narration. Запусти generation и жди `ready`/`completed` или `failed`.

При success проверь `generationMode === "yandex"`, новую revision, canonical narration, canvas audit, 10 slides и отсутствие demo modes. При failure зафиксируй safe error, revision `0`, отсутствие partial document и recovery classification. Не удаляй test project и не делай ручной retry.

Запусти: `npm run test -w @studydeck/worker -- src/tasks/presentation.test.ts src/tasks/generation.test.ts src/tasks/job-progress.test.ts`; `npm run typecheck -w @studydeck/worker`; `npm run build -w @studydeck/shared`; `docker compose config --quiet`; `git diff --check`.

## Приёмка

Truncated Yandex JSON получает ограниченный chunked recovery, а не бесконечный monolithic retry. Итог — только полный valid Yandex document или safe `failed` без revision. Нет OpenAI/demo fallback, partial save или технических деталей в UI. Финальный отчёт: изменённые файлы, проверки, Docker provenance, новый project/job ID, runtime status и риски без секретов.
