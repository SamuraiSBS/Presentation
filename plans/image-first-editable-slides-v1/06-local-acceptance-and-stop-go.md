# План-промт 06: локальная приёмка, два endpoint-deck и честный stop/go

Ты работаешь в `D:\presentation`. Это финальный локальный read-only gate пакета. Сначала выполни все бесплатные проверки. Реальную генерацию разрешено запускать только после отдельного свежего сообщения пользователя с точным потолком расходов.

Этот план не разрешает commit, push, merge, staging, production rollout или deploy.

Этот план также не разрешает исправлять implementation code. Допустимы только runtime operations, отчёт и acceptance artifacts. Любой найденный дефект означает NO-GO, отдельный remediation-чат, повтор бесплатных gates и новое разрешение перед следующим платным run.

## Перед началом

Полностью прочитай:

- `AGENTS.md`;
- `plans/image-first-editable-slides-v1/00-product-contract.md`;
- все отчёты 01–05;
- текущий provider catalog, cost policy и ledger;
- текущие local runtime instructions;
- reference folder и сохранённые benchmark artifacts.

Проверь `git status`. Отдели изменения пакета от чужого dirty diff. Не исправляй unrelated failures.

## Предусловия

Нужны статусы:

- `FOUNDATION ACCEPTED`;
- `RECONSTRUCTION GO`;
- `TEXT MODEL GO`;
- `FULL NON-IMAGE ECONOMIC GO`;
- `IMAGE MODEL GO`;
- `PIPELINE ACCEPTED`;
- `PRODUCT FLOW ACCEPTED`.

Если статус отсутствует или доказательство устарело относительно текущего кода/provider catalog, не запускай платный deck. Сначала дай `LOCAL ACCEPTANCE BLOCKED` с точным несовпадением.

## Цель

Доказать на локальном runtime, что новая архитектура:

- всегда создаёт exact selected count;
- для 6 слайдов укладывается в 7 ₽ целиком;
- для 14 слайдов укладывается в 15 ₽ целиком;
- делает цельные image-first слайды с точным editable text;
- корректно использует native evidence;
- при единичном провале показывает хороший fallback без retry;
- сохраняет свободное редактирование и export parity;
- не маскирует слабое качество зелёными техническими тестами.

## Этап 1. Бесплатный audit и воспроизводимость

1. Проверь, что новый mode/flag всё ещё default off.
2. Сверь model IDs/modes и актуальную pre-call цену с отчётом 03.
3. Проверь fixture hashes и отсутствие секретов в artifacts.
4. Убедись, что текущий runtime действительно содержит проверяемый код, а не stale container/build.
5. Запусти targeted test matrix всех планов.
6. Проверь отсутствие реальной сети в unit/integration tests.
7. Получи baseline ledger timestamp/event IDs до любого paid action первоначального пользовательского flow, включая создание/repair речи и source/search.

Если Docker/runtime недоступен или новая версия не доказана локально, остановись до платного вызова.

## Этап 2. Бесплатная матрица пяти тарифов

На deterministic/mocked provider responses с входной речью 600–800 слов сгенерируй 6, 8, 10, 12 и 14 слайдов.

Для каждого N докажи:

- общее число ровно N, включая cover и closing;
- нет invented facts/padding/дублированного filler;
- conclusion только поддержанный;
- один art direction и разнообразные archetypes;
- image call count ≤ число image-eligible slides и никогда >N;
- один text call максимум;
- native evidence не считается fallback;
- failed/timeout/uncertain cases не retry;
- итог всё равно содержит N хороших native canvases;
- simulated reservations не превышают 7/9/11/13/15 ₽;
- manual regeneration не входит в initial envelope.

Добавь race/concurrency tests и failure injection для первого, среднего и последнего image slide.

## Этап 3. Бесплатная визуальная проверка

Собери contact sheets минимум для:

- all-image success fixture;
- mixed image-first/native-evidence deck;
- one image failure with fallback;
- all-image failure with all-native deck;
- long user edit with warning;
- manual regeneration pending/accept/reject на mocks;
- editor/PDF/PPTX renders.

Проверь side-by-side с одной выбранной family из `D:\presentation\референц слайдов`:

- цельная flat/editorial композиция;
- отсутствие UI-card/grid/pills эстетики;
- читаемая иерархия;
- разные композиции внутри одного языка;
- meaningful visual-to-text relation;
- отсутствие ghost text/patch artifacts;
- fallback визуально не выпадает из deck.

Если бесплатная визуальная проверка провалена, не запрашивай деньги «чтобы посмотреть реальный результат»: дай NO-GO и подготовь точный prompt для отдельного remediation-чата. В acceptance-чате код не исправляй.

## Paid Gate 1. Один реальный all-in deck на 6 слайдов

Перед запуском остановись и покажи пользователю preflight:

- точный новый project/input fixture до генерации речи и его hash;
- ровно 6 слайдов, включая cover и closing;
- все non-image models/modes, включая narration/search, если они вызываются;
- максимум один deck-wide slide-copy call и точное число других non-image вызовов;
- максимум шесть image calls, фактически меньше при native evidence;
- отсутствие paid retries/layout/vision/edit;
- reservation breakdown;
- hard total ceiling 7 ₽;
- artifact/report paths;
- baseline ledger IDs;
- как будет обработан timeout/uncertain cost.

Запускай только после отдельного сообщения пользователя, явно разрешающего один 6-slide run с ceiling 7 ₽. Старые разрешения из других чатов не действуют.

Runtime rules:

1. Атомарно зарезервируй ≤7 ₽ до первого billable call всего первоначального пользовательского flow.
2. Общий non-image bucket ≤1 ₽, включая narration/search/repair/deck-copy/art-direction calls.
3. Image bucket ≤6 ₽, каждый отдельный reserve ≤1 ₽.
4. Никаких автоматических повторов.
5. При failure конкретный слайд становится native fallback, остальные не пересоздаются.
6. При uncertain settlement `uncertainRub` равен полному unsettled reserve вызова, а все дальнейшие paid calls прекращаются до reconciliation; оставшиеся слайды строятся бесплатно.
7. Всегда сохраняй raw result, local diagnostics и ledger event.
8. Финальный документ обязан иметь ровно 6 слайдов, даже при provider failures.

## Этап 5. Cost reconciliation

После прогона сверь provider telemetry и локальный ledger по каждому событию:

| Stage/slide | Reserved ₽ | Actual ₽ | Uncertain ₽ | Status | Retry count |
|---|---:|---:|---:|---|---:|

Hard cost pass:

- `actualRub + uncertainRub ≤ 7`;
- `uncertainRub = 0` для окончательного GO;
- весь non-image total ≤1;
- image total ≤6;
- каждый image event ≤1;
- число paid retries = 0;
- нет untracked provider calls в выбранном окне.

Если ledger и provider расход расходятся, не округляй проблему и не выдавай GO до reconciliation.

## Этап 6. Качественная приёмка реального deck

Для каждого из шести слайдов сохрани:

```text
reference family | raw generated image | cleaned background | final editor | PDF | PPTX
```

Hard checks:

- exact text совпадает с content lock до пользовательских правок;
- каждая видимая semantic string имеет trace к matching section принятой речи; source refs только подтверждают точность и не добавляют source-only смысл;
- semantic text editable;
- page number locked;
- structured evidence exact/editable;
- нет unexpected/ghost raster text;
- нет сломанного crop, patch, overlap или unreadable text;
- композиция не является UI-card template;
- visual relation соответствует тезисам;
- fallback, если был, выглядит законченным и согласованным;
- speech review screen и accepted speech не потеряны.

Cost proof должен начинаться до создания речи и завершаться после ready deck в одном attempt-group и одном актуальном provider/price window. Для all-in verdict нельзя складывать историческую стоимость ранее принятой AI-речи с новым presentation run. Готовая речь допустима как нулевая стоимость только когда это прямой пользовательский input и с ней не связан ранее оплаченный model event продукта; тогда отчёт обязан прямо сказать, что model-based narration generation в этом сценарии не выполнялась.

Image-model success rate считается отдельно от safety fallback. Для `LOCAL 6-SLIDE GO` минимум 80% image-eligible слайдов должны успешно пройти image-first route. Нельзя засчитать fallback как успех модели.

Финальный visual verdict требует человеческого просмотра contact sheet. До ответа пользователя используй `LOCAL 6-SLIDE REVIEW REQUIRED`, а не самоназначенный GO.

Успешный Gate 1 даёт только `LOCAL 6-SLIDE GO`. Он не разрешает rollout тарифов 8–14 и не завершает пакет.

## Этап 7. Промежуточные тарифы и Paid Gate 2 на 14 слайдов

После `LOCAL 6-SLIDE GO`:

- 8/10/12 проверяются бесплатной матрицей и cost arithmetic; отдельный платный deck не нужен;
- 14-slide реальный all-in deck обязателен перед общим GO всех тарифов;
- Gate 2 требует отдельного нового разрешения пользователя с hard ceiling 15 ₽;
- разрешение 6-slide run не действует для Gate 2;
- до разрешения покажи новый project/input hash, актуальные prices, максимум всех non-image calls, максимум 14 image calls, reservation breakdown и baseline ledger;
- общий non-image bucket ≤1 ₽, image bucket ≤14 ₽, каждый image reserve ≤1 ₽;
- действуют те же one-candidate, no-retry, full-uncertain-reserve и global paid-halt правила;
- cost window начинается до narration/search и заканчивается после ready 14-slide deck;
- повторный trace audit подтверждает каждую видимую semantic string в matching accepted speech section; source-only content запрещён;
- сохрани отдельный 14-slide contact sheet и получи человеческий copy/visual verdict;
- минимум 80% image-eligible слайдов должны пройти image-first route; fallback не считается успехом модели;
- `actualRub + uncertainRub ≤15`, а для GO `uncertainRub=0`.

До отдельной authorization используй статус `LOCAL 6-SLIDE GO — AWAITING 15 RUB AUTHORIZATION`. После технического 14-slide pass, но до human review — `LOCAL 14-SLIDE REVIEW REQUIRED`.

Только сочетание успешных реальных endpoints 6 и 14, бесплатных 8/10/12, human review и export/editor proof даёт `LOCAL ALL-TIERS GO`.

## Итоговый verdict

Создай:

`D:\presentation\plans\image-first-editable-slides-v1\reports\06-local-acceptance-and-stop-go.md`

Допустимые статусы:

- `LOCAL ACCEPTANCE BLOCKED`;
- `FREE GATES PASSED — AWAITING 7 RUB AUTHORIZATION`;
- `PAID RUN FAILED — LOCAL NO-GO`;
- `COST PASSED — LOCAL 6-SLIDE REVIEW REQUIRED`;
- `LOCAL 6-SLIDE GO — AWAITING 15 RUB AUTHORIZATION`;
- `LOCAL 14-SLIDE REVIEW REQUIRED`;
- `LOCAL ALL-TIERS GO`;
- `LOCAL NO-GO`.

Отчёт содержит:

- git/runtime identity;
- все prerequisite statuses;
- five-tier free matrix;
- точное пользовательское paid authorization;
- provider + ledger cost table;
- call count/retry evidence;
- artifact/contact-sheet links;
- per-slide image/native/fallback result;
- human visual decision;
- editor/export proof;
- подтверждение, что implementation files не менялись; перечисли только report/runtime artifacts;
- что осталось до возможного staging/rollout;
- подтверждение `commit/push/deploy: нет`.

Не исправляй дефект любого размера внутри acceptance-чата и не повторяй платный прогон в том же envelope. При дефекте дай честный NO-GO и отдельный минимальный remediation prompt. После исправления все бесплатные gates повторяются, а новый paid run требует нового разрешения. Production default, staging и deploy остаются за пределами этого пакета до `LOCAL ALL-TIERS GO` и нового прямого решения пользователя.
