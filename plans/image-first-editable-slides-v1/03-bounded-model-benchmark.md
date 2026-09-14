# План-промт 03: bounded benchmark текстовой и image-модели

Ты работаешь в `D:\presentation`. Цель этого чата — выбрать модели и режимы по фактическому качеству и фактической цене, а не по названию модели или обещанию «от … ₽».

План состоит из бесплатной подготовки и двух независимых платных gates. Переход к каждому платному gate требует отдельного свежего сообщения пользователя с точным ceiling. Само сообщение «выполни этот план» не разрешает ни одного billable call.

## Обязательный контекст

Прочитай полностью:

- `D:\presentation\AGENTS.md`;
- `D:\presentation\plans\image-first-editable-slides-v1\00-product-contract.md`;
- отчёты 01 и 02 из `D:\presentation\plans\image-first-editable-slides-v1\reports\`;
- текущий provider catalog/routing, usage ledger и cost-envelope код;
- текущие AI Scene v3 manifests как отрицательную cost baseline;
- артефакты reference reconstruction из Плана 02.

Проверь `git status`. Не меняй/не удаляй чужие artifacts. Не коммить и не деплой.

## Предусловие

До любого платного вызова отчёт Плана 01 должен иметь `FOUNDATION ACCEPTED`, а отчёт Плана 02 — `RECONSTRUCTION GO`.

Если хотя бы одного статуса нет:

- разрешена бесплатная подготовка harness;
- все paid text/image benchmarks запрещены;
- итоговый status — `BENCHMARK PREPARED / PREREQUISITE BLOCKED`.

## Цель benchmark

Нужно ответить на два вопроса:

1. Может ли один дешёвый deck-wide вызов написать хороший, grounded и завершённый текст ровно для 14 слайдов в пределах text budget?
2. Может ли image-модель не дороже 1 ₽ за вызов создать один цельный 16:9 слайд с точными русскими строками так, чтобы локальный text lift дал визуально хороший редактируемый результат?

Не пытайся «доказать» заранее выбранную модель. Любая модель получает GO только по сохранённым артефактам и ledger.

## Этап 1. Бесплатная проверка каталога и цен

Без генерации:

1. Прочитай фактический runtime provider catalog и доступные model IDs/qualities/sizes/input-image capabilities.
2. Получи актуальные цены из первичного API/документации провайдера, если доступно.
3. Зафиксируй дату, currency, единицу тарификации, качество, размер/aspect ratio и условия, влияющие на цену.
4. Отдели:
   - гарантированную максимальную стоимость вызова;
   - оценку;
   - маркетинговое «от»;
   - фактический billed cost прошлых вызовов.
5. Исключи режим, если до вызова нельзя доказать ceiling не выше разрешённого hard cap.
6. Не считай старую локальную pricing formula источником истины при расхождении с provider telemetry.

Для image standard-route допустим только режим с гарантированным pre-call reserve не выше 1 ₽. Модель за 1,70 ₽ и дороже не подходит как default для всех тарифов, даже если качество хорошее.

## Этап 2. Бесплатный воспроизводимый harness

Подготовь набор immutable fixture inputs и сохрани их hashes.

### Text fixtures

- минимум три разных реальных принятых текста выступления по 600–800 слов: разные темы/структуры, один на 6, один на 10 и один на 14 слайдов;
- для первой самой строгой проверки используй fixture на 14 слайдов, включая cover и closing;
- matching speech traces и отдельные source refs для проверки фактов;
- тот же structured contract, что в Плане 01;
- строгий prompt без механического обрезания;
- response capture до любой нормализации.

### Image fixture

- один содержательный слайд из утверждённого content lock;
- русскоязычный title;
- 2–4 тезиса;
- хотя бы один смысловой label/date/term;
- conclusion только если он реально следует из текста;
- одна выбранная reference visual family;
- точные planned semantic zones;
- 16:9;
- запрет постороннего текста, логотипов и watermarks.

Image prompt должен просить готовую цельную композицию с точными строками, а не пустой фон. Он должен одновременно сообщать semantic zones, которые затем использует локальный text lift.

Подготовь:

- dry-run request manifests без секретов;
- точный максимум числа вызовов;
- reservation proof;
- provider response capture;
- локальный OCR/cleanup/native-overlay pipeline;
- contact sheet и human-review form;
- ledger reconciliation script/query;
- abort handling для timeout/unknown cost.

Все harness tests должны работать на mocks и локальных fixtures.

## Gate A. Последовательный платный benchmark текста

Перед Gate A остановись и покажи пользователю:

- модель и точный model ID;
- почему она выбрана первой;
- актуальный прогноз стоимости;
- hard ceiling, который будет зарезервирован;
- точное число вызовов текущего шага: 1;
- какие артефакты будут сохранены.

Начинай каждый fixture только после нового прямого разрешения вида «разрешаю один text call для fixture `<hash>`, ceiling X ₽». Разрешение одного fixture не распространяется на следующий.

Рекомендованный первый кандидат — `gpt-5.6-luna`, потому что текущий плохой v3-текст был создан механическим clipping, а Luna лишь размещала строки. Но перед запуском проверь актуальное имя, цену и доступность. Это рекомендация, не автоматический GO.

Экономика:

- target ≤ 0,60 ₽;
- абсолютный hard cap ≤ 1,00 ₽;
- один deck-wide call на текущий явно разрешённый fixture;
- ни одного automatic retry/repair call;
- timeout, malformed JSON или quality failure завершают текущий fixture без retry.

Этот вызов делит общий non-image bucket 1 ₽ с narration/search/repair, если они входят в первоначальный пользовательский flow. Поэтому стоимость между 0,60 и 1,00 ₽ может доказать качество модели, но даёт только условный economic GO до тех пор, пока измеренная сумма всех остальных non-image stages не помещается в остаток.

`TEXT FIXTURE GO` требует одновременно:

- ровно requested 6/10/14 слайдов, включая cover и closing;
- все смысловые строки grounded;
- нет invented facts, декоративных лозунгов и prompt echo;
- нет оборванных/механически обрезанных фраз;
- тезисы действительно сокращают речь и пригодны для слайда;
- conclusion только там, где есть реальный итог;
- visual family едина, композиционные функции различаются;
- exact strings проходят локальный density/fit preflight;
- actual + uncertain cost ≤ авторизованного ceiling;
- `uncertainRub = 0` после reconciliation;
- человек принимает slide copy по рубрике: естественность русского языка, завершённость, отсутствие повторов, ясная иерархия и соответствие текста роли/визуальному замыслу каждого слайда.

Один успешный fixture даёт только `TEXT MODEL PROVISIONAL GO`. `TEXT MODEL GO` требует три разных успешных fixtures (6/10/14), каждый с отдельной authorization, raw output и human copy verdict. Это benchmark модели/prompt version, а не обязательное пользовательское согласование текста при каждой обычной генерации.

Для допуска в standard route дополнительно выдай отдельный статус `FULL NON-IMAGE ECONOMIC GO`: measured/provable полный non-image budget для одного initial flow — narration + search + repair + deck copy + art direction/checks — не превышает 1 ₽, а `nonImageUncertainRub = 0`. Нельзя вынести уже оплаченные этапы за окно подсчёта.

Если Luna не проходит любой fixture, сохрани ответ и diagnostics и остановись. Другую text-модель можно проверить только новой серией отдельно разрешённых вызовов. Нельзя бесплатно объявить Terra или любую другую модель победителем без benchmark evidence.

## Gate B. Один платный image-first слайд

Gate B не наследует разрешение Gate A и доступен только после `TEXT MODEL GO` и `FULL NON-IMAGE ECONOMIC GO`. Перед ним снова остановись и покажи:

- model ID, quality, resolution/aspect ratio;
- гарантированный maximum price;
- exact image prompt manifest hash;
- точное число вызовов: 1;
- отсутствие платного vision/layout/image-edit;
- критерии visual review.

Запускай только после прямого разрешения вида «разрешаю один image call, ceiling не более 1 ₽».

Hard rules:

- один image generation call;
- reserve ≤ 1,00 ₽ до вызова;
- один candidate, без A/B/C;
- no retry при timeout, provider error, плохом тексте или слабом дизайне;
- OCR, cleanup, native overlay, render и проверки только локально;
- actual и uncertain cost сохраняются даже при provider failure;
- при unknown settlement `uncertainRub` становится равным полному unsettled reserve, а все дальнейшие paid stages глобально останавливаются до reconciliation.

Image GO требует одновременно:

- реальный 16:9;
- цельная композиция, сопоставимая по принципам с выбранной reference family;
- все заданные semantic blocks участвуют в композиции;
- нет постороннего текста, логотипа, watermark или конфликтующих чисел;
- локальный text lift восстанавливает 100% exact strings как native editable;
- очищенные зоны не выглядят заплатками и не содержат ghost glyphs;
- нет UI-card/grid эстетики;
- web/editor/PDF/PPTX сохраняют композицию;
- actual cost ≤ 1,00 ₽, `uncertainRub = 0`;
- человек явно принимает side-by-side результат.

Провал любого пункта означает `IMAGE MODEL NO-GO`. Fallback может доказать безопасность продукта, но не превращает плохой image-кандидат в успешный benchmark.

Другую image-модель/quality можно тестировать только отдельным новым разрешением, одним вызовом и тем же ceiling. Сохраняй неудачные результаты: не перезаписывай их более удачным кандидатом.

## Этап 5. Решение по моделям

Сформируй decision table:

| Роль | Model ID / mode | Actual cost | Quality verdict | Допущен в standard route |
|---|---|---:|---|---|
| deck text | ... | ... | ... | да/нет |
| image-first | ... | ... | ... | да/нет |

Никаких средних оценок без первичных provider events. Если модель хороша, но дороже cap, она может быть отмечена только как возможная future premium option; standard-route GO ей не выдаётся.

## Бесплатные проверки

До paid gate и после него запусти:

- schema/parser tests;
- exact-call-count tests;
- atomic reservation tests;
- timeout/uncertain-cost tests;
- fixture hash check;
- local reconstruction checks;
- `git diff --check`.

Не запускай полный deck и не меняй production routing.

## Отчёт и статусы

Создай:

`D:\presentation\plans\image-first-editable-slides-v1\reports\03-bounded-model-benchmark.md`

Допустимые verdicts:

- `BENCHMARK PREPARED — AWAITING TEXT AUTHORIZATION`;
- `TEXT FIXTURE GO — AWAITING NEXT TEXT AUTHORIZATION`;
- `TEXT MODEL PROVISIONAL GO`;
- `TEXT MODEL GO — NON-IMAGE ECONOMICS PENDING`;
- `FULL NON-IMAGE ECONOMIC GO — AWAITING IMAGE AUTHORIZATION`;
- `TEXT MODEL NO-GO`;
- `IMAGE MODEL GO`;
- `IMAGE MODEL NO-GO`;
- `BENCHMARK BLOCKED`.

Отчёт включает:

- проверенные актуальные цены и источники;
- все authorizations с ceiling;
- request/response hashes и artifact paths;
- exact call count;
- actual/reserved/uncertain cost по event;
- сырой model output и результат deterministic validation;
- human copy rubric/verdict по каждому text fixture;
- доказательство полного non-image budget и отдельный economic status;
- side-by-side image evidence;
- human visual verdict;
- что можно и нельзя делать в Плане 04;
- подтверждение отсутствия commit/deploy.

Если нет одновременно `FOUNDATION ACCEPTED`, `RECONSTRUCTION GO`, `TEXT MODEL GO`, `FULL NON-IMAGE ECONOMIC GO` и `IMAGE MODEL GO`, План 04 не должен подключать новый production-capable pipeline. Сначала обсуди с пользователем NO-GO и следующий минимальный эксперимент.
