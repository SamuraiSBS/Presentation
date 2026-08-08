# 02 — финальная локальная сборка из принятой реальной речи

## Цель

Сделать так, чтобы падение структурированного presentation provider не превращало уже принятые реальную речь и реальные источники в `failed`. Вместо этого система должна собрать валидную presentation contract локально из принятых артефактов и довести проект до `ready`, сохранив качество и provenance.

## До начала

Прочитай `AGENTS.md`, `plans/generation-recovery-hardening/README.md`, отчёт и решение координатора по Prompt 01, а также текущий `git diff`. Не затирай существующие незавершённые изменения в `presentation`/`narration`/`orchestrator` — проверь, какие из них уже направлены на эту проблему.

## Scope

Разрешены минимальные изменения в worker presentation/narration/orchestrator/provider recovery code и соответствующих tests. Не переделывай cost model и API contract из Prompt 01, кроме строго необходимого вызова уже принятого механизма.

Не выполнять реальные AI/Tavily вызовы, Docker build/restart, миграции, commit или deploy.

## Обязательное поведение

1. Если есть принятый полный AI-текст выступления и реальный source snapshot, ошибка structured presentation provider должна входить в локальный recovery, а не завершать проект `failed`.
2. Локальная сборка — это детерминированная проекция принятого содержания: слайды, `speakerNotes`, `speechScript`/speech sections и source refs должны оставаться согласованными. Нельзя подменять их demo или искусственно коротким generic text.
3. Учитывай, что полный narration contract может иметь больше предложений на section, чем legacy slide gate. Исправь несогласованность contracts, а не обходи quality gate глобальным отключением.
4. Точечная починка шаблонных фраз/повторов допустима лишь до принятия текста или через реальный AI repair path в пределах общего лимита. После принятия текста fallback не должен молча переписывать содержание в шаблонный вид.
5. Fallback presentation обязана пройти те же обязательные structural, source, text and canvas/production quality проверки, которые реально применимы к локальной проекции. Если gate не применим к полному narration contract, это должно быть узко и явно отражено в коде/тестах.
6. При fallback не должно быть новых AI/Tavily вызовов. Если это последний допустимый путь, он должен завершаться `ready` с объяснимым diagnostic reason, но без технической ошибки для пользователя.
7. Не ослабляй проверку URL/источников, не выкидывай источники со слайдов и не разрывай export/render parity.

## Обязательные тесты

Добавь/обнови тесты с принятым реалистичным полным narration и реальным source snapshot, которые доказывают:

- provider presentation намеренно падает, а generation завершается `ready` через local recovery;
- нет второго provider AI/Tavily вызова в fallback;
- итог содержит ожидаемое число слайдов, источники, URL, согласованные notes/script и текст слайдов;
- full narration не отвергается только из-за legacy soft лимита предложений на слайд;
- malformed/generic/local-only synthetic content по-прежнему отвергается.

Выполни целевые worker tests и typecheck. Визуальная проверка canvas допустима только как локальная, без Docker rebuild; сохрани evidence, если текущая test infrastructure позволяет её получить без платных вызовов.

## Критерии приёмки

- Есть детерминированный production-safe путь от `accepted narration + sources + provider failure` к `ready`.
- Этот путь не генерирует текст заново, не делает новый поиск и не подменяет реальный контент demo-данными.
- Проверки качества остаются содержательными и contract-aware.
- Нет несвязанных изменений в API/cost policy, миграций, Docker-операций или commit/deploy.
- Стоимость внешних вызовов для этого этапа: `0 RUB`.

## Отчёт и остановка

В конце дай отчёт по шаблону из README, укажи `0 RUB: реальные AI/Tavily вызовы не выполнялись`, затем остановись. Не запускай live generation и не начинай Prompt 03 без явного принятия координатора.
