# Prompt 04 — real documentary photo fulfillment

Работай в D:\presentation. Реализуй prompt полностью, только для новых generated decks. Перед работой прочитай AGENTS.md, README пакета и этот prompt.

## Цель

Если план выбирает real_photo или пользователь запросил images_and_diagrams, новый deck получает реальные релевантные документальные фото либо до final canvas честно переходит в layout без фото. Нельзя оставлять пустой image-focus или маскировать отсутствие фото градиентом.

AI illustrations запрещены для этой product direction. Existing provider path для старых документов не ломай, но новый default не выбирает generated_illustration.

## Точки входа

- packages/shared/src/generation/schemas.ts — imageStrategy, visualStrategy.
- apps/worker/src/tasks/presentation/planning/builders.ts — visual directions and visual balance.
- apps/worker/src/tasks/image-search.ts и image-search.test.ts.
- apps/worker/src/tasks/presentation/normalization/presentation.ts — layout selection.
- packages/shared/src/presentation/canvas-builder.ts, attribution.ts.
- apps/worker/src/tasks/presentation-quality.ts.

## Реализация

1. В new-generation design brief закрепи photo-only policy: real_photo, diagram, none допустимы; generated_illustration не выбирается автоматически; фото только для concrete visual anchor, abstract claim получает timeline/comparison/diagram/statement.

2. Сделай photo fulfillment явным этапом после planning и до canvas finalization. Для direction есть exact subject, period/model/event, desired composition и query. Query строится из source-grounded entity names; candidate проходит relevance check against title, narrative job и source context; сохраняются source URL/title/provider, attribution и alt text; одно фото не повторяется без явной причины.

3. Bounded recovery при отсутствии фото: 2–3 refined documentary queries; crop/layout change только с valid asset; если asset не найден — diagram при достаточных фактах, иначе statement/timeline без притворства, что фото есть; затем rerun quality/canvas audit. Не генерируй artificial image и не ставь blank placeholder.

4. Tighten layout invariant: image-focus/image slots требуют visual.image.url; thesis сам по себе не делает image layout valid. Canvas builder не резервирует пустой media region.

5. Attribution остаётся в provenance и compact credit согласно текущим product rules. Не показывай длинные URL в body и не делай citation manager UI.

## Обязательные тесты

1. BMW M3 direction строит query с model/generation/documentary context, выбирает matching photo и сохраняет attribution.
2. No-candidate photo request retries refined queries и выбирает valid non-photo layout без blank canvas.
3. Abstract claim не вынуждает generic car photo.
4. Photo direction без URL fails quality gate.
5. Один candidate не reused на двух slides by default.
6. New generation не выбирает generated_illustration; old document с ним всё ещё render/export.

## Проверка

    npm run build -w @studydeck/shared
    npm run test -w @studydeck/worker -- src/tasks/image-search.test.ts
    npm run test -w @studydeck/worker -- src/tasks/presentation-quality.test.ts
    npm run typecheck -w @studydeck/worker
    git diff --check

## Готово, когда

10-slide documentary topic получает deliberate mix реальных фото и evidence-driven diagrams; каждый выбранный visual traceable; missing photo тихо меняет composition до показа пользователю; AI illustration не появляется в новом default deck.

