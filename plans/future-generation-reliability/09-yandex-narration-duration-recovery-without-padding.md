# 09 — Yandex narration: recovery длительности без локального дописывания

## Роль и границы

Выполни только этот пункт в новом чате Codex после планов 01–08. Работай в `D:\presentation`. Сначала прочитай `AGENTS.md`, README этого пакета, планы 01–08, выполни `git status --short` и открой фактические затрагиваемые файлы. Рабочее дерево может быть грязным: не откатывай и не перезаписывай чужие изменения.

Yandex остаётся единственным автором речи. Не добавляй OpenAI, `demo`/`demo-fallback`, новую очередь или параллельный генератор. Не редактируй существующие проекты, revisions, custom canvas или записи БД. Не печатай секреты из `.env`.

## Дефект, который нужно устранить

В проекте «Космос - планета Сатурн» `cmrw654v3000zmq0jplkyrlvs` Yandex вернул слишком короткую, но структурно корректную речь. Вместо повторной генерации worker выполнил локальную достройку. Функции `completeYandexNarrationDuration(...)` и `narrativePlanContinuation(...)` в `apps/worker/src/tasks/presentation/providers/generation.ts`:

- удаляют финальную точку исходной фразы;
- присоединяют текст через `;`;
- склеивают `keyMessage`, `evidenceOrExplanation`, `whyItMatters`, `slidePurpose`, `audienceQuestion` и `bridgeFromPrevious`;
- заменяют пунктуацию этих полей на запятые и циклически повторяют слова до нужной длины.

Именно это породило 93 точки с запятой, дубликаты фактов, служебные формулировки «Представить…»/«Какова…» и 119 упоминаний «Сатурн». Worker log для этого запуска зафиксировал `recovery: "template_sentence_replacement"`; этот второй repair не исправил уже склеенное предложение.

## Цель

При недостаточной длительности Yandex narration worker либо получает новую естественную речь от Yandex, либо безопасно завершает job ошибкой. Он никогда не увеличивает длину механической конкатенацией narrative-plan полей.

Сохрани canonical accepted narration: `generatedText`, `speakerNotes` и `speechScript` согласованы; строгую валидацию sections; Yandex-only провайдера; safe public error; атомарность и отсутствие partial save; существующие quality/release gates и пользовательские canvas.

## Обязательное исследование

До правок проследи реальный поток:

1. `apps/worker/src/tasks/generation.ts`: narration job до сохранения `speechDraft`.
2. `apps/worker/src/tasks/presentation/orchestrator.ts`: выбор provider и вызов narration.
3. `apps/worker/src/tasks/presentation/providers/generation.ts`: `generateYandexNarration`, обычные retries, `recoverShortYandexNarration`, `generateYandexNarrationByChunks`, `completeYandexNarrationDuration`, `replaceTemplateNarration`.
4. `apps/worker/src/tasks/presentation/prompts/builders.ts`: normal, repair и chunk narration prompts.
5. `apps/worker/src/tasks/presentation/narration/processing.ts`: `normalizeNarrationText`, `validateNarrationSections`, duration and template checks.
6. Связанные unit tests, прежде всего `apps/worker/src/tasks/presentation.test.ts`.

Подтверди, что для duration-only failure можно использовать уже существующий Yandex retry/chunk seam. Не делай предположений о старых тестах: открой их перед редактированием.

## Реализация

### 1. Удалить недопустимый локальный recovery

Убери `completeYandexNarrationDuration(...)` и `narrativePlanContinuation(...)` из рабочего пути. Не оставляй reachable fallback, который вставляет в речь `slidePurpose`, `audienceQuestion` или циклически повторённые слова. Можно удалить код целиком либо заменить безопасной маршрутизацией, но тесты не должны допускать его возврат.

### 2. Yandex-only recovery вместо padding

При первом duration-only failure не сохраняй исходный короткий текст и не переписывай его локально. Используй ограниченный повторный Yandex запрос с существующим repair prompt либо существующую chunked narration recovery. Если выбран chunked путь, каждый chunk возвращает полные sections только своих `slideOrder`, а объединённый результат проходит `normalizeNarrationText(...)` для всей речи.

Число вызовов и попыток остаётся конечным и понятным в logs. Если Yandex не дал валидную естественную речь после лимита, job остаётся `failed` с безопасным пользовательским сообщением и без `speechDraft`. Не создавай provider abstraction, новую очередь или вторую текстовую pipeline.

### 3. Не смешивать планировочные поля и речь

`SlideNarrative` остаётся семантическим планом для prompt. `slidePurpose` и `audienceQuestion` могут помогать Yandex понять задачу, но не могут появиться в accepted narration дословно как команды или вопросы планировщика. Не преобразовывай их локально в текст докладчика.

### 4. Логи и ошибки

В structured logs различай обычный успех, Yandex retry, chunk recovery и окончательный failure. Не выводи API keys, полный prompt, source contents или provider payload. `project.error` и UI получают спокойное действие, а не внутреннюю техническую диагностику.

## Детерминированные тесты

Добавь compact fixtures без сети, реальных project ID и API ключей.

1. Duration-short 10-slide narration не возвращается с `;`-склейкой, `slidePurpose`, `audienceQuestion` или циклическими повторениями.
2. Duration-only failure запускает ограниченный Yandex retry/chunk recovery, а не локальный padding.
3. Валидный Yandex recovery выдаёт ровно 10 ordered sections и проходит `normalizeNarrationText(...)`.
4. Невалидный, короткий, неупорядоченный или обрезанный Yandex recovery завершается безопасно без `speechDraft` и partial presentation.
5. Не-duration ошибки не попадают в новую recovery ветку.
6. Saturn-like fixture не содержит подряд повторённых предложений, планировочных команд, `,;` и дублированного ключевого факта.
7. Успешный monolithic Yandex narration path не делает лишнего recovery вызова.

Обнови прежние тесты, которые сейчас считают локальное дописывание корректным только потому, что текст достиг длины. Новое ожидание — естественная речь либо безопасный отказ.

## Проверка и приёмка

Запусти минимальный релевантный набор worker tests, затем `npm run typecheck -w @studydeck/worker`, `npm run build -w @studydeck/shared`, `docker compose config --quiet` и `git diff --check`.

Не выполняй реальный вызов Yandex, не пересобирай Docker и не создавай тестовый проект, пока пользователь отдельно не попросит применить изменения к `localhost:3010`.

Итог принимается, только если в production path отсутствует локальное дополнение речи из narrative-plan полей; недобор длительности приводит лишь к ограниченному Yandex recovery или safe `failed`; нет OpenAI/demo fallback, partial save, ослабления validation/release gate или изменения старых revisions. В финальном отчёте перечисли изменённые файлы, реальные команды проверок, результаты и оставшиеся риски.
