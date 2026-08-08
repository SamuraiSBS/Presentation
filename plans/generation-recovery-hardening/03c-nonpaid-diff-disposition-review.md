# 03c — read-only решение о судьбе текущего recovery diff

## Основание и цель

Prompt 03 не принят: единственный paid live-run завершился `failed`, превысил
cap и не создал `Presentation`; повторный paid run запрещён. Prompt 03a и
Prompt 03b приняты как deterministic/non-paid этапы, но они не заменяют
runtime-доказательство Prompt 03.

Цель — дать пользователю доказательный выбор о текущем незакоммиченном diff,
не меняя его:

1. какие изменения непосредственно подтверждены принятыми 03a/03b evidence;
2. какие изменения не подтверждены, находятся вне recovery scope или требуют
   отдельного решения;
3. можно ли сохранять текущий diff как кандидат для будущего отдельного
   commit-readiness review, не утверждая, что Prompt 03 принят.

Этот prompt не разрешает commit, Prompt 04, новый live-run или реализацию.

## Входные материалы

Прочитай:

- `AGENTS.md`;
- `plans/generation-recovery-hardening/README.md`;
- этот prompt;
- `03-one-real-end-to-end-proof.md`, `03a-presentation-retry-envelope-remediation.md`
  и `03b-presentation-regression-triage.md`;
- все отчёты Prompt 03 и 03b;
- текущие `git status --short` и read-only diff затронутых файлов.

## Жёсткие границы

- Только read-only: не создавать, не редактировать и не форматировать файлы.
- Не запускать npm, Docker, миграции, generation, AI/AITunnel, Tavily, сеть,
  commit, push, deploy, reset, checkout или clean.
- Не трогать `.audit-bmw/tmpw120oeib/enlarged.pptx`.
- Не открывать Prompt 04–06 и не предлагать повторный paid run.
- Не заявлять, что test или runtime proof существует, если он не приложен в
  сохранённых отчётах либо не воспроизводим доступной read-only проверкой.

## Проверка

1. Зафиксируй raw `git status --short`.
2. Построй таблицу для всех изменённых файлов с колонками:

   `файл | принадлежность (03a/03b/предсуществующий/неясно) | evidence | риск | решение`.

   Если post-hunk происхождение внутри одного файла невозможно отделить от
   предсуществующего diff, укажи `неясно`, а не делай предположение.
3. Отдельно оцени:

   - recovery envelope/cap/local presentation изменения из 03a;
   - два unresolved failure из `presentation.test.ts`;
   - failed live-run evidence Prompt 03 и его запрет на повтор;
   - любые незакоммиченные API/shared/worker файлы, не покрытые 03a/03b.
4. Сформулируй один из двух итогов:

   - `retain for later review`: есть узкое, подтверждённое ядро 03a, но оно не
     готово к commit/Prompt 04 без нового явного решения пользователя;
   - `hold`: невозможно безопасно отделить подтверждённое ядро от иных
     изменений, поэтому никаких дальнейших действий не рекомендовать.

## Отчёт и остановка

Передай coordinator-чату один self-contained отчёт:

1. raw `git status --short`;
2. таблицу disposition по всем строкам worktree;
3. evidence-ссылки на конкретные отчёты/команды, без пересказа как факта;
4. один итог: `retain for later review` или `hold`;
5. ясно укажи: Prompt 03 не принят, новый paid run запрещён, Prompt 04 не
   разрешён, изменений и запусков не было.

После отчёта остановись.
