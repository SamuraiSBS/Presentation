# 06 — Устранение шаблонной narration на финальном слайде и runtime-проверка

## Роль и границы

Выполни только этот пункт в новом чате Codex. Он продолжает пакет `plans/future-generation-reliability/` после 01–05 и закрывает реальный runtime-дефект, обнаруженный 2026-07-22 на новом проекте `cmrwdh1ig0003l90jpd2c119u` («Runtime Saturn check»).

Не ослабляй `productionQualityReleaseResult(...)`, не возвращай `demo`/`demo-fallback`, не сохраняй плохую presentation revision и не редактируй существующие проекты, включая `cmrvw6e54000hmq0joh02cprf` и runtime-fixture выше. Не создавай новую очередь или параллельный генератор.

Нельзя выключать проверку template narration глобально и нельзя добавлять allowlist для фразы, которая является мета-инструкцией, а не речью докладчика.

## Наблюдаемый дефект

Для новой Yandex narration job `172` worker успешно дошёл до `drafting_speech`, но job завершилась `failed` с технической причиной:

```text
AI narration quality check failed: slide 10 contains template narration:
Собрать ответ на главный вопрос темы «Runtime Saturn check», связать его
с предыдущими смысловыми шагами и оставить 2–3 ...
```

Пользователь получил безопасное сообщение, `presentationRevision` остался `0`, поэтому release gate сработал корректно. Однако это ложный отказ: система сама передала в narration мета-текст планировщика, который потом запрещает `validateNarrationSections(...)`.

Конфликт находится на стыке:

- `apps/worker/src/tasks/presentation/planning/builders.ts` — fallback последнего `slidePurpose` содержит «Собрать ответ на главный вопрос…»;
- `apps/worker/src/tasks/presentation/constants.ts` — «главный вопрос» входит в `GENERIC_NARRATION_PHRASES`;
- `apps/worker/src/tasks/presentation/narration/processing.ts` — validator отклоняет section с такой фразой;
- `apps/worker/src/tasks/presentation/providers/generation.ts` — уже имеет `replaceTemplateNarration(...)`;
- `apps/worker/src/tasks/presentation/quality/orchestration.ts` и `utilities.ts` имеют похожие deterministic repair seams.

## Цель

Новая 10-slide Yandex generation для учебной темы о Сатурне должна пройти narration stage естественной предметной речью. Финальный слайд обязан давать содержательный вывод по теме, а не повторять внутреннюю инструкцию вроде «собрать ответ», «главный вопрос темы», «связать с предыдущими шагами» или «оставить 2–3 вывода».

После исправления сохраняются инварианты 01–05: только Yandex; ошибка модели остаётся `failed`; принятая речь канонична для `speakerNotes`/`speechScript`; release gate и атомарность не ослабляются; custom canvas и старые revisions не переписываются.

## Обязательное исследование до правки

Прочитай `AGENTS.md`, README пакета, пункты 01–05 и `git status --short`. Не откатывай чужие изменения. Затем проследи путь:

1. `generateNarrationDraft(...)` и provider selection.
2. `generateNarrativePlan(...)` и fallback plan.
3. Narration prompt и места, где `slidePurpose`, `keyMessage`, `audienceQuestion` попадают в prompt.
4. `normalizeNarrationText(...)`, `validateNarrationSections(...)`, `isGenericNarrationSentence(...)`, `repairNarrationQualitySections(...)`.
5. `replaceTemplateNarration(...)`, все callers и сохранение accepted narration.
6. `runGenerationJob(...)` до `speechDraft` и error classification.

Проверь, почему fallback final `slidePurpose` оказывается дословной речью. Решение должно убрать мета-инструкцию на границе plan → narration, а не скрыть сообщение об ошибке.

## План реализации

### 1. Разделить планировочную инструкцию и текст докладчика

Сохрани сильную смысловую цель финального slide в narrative plan, но замени fallback `slidePurpose`/`keyMessage` на предметно-нейтральную формулировку без запрещённых шаблонов. Plan может требовать синтез предыдущих пунктов, но фраза «Собрать ответ на главный вопрос…» не должна попасть в `speakerNotes`.

- Если требуется machine-oriented instruction, выдели её только для prompt; в `SlideNarrative`, которое служит основой речи, оставь семантическое назначение и конкретный topic anchor.
- Для Сатурна ожидай вывод о том, как строение, кольца и спутники вместе объясняют научную ценность системы Сатурна, без новых непроверенных фактов.
- Не убирай требование сильного финала из prompt builders.

### 2. Уточнить локальный repair template narration

Проверь `replaceTemplateNarration(...)` и repair в `narration/processing.ts`. Если section содержит запрещённую мета-фразу, repair заменяет только это предложение содержательным текстом из уже принятых `keyMessage`, `slidePurpose`, предыдущих sections и source-backed material.

- Не генерировать новые числа, даты, точные факты или ссылки.
- Не копировать мета-слова из `slidePurpose` в речь.
- Сохранить заголовок, порядок и число sections.
- Сохранить связность с предыдущим слайдом.
- После repair снова запускать `validateNarrationSections(...)`.
- Если естественный текст получить невозможно, оставить `failed`, не создавать fallback presentation.

Не добавляй общий `try/catch`, который превращает любой quality error в accepted narration.

### 3. Сохранить безопасную классификацию ошибок

Техническая причина остаётся в worker log/Sentry; `project.error`/UI получают спокойное действие без provider payload, schema detail и шаблонной фразы. Не меняй release-gate из пункта 05. Если repair не прошёл повторную валидацию, job остаётся `failed` и не создаёт `speechDraft`/presentation.

### 4. Добавить детерминированные тесты

- Fallback 10-го narrative item не содержит дословного template narration.
- `validateNarrationSections(...)` продолжает отклонять фразу «Собрать ответ на главный вопрос…».
- `replaceTemplateNarration(...)` для 10-slide Saturn-like fixture формирует естественный предметный финал.
- Repaired text проходит `normalizeNarrationText(...)` и имеет ровно 10 sections.
- Repair не добавляет facts, которых нет в input narration/narrative plan/sources.
- Если repair невалиден, Yandex narration path остаётся `failed` и не сохраняет `speechDraft`.
- Сильный final slide не превращается в «Спасибо за внимание»/«Вопросы?».

Используй компактные Saturn fixtures. Не используй старый project ID как fixture и не трогай его БД-запись.

## Runtime-проверка

Пользователь уже явно запросил runtime. После зелёных unit/typecheck:

1. Убедись, что `AI_PROVIDER=yandex`, `ALLOW_DEMO_GENERATION=false`; не печатай ключи.
2. Пересобери и пересоздай только `worker` для `localhost:3010`.
3. Через `POST /api/projects` создай новый тестовый проект с новым ID о Сатурне. Не используй `cmrwdh1ig0003l90jpd2c119u` повторно.
4. Вызови `POST /api/projects/:id/narration`; дождись `script_ready` либо `failed`.
5. При `script_ready` проверь 10 sections без template phrase и нерелевантных WEB sources; штатно прими narration через `PATCH /api/projects/:id/narration`, затем вызови `POST /api/projects/:id/generate`.
6. Дождись `ready`/`completed` либо `failed`. При успехе проверь `generationMode === "yandex"`, revision, canvas audit и отсутствие `demo`/`demo-fallback`; при failure запиши safe error и отсутствие новой revision.
7. Не удаляй test-project автоматически и не меняй старые проекты.

## Проверка

```powershell
npm run test -w @studydeck/worker -- src/tasks/presentation.test.ts src/tasks/presentation/narration/processing.test.ts src/tasks/presentation/providers/generation.test.ts src/tasks/generation.test.ts src/tasks/job-progress.test.ts
npm run typecheck -w @studydeck/worker
npm run build -w @studydeck/shared
docker compose config --quiet
git diff --check
```

Если точные test filenames отличаются, сначала найди существующие Vitest-файлы и используй минимальный эквивалентный набор; в отчёте назови фактические команды.

## Критерии приёмки

- Финальный narrative plan остаётся сильным и тематическим, но не даёт validator-ошибку при буквальном следовании plan.
- Template narration по-прежнему жёстко отклоняется до сохранения; repair допустим только при детерминированно естественном grounded тексте.
- Yandex failure по-прежнему даёт safe error и не создаёт bad completed deck.
- Новая Saturn runtime generation проходит narration и, если provider доступен, завершается `completed` с Yandex document.
- В отчёте отдельно указаны unit/typecheck, Docker provenance, новый test project ID и итог job без секретов.
