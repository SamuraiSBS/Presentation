# План-промт 04: image-first worker pipeline, local text lift и native evidence

Ты работаешь в `D:\presentation`. Реализуй новый opt-in generation path на основе доказанных контрактов и победителей benchmark. При реализации и тестах запрещены реальные provider calls: используй сохранённые responses и mocks.

## Перед началом

Полностью прочитай:

- `AGENTS.md`;
- `plans/image-first-editable-slides-v1/00-product-contract.md`;
- отчёты 01, 02 и 03;
- актуальный worker generation, shared schemas, usage ledger, canvas builder и export renderer;
- текущий AI Scene v3 код только для безопасного переиспользования отдельных primitives.

Проверь `git status` и diff затрагиваемых файлов. Не откатывай чужие изменения.

## Предусловие и STOP

В отчёте 03 должны быть одновременно:

- отчёты 01/02 подтверждают `FOUNDATION ACCEPTED` и `RECONSTRUCTION GO`;
- `TEXT MODEL GO` с human copy verdicts на трёх fixtures;
- `FULL NON-IMAGE ECONOMIC GO` с общей доказанной стоимостью non-image stages не выше 1 ₽ и `uncertainRub = 0`;
- `IMAGE MODEL GO` с точным model/mode и стоимостью не выше 1 ₽ за вызов;
- `uncertainRub = 0`;
- человеческий visual acceptance для image fixture.

Если хотя бы одного доказательства нет, не интегрируй предположение в runtime. Напиши `PIPELINE BLOCKED BY PREREQUISITE` и остановись без платных вызовов.

## Цель

Добавить выключенный по умолчанию `image_first_editable_v1` путь:

```text
accepted speech
  -> one deck-wide DeckContentLock
  -> one DeckArtDirection / visual family
  -> per slide classifier
       image_text_lift -> one complete-slide image call -> local lift -> native exact text
       native_evidence -> exact native table/chart/formula/diagram in same art direction
  -> local quality gate
       pass -> canonical canvas
       fail -> good native fallback
  -> same canonical canvas for editor/PDF/PPTX
```

Новый путь не заменяет существующий production default до Плана 06 и отдельного rollout решения.

## Этап 1. Orchestration и состояние

1. Создай отдельный orchestrator/module boundary; не превращай `presentation.ts` в новый монолит.
2. Сделай image adapter инъецируемым/provider-neutral, а выбранный model/mode храни в версионированной routing policy. Смена image-модели требует повторного Плана 03, но не переписывания contracts, cleanup или renderer.
3. Используй shared `DeckContentLock` из Плана 01 как единственный источник generated strings.
4. Сохраняй immutable generation lock отдельно от текущих editable values.
5. Сохраняй hashes и lineage:
   - accepted speech/source snapshot;
   - content lock;
   - art direction;
   - prompt per slide;
   - provider result;
   - cleanup/native reconstruction;
   - fallback reason;
   - canonical canvas.
6. Добавь feature flag/mode default off и не мигрируй старые projects.
7. Повторный job/idempotent replay не должен повторно списывать деньги или терять уже готовый слайд.

## Этап 2. Deck-wide art direction

Из content lock и reference profile выбери один art direction на всю презентацию:

- palette и contrast strategy;
- доступные fonts/weights;
- image treatment;
- shape/line language;
- whitespace/edge rules;
- 4–6 допустимых composition archetypes;
- правила native evidence и native fallback.

Не делай отдельный платный art-director call, если это выводит общий non-image budget выше 1 ₽. Предпочтительно получить art direction в том же deck-wide result или построить локально из утверждённого visual family intent.

Composition diversity не должна разрушать единство. Добавь детерминированный guard против одинакового layout на всех слайдах и против универсальной сетки карточек.

## Этап 3. `image_text_lift` route

Для подходящего иллюстративного слайда:

1. Построй prompt из exact content lock strings, visual intent, выбранной family и planned semantic zones.
2. Prompt просит цельный готовый слайд, где текст участвует в композиции.
3. Перед вызовом зарезервируй per-slide максимум и проверь общий deck envelope.
4. Выполни максимум один image generation call.
5. Сохрани raw provider result и billed telemetry даже при failure.
6. Не вызывай платный Luna layout, vision critic, image edit или второй candidate.
7. Локально выполни geometry refinement, OCR/CV diagnostics, mask, cleanup и native overlay из Плана 02.
8. Наложи исходные exact strings, а не OCR text.
9. Создай native locked page number отдельно.
10. Прогони локальные hard gates.

Hard failures:

- wrong dimensions/crop;
- неожиданный текст, logo/watermark;
- конфликтующая цифра/формула/label;
- semantic block не найден или не может быть безопасно очищен;
- ghost text;
- patch artifact;
- unreadable font size/contrast;
- overlap/overflow;
- несоответствие visual intent;
- UI-card/grid composition;
- export parity failure;
- uncertain provider cost.

Любой hard failure переключает этот слайд на native fallback. Если cost известен, pipeline может продолжить следующие заранее зарезервированные слайды. Если settlement неизвестен, `uncertainRub` равен полному unsettled reserve, все дальнейшие paid stages всего deck глобально останавливаются до reconciliation, а оставшиеся слайды строятся бесплатно нативно.

## Этап 4. `native_evidence` route

Классифицируй slide до image generation. Нативный маршрут обязателен для точных:

- таблиц;
- графиков/осей/легенд/значений;
- формул;
- дат/процентов/числовых сравнений;
- причинно-следственных и смысловых диаграмм;
- подписанных карт/таймлайнов, где ошибка меняет смысл.

Правила:

1. Все values/labels/connections строятся из matching accepted speech section; source data только проверяет их точность и не добавляет отсутствующий в речи смысл.
2. Все точные элементы редактируемы.
3. Image-модель не рисует дублирующие значения на фоне.
4. Допустим бесплатный native-only слайд или один image call только для художественного окружения, если он укладывается в envelope и не содержит точных данных.
5. Этот route считается полноценным успешным дизайном, не fallback.
6. Он использует ту же visual family и несколько композиционных archetypes.

Добавь source/data consistency checks до canonical canvas.

## Этап 5. Good native fallback

Fallback renderer получает:

- exact current strings;
- visual family tokens;
- slide role/visual intent;
- available verified assets;
- failure category;
- structured evidence data.

Он выбирает подходящий archetype: typographic editorial, full-bleed local visual with type, timeline, comparison, process, annotated focal object, visual pause, native chart/formula и другие согласованные варианты.

Запрещены:

- один и тот же template для всего deck;
- белый bullet list;
- dashboard/card grid/pills;
- показ exception или placeholder пользователю;
- потеря строки из content lock;
- повторный платный вызов.

Сохраняй внутренний diagnostic, почему выбран fallback, и пользовательский нейтральный status без технической грязи.

## Этап 6. Экономика и отказоустойчивость

До первого paid stage runtime резервирует initial cap `N + 1 ₽` и общий non-image bucket ≤1 ₽. Если source search, narration generation/repair, deck copy или art direction оплачиваются в этом же initial flow, все они входят в этот bucket.

Для каждого image-eligible слайда:

- per-call reserved max ≤1 ₽;
- общее image reservation ≤N ₽;
- completed и failed events учитываются;
- uncertain event учитывается на полный unsettled reserve и глобально останавливает последующие paid stages до reconciliation;
- timeout не повторяется;
- если remaining envelope недостаточен, слайд сразу строится native;
- native evidence/fallback/cleanup/render не создают AI usage events;
- job всегда завершает exact N качественными слайдами, даже если все image calls упали;
- broken image candidate не становится user-visible final slide.

Проверь concurrency: параллельные вызовы не должны совместно превысить cap. Самый безопасный baseline — атомарное резервирование всех возможных calls до запуска и bounded concurrency.

## Этап 7. Canonical render и export parity

- Final presentation document хранит один canonical canvas на слайд.
- Web/editor, PDF и PPTX читают его, а не собирают разные версии.
- Background/decoration locked.
- Semantic text and exact evidence editable.
- Page number native locked.
- Кириллица использует доступный font fallback без изменения строк.
- PDF/PPTX raster background не содержит удалённого текста.
- PPTX text boxes остаются редактируемыми.

Если export path пока невозможно закончить без scope Плана 05, добавь contract/fixtures и явный blocker, но не объявляй полную parity.

## Этап 8. Тесты без сети

Обязательные случаи:

- 6/8/10/12/14 exact counts;
- один deck-wide text call;
- максимум один image call на eligible slide;
- mixed image/native-evidence deck;
- все image calls pass;
- один image call fails -> один fallback, остальные сохраняются;
- все image calls fail -> exact N native deck;
- timeout/unknown cost -> no retry;
- unknown cost -> `uncertainRub` на полный reserve и global paid halt;
- concurrent reservations не превышают cap;
- wrong/extra raster text -> fallback;
- ghost/patch/overflow/overlap -> fallback;
- exact Unicode strings in canonical canvas;
- formula/table/chart data exact and editable;
- visual family consistency + composition diversity;
- idempotent job replay;
- legacy projects unchanged;
- feature flag off by default;
- editor/PDF/PPTX fixture parity.

Используй сохранённый benchmark response как fixture, но не обращайся к provider.

Запусти targeted shared/worker/export tests, typechecks, `git diff --check`; полный build только если это пропорционально изменённым surfaces. Не выполняй Docker/remote deploy без отдельного запроса.

## Отчёт и verdict

Создай:

`D:\presentation\plans\image-first-editable-slides-v1\reports\04-image-first-pipeline-and-native-evidence.md`

Отчёт включает:

- `PIPELINE ACCEPTED`, `PIPELINE NOT ACCEPTED` или `PIPELINE BLOCKED BY PREREQUISITE`;
- architecture/data-flow map;
- provider-neutral image adapter и routing policy proof;
- изменённые файлы;
- доказательство feature flag default off;
- call-count и cap test matrix;
- image/native/fallback fixture matrix;
- structured evidence checks;
- canonical render/export evidence;
- результаты команд;
- чужие dirty changes, которых ты не касался;
- `paid calls during implementation: 0`;
- точный scope Плана 05.

`PIPELINE ACCEPTED` нельзя ставить при скрытом retry, потере exact text, user-visible broken slide, cost-cap race или отсутствии native evidence accuracy.
