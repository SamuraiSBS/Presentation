# 03b — non-paid triage двух presentation regression failures

## Основание и цель

Prompt 03 не принят: единственный разрешённый paid live-run завершился
`failed`, и повторять его запрещено. Prompt 03a принят: deterministic tests
подтверждают remediation envelope/retry и local recovery.

Вне финального набора 03a остались два failure в
`apps/worker/src/tasks/presentation.test.ts`:

- `hides weak visual blocks and keeps useful structured visuals` — `bad_narration`;
- `uses slide speaker notes as the narration fallback for each concrete slide` —
  `schema_risk`.

Цель этого prompt — безопасно установить, вызваны ли они текущим незакоммиченным
diff, и только при доказанной связи устранить минимальную причину. Он не
принимает Prompt 03 и не заменяет реальный E2E-доказательство.

Перед работой прочитай:

- `AGENTS.md`;
- `plans/generation-recovery-hardening/README.md`;
- этот prompt;
- `plans/generation-recovery-hardening/03a-presentation-retry-envelope-remediation.md`;
- все отчёты Prompt 03, включая шестой.

## Жёсткие границы

- Не создавать проекты и не запускать generation, live smoke, AI/AITunnel,
  Tavily или иные сетевые/платные вызовы.
- Не выполнять Docker build/up/restart, миграции, commit, push, deploy, reset,
  checkout или clean.
- Не менять provider/model routing, ключи, cap, cost-envelope lifecycle,
  demo/mock policy, UI, export/canvas или source-search.
- Не менять данные failed live-run в БД/Redis/MinIO.
- Не удалять и не менять `.audit-bmw/tmpw120oeib/enlarged.pptx`.
- Не открывать Prompt 04–06 и не делать второй paid E2E.

Разрешены только read-only сравнение с `HEAD`, минимальная правка worker-кода
или тестовых fixtures, если она непосредственно устраняет доказанный regression,
и узкие deterministic tests/typecheck изменённых worker-файлов.

## Порядок работы

1. Зафиксируй `git status --short`. Сохрани чужие изменения.
2. Выполни только целевой запуск `presentation.test.ts`; приложи полный вывод
   обоих failures.
3. Read-only сравни затронутые функции и fixtures с `HEAD`. Не утверждай, что
   failure предсуществовал, без воспроизводимого baseline. Укажи точную
   причинную цепочку либо честно зафиксируй, что причина не доказана.
4. Если причина доказанно находится в текущем незакоммиченном diff и относится
   к смыслу 03a/recovery, внеси минимальную правку. Если связь не доказана или
   исправление расширяет scope, ничего не меняй и остановись.
5. После допустимой правки выполни только:

   ```powershell
   npm run test -w @studydeck/worker -- src/tasks/presentation.test.ts
   npm run typecheck -w @studydeck/worker
   ```

   При изменении непосредственно затронутого recovery-файла можно добавить
   соответствующий один existing targeted test file. Не запускай широкие suites.

## Критерии результата

### Вариант A — исправление допустимо и прошло

- Оба named test cases проходят.
- В отчёте есть причинная цепочка «изменённый hunk → failure → минимальная
  правка → passing assertion».
- Нет внешних/платных вызовов; `0 RUB`.

### Вариант B — корректная остановка без правки

- Есть полный target output и read-only evidence, почему причинная связь с
  текущим diff не доказана или почему fix вне scope.
- Никакая unrelated правка не выполняется.

Оба варианта не переводят Prompt 03 в статус `принят` и не разрешают Prompt 04.

## Отчёт и остановка

Передай coordinator-чату один self-contained отчёт:

1. исходный и финальный outputs целевого test запуска;
2. точную причинную цепочку либо доказательство отсутствия такой цепочки;
3. изменённые файлы и relevant diff, если была правка;
4. команды и результаты;
5. `git status --short` с отделением собственных изменений;
6. `0 RUB` и подтверждение отсутствия live/AI/Tavily/Docker/миграций;
7. явную фразу: «Prompt 03 остаётся не принят; повторный paid live-run не
   разрешён».

После отчёта остановись.
