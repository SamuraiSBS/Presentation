# Prompt 01 — grounded story, facts and sources

Ты работаешь в StudyDeck AI, D:\presentation. Реализуй этот prompt полностью. Не создавай новый план и не ограничивайся аудитом.

Перед изменениями прочитай AGENTS.md, README текущего пакета и этот файл. Проверь git status и актуальный код.

## Цель

Для новых generated presentations ввести проверяемый контракт: каждый слайд имеет отдельную роль в истории, значимые факты имеют provenance, а модель не смешивает сущности, периоды и темы. Пользователь не видит режим проверки и не подтверждает результаты вручную.

BMW regression: BMW 328 нельзя представлять как модель BMW M, обычную BMW 8 Series нельзя без оговорки выдавать за M-модель, а «Уроки для политики» не может появляться в историческом докладе об автомобилях.

## Точки входа

- packages/shared/src/generation/schemas.ts — DeckStory, SlideNarrative, SlideTextPlan, GenerationPipelineArtifacts.
- packages/shared/src/projects/schemas.ts и packages/shared/src/presentation/schemas.ts — sourceRefs, Slide, document contract.
- apps/worker/src/tasks/presentation/planning/builders.ts — deterministic plan/design brief.
- apps/worker/src/tasks/presentation/prompts/builders.ts — model constraints.
- apps/worker/src/tasks/presentation/normalization/presentation.ts — normalized slides/fallback narrative.
- apps/worker/src/tasks/presentation-quality.ts и quality/orchestration.ts.

## Реализация

1. Расширь shared generation artifacts минимальным backward-compatible factual-story contract: per-slide story job, audience question, supported fact/source IDs; optional entity assertion с subject/relation/object/confidence/source linkage. Старые documents должны парситься defaults без миграции.

2. В planning stage построй deterministic topic profile из project title, prompt, accepted narration и sources: topic terms, allowed entities, time range, domain anchors. Не создавай универсальную базу знаний и не выдумывай факт при отсутствии источника.

3. Добавь quality issues/local repair для off-topic title/purpose/visual prompt, title который повторяет section label, slide без distinct narrative function, точной даты/модели/числа/entity relation без sourceRef, entity-category mismatch и более одного conclusion без новой функции.

4. Repair сначала использует accepted narration и source excerpts. Если подтверждение не найдено — безопасно обобщает claim или заменяет slide тематическим explanatory beat. Не приклеивай случайный sourceRef. Сохраняй generatedText, speakerNotes, speechScript, sourceRefs и explicit custom canvas.

5. Prompt builders требуют одну distinct job на слайд, no invented facts/topic jumps/generic filler и source-grounded wording для claims с датами, моделями, биографиями, юридическими и научными фактами.

## Обязательные тесты

1. Automotive fixture с BMW 328 1936 и BMW M 1972 ловит «328 — BMW M» и исправляет wording без выдуманной ссылки.
2. «Уроки для политики» в automotive deck получает off-topic issue и тематическую замену.
3. Два summary slides с одной мыслью получают duplicate/narrative issue; остаётся один финал.
4. Точный год без sourceRef создаёт issue; подходящий sourceRef его снимает.
5. Repair не перерисовывает existing custom canvas.
6. Старый document без новых artifacts schema-valid.

## Проверка

    npm run build -w @studydeck/shared
    npm run test -w @studydeck/worker -- src/tasks/presentation-quality.test.ts
    npm run test -w @studydeck/worker -- src/tasks/presentation/prompts/builders.test.ts
    npm run typecheck -w @studydeck/worker
    git diff --check

## Готово, когда

Новый deck не имеет topic jumps и неподтверждённых точных claims; factual slide хранит provenance или безопасно обобщён; story движется к одному заключению; старые проекты и ручные canvas совместимы.

