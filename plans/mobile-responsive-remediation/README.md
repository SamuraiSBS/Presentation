# StudyDeck: mobile responsive remediation

Этот пакет превращает мобильный аудит от 31 июля 2026 года в последовательность самостоятельных implementation-промтов для Codex. Он покрывает пользовательские страницы, редактор, workflow, экспорт, создание проекта и админку.

Источник требований:

- `D:\presentation\.impeccable\critique\2026-07-31T17-57-08Z__apps-web-src-app.md`;
- живой production-like снимок на `http://localhost:3010`;
- код и тесты в `D:\presentation`, которые всегда важнее устаревших строк и номеров из отчёта.

## Что исправляет пакет

В аудите нет P0. Зафиксированы 6 P1 и 5 P2:

- мобильный, landscape и tablet shell редактора;
- обрезанный artifact финального CTA лендинга;
- скрытый активный шаг workflow;
- первый экран `/new`, перекрытый нижней навигацией;
- scroll/focus поведение drawer админки;
- touch-targets меньше 44x44 px;
- desktop-only административные таблицы;
- слишком длинная страница проверки речи;
- подписи нижней навигации размером 8.5 px.

## Порядок выполнения

Каждый numbered-файл выполняется **в отдельном новом чате Codex** и только после принятия предыдущего этапа координатором.

1. `01-editor-responsive-shell.md` — P1 редактора: portrait, landscape, 768 px.
2. `02-public-creation-and-workflow.md` — P1 лендинга, `/new` и workflow progress.
3. `03-admin-mobile-and-touch-accessibility.md` — P2 админки, таблиц, touch-targets и нижней навигации.
4. `04-speech-review-progressive-disclosure.md` — P2 длинной страницы речи.
5. `05-cross-route-mobile-regression-gate.md` — итоговая проверка всех маршрутов и только узкие regression fixes.

`00-read-only-coordinator.md` предназначен для отдельного постоянного чата-координатора. Он не реализует код, а принимает отчёты, проверяет evidence и выдаёт точный следующий текст.

Этапы нельзя запускать параллельно: 02 и 04 последовательно меняют `workflow-review.css`, 01 и 03 могут последовательно уточнять размеры контролов редактора, а 05 проверяет итоговое состояние всех предыдущих этапов.

## Общие границы

- Работать только в `D:\presentation` и сначала полностью читать `AGENTS.md`.
- До правок выполнять `git status --short`; не делать reset, checkout, clean или массовое форматирование.
- Сохранить чужие изменения. В частности, не восстанавливать и не удалять историческое состояние `.audit-bmw/tmpw120oeib/enlarged.pptx`.
- Не менять legacy MVP в корне, backend, worker, Prisma, AI/search/provider логику и контракты презентации без доказанной необходимости текущего этапа.
- Не устанавливать новые зависимости: в проекте уже есть Radix, Lucide, React Query, Tiptap и Playwright.
- Не делать `git add`, commit, push, deploy, Docker build/restart и платные/сетевые AI-вызовы.
- Для UI-проверки использовать `npm run dev:web:fast` и `http://localhost:3020`. `localhost:3010` — production container; эти промты не разрешают его перестраивать.
- Сохранять текущую оранжевую визуальную систему, desktop UX, generated-slide rendering и export parity. Это responsive remediation, не редизайн.

## Общая матрица viewport

Проверять фактические bounding boxes и overflow, а не только делать скриншоты:

| Режим | Viewport |
|---|---:|
| small phone portrait | 320x568 |
| phone portrait | 360x800 |
| phone portrait | 390x844 |
| large phone portrait | 412x915 |
| tablet portrait | 768x1024 |
| small phone landscape | 568x320 |
| phone landscape | 844x390 |

Во всех применимых маршрутах обязательны:

- отсутствие document-level horizontal overflow;
- отсутствие перекрытия fixed/sticky навигацией;
- доступность текущего действия без скрытого обрезания;
- осмысленный scroll container только там, где он действительно нужен;
- видимый keyboard focus, корректные accessible names и reduced-motion совместимость;
- интерактивные цели не меньше 44x44 px на coarse pointer, без уменьшения текста до нечитаемых размеров;
- корректность с длинным русским текстом и safe-area inset.

## Evidence и отчёт каждого исполнителя

Исполнитель должен закончить одним самодостаточным отчётом:

1. что изменено и почему;
2. полный список изменённых файлов;
3. какие acceptance criteria доказаны;
4. команды и точный результат tests/typecheck/E2E;
5. какие viewport/маршруты проверены и какими измерениями;
6. где лежат screenshots/traces при наличии;
7. оставшиеся риски или блокеры без маскировки;
8. итоговый `git status --short` с отделением своих файлов от чужих.

После отчёта исполнитель останавливается и не начинает следующий prompt.

## Как передавать между чатами

В новый worker-чат прикладывайте:

- соответствующий numbered prompt;
- этот `README.md`;
- исходный audit-файл;
- принятый координатором полный отчёт предыдущего этапа, если это этап 02–05.

Не нужно прикладывать все остальные numbered prompts. Новый чат обязан сверять отчёт с текущим кодом и не считать его источником истины.

