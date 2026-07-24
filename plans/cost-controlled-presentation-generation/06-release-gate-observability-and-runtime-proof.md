# Prompt 06 — release gate, UX и доказательство лимита на localhost:3010

Скопируй весь этот файл в новый чат Codex. Эта задача требует выполненных Prompts 01–05.

## Задача

Заверши economic standard run: строгий release gate, понятный public UX без технических ошибок, полная наблюдаемость расходов и live доказательство на `http://localhost:3010`.

Сначала прочитай `AGENTS.md`, проверь git status и предыдущие изменения. Не начинай работу, если prompts 01–05 не были реализованы или их contracts отличаются — сначала сообщи конкретное расхождение.

## Требования

1. Release gate для нового режима должен требовать: source snapshot с минимум тремя источниками, accepted narration по таймингу, 10 валидных слайдов, source refs на фактических слайдах, canvas audit, visual cap, сохранённый cost envelope не выше 10 ₽ и отсутствие неразрешённых paid stages.
2. Public error не должен раскрывать provider/token/stack trace. Для неразрешимой ситуации используй спокойный понятный сценарий («Уточните тему или добавьте материалы»), сохраняй подробную category только в `GenerationJob`, logs и admin telemetry.
3. Admin/cost telemetry должна показывать run/envelope, каждую reservation/settlement, фактическую модель, источник расхода, число Tavily запросов, total ₽, budget remaining и reason прекращения. Не помечай неизвестную цену как ноль.
4. Гарантируй, что retry presentation job локальный и не расходует AI/web-search. Повтор narration не создаёт второй envelope без явного нового user-run.
5. Проверь export: PDF/PPTX работают с deterministic document и не меняют presentation revision. Учти storage и export compute в envelope либо явно исключи повторный пользовательский экспорт из лимита 10 ₽ и отрази это в UX/admin contract. Выбери один вариант и протестируй его.
6. Обнови `.env.example` и короткую эксплуатационную документацию: экономный путь, утверждённые модели, значения лимитов, как безопасно обновлять provider price snapshot.
7. Не ослабляй Yandex/defense/legacy paths и не переписывай существующие presentations.

## Runtime proof

После тестов выполни узкий, но реальный rebuild затронутых сервисов. Поскольку эта серия меняет worker, shared/API и, вероятно, admin/API contracts, используй production-like compose на `WEB_PORT=3010` только после успешных локальных проверок. Проверь:

- `docker compose config --quiet`;
- `docker compose ps`;
- `curl.exe -s http://localhost:4000/v1/health`;
- `curl.exe -k -s https://localhost/api/internal-health`;
- новый 10-slide русский project с обязательными источниками;
- job/event payload: один web source search, candidate narration и только допустимый fallback, ноль AI calls на локальную presentation assembly, не более двух image-search;
- presentation готова, export проходит, total envelope не больше 10 ₽.

Если реальные ключи или внешний provider недоступны, не симулируй успех: проведи deterministic/integration proof с mocks, покажи точный blocker и отдельно проверь health живого стека.

## Итоговый отчёт

Кратко покажи: созданный project/job id (без секретов), usage/cost breakdown, какие URL обновить, файлы, тесты, Docker provenance и все реальные ограничения. Не коммить изменения, если пользователь отдельно не попросил commit.

