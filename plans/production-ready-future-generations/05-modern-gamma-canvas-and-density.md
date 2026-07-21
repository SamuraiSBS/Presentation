# Prompt 05 — modern Gamma canvas, readable density

Работай в StudyDeck, D:\presentation. Реализуй prompt полностью для новых decks. Не мигрируй старые presentations и не создавай второй layout engine.

## Цель

Новые presentations выглядят как современная Gamma-подача для студенческой защиты: выразительный ритм, реальные фото, минимум текста и профессиональная читаемость. Это не интерфейс из карточек и не десять одинаковых белых rounded rectangles.

## Точки входа

- apps/worker/src/tasks/presentation/planning/builders.ts.
- packages/shared/src/generation/schemas.ts — sceneTextMode, layoutIntent, imageStrategy.
- packages/shared/src/presentation/themes.ts, layouts.ts, typography.ts.
- packages/shared/src/presentation/canvas-builder.ts, canvas-helpers.ts, canvas-audit.ts.
- apps/web/src/components/slide-template-renderer.tsx, apps/web/src/lib/presentation-display.ts.
- apps/worker/src/tasks/export.ts.

Также прочитай реализованный plans/gamma-student-level/07-modern-gamma-slide-template-upgrade.md. Расширяй current scene modes/canvas helpers, не создавай параллельный layout engine.

## Реализация

1. Для new Gamma default зафиксируй layout rhythm: hero/full-bleed photo, split photo+claim, timeline, comparison/evidence, visual statement, concise final takeaway. Запрети run из трёх одинаковых statement/card silhouettes. Planning выбирает композицию по narrative job и asset availability.

2. Дополни canvas builder только нужными variants. Для каждого определи content ownership/source of truth, safe text capacity, media crop/object-fit, title/main-claim/supporting roles. Card grid допускается лишь для сравнения, а не как общий декор.

3. Typography/density rules для generated canvas: deck title 48–64 pt equivalent; slide title 34–44; main claim 28–38; supporting 22–28; credit/number may be smaller. Сначала сокращай visible words/меняй layout, потом bounded font fit. Обычно 8–25 visible words and one main message. Используй shared semantic tokens и общий px→pt mapping.

4. Strengthen canvas audit: overflow, unintended overlap, title wrap, body heavier than title, narrow columns, orphan lines, empty image slot и repeated composition. Repair generated canvas conservatively; custom canvas preserve.

5. Renderer/exporters используют те же canvas semantics. Не добавляй CSS-only decorative layer, которая исчезает в PPTX/PDF.

## Обязательные тесты

1. Ten-slide fixture не имеет run из трёх одинаковых layout silhouettes.
2. Full-bleed/split photo layouts требуют resolved image и не перекрывают photo focal area.
3. Long Russian title сокращается или меняет layout, а не становится двухстрочным banner/unsafe font.
4. Slide-9 oversized paragraph создаёт audit issue и repairs to readable composition.
5. Main text не доминирует над title без explicit hero role.
6. Legacy/custom canvas остаются на прежнем path.

## Проверка

    npm run build -w @studydeck/shared
    npm run test -w @studydeck/shared
    npm run test -w @studydeck/worker -- src/tasks/presentation-quality.test.ts
    npm run test -w @studydeck/web -- src/lib/presentation-display.test.ts
    npm run test -w @studydeck/worker -- src/tasks/export.test.ts
    npm run typecheck -w @studydeck/web
    npm run typecheck -w @studydeck/worker
    git diff --check

## Готово, когда

New decks больше не похожи на повторяющиеся белые карточки, читаются с проектора, real-photo layouts имеют смысл, а web/PPTX/PDF разделяют одну Gamma-композицию.

