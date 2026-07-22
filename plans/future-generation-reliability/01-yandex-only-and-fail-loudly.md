# 01 — Только Yandex и явная ошибка вместо плохой презентации

## Роль

Ты реализуешь только этот пункт пакета `plans/future-generation-reliability/`. Не переходи к поиску источников, визуальной плотности или массовой переработке prompt'ов, кроме минимально необходимого для корректной обработки ошибки.

## Проблема

В разобранном проекте статус job был `completed`, хотя document имел `generationMode: "demo-fallback"`. Код в `generatePresentationFromNarration(...)` ловит сбой модели и строит локальную «безопасную» колоду из принятой речи. Для пользователя это выглядит как успешно сгенерированная, но фактически непригодная презентация.

## Результат

Для новых generation jobs:

- `AI_PROVIDER=yandex` означает попытку **только Yandex**.
- При отсутствии Yandex-конфигурации, ошибке сетевого/провайдерского вызова, невалидном структурированном ответе или неустранимом качестве job становится `failed`.
- В БД не создаётся и не сохраняется новая presentation-ревизия с `generationMode: demo` или `demo-fallback` как результат обычной пользовательской генерации.
- Пользователь видит спокойное действие-ориентированное сообщение, например: «Не удалось подготовить презентацию. Проверьте настройки Yandex AI и попробуйте ещё раз.» Не раскрывать JSON Schema, ключи, stack trace или текст провайдера.
- Старый demo-preview/тестовые fixture и явно разрешённые demo-сценарии не ломать без отдельного аудита их вызовов.

## Обязательное исследование перед правкой

Прочитай `AGENTS.md`, README пакета, `git status --short`, а затем:

- `apps/worker/src/tasks/presentation/providers/provider-selection.ts`;
- `apps/worker/src/tasks/presentation/orchestrator.ts`;
- `apps/worker/src/tasks/presentation/providers/generation.ts`;
- `apps/worker/src/tasks/generation.ts`;
- `apps/worker/src/tasks/job-progress.ts`;
- обработку `project.error` в API/web;
- точные тесты `presentation.test.ts`, `job-progress.test.ts` и связанные generation tests.

Сначала опиши себе текущие отдельные ветви: генерация narration, генерация слайдов по принятой narration, необязательный repair, `demoPresentation`, `buildSafePresentationFromNarration`. Не делай вывод по имени функции — проследи каждый caller.

## План реализации

1. Сделай выбор провайдера однозначным: если `AI_PROVIDER=yandex`, массив кандидатов содержит только `yandex`; при `openai` — только `openai`. Не добавляй каскад между ними. Если окружение невалидно, возвращай/выбрасывай диагностируемую конфигурационную ошибку до сетевого вызова.
2. Раздели допустимые локальные repair от подмены результата. Локальный repair разрешён только для уже валидного документa и не должен маскировать отсутствие полноценного ответа модели. Если модель не выдала валидную презентацию по принятой речи, пусть `generatePresentationFromNarration(...)` возвращает ошибку в очередь, а не `buildSafePresentationFromNarration(...)`.
3. Убедись, что worker записывает job/project error через существующую классификацию и не переводит job в `completed` после такой ошибки. Сохрани безопасные пользовательские формулировки и подробности — только в структурированных логах/Sentry.
4. Не редактируй старые `Presentation` записи и не мигрируй данные. Правило действует на runtime новых jobs.
5. Проверь, действительно ли `generationMode` должен продолжать содержать demo-варианты для изолированных demo fixture. Если да — сузь их до явно тестового/preview пути, не меняя shared-contract без причины.

## Тесты, которые нужно добавить/изменить

- `AI_PROVIDER=yandex` с валидной конфигурацией выбирает только `yandex`, даже когда OpenAI тоже настроен.
- Ошибка Yandex на narration stage делает job failed и не создаёт fallback narration/документ.
- Ошибка Yandex при building slides после принятой narration делает job failed и не записывает новую ревизию presentation.
- Невалидный структурированный ответ Yandex покрыт тем же поведением.
- API/UI показывает безопасное русское recovery-сообщение, не исходную ошибку провайдера.
- Существующие явно demo-ориентированные тесты остаются осознанно рабочими либо заменяются точным аналогом без изменения продукта скрытно.

## Проверка

```powershell
npm run test -w @studydeck/worker -- src/tasks/presentation.test.ts src/tasks/job-progress.test.ts
npm run typecheck -w @studydeck/worker
npm run typecheck -w @studydeck/api
npm run typecheck -w @studydeck/web
git diff --check
```

В финальном отчёте перечисли: изменённые файлы, точную новую семантику ошибок, результаты тестов и то, что локальный Docker runtime не менялся, если пользователь не просил деплой.

