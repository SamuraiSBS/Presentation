# План-промт 01: deck-wide content lock, точное число слайдов и hard cost envelope

Ты работаешь в монорепозитории StudyDeck AI по адресу `D:\presentation`.

Реализуй этот план полностью. Это разрешение на узкие локальные изменения кода и тестов в scope плана, но не на платные AI-вызовы, commit, push, merge, deploy или включение нового режима по умолчанию.

## Обязательный контекст

Полностью прочитай:

- `D:\presentation\AGENTS.md`;
- `D:\presentation\plans\image-first-editable-slides-v1\00-product-contract.md`;
- этот файл;
- актуальные shared contracts, worker generation pipeline и cost-envelope код;
- текущий `apps/worker/src/tasks/presentation/ai-scene-v3/**` только как исторический прототип и источник уже проверенных renderer/ledger primitives.

Сначала выполни:

```powershell
git -c safe.directory=D:/presentation status --short
git -c safe.directory=D:/presentation diff -- packages/shared apps/worker
```

Рабочее дерево уже может быть dirty. Не откатывай, не форматируй массово и не присваивай себе чужие изменения. Если нужный файл уже изменён, сначала отдели существующий diff от своего.

## Цель

Создать выключенный по умолчанию фундамент нового `image_first_editable_v1` пути:

1. Один deck-wide model result определяет точные строки всей презентации.
2. Результат всегда содержит ровно 6, 8, 10, 12 или 14 слайдов, включая обложку и финал.
3. Каждая строка grounded в соответствующем разделе принятой речи и имеет стабильный semantic ID; source refs только подтверждают её точность.
4. Все billable non-image stages вместе имеют hard cap 1 ₽ на первоначальную презентацию, включая narration/search, если они входят в тот же пользовательский flow.
5. Общий первоначальный cap равен `N + 1 ₽`.
6. Ни один invalid/timeout/uncertain result не запускает автоматический платный retry.

На этом этапе не генерируй изображения и не подключай новый путь к обычной production generation.

## Не переносить ошибочные правила v3

Не копируй в новый контракт:

- обязательные 4–7 anchors на каждом content slide;
- первые четыре предложения как тезисы;
- обрезание по 64 символам;
- два image-кандидата A/B;
- отдельный платный Luna layout;
- отдельный платный high-detail vision;
- `xhigh` как обязательное качество;
- фон без текста как конечную архитектуру.

Переиспользовать можно только нейтральные части: schema validation, hashes, native canvas/export primitives, ledger reservation/settlement и fail-closed diagnostics.

## Этап 1. Characterization и архитектурная граница

1. Построй карту текущего пути от accepted narration до presentation document.
2. Найди фактические seams для:
   - accepted speech и section mapping;
   - model routing;
   - shared presentation/generation artifacts;
   - cost reservation и settlement;
   - exact slide-count policy;
   - native canvas/export.
3. Добавь characterization tests на существующее поведение, которое нельзя сломать:
   - экран и состояние принятой речи остаются источником истины;
   - старые presentation documents продолжают парситься;
   - существующие OpenAI/Yandex/demo пути не меняются;
   - пользовательский custom canvas не перезаписывается;
   - feature flag нового режима по умолчанию выключен.
4. Выбери отдельное имя контракта/feature flag. Не переопределяй смысл `ai_scene_v3` и не включай его автоматически.

Сохрани краткую карту в итоговом отчёте. Не останавливайся на аудите, если нет подтверждённого блокера.

## Этап 2. Shared `DeckContentLock`

Добавь минимальный backward-compatible Zod/TypeScript contract. Имена адаптируй к кодовой базе, но смысл должен быть таким:

```text
DeckContentLock
  version
  requestedSlideCount: 6 | 8 | 10 | 12 | 14
  acceptedSpeechHash
  sourceSnapshotHash / provenance context
  visualFamilyIntent
  slides[] exactly requestedSlideCount
    slideId, order, role
    title
    theses[]
    optional conclusion
    optional semantic labels[]
    visualIntent
    compositionArchetype
    renderMode: image_text_lift | native_evidence
    matching speech trace for every semantic string
    optional source refs that verify the speech claim
    provenance: speech_grounded | repeated_accepted_speech | fallback_added
    contentHash
```

Инварианты:

- `order` непрерывен и начинается с 1;
- первая роль — cover, последняя — closing, общее число строго равно requested;
- cover не обязан иметь theses/conclusion;
- content slide имеет 1–4 тезиса по реальной плотности, а не для заполнения схемы;
- conclusion отсутствует, если в соответствующем материале нет настоящего итога;
- даты, числа, имена, термины и смысловые подписи получают отдельные semantic IDs;
- номер страницы не является model text: он создаётся нативно и locked;
- каждая смысловая строка имеет обязательный trace к своему matching accepted speech section;
- source excerpt может подтвердить факт, но не может добавить на слайд новый смысл, отсутствующий в matching speech section;
- при дефиците уникальных grounded statements exact count имеет приоритет: повторённая строка получает `repeated_accepted_speech` и `repeatedFromSemanticId`; нейтральная навигационная fallback-строка получает `fallback_added`. Эти строки и lock-level `fallbackDiagnostics` обязательны, хэшируются и не должны показываться как новые speech-grounded claims;
- hash вычисляется по точным строкам и меняется при их изменении;
- старые документы без нового artifact остаются валидными.

Не смешивай editable text state после пользовательской правки с исходным immutable generation lock. Нужна явная lineage: `generated content lock -> current editable values`.

## Этап 3. Один deck-wide text planner

Создай отдельный prompt builder, parser и validator для одного запроса на весь deck.

Prompt обязан:

- получать всю принятую речь 600–800 слов, requested count и доступные source refs;
- сразу вернуть все слайды в строгом structured object;
- писать короткий слайдовый текст, а не копировать речь;
- сохранять смысл и завершённость фраз;
- не брать механически первые предложения;
- не обрезать строки по символам;
- не добавлять на слайд смысл/факт, которого нет в соответствующем разделе принятой речи; sources использовать только для проверки;
- не создавать декоративные лозунги/microtext;
- ставить conclusion только при реальном результате;
- при нехватке материала использовать честные паузы, определения и примеры из материала;
- выбрать одну visual family intent и разные composition archetypes;
- классифицировать таблицы, графики, формулы и точные схемы как `native_evidence`.

Model adapter должен быть инъецируемым. В production route пока не закрепляй Luna или другую модель: окончательный выбор делает План 03 по фактической цене и качеству.

Во всех тестах используй fixtures/mocks. Ни одного реального provider call.

## Этап 4. Локальная проверка и безопасная нормализация

После model result выполняй deterministic validation:

- exact count и role sequence;
- semantic ID uniqueness;
- matching speech trace каждой строки;
- отсутствие фактов/чисел вне matching speech section; source refs проверяют точность, но не расширяют видимый смысл;
- отсутствие оборванных фраз, prompt echo и generic filler;
- отсутствие дублированных тезисов между слайдами;
- conclusion support;
- разумная длина текста для native minimum sizes;
- visual family consistency и composition diversity;
- `native_evidence` для точных объектов.

Не пытайся локально «угадывать» новый факт. Допустима только безопасная нормализация структуры и пунктуации без изменения смысла.

Если model output invalid:

1. Не выполнять второй платный text call.
2. Построить deterministic best-effort lock только из matching sections принятой речи; известные source refs использовать для проверки.
3. Сохранить diagnostics о fallback.
4. Всё равно выдать точное N: при дефиците unique claims повторить grounded строку с явной provenance или добавить нейтральный fallback-слайд с явной provenance; exact-count conflict не является blocker.
5. Остановить генерацию до любых image-вызовов можно только при отсутствующей или malformed accepted speech; дефицит unique claims не даёт `PreImageContentBlockerError`.

## Этап 5. Экономический контракт

Расширь существующий cost-envelope путь без переписывания исторических policy snapshots.

Для первоначальной презентации:

| N | total hard cap | все billable non-image | все image calls |
|---:|---:|---:|---:|
| 6 | 7 ₽ | ≤ 1 ₽ | ≤ 6 ₽ |
| 8 | 9 ₽ | ≤ 1 ₽ | ≤ 8 ₽ |
| 10 | 11 ₽ | ≤ 1 ₽ | ≤ 10 ₽ |
| 12 | 13 ₽ | ≤ 1 ₽ | ≤ 12 ₽ |
| 14 | 15 ₽ | ≤ 1 ₽ | ≤ 14 ₽ |

Реализуй/проверь следующие свойства:

- envelope резервируется атомарно до первого billable call;
- каждый stage также резервируется отдельно;
- failed и uncertain billable events входят в cap;
- `uncertainRub` равен полному unsettled reserve вызова и вычитается из остатка;
- timeout/unknown settlement глобально блокирует все следующие paid stages до reconciliation;
- один deck-wide text call максимум;
- один image call на слайд максимум;
- никакого автоматического платного retry;
- manual regeneration использует другой envelope и не списывается из initial generation;
- provider telemetry/ledger является источником фактической стоимости;
- cap policy хранится версионированно и не меняет старые проекты задним числом.

На этом этапе image budget только моделируется тестами; реальные вызовы запрещены.

## Этап 6. Тесты

Добавь минимум такие тестовые группы:

### Shared

- разрешены только 6/8/10/12/14;
- exact slide count включает cover и closing;
- optional conclusion;
- 1–4 theses без искусственного padding;
- уникальные semantic IDs и стабильные hashes;
- lineage исходного lock и текущих editable values;
- backward compatibility старого document.

### Worker

- один model call формирует весь deck;
- 600–800 слов корректно распределяются на 6 и 14 слайдов;
- тонкий материал, включая два unique claims для requested 10, всё равно даёт exact N через provenance-маркированные повторы или added fallback; exact-count conflict не блокирует flow;
- избыток материала не меняет N и не уменьшает шрифт;
- механическое обрезание, незавершённая фраза, invented fact и unsupported conclusion отклоняются;
- точная таблица/график/формула классифицируется как native evidence;
- invalid model output не вызывает retry и использует deterministic lock;
- отсутствующая accepted speech останавливает pipeline до image stage.

### Economics

- все пять cap mapping;
- reserve-before-call;
- failed events и uncertain event на полный reserve;
- global paid halt до reconciliation;
- no retry;
- весь non-image budget, включая narration/search внутри initial flow, не может превысить 1 ₽;
- image budget не может превысить N ₽;
- manual envelope изолирован от initial envelope.

Выполни самые узкие актуальные команды, как минимум:

```powershell
npm run build -w @studydeck/shared
npm run test -w @studydeck/shared
npm run typecheck -w @studydeck/worker
npm run test -w @studydeck/worker -- <новые-и-затронутые-тесты>
git -c safe.directory=D:/presentation diff --check
```

Не запускай Docker build, если изменения не требуют production-container proof.

## Отчёт и stop/go

Создай файл:

`D:\presentation\plans\image-first-editable-slides-v1\reports\01-content-lock-and-economics.md`

Отчёт должен содержать:

- verdict `FOUNDATION ACCEPTED` или `FOUNDATION NOT ACCEPTED`;
- точный список изменённых файлов;
- фактическую схему content lock;
- доказательство одного deck-wide call contract;
- таблицу всех пяти cap и точную границу измерения от user start до ready deck;
- тесты и их результаты;
- существующие чужие dirty changes, которых ты не касался;
- что осталось для следующего плана;
- подтверждение `paid calls: 0`, `commit/deploy: нет`.

`FOUNDATION ACCEPTED` допустим только если exact counts, grounding, no-retry и cost tests проходят. Иначе честно зафиксируй blocker и не предлагай План 02 как уже разрешённый результат.
