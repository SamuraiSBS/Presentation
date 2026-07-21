# Production-ready generation: пакет промтов для новых чатов Codex

Этот пакет реализует только новые генерации StudyDeck в D:\presentation.

Решения владельца: выступление 7–10 минут; современная Gamma-подача; только реальные документальные фотографии; пользователь не видит технические ошибки, служебные fallback-фразы и промежуточный сломанный deck; старые презентации не мигрируются.

## BMW-регрессия

- images_and_diagrams завершался без смысловых фото;
- web editor дописывал «<название>: коротко и по существу», а PPTX содержал другую версию;
- canvas, Slide и speechScript расходились;
- factual slides не имели sourceRefs;
- automotive deck получил «Уроки для политики», повторы и неверную классификацию сущностей;
- ready означал schema-valid документ, не проверенный пользовательский результат.

## Порядок реализации

Выполняй один prompt в новом чате, проверяя актуальный код перед работой.

1. 01-grounded-story-and-fact-contract.md
2. 02-seven-to-ten-minute-speech-director.md
3. 03-silent-production-quality-gate.md
4. 04-real-documentary-photo-fulfillment.md
5. 05-modern-gamma-canvas-and-density.md
6. 06-canonical-document-and-export-parity.md
7. 07-user-safe-retries-and-release-verification.md

## Общее начало каждого нового чата

1. Прочитать AGENTS.md, этот README и только выбранный prompt.
2. Выполнить git -c safe.directory=D:/presentation status --short; не откатывать чужие изменения.
3. Сверить prompt с текущим кодом и соседними планами future-presentation-quality и gamma-student-level. Реализованное не дублировать.
4. Реализовать prompt полностью, не писать новый план.
5. Сохранить OpenAI, Yandex, demo fallback, shared Zod-contracts, sourceRefs и user custom canvas.
6. Не менять старые presentations автоматически.
7. Не добавлять пользователю чеклистов качества, технических модалок или ручных подтверждений.

## Определение ready для новой генерации

Новый deck получает ready только когда он тематически связан, factual claims имеют provenance или безопасно обобщены, речь занимает 7–10 минут, видимый текст не содержит шаблонных/служебных фраз, visual direction выполнен или честно перестроен, canvas проходит audit, а web, editor, PPTX и PDF используют один канонический документ.

## Общая проверка

Для каждого prompt выполни targeted tests. При изменении shared/worker/web также используй:

    npm run build -w @studydeck/shared
    npm run test -w @studydeck/shared
    npm run typecheck -w @studydeck/worker
    npm run typecheck -w @studydeck/web
    git diff --check

Для runtime-проверки запускай только затронутые сервисы. Worker/shared generation logic требует worker rebuild; для web-only используй npm run dev:web:fast. Remote deploy не выполнять без отдельного запроса.

