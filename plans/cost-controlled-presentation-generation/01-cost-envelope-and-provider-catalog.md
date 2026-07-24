# Prompt 01 — сквозной бюджет и каталог AI Tunnel

Скопируй весь этот файл в новый чат Codex.

## Задача

Реализуй фундамент строгой себестоимости для **будущих** стандартных генераций StudyDeck. Цель — 10 ₽ максимум на полный пользовательский путь, а не отдельный лимит на одну BullMQ job.

Сначала прочитай `AGENTS.md`, проверь `git -c safe.directory=D:/presentation status --short` и сохрани все посторонние изменения. Рабочая папка: `D:\presentation`.

## Контекст проекта

- AI Tunnel выбран через `AI_PROVIDER=aitunnel`; клиент и строгая конфигурация находятся в `apps/worker/src/openai-client.ts`.
- В `apps/worker/src/aitunnel-narration-budget.ts` сейчас есть `AitunnelProjectBudget`, но он живёт только в памяти одного вызова, а narration и presentation — разные job.
- Реальные расходы пишутся в `AiUsageEvent` и `CostEvent` через `apps/worker/src/usage-ledger.ts`.
- Открытый текущий каталог AI Tunnel: `GET https://api.aitunnel.ru/public/aitunnel/models/chat`; не использовать `model: auto` и не запрашивать ключ в коде.
- Для 10 слайдов / 9–12 минут нужно резервировать расходы до внешнего вызова, включая source search, первую речь, один скрытый fallback-речь, изображения и экспорт.

## Требования

1. Введи persisted cost envelope, привязанный к одному запуску создания презентации, а не к in-memory контексту одной job. Выбери минимальную ясную Prisma-модель или расширение существующей модели; она должна содержать:
   - идентификатор run/envelope и `projectId`;
   - версию политики, лимит 10 ₽, бюджетные корзины и суммы `reserved`, `settled`, `released`;
   - статус (`active`, `completed`, `exhausted`, `cancelled`); 
   - идемпотентную связь с narration/presentation job.
2. Сделай транзакционные операции `reserve`, `settle`, `release` безопасными при повторе BullMQ job и параллельных запросах. Резервировать средства до вызова провайдера; если корзины не хватает — не вызывать сеть.
3. Не считать старый `AITUNNEL_PROJECT_BUDGET_RUB=30` источником истины для экономного режима. Добавь явную policy-конфигурацию с максимальными бюджетами: sources, narration-candidate, narration-fallback, images, export/infra. Их сумма не больше 10 ₽. Значения должны быть документированы и покрыты тестами.
4. Отдели provider catalog от reservation logic. Разрешены только утверждённые ID `gemini-3.5-flash-lite` и `gemini-3.6-flash`; сохранённый snapshot цены/версии должен быть детерминированным для одного envelope. Не делай сетевой fetch каталога на каждый запрос. Допустим ручной/деплойный refresh или короткоживущий server cache с безопасным fallback к проверенному snapshot.
5. Исправь расхождение между ценами в коде и каталогом: telemetry должна хранить именно policy/snapshot, по которому был сделан reservation. Не обещай «никогда не будет переплаты»: если usage отсутствует или фактические токены превысили reservation, атомарно заблокируй дальнейшие платные стадии и оставь полную observability.
6. Не меняй ещё narration, sources, visuals или presentation path — только фундамент бюджета и интеграционные точки/контракты, необходимые для следующих задач.

## Предполагаемый файл scope

- `prisma/schema.prisma` и новая миграция;
- `apps/worker/src/aitunnel-narration-budget.ts` либо новый узкий модуль cost envelope;
- `apps/worker/src/usage-ledger.ts`;
- `apps/worker/src/openai-client.ts`;
- `apps/api/src/projects/projects.service.ts` и job payload/контракты, только если нужны для создания и передачи run id;
- целевые unit/integration tests и `.env.example`.

Сначала сам проверь существующие contracts и уточни этот список. Не добавляй API/UI без необходимости.

## Acceptance criteria

- Один envelope переживает narration и последующую presentation job одного запуска.
- Нельзя начать платную стадию при недостатке её корзины или при исчерпанном общем лимите.
- Повтор одной и той же job не удваивает reservation/settlement.
- `unknown_usage`, provider error и overrun прекращают новые платные вызовы, но не портят уже сохранённую речь или presentation revision.
- Суммарный policy cap не больше 10 ₽; тесты фиксируют это.
- Существующие неэкономные/Yandex пути не сломаны.

## Проверка

Запусти минимально достаточные Prisma/shared/worker/api тесты и typechecks. Если изменена Prisma schema — сгенерируй клиент предусмотренным проектом способом. Не запускай полный Docker deploy в этой задаче.

В финале перечисли изменённые файлы, тесты и точный формат envelope, который должны использовать prompts 02–06.

