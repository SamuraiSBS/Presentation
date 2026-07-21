# Prompt 02 — speech director for a 7–10 minute presentation

Работай в D:\presentation. Реализуй этот prompt полностью для новых presentations. Не меняй старые decks и не создавай новый план.

Перед работой прочитай AGENTS.md, README текущего пакета и этот файл. Проверь dirty worktree.

## Цель

Новые student presentations должны давать естественный, factual и связный русский текст выступления на 7–10 минут. Видимый слайд остаётся кратким; speakerNotes, speechScript и accepted generatedText — полное объяснение.

BMW regression: 10 слайдов содержали 389 слов, около трёх минут, повторяли одну мысль и не имели переходов.

## Точки входа

- packages/shared/src/generation/schemas.ts — narrative/text plan artifacts.
- apps/worker/src/tasks/presentation/narration/processing.ts — parsing and generic phrase detection.
- apps/worker/src/tasks/presentation/prompts/builders.ts и constants.ts — narration prompt.
- apps/worker/src/tasks/presentation/normalization/presentation.ts.
- apps/worker/src/tasks/presentation/quality/orchestration.ts и presentation-quality.ts.
- apps/web/src/lib/speech-docx.ts и project-script-review.tsx — compatibility consumers; UI review не превращать в обязательную ручную проверку.

## Реализация

1. Добавь shared deterministic timing budget для university_student и easy_professional. Используй один documented Russian-speaking-rate helper. Target total words: 900–1200; title 45–75, content 85–130, conclusion 70–110 слов. Budget зависит от slide count/scenario и не применяется при display/export legacy deck.

2. Создавай narration plan до final slide text. Для content slide обязательны bridge from prior beat, grounded explanation/evidence, why it matters и natural transition. Финал отвечает на central question без общего filler.

3. Усиль prompts: студент говорит естественно, не повторяет visible thesis дословно, не использует «уникальный», «культовый», «эталон», «революционный» без context; без meta language, slide numbers, prompt echoes и placeholder phrases.

4. Добавь deterministic checks/local repair: total duration ниже 7 или выше 10 минут, section too short/generic/duplicate/fragment/without transition, title-content mismatch, weak/duplicated conclusion. Расширяй только grounded accepted material; при отсутствии фактов объясняй значение подтверждённого факта, не создавай новый.

5. Сохрани invariant: accepted narration/generatedText — source of truth. Поздний repair не заменяет полный accepted текст коротким model response. После repair синхронизируй speakerNotes, speechScript и DOCX export input.

## Обязательные тесты

1. Ten-slide fixture на 389 слов получает duration issue и repair/regen path.
2. Fixture на 1,450 слов получает over-duration issue.
3. Повтор «мощность, дизайн и инновации» в трёх sections ловится semantic repetition.
4. «Тема важна и интересна» не проходит quality gate.
5. Final section отвечает на central question и не повторяет предпоследний slide.
6. Repeated repair сохраняет более полный accepted narration.

## Проверка

    npm run test -w @studydeck/worker -- src/tasks/presentation-quality.test.ts
    npm run test -w @studydeck/worker -- src/tasks/presentation.test.ts
    npm run typecheck -w @studydeck/worker
    git diff --check

## Готово, когда

Новая 10-slide university presentation получает 7–10 минут речи без ручной доработки; экран и речь дополняют, а не дублируют друг друга; DOCX использует тот же accepted speech script.

