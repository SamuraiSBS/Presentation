# 03h — Tavily source recovery и финальный AITunnel E2E proof

## Явное разрешение пользователя

Пользователь разрешил без промежуточных согласований:

1. **ровно один** диагностический Tavily source-search request без создания
   project/job;
2. если он успешно возвращает реальные URL, **ровно один** новый normal
   user-visible E2E generation project через candidate-only
   `AI_PROVIDER=aitunnel`;
3. локальный commit candidate branch только при полном успехе.

Никаких иных Tavily запросов вне diagnostic + штатного поиска внутри единственного
E2E, никаких retry/второго project/E2E, push или deploy не разрешено.

## Цель

03g устранил narration quality issue, но единственный run остановился до
narration на `mandatory_source_search_provider_failure`. Нужно различить
внешнюю Tavily недоступность и локальную configuration/transport проблему,
не подменяя реальные WEB sources. При рабочем источнике завершить один
AITunnel-backed E2E до ready/Presentation/cost proof.

## Worktree и инварианты

Работай только в:

`D:\presentation\.worktrees\generation-recovery-autonomous`

ветка `codex/generation-recovery-autonomous`. Оригинальный
`D:\presentation` не редактируй. Не трогай `.audit-bmw/tmpw120oeib/enlarged.pptx`.

Не изменяй product provider routing, модели, keys, cap `27.90000000 RUB`,
pricing/FX policy, demo policy, quality thresholds или source requirements.
Для этого candidate E2E разрешён только временный Compose env override:
`AI_PROVIDER=aitunnel` и уже настроенные AITunnel model variables; секреты
никогда не выводить и не записывать в файл. Override удалить после runtime.

## Фаза A — один диагностический search

1. Зафиксируй candidate revision, raw status, runtime health и redacted
   наличие Tavily/AITunnel credentials. Не создавай project/job/envelope.
2. Выполни ровно один прямой диагностический search через тот же Tavily
   adapter/configuration, что использует production worker. Используй
   нейтральную учебную query, не содержащую пользовательских данных.
3. Сохрани без secrets: HTTP/provider status, error class или count URL,
   provider request/correlation ID если есть, длительность и факт возможного
   CostEvent. Не выдавай request headers/keys.
4. Если diagnostic не вернул хотя бы один валидный HTTP(S) URL — paid E2E не
   запускай. Разрешена только бесплатная локальная диагностика точной причины;
   не делай второй Tavily request и не создавай project.
5. Если diagnostic успешен, не выполняй больше прямых source searches:
   единственный следующий поиск допускается только внутри финального E2E.

## Фаза B — final E2E preflight

Перед project run убедись:

- candidate API/worker собраны и пересозданы из candidate worktree;
- AITunnel/Tavily config присутствует, demo off, source mode включён;
- provider/model names, policy, cap, FX/start ledger и queue state сохранены
  без secrets;
- все существующие 03g deterministic gates и typechecks остаются passing;
- нет активных/queued generation jobs, кроме system maintenance.

При любом бесплатном blocker не запускай E2E.

## Фаза C — один final project run

1. Создай ровно один новый обычный учебный project с `with_sources` и
   релевантной конкретной темой; не пиши в БД напрямую.
2. Запусти штатный user-visible generation flow. Не повторяй request вручную,
   не создавай второй project и не вызывай отдельный Tavily search.
3. Дождись terminal state и собери read-only evidence:

   - project/job IDs, provider/model, один envelope/attempt lineage;
   - Tavily WEB source IDs, URL и final source refs;
   - accepted speech, speaker notes, slide text и quality diagnostics;
   - Presentation row, slide count, canvas/export/parity checks;
   - полный CostEnvelope/CostEvent/AiUsageEvent ledger и
     fact-versus-cap table, включая FX snapshot.

Успех требует одновременно: `ready`, реальных sources, valid Presentation,
одного envelope, `settled <= cap`, отсутствия demo/mock и отсутствия
user-visible technical error.

При failure не делать retry: зафиксируй итог и не commit candidate как готовое
решение.

## Commit и отчёт

Только при полном успехе: проверь candidate diff, исключи plans/reports/
audit/unrelated artifacts и создай один локальный commit. Не push/deploy.

Отчёт: diagnostic Tavily result, preflight, E2E evidence или точный stop,
расходы, candidate path/branch, commit SHA при успехе и подтверждение, что
original worktree не изменялся. После отчёта остановись.
