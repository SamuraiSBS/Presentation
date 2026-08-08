# 03a — remediation повторных presentation jobs после failed live-run

## Основание и единственная цель

Prompt 03 **не принят**. Этот remediation-prompt устраняет только три
подтверждённые причины отказа по сохранённому failed live-run проекта
`cmses2qp60003s40jg8ud98hb`:

1. семь presentation jobs (`258`–`264`) получили семь независимых
   `CostEnvelope` вместо повторного использования одного envelope исходного
   пользовательского запуска;
2. агрегированный `settled` достиг `69.231780 RUB` при cap `27.900000 RUB`;
3. после принятой речи и сохранённых источников не появилась готовая
   `Presentation` (`0 presentation rows`).

Исходный evidence не пересматривается и не исправляется. Прочитай перед
работой:

- `AGENTS.md`;
- `plans/generation-recovery-hardening/README.md`;
- этот prompt;
- `plans/generation-recovery-hardening/03-one-real-end-to-end-proof.md`;
- `plans/generation-recovery-hardening/Отчёты/Отчёт 03-one-real-end-to-end-proof.txt`;
- `plans/generation-recovery-hardening/Отчёты/Второй отчёт 03-one-real-end-to-end-proof.txt`.

Не открывай и не начинай Prompt 04–06. Не создавай новый numbered prompt.

## Жёсткие границы

- Не создавать проектов и не запускать generation, live smoke, AI/AITunnel,
  Tavily или иной сетевой вызов.
- Не выполнять миграции, commit, push, deploy, reset, checkout или clean.
- Не менять provider keys, provider/model routing, стоимость моделей, cap,
  demo/mock policy или контентные quality thresholds.
- Не менять UI, export/canvas и не делать несвязанный рефакторинг.
- Не удалять и не менять данные failed live-run в БД/Redis/MinIO.
- Не делать второй платный E2E. Будущая проверка с реальными провайдерами
  требует отдельного явного решения пользователя.

Разрешены только необходимые изменения worker/API/shared contracts и
детерминированные тесты, непосредственно доказывающие три пункта ниже.
Сохрани чужие изменения, особенно `.audit-bmw/tmpw120oeib/enlarged.pptx`.

## Требуемое поведение

### 1. Одна attempt lineage — один envelope

Повторный presentation job того же пользовательского запуска обязан
детерминированно находить и переиспользовать исходный `CostEnvelope`; он не
может создавать новый независимый envelope. Связь должна быть устойчивой к
очереди/retry и сохранять исходный source snapshot.

Если lineage отсутствует, неоднозначна или envelope terminal/недоступен,
безопасно завершай job без нового provider-вызова и без создания envelope.
Запиши безопасную, диагностируемую terminal-причину; не маскируй исходную
ошибку качества/восстановления.

### 2. Глобальный cap до любого оплачиваемого этапа

Для исходной attempt lineage суммарный фактический `settled` плюс будущие
обязательства не может превысить её единственный cap. Проверка должна быть
атомарной по persisted envelope/reservations и выполняться до каждого
оплачиваемого presentation-пути, включая narrative plan, design brief,
presentation и slide repair.

При недостаточном остатке:

- не создавай новый envelope и не вызывай provider;
- не перезапускай Tavily и используй лишь уже сохранённый source snapshot;
- освободи только ещё неиспользованные reservations по существующему
  контракту;
- сохрани исходный terminal diagnostic и понятный cap/budget diagnostic.

Не меняй значение cap: исправляется учёт и lifecycle, а не бюджетная политика.

### 3. Локальное recovery после принятой речи

Когда narration уже имеет `accepted_speech`, а presentation generation больше
не разрешена из-за исчерпанного cap или terminal failure, выполни только
локальную детерминированную сборку из сохранённых accepted artifacts
(accepted speech, persisted source snapshot, presentation/narrative artifacts
при наличии). Она не должна обращаться к AI/Tavily и не должна заменять
принятую речь generic/demo/template текстом.

Если данных достаточно для валидной презентации, создай ровно одну готовую
`Presentation`, переведи проект в `ready` и обеспечь согласованность с
существующим shared presentation contract. Если данных недостаточно, сохрани
честный terminal статус: не создавай фиктивную презентацию и не вызывай
provider.

## Детерминированное доказательство

Добавь или скорректируй минимальные deterministic tests с полностью mocked
AI/search boundaries. Они должны доказать:

1. исходный narration + повторные presentation jobs используют один и тот же
   persisted envelope и source snapshot; число новых envelope равно нулю;
2. после первого terminal presentation failure следующий retry не может
   зарезервировать/settle больше исходного cap и не выполняет provider call;
3. cap-blocked путь с `accepted_speech` создаёт ровно одну локальную
   presentation без AI/Tavily и сохраняет текст речи;
4. недостаточные persisted artifacts дают честную terminal failure без новой
   presentation, envelope или provider call;
5. исходный diagnostic не подменяется ошибкой cleanup/finalization.

Запусти только целевые tests/typecheck, необходимые для изменённых файлов.
Не запускай live, Docker, миграции или широкие suites. Если тестовый раннер
технически не стартует, приложи точный безопасный вывод и не подменяй его
успешным утверждением.

## Отчёт и остановка

В конце подготовь один self-contained отчёт для coordinator-чата:

1. изменённые файлы и обоснование;
2. таблица «требование → код → deterministic evidence»;
3. точные запущенные команды и результаты;
4. подтверждение: `0 RUB`, новых AI/Tavily/live generation не было;
5. текущий `git status --short` с отделением собственных файлов от чужих;
6. известные ограничения: failed live-run остаётся failed evidence, а новый
   платный E2E не разрешён этим prompt.

После отчёта остановись. Не начинай Prompt 04, не делай commit и не предлагай
новый paid run без отдельного явного решения пользователя.
