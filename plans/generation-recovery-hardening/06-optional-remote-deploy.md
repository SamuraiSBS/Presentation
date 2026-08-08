# 06 — явный remote deploy и production smoke

## Разрешение

Запускай этот prompt только после принятого Prompt 05 и отдельного явного сообщения пользователя, содержащего все три значения:

1. `HostName` для SSH, например `deploy@example.com`;
2. `RemotePath`, например `/opt/studydeck`;
3. публичный URL, по которому пользователь ожидает сервис после deploy.

Если хотя бы одного значения нет, не угадывай его и не выполняй deploy: запроси недостающее значение. Не подменяй целевой сервер локальным Docker.

## Цель

Развернуть только принятый локальный commit SHA через штатный `scripts/deploy.ps1`, затем доказать, что production отвечает. Это не повторная генерация и не проверка качества новой презентации.

## До deploy

1. Прочитай `AGENTS.md`, README пакета, отчёты Prompt 04–05 и решение координатора.
2. Выполни `git status --short`, `git rev-parse HEAD` и `git show --stat --oneline HEAD`.
3. Убедись, что HEAD совпадает с commit SHA, принятым в Prompt 05. Наличие чужих незакоммиченных файлов не разрешает включать их в deploy: штатный скрипт должен разворачивать только `HEAD`.
4. Сохрани текущий production commit/release identifier, если он доступен read-only. Это нужно для понятного rollback decision; не выполняй rollback сам без явного запроса пользователя.
5. Покажи пользователю короткую preflight-сводку: local commit SHA, SSH target, remote path и public URL. После этого выполняй deployment только если эти значения соответствуют его явному разрешению.

## Deploy

Используй штатный скрипт репозитория, без ручной подмены последовательности:

```powershell
.\scripts\deploy.ps1 -HostName '<HostName>' -RemotePath '<RemotePath>'
```

Не делай `git push`, не передавай секреты в выводе и не изменяй удалённый код вручную. Скрипт должен получить только принятый `HEAD`.

## Production smoke

После успешного deploy проверь:

1. публичная главная страница доступна по указанному URL;
2. production API health endpoint возвращает успешный ответ;
3. на удалённом сервисе запущены нужные containers/services и нет явного crash loop;
4. новая generation job, AI/Tavily или платный тестовый проект **не** создавались.

Если deploy или smoke упал, немедленно остановись. Собери безопасный вывод ошибки, текущий remote release/commit identifier и предложи следующий отдельный rollback-investigation prompt. Не выполняй rollback, второй deploy или платный прогон без нового явного решения пользователя.

## Отчёт и остановка

Передай coordinator-чату:

- local commit SHA и подтверждение, что именно он развернут;
- SSH target и remote path без секретов;
- результат `scripts/deploy.ps1` в безопасном виде;
- URL и результаты web/API health checks;
- статус сервисов/containers;
- `0 RUB: новые AI/Tavily вызовы не выполнялись`;
- итоговый `git status --short` локального worktree.

После отчёта остановись. Не запускай создание презентации как часть production smoke.
