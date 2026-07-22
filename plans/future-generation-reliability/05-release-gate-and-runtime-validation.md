# 05 — Единый release gate и проверка новой генерации

## Роль

Это интеграционный завершающий пункт. Выполняй только после 01–04: сначала прочитай их и проверь текущий diff/tests. Не переписывай реализованные решения заново; закрывай только пробелы на стыках и добавляй надёжную verification.

## Цель

Перед сохранением новой автоматически сгенерированной презентации система должна гарантировать:

1. Yandex — единственный выбранный провайдер; сбой не превращается в плохой completed deck.
2. WEB-источники либо релевантны и качественны, либо отсутствуют; они не могут увести deck в чужую тему.
3. Content-слайды следуют контракту «тезис + 2–3 буллета» с полноценной речью в notes.
4. Визуалы и layouts имеют достаточное разнообразие и проходят canvas audit.
5. Эти правила работают только для новых jobs и не перезаписывают старые проекты/custom canvas.

## Обязательное исследование

Прочитай `AGENTS.md`, README, все `01`–`04`, `git status --short`, затем trace от `runGenerationJob` в `generation.ts` до сохранения presentation/revision. Изучи текущий `productionQualityReleaseResult(...)`, repair loop и ошибочные branches. Проверь, не создаёт ли какая-либо ветка presentation до release gate.

## План реализации

1. Сформируй один понятный выпускной инвариант для generated document после enrichment/canvas rebuild, но до persist: provider mode, grounding, content contract, visual coverage, layout/canvas safety. Используй существующие quality seams; не создавай второй независимый валидатор с другой терминологией.
2. Классифицируй failure категории так, чтобы лог/Sentry получал техническую причину, а `project.error`/UI — спокойное действие: повторить позже, проверить Yandex, изменить тему/материалы. Не показывай provider payload или внутренние schema errors.
3. Гарантируй атомарность: при failed gate новая document/revision не сохраняется. Старый доступный deck остаётся нетронутым; для нового проекта без прежней презентации не появляется фальшивый ready document.
4. Добавь сквозные mocked тесты на две трассы: успешный тематический Saturn-like deck и отказ Yandex/нерелевантный web search. Не обращаться к реальным Tavily/Yandex.
5. Только если пользователь в отдельном сообщении попросит runtime: установи `AI_PROVIDER=yandex` в runtime-конфигурации, пересобери узко `worker`, запусти новую тестовую презентацию через API/UI и проверь итоговый job/document. Не менять существующий проект `cmrvw6e54000hmq0joh02cprf`.

## Критерии приёмки

- Успешная 10-slide учебная fixture имеет Yandex generation mode, тематические/пустые WEB sources по правилам, content contract и visual coverage.
- Сбой Yandex даёт `failed`, безопасный UI error и отсутствие новой presentation revision.
- Поиск, возвращающий только «Академическую»/карты/словари для темы Сатурна, не оставляет ни одного WEB-source и не заражает narrative plan.
- Старый документ и custom canvas не меняются.
- Runtime-проверка, если запрошена, использует новую project ID, дожидается фактического `completed`/`failed` и фиксирует результат без секретов.

## Проверка

```powershell
npm run test -w @studydeck/worker -- src/tasks/web-search.test.ts src/tasks/generation.test.ts src/tasks/presentation.test.ts src/tasks/presentation-quality.test.ts src/tasks/image-search.test.ts src/tasks/export.test.ts
npm run typecheck -w @studydeck/worker
npm run typecheck -w @studydeck/api
npm run typecheck -w @studydeck/web
npm run build -w @studydeck/shared
docker compose config --quiet
git diff --check
```

В финальном отчёте честно раздели unit/typecheck результаты и runtime-проверку. Не заявляй, что `localhost:3010` обновлён, пока worker не пересобран и новая generation job не завершилась.

