# Prompt 04 — локальная презентация из принятой речи

Скопируй весь этот файл в новый чат Codex. Эта задача требует выполненных Prompts 01–03.

## Задача

Убери все платные LLM-вызовы из стадии «Создать презентацию» для будущего economic standard run. После принятой narration презентация должна собираться локально и детерминированно: 10 слайдов, заголовки, один тезис, 2–3 bullets, speaker notes, source refs, slide type, canvas и release-ready document.

## Контекст

- `generatePresentationFromNarration()` сейчас вызывает model providers.
- `buildSafePresentationFromNarration()` уже есть, но использует `demo-fallback` и fallback narrative plan. Его нельзя просто включить как production implementation.
- Локальные builders уже существуют: `buildResearchBrief`, `buildDeckStory`, `buildDesignBrief`, `buildSlideTextPlans`, `buildSlideBlueprints`, `ensureEditableCanvas`.
- В БД проект сохраняет только `speechDraft`; source snapshot и envelope доступны после первых трёх задач.

## Требования

1. Создай отдельный production-grade deterministic generation mode, не `demo`/`demo-fallback`. Он должен проходить те же production quality gates, что и обычный документ.
2. На базе accepted narration + сохранённого source snapshot локально восстанови canonical narrative plan: по одной структуре на section, заголовок/вопрос/ключевая мысль из section и source anchors. Не вызывай модель и не опирайся на `normalizeNarrativePlan([])` как на единственный смысловой источник.
3. Локально собери deck story, design brief, slide text plans и blueprints. Контракт видимого слайда: **один тезис + 2–3 коротких bullets**; полная речь остаётся speaker notes/speech script.
4. Для каждого фактического слайда прикрепи только подходящие `sourceRefs` из сохранённого snapshot. Нельзя выдумывать citation metadata; если источник не поддерживает точное число, локально обобщай формулировку.
5. Построй редактируемый canvas через существующие shared builders и перепроверь `auditSlideCanvas`. Не меняй кастомные canvas старых пользовательских документов.
6. Удали AI model path именно из `generate-presentation` economic standard run: не должны исполняться narrative plan, design brief, structured presentation, slide text repair, quality critic или quality repair calls.
7. Сохрани совместимость существующих provider-путей и старых saved presentations. Не делай массовую миграцию старых document JSON.
8. Presentation BullMQ retry после уже сохранённой речи должен быть безопасным и локальным: повтор не расходует AI-бюджет и не создаёт новый source snapshot.

## Вероятный scope

- `apps/worker/src/tasks/generation.ts`
- `apps/worker/src/tasks/presentation/orchestrator.ts`
- `apps/worker/src/tasks/presentation/planning/builders.ts`
- `apps/worker/src/tasks/presentation/normalization/presentation.ts`
- `apps/worker/src/tasks/presentation-quality.ts`
- tests в worker/shared; shared schema только при необходимости нового generationMode.

## Acceptance criteria

- После accepted narration `generate-presentation` делает ноль AI provider calls и ноль Tavily web-source calls.
- Итоговый 10-slide document проходит schema, canvas audit и production quality release.
- Видимый текст соответствует правилу `1 thesis + 2–3 bullets`; речь остаётся полной и не переписывается.
- Document несёт допустимые source refs и local generation mode.
- Повтор presentation job даёт валидный document без нового AI spend.

## Проверка

Добавь тест, который мокаeт все AI clients и падает при любом обращении, но успешно собирает 10-slide document из принятой русской речи и source snapshot. Добавь canvas/export parity regression. Запусти targeted worker/shared tests и typecheck. В финале перечисли, какие model calls стали недостижимы в economic path.

