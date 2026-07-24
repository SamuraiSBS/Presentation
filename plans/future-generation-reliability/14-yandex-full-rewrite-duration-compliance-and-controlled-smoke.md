# 14 — Соблюдение длительности полного Yandex rewrite и контролируемая smoke-проверка

## Скопируй этот prompt в новый чат Codex

Работай в D:\presentation.

Сначала прочитай AGENTS.md, затем:
- plans/future-generation-reliability/README.md
- plans/future-generation-reliability/12-full-yandex-narration-rewrite-before-safe-failure.md
- plans/future-generation-reliability/13-yandex-pro-narration-ab-experiment.md
- этот файл.

Перед любыми изменениями выполни git status --short. Сохрани все несвязанные изменения. Не редактируй старые проекты, документы, Presentation.revision или user canvas.

Выполни только этот пункт. Не добавляй OpenAI, demo/demo-fallback, второй provider или автоматический rerun. Не меняй production-модель: narration по умолчанию остаётся текущим Yandex alias. Не запускай paid smoke без нового явного разрешения пользователя после deterministic checks.

## Контекст

Пункт 12 уже закрепил безопасную policy: при shortfall допускается ровно один полный Yandex rewrite; локально дописывать sections запрещено; если replacement снова короткий, задача завершается публичной нейтральной ошибкой без fallback.

Live A/B 23.07.2026 доказал, что эта policy безопасна, но не дала нужную длительность:
- baseline yandexgpt/latest: 717 слов, 5.5 мин, safe failure; text cost 14.0724 ₽.
- candidate yandexgpt-5.1: 670 слов, 5.2 мин, safe failure; text cost 9.6008 ₽.

Оба результата ниже floor 1170 слов для 10-slide university_student речи. Candidate нельзя повышать: он не прошёл quality gate. В каждом run уже был ровно один full rewrite, поэтому нельзя исправлять старые проекты дополнительными paid calls.

Текущий buildFullNarrationDurationRewritePrompt сообщает общий range, но не задаёт модели проверяемое распределение объёма по десяти sections. Это и есть целевая причина. Кроме того, два A/B run получили разные автоматически найденные WEB sources: одинаковая source policy не обеспечивает одинаковый context.

## Цель

Сделай future-generation-only изменение, при котором единственный full duration rewrite для 10-slide university_student narration получает ясную содержательную per-section structure и с высокой вероятностью возвращает 1170–1560 слов без filler, plan leakage, повторов или неподдержанных фактов.

Сохрани ровно один full rewrite, minimum 9 минут и safe public error. Не меняй initial narration, targeted spoken rewrite, planning/design brief, structured slide generation или default provider route.

## Исследование перед кодом

1. Проверь реализации и тесты:
   - apps/worker/src/tasks/presentation/prompts/builders.ts
   - apps/worker/src/tasks/presentation/providers/generation.ts
   - apps/worker/src/tasks/presentation/narration/processing.ts
   - apps/worker/src/tasks/presentation.test.ts
   - apps/worker/src/tasks/presentation-quality.test.ts
   - apps/worker/src/tasks/web-search.ts
2. Найди getRussianStudentSpeechTimingBudget и все preset-ветви. Не переноси правило ten slides на остальные slideCount.
3. Подтверди, что normalizeNarrationText и findSpokenNarrationIssues остаются действующими gatekeepers; не создавай второй validator.
4. Найди минимальный explicit operator/test способ закрепить один source context для двух будущих runs, не выключая automatic search для обычных user generations.

Если фактический код отличается от этого описания, следуй коду и отрази расхождение в отчёте.

## Реализация

Измени buildFullNarrationDurationRewritePrompt и при необходимости добавь рядом чистый локальный helper.

Требования:
- Новая guidance применяется только в полном rewrite, который уже вызван подтверждённым duration shortfall.
- Для 10 slides с range 1170–1560 prompt требует все десять headers, ровно один section на slide и содержательное распределение: slide 1 не менее 105 слов, final slide не менее 130 слов, остальные ориентировочно 115–145 слов. Выводи требования из фактического timing budget и slideCount.
- Описывай это как editorial structure: каждая section должна развивать аргумент через объяснение, пример, evidence или consequence. Запрети filler, мета-комментарии, planner field labels и искусственные связки.
- Сохрани discard-previous-answer semantics; не склеивай invalid text и не выводи его в public UI/log.
- Не меняй NARRATION_MAX_PROVIDER_ATTEMPTS, minimum duration, safe public error или provider routing.
- Если добавлен helper, он pure, покрыт unit tests и локален к prompt/timing seam.

## Deterministic tests

Добавь/расширь tests без Yandex/Tavily сети:
1. Rewrite prompt 10-slide university_student содержит 1170–1560, exact ten sections и budget-derived section guidance.
2. Prompt не предписывает filler и не превращает slidePurpose/audienceQuestion в видимый текст.
3. Short initial response плюс complete replacement дают ровно два Yandex text calls, без третьего provider call.
4. Short replacement остаётся safe failure, а плохой draft не сохраняется.
5. Non-10-slide preset доказывает, что guidance derived from actual budget/slide count.
6. Existing Yandex-only/no-demo/no-OpenAI tests остаются зелёными.

Fixture не должен маскировать дефект искусственной длиной: он должен честно проходить существующий normalizer и headers contract.

## Контролируемый следующий smoke/A-B protocol

Не создавай admin UI и background experiment. Зафиксируй операторский протокол в этом файле или минимальной документации:
1. Создавай новые isolated projects с одинаковыми prompt, scenario, level, mode и slideCount.
2. Для duration smoke используй explicit empty accepted WEB source set или один заранее подготовленный source fixture. Не допускай два независимых Tavily searches.
3. Baseline идёт без YANDEX_NARRATION override; candidate только с explicit override и только после отдельного разрешения.
4. Для каждого run собирай из AiUsageEvent actual model, text call count, input/output tokens, text latency и RUB cost; из project/job — status, public error, words, duration и spoken issue count.
5. Не делай automatic retry. Без нового разрешения допускается максимум один paid smoke; для нового A/B нужно разрешение на два job.

## Проверки до paid runtime

Выполни:
npm run test -w @studydeck/worker -- presentation.test.ts presentation-quality.test.ts prompts/builders.test.ts
npm run typecheck -w @studydeck/worker
npm run build -w @studydeck/shared
docker compose config --quiet
git diff --check

Если Vitest в sandbox падает с spawn EPERM, повтори ту же детерминированную команду разрешённым способом; не меняй tests ради обхода sandbox.

## Paid smoke только после разрешения

До запуска сообщи пользователю exact model, закреплённый source context, максимум paid jobs и прогноз стоимости. После разрешения пересобери только worker; runtime-проверкой подтверди AI_PROVIDER=yandex, ALLOW_DEMO_GENERATION=false, пустой OPENAI_API_KEY и отсутствие override для baseline. Используй новый проект, не A/B проекты от 23.07.2026. Не повторяй failure.

## Приёмка

Пункт принят, если deterministic checks зелёные, production default не изменён, full duration rewrite по-прежнему ровно один, prompt имеет budget-derived structure без filler, а разрешённый smoke либо проходит 1170–1560 и все gates, либо честно safe-fails с полной telemetry. В конце сообщи изменённые файлы, tests, production model, source-control protocol, paid calls/cost и remaining risks.

