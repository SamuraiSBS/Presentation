# Prompt 03 — речь: Lite first, Flash fallback, один скрытый повтор

Скопируй весь этот файл в новый чат Codex. Эта задача требует выполненных Prompts 01–02.

## Задача

Переделай generation речи для будущего экономного standard run:

`источники → Gemini 3.5 Flash Lite candidate → локальная валидация → при необходимости единственный Gemini 3.6 Flash fallback → accepted narration`.

Пользователь не выбирает тариф и не видит техническую ошибку первой попытки. Общий cost envelope не превышает 10 ₽.

## Контекст

- `generateNarrationDraft()` в `apps/worker/src/tasks/presentation/orchestrator.ts` вызывает plan и narration.
- `generateAitunnelNarration()` сейчас всегда получает primary model и допускает полный primary rewrite.
- `AitunnelStage` уже содержит `narration` и `narration_rewrite`, но policy нужно привести к продуктовой схеме.
- 10 слайдов — 9–12 минут русского выступления; не сокращай речь только ради цены.

## Требования

1. Введи два явных внутренних этапа: `narration_candidate` = `gemini-3.5-flash-lite`, `narration_fallback` = `gemini-3.6-flash`. Не используй `auto`, provider fallback, OpenAI или Yandex в этом пути.
2. Перед candidate и fallback зарезервируй соответствующие корзины persisted envelope. Fallback разрешён только один раз, только после локальной классификации дефекта candidate и только если общий лимит сохраняется.
3. Валидация перед fallback только локальная: точное число секций, заголовки, речь на нужную длительность, минимум содержательных предложений, повторяемость, шаблонные фразы, source anchors. Не запускай paid critic для решения, нужен ли fallback.
4. Prompt fallback должен быть полной заменой речи, но компактным: отправлять source snapshot и категорию дефекта, не отправлять огромный отвергнутый текст и внутренние stack traces.
5. Если candidate подходит — немедленно принять его. Если fallback подходит — принять fallback. Не допускай третьей попытки, quality-repair или скрытого расхода после принятия.
6. Если обе попытки не дают допустимую речь либо лимит не позволяет fallback, не создавать плохой deck и не менять принятый ранее draft. Public состояние/текст должен быть спокойным и предметным, например просить уточнить тему или материалы, без слов «AI provider», token или exception. В admin/job log оставить точную категорию.
7. Сохрани accepted narration как канонический текст. Любое последующее редактирование пользователем не должно снова вызывать модель.
8. Не меняй пользовательские тарифы/UI; это внутренний routing.

## Acceptance criteria

- Успешный Lite candidate использует один платный narration call.
- Невалидный candidate приводит максимум к одному Flash call.
- Нет пути, где `gemini-3.6-flash` вызывается для первой и второй narration попытки в economic standard run.
- Все случаи budget exhausted, missing usage и provider error завершаются без дополнительного AI spend.
- Для 10 слайдов в тестовых fixtures соблюдается 9–12-минутный contract.
- Usage events содержат реальную модель, stage, attempt, envelope id и стоимость.

## Проверка

Добавь regression tests для: valid Lite; Lite quality fail → valid Flash; оба fail; reservation refusal; provider usage missing; user-edited accepted speech. Запусти targeted worker tests/typecheck. В конце доложи максимальный предзарезервированный budget и передай в Prompt 04 точный accepted-narration contract.

