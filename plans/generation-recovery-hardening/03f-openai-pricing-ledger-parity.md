# 03f — автономная OpenAI pricing/ledger parity перед re-proof

## Основание и полномочия

Это обязательное узкое продолжение Prompt 03e. В candidate worktree OpenAI
теперь создаёт и наследует `CostEnvelope`, но deterministic test обнаружил,
что для активного provider/model отсутствует pricing record:
`aitunnel_narrative_plan_price_unavailable`. Без неё нельзя честно записать
actual usage/settled ledger и доказать cap до paid E2E.

Пользователь уже разрешил автономно решить recovery проблему, один paid E2E и
локальный commit при успехе. Это разрешает добавить **только проверяемую
pricing запись для фактически настроенного OpenAI-compatible provider/model**,
не меняя cap, маршрутизацию, ключи, demo policy или любые иные цены.

Если authoritative pricing source для именно этого provider/model получить
нельзя, этот prompt обязан остановиться без paid E2E и без выдуманной цены.

## Жёсткие границы

- Работай только в candidate worktree
  `D:\presentation\.worktrees\generation-recovery-autonomous`; исходный
  `D:\presentation` не меняй.
- Не меняй `AI_PROVIDER`, модель, ключи, provider routing, cap, policy
  buckets, quality gates, demo policy или чужие pricing записи.
- Не создавай project/job и не запускай AI/Tavily/paid E2E до успешного
  deterministic pricing/ledger gate.
- Не выполняй push, deploy, reset, clean и не удаляй worktree.
- Public read-only lookup pricing разрешён только для проверки authoritative
  source; не отправляй ключи, prompt, пользовательские данные или запросы к
  generation endpoint.

## Фаза A — установить источник, а не оценку

1. Read-only зафиксируй активные provider/model names и точное место, где
   lookup цены ожидается. Не раскрывай secrets.
2. Определи, является ли `AI_PROVIDER=openai` прямым официальным OpenAI API
   или OpenAI-compatible gateway. Для gateway authoritative source — его
   локально настроенный provider catalog/billing contract, а не страница
   обычного OpenAI с другой моделью.
3. Найди неизменяемый источник цены для **точного model identifier**:

   - официальный pricing/documentation URL точного provider, либо
   - существующий versioned catalog в repository/operational configuration с
     явной датой и unit price, либо
   - provider usage telemetry, если она возвращает именно settled RUB price
     для той же операции без осуществления новой generation.

4. Не используй estimate, цену похожей модели, курс валюты «на глаз»,
   неофициальный агрегатор или fallback `0`. Если источник не подтверждает
   точную модель и units, остановись с evidence; paid E2E остаётся не
   использован.

## Фаза B — минимальная implementation parity

Только при найденном source добавь минимальную versioned pricing entry в
существующий catalog/contract, включив provider, exact model, input/output
units, currency/RUB calculation source и effective date/reference. Не меняй
ни одного существующего значения pricing или cap.

Добавь deterministic tests, доказывающие для OpenAI flow:

1. `narrative_plan`, design, presentation и repair используют exact pricing
   entry или честно fail до provider, если запись отсутствует;
2. usage event получает provider/model/stage, вычисленный settled RUB и тот
   же inherited `CostEnvelope` ID;
3. reservation/settlement остаются в одном envelope и не превышают cap;
4. unknown OpenAI model не получает цену похожей модели и не допускает
   provider call;
5. существующие AITunnel/Yandex paths не изменены.

Запусти только relevant API/worker tests, typechecks и `git diff --check`.
В отчёте приведи precise pricing source, но не ключи.

## Фаза C — продолжение 03e без нового разрешения

Если все бесплатные gates проходят:

1. Узко пересобери/recreate candidate `api`/`worker` и докажи их candidate
   image/container IDs.
2. Повтори preflight Prompt 03e: health, worker, infrastructure, demo off,
   cap/start usage/пустая очередь.
3. Немедленно выполни единственный разрешённый paid E2E Prompt 03e через
   normal user-visible flow. Не делай retry, второй project или второй run.
4. При полном `ready`, одном envelope, реальных sources, valid Presentation и
   `settled <= cap` создай один local commit candidate branch. Иначе
   остановись без commit.

## Отчёт и остановка

Передай один self-contained отчёт:

1. source/provider/model verdict и URL/record или точную причину отсутствия
   authoritative price;
2. relevant diff и test/typecheck outputs;
3. факт, что cap/routing/existing prices не менялись;
4. при проходе — image/container IDs, complete E2E IDs, source URLs,
   presentation/quality evidence и fact-versus-cap ledger;
5. commit SHA только при полном успехе; иначе явное подтверждение `0 RUB`,
   no commit, no retry.

После отчёта остановись.
