# Prompt 03 — silent production quality gate

Работай в D:\presentation. Реализуй prompt полностью для новых generations; не создавай новый план. Перед работой прочитай AGENTS.md, README пакета и этот файл.

## Цель

Quality pipeline становится внутренним production gate: исправимые дефекты чинятся автоматически, неисправимый документ не получает ready, web-editor никогда не показывает технический fallback или служебный текст.

BMW regression: web display добавлял «<title>: коротко и по существу», повторял это в canvas/chips, хотя PPTX показывал иной документ. Устрани источник в canonical generation path; display fallback не должен создавать пользовательский контент.

## Точки входа

- apps/worker/src/tasks/presentation-quality.ts и tests.
- apps/worker/src/tasks/presentation/quality/orchestration.ts.
- apps/worker/src/tasks/presentation/normalization/presentation.ts.
- apps/web/src/lib/presentation-display.ts и tests.
- packages/shared/src/presentation/canvas-audit.ts, canvas-builder.ts, document.ts.
- apps/worker/src/tasks/generation.ts.

## Реализация

1. Введи один internal quality result для generation release: issue category, slide/element, severity, repairability, attempts, final disposition. Payload не показывается пользователю.

2. Добавь blocker checks: banned phrases («коротко и по существу», «введение в тему презентации», prompt echo, TODO), fragment, same title as thesis/bullet/chip, duplicate visible sentence, visual.type=image без visual.image.url, canvas text diverging from canonical Slide fields, bounds/content audit issue.

3. Раздели fallback behavior:
   - normalization может создать grounded fallback из accepted narration;
   - presentation-display может sanitize legacy content, но не создаёт visible callout/bullet/canvas/title phrase;
   - incomplete new-generation document получает controlled loading/unavailable state, не «догаданный» slide;
   - legacy compatibility сохраняй через explicit version/capability detection.

4. Repair order: local deterministic repair; bounded model repair; deterministic canvas rebuild только generated canvas; final audit; затем атомарное сохранение, revision increment и ready. Не повреждай custom canvas, sources, accepted narration или speech script.

5. Добавь structured internal logger fields projectId, jobId, stage, issue categories, attempts, final action. Не логируй полный пользовательский текст как error message.

## Обязательные тесты

1. Empty new generated slide никогда не получает «коротко и по существу».
2. Legacy incomplete deck readable, но не маркируется new production-ready generation.
3. Canvas с duplicate title/chip rebuilds или rejects before ready.
4. Image visual without URL создаёт blocker и идёт в visual fulfillment, не blank slide.
5. Failed final audit не обновляет document/revision/status до ready.
6. Valid repair сохраняет generatedText, speakerNotes, speechScript, sourceRefs и custom canvas.

## Проверка

    npm run build -w @studydeck/shared
    npm run test -w @studydeck/worker -- src/tasks/presentation-quality.test.ts
    npm run test -w @studydeck/web -- src/lib/presentation-display.test.ts
    npm run typecheck -w @studydeck/worker
    npm run typecheck -w @studydeck/web
    git diff --check

## Готово, когда

Пользователь не видит placeholder/internal fallback/partial deck; valid documents repair-and-continue silently; ready является результатом final audit, а legacy/custom canvas остаются совместимы.

