# 12 — Цельная Yandex rewrite при короткой речи до safe failure

## Роль, вход и строгие границы

Выполни только этот пункт в новом чате Codex после 01–11. До изменения кода прочитай `AGENTS.md`, README этого пакета, этот файл, затем выполни `git status --short` и изучи фактический код и тесты. Рабочее дерево намеренно может быть грязным: сохрани все чужие изменения, не делай `reset`, `checkout`, массовое форматирование и не переходи к пункту 13.

Это изменение относится только к новым university-student narration с timing budget. Не редактируй существующие проекты, `speechDraft`, сохранённые documents, `Presentation.revision` или пользовательские canvas.

Yandex остаётся единственным автором. Нельзя добавлять OpenAI, `demo`, `demo-fallback`, локальные фразы, склейку полей narrative plan, механическое добивание количества слов или обход quality/release gate.

## Подтверждённая проблема

Для 10-слайдового Saturn smoke текущий primary Yandex вернул 508 слов. После `chunked_duration_recovery` результат составил 691 слово. После per-section duration recovery — 827 слов, с повторяющейся closing phrase. Все варианты были правильно отклонены и стали safe failure, однако дробление речи не улучшает соблюдение полного связного доклада и может ухудшать естественность.

Текущий пункт намеренно заменяет **только duration-recovery ветку** из 09/11:

- `spoken_narration_rewrite` для детерминированно найденных template/repetition defects остаётся отдельным механизмом;
- duration shortfall после первого ответа либо после targeted spoken rewrite ведёт к одной полной Yandex rewrite всего доклада;
- если эта rewrite не проходит все уже существующие проверки, задача завершается safe failure;
- не возвращай chunked или per-section extension как автоматический duration путь.

## Продуктовое решение

Для 10 slides, `level: university_student`, режима с применимым shared timing budget:

- допустимый диапазон остаётся 1170–1560 слов / 9–12 минут;
- цель остаётся 1300 слов с targets 80 / 140 / 100;
- качественный цельный доклад важнее искусственной длины;
- разрешена ровно **одна** дополнительная полная Yandex rewrite при duration shortfall;
- эта попытка переписывает весь narration с нуля, а не добавляет фрагменты к старому тексту;
- результат обязан заново пройти section, duration, spoken-narration, topic, quality и release проверки;
- после неудачи публичная ошибка остаётся спокойной и не раскрывает внутренние provider details.

Не меняй 6-, 8-, 12- и 14-slide presets. Не ослабляй minimum и не меняй модель/цену: это отдельный пункт 13 и отдельное продуктовое решение.

## Фактический технический контекст

Проверь эти файлы перед редактированием, а не полагайся на номера строк:

- `packages/shared/src/generation/speech-timing.ts` — единый budget 10 slides.
- `apps/worker/src/tasks/presentation/providers/generation.ts` — `generateYandexNarration`, `isNarrationDurationShortfall`, вызовы Yandex и текущая chunk/per-section recovery.
- `apps/worker/src/tasks/presentation/prompts/builders.ts` — `buildNarrationPrompt`, `buildNarrationRepairPrompt`, `buildSpokenNarrationRewritePrompt`.
- `apps/worker/src/tasks/presentation/narration/processing.ts` — `normalizeNarrationText`, `validateNarrationSections`, spoken checks.
- `apps/worker/src/tasks/presentation.test.ts` — mocked Yandex duration and spoken-rewrite tests.
- `apps/worker/src/tasks/generation.ts`, `job-progress.ts` и public error helpers — safe failure surface, только если проверка покажет необходимость.

В текущем рабочем дереве возможно уже есть незакоммиченный `return await` в ветке `spoken_narration_rewrite` и chunk/per-section helpers. Не откатывай этот фикс: сначала установи его назначение и затем аккуратно замени только устаревший duration path.

## Реализация

### 1. Явно отдели duration shortfall от других ошибок

Сделай предикат duration shortfall устойчивым к составному сообщению ошибок: он должен распознавать фрагмент `narration duration is below`, даже если раньше в строке есть repeated opening/closing или другая quality issue. Он не должен реагировать на 503, invalid JSON, отсутствие sections, upper-bound overflow или другие не-duration ошибки.

Сохрани `await` у вызова targeted spoken rewrite. Ошибка из awaited promise должна попасть в тот же контролируемый `catch`, а не обойти recovery-решение.

### 2. Замени фрагментарную duration-recovery одной полной rewrite

В `generateYandexNarration(...)` при первом duration shortfall:

1. Сохрани invalid response только как диагностический контекст.
2. Собери новый full-rewrite prompt на базе `buildNarrationRepairPrompt(...)` или небольшого специализированного builder рядом с ним.
3. Передай project, sources, research brief, narrative plan, предыдущий invalid text и validation error.
4. Явно потребуй единую речь на все N slides, в порядке 1…N, в shared min/target/max диапазоне; не требуй достигнуть target любой ценой.
5. Явно запрети повторять старые closing/opening formulas, вставлять filler, описывать planning process, копировать `slidePurpose`/`audienceQuestion` и локально дополнять старую речь.
6. Выполни один новый вызов `requestYandexText(...)` с `NARRATION_SYSTEM_PROMPT` и повторно пропусти его через `findSpokenNarrationIssues` и `normalizeNarrationText`.

После этого вызова не запускай `generateYandexNarrationByChunks`, `narrationRecoveryChunks`, single-slide duration recovery или функциональный эквивалент. Удали code paths, которые стали недостижимыми, вместе с их private helpers и тестами; не удаляй public/используемые helpers, пока поиск не подтвердит отсутствие потребителей.

Сохрани обычные full regeneration attempts для других recoverable response-format ошибок только там, где они уже существовали. Не увеличивай скрыто `NARRATION_MAX_PROVIDER_ATTEMPTS`: duration policy должна быть читаемой и ограниченной.

### 3. Сохрани safe failure и атомарность речи

Если full rewrite невалидна или снова ниже 1170 слов:

- выбрось обычную internal error с реальной причиной для worker log;
- не сохраняй частичную или плохую речь;
- не создавай deck;
- публичные project/job ошибки должны остаться уже согласованными redacted recovery copy;
- не вызывай другого provider и не создавай fallback deck.

Проверь, что не меняются `generatedText`, accepted narration, custom canvas и существующие projects. Этот код должен работать только до сохранения новой narration task.

### 4. Сделай prompt честным quality-first

Проверь `NARRATION_SYSTEM_PROMPT`, `buildNarrationPrompt` и новый full-rewrite builder. Они должны получать числа только из shared timing helper. Формулировки должны говорить:

- цель распределяется по смыслу;
- полный содержательный доклад лучше шаблонного наполнения;
- при недостатке объёма модель переписывает цельную речь, а не добавляет слова в отдельные места;
- полные предложения, grounding и уникальные переходы обязательны.

Не дублируй 1170/1300/1560 в prompt code, если helper уже передаёт эти значения.

## Тесты

Обнови/добавь deterministic unit tests с mocked `global.fetch` в `apps/worker/src/tasks/presentation.test.ts`:

1. Первый 10-slide ответ ниже 1170 слов вызывает ровно один full-rewrite request и принимает цельную valid speech; нет chunk requests и нет plan metadata в тексте.
2. Shortfall после targeted spoken rewrite также вызывает full-rewrite request, потому что promise awaited.
3. Если full rewrite снова ниже 1170 слов, функция rejects; не было OpenAI/demo/local words и не было дополнительных duration attempts.
4. 503/non-duration JSON/section-order error не запускает full duration rewrite.
5. Rewrite с 1170 и с 1560 словами проходит; 1169 и 1561 не проходят через существующие validator checks.
6. Existing 6/8/12/14 timing contracts и обычный valid spoken rewrite остаются без изменений.
7. Prompt для full rewrite содержит quality-first constraints и shared 10-slide values, но не содержит прежнюю семантику `hard contract`.

Проверяй не только число вызовов, но и что возвращённый текст содержит sections 1…10 ровно один раз, не имеет повторов/шаблонного plan leakage и не склеен локально с invalid answer.

## Проверка

Сначала focused checks:

```powershell
npm run test -w @studydeck/worker -- presentation.test.ts presentation-quality.test.ts
npm run typecheck -w @studydeck/worker
npm run build -w @studydeck/shared
docker compose config --quiet
git diff --check
```

Если Vitest в sandbox падает с `spawn EPERM`, повтори ту же проверку с разрешённым запуском дочерних процессов; не маскируй проблему изменением tests.

После успешных deterministic checks выполни **один** paid Yandex smoke только по явному разрешению пользователя:

1. Пересобери только worker: `docker compose build worker`, затем `docker compose up -d worker`.
2. Убедись, что `AI_PROVIDER=yandex`, `ALLOW_DEMO_GENERATION=false`, `OPENAI_API_KEY` пуст и новый worker запущен.
3. Создай новую 10-slide `university_student` narration задачу с отдельным smoke title; не используй старые Saturn projects.
4. Зафиксируй resolved provider, job status, word count, факт одной full rewrite (если был shortfall), отсутствие OpenAI/demo и public error в случае failure.
5. Не делай второй paid rerun без нового явного разрешения.

## Приёмка

Пункт принят, если duration recovery имеет ровно один цельный Yandex rewrite, не дробит речь на фрагментарные дописки, проходит все unit/type checks, а live run либо даёт валидную 1170–1560-word речь, либо заканчивается безопасной понятной ошибкой без fallback. Другие slide-count presets, старые документы и пользовательские canvas не изменены.
