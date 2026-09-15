# План-промт 02b: native-first proof редактируемых слайдов

## Статус и решение

Этот план заменяет **только закрытый технический маршрут** text-lift из
Плана 02. Он не является повтором Плана 02 и не пытается улучшить маски,
OCR, OpenCV Telea или иной способ удаления текста из raster-референса.

Контролирующее доказательство —
`plans/image-first-editable-slides-v1/reports/02-local-reference-reconstruction.md`:
в изолированном Telea proof `solar-01`, `porsche-01` и `nature-01` получили
`0/3`: старый текст остался читаемым, а композиция во всех трёх случаях была
повреждена. Путь «очистить готовую референсную картинку и вернуть текст
поверх неё» закрыт.

Новая гипотеза уже другая:

> Референс задаёт visual family и композиционные принципы, но не является
> слоем нового слайда. Каждый новый слайд авторится с нуля из нативных
> элементов; все смысловые строки существуют только как editable native text.

Не требуется пиксельная, побайтная или объектная копия референса. Нельзя
использовать этот план как разрешение начать старый План 03,
`03-bounded-model-benchmark.md`, или любой paid image benchmark.

## Обязательное чтение и preflight

До любого изменения исполнитель обязан полностью прочитать:

1. `D:\presentation\AGENTS.md`;
2. `D:\presentation\plans\image-first-editable-slides-v1\README.md`;
3. `D:\presentation\plans\image-first-editable-slides-v1\00-product-contract.md`;
4. `D:\presentation\plans\image-first-editable-slides-v1\07-read-only-coordinator.md`;
5. `D:\presentation\plans\image-first-editable-slides-v1\02-local-reference-reconstruction.md`;
6. `D:\presentation\plans\image-first-editable-slides-v1\reports\02-local-reference-reconstruction.md`;
7. `plans/image-first-editable-slides-v1/01-content-lock-and-economics.md` и
   его отчёт, чтобы подтвердить `FOUNDATION ACCEPTED`;
8. живые native canvas/editor/PDF/PPTX renderer и `git status`.

Сохрани чужой dirty diff. Перед работой зафиксируй hashes трёх reference
fixtures и существующих exact gold strings, но не изменяй файлы в
`D:\presentation\референц слайдов`.

## Жёсткие границы

- Только локальный, бесплатный proof. **Paid API, paid search, paid image,
  OCR/vision API и любые provider calls запрещены.** `paid calls: 0`.
- Не меняй production routing, default feature flags, billing, provider
  selection, job queues или public generation path. Результат остаётся
  изолированным lab/fixture renderer.
- Не делай commit, push, merge, staging, production deploy или Docker release
  build.
- Не начинай старый План 03 и не создавай paid benchmark, даже если proof
  прошёл.
- Не очищай, не маскируй, не блюрь, не inpaint-ь и не crop-ь старый raster
  текст. Не используй Telea, другую inpainting-реализацию или OCR geometry
  для восстановления референса.
- Не помещай reference PNG/JPEG целиком, его очищенную копию или crop с
  читаемым текстом в новый слайд как background, overlay или export asset.
- Не rasterize смысловой текст на canonical canvas, в PDF или в PPTX. Рендер
  PNG допустим только как проверочный артефакт, а не как представление слайда.
- Не подменяй провал универсальным bullet-template, dashboard, card grid,
  pills или стеклянными панелями.

## Минимальный proof: ровно три слайда

Построй с нуля по одному новому слайду для трёх независимых visual families:

| Fixture / visual family | Что доказать |
|---|---|
| `solar-01` — dark cosmic / technical editorial | Тёмное пространство, световой акцент, иерархическая композиция и смысловая timeline/relationship structure без raster-текста. |
| `porsche-01` — red/black motorsport editorial | Крупный hero-object, асимметрия, контраст и динамика без размытой копии автомобиля или готового слайда. |
| `nature-01` — light editorial nature | Светлая воздушная палитра, картографическая/ландшафтная связь и спокойная плотность без копирования карточек, карты или подписей из референса. |

Используй существующие pinned gold semantic strings и IDs каждого fixture как
контракт содержания: все смысловые строки должны быть представлены в новом
слайде точно, NFC-normalized. Они не переписываются, не сокращаются и не
дополняются новыми фактами. Если для proof нужны только нейтральные
decorative labels, они обязаны быть явно помечены как decorative и не могут
маскировать потерю gold semantic string.

Это не задача сделать три одинаковых шаблона. У каждого слайда должен быть
свой подходящий композиционный архетип, но внутри своей family. Страница
имеет нативный locked page number; смысловые элементы остаются editable.

## Что авторится нативно, а что допустимо как raster asset

| Категория | Правило |
|---|---|
| Фон | Нативно: color field, градиент, формы, линии, маски, halo, шум/фактура, если стек проекта умеет воспроизвести их без text raster. |
| Смысловой текст | Только отдельные native editable text elements: заголовок, тезисы, conclusion, labels, имена, даты, числа, проценты и подписи. |
| Структурная информация | Только нативно: таблицы, оси, легенды, значения графиков, формулы, связи и подписи диаграмм. |
| Фигуры и диаграммы | Нативные shapes/connectors/paths, чтобы их геометрия и labels не зависели от одного raster-слоя. |
| Изображения | Разрешён отдельный локальный text-free raster asset (фото, текстура, иллюстрация), если он не является reference slide или его text-containing crop, не содержит читаемых слов/чисел/формул и имеет manifest с source/hash/license-or-origin. Он может быть locked декоративным слоем или hero image. |
| Не допускается как raster | Любой смысловой текст, таблица, график, формула, карта с подписью, логотип с читаемым слоганом, снимок целого reference slide, его text-cleaned вариант или raster «запасной» текст. |

Если для конкретного proof нет приемлемого локального text-free изображения,
строится законченная композиция из нативного фона, shapes и diagram
primitives. Отсутствие фотографии не даёт права использовать старый референс
как фон.

## Правила visual similarity

Оценка сравнивает не пиксели, а пять наблюдаемых свойств. Для каждого из трёх
слайдов reviewer обязан вынести отдельный PASS/FAIL по каждому свойству и
коротко объяснить решение:

1. **Композиция:** сопоставимый баланс пустоты и главного объекта, направление
   взгляда, scale и placement text zones; не копирование координат или слоёв.
2. **Палитра:** та же family контраста, температуры и ведущих цветов, без
   требования совпасть с каждым пикселем.
3. **Иерархия:** title, главная мысль, supporting text и structured evidence
   читаются в верном порядке и не выглядят поздним UI-overlay.
4. **Плотность:** сопоставимый объём визуальной и текстовой информации,
   ритм и whitespace; не уменьшение шрифта ради вмещения всего в карточки.
5. **Настроение:** узнаваемый dark-cosmic, motorsport или light-nature
   editorial character при самостоятельной композиции.

Visual PASS требует `5/5` свойств для данного fixture и отсутствие заметного
заимствования raster-композиции. Pixel diff, SSIM, OCR score, hash similarity
и «похоже на 1:1» не являются ни целью, ни критерием этого плана.

## Исполнение

1. Создай изолированный native-first lab рядом с существующим
   `image-first-editable-v1` proof. Его вход: `fixture ID + exact strings +
   semantic IDs + visual-family tokens + optional approved local text-free
   assets`. Его выход: один canonical native canvas на fixture.
2. Сначала построй модель слайда без reference bitmap: native background,
   native visual structure, text zones, page number и required structured
   evidence. Reference можно открыть только как визуальный ориентир во время
   human review; он не передаётся в renderer.
3. Заведи per-element manifest: semantic ID/kind, text hash, element type,
   editability, locked state, bounds, z-order, font tokens и asset hash для
   допустимого raster asset. Это доказательство отсутствия rasterized text.
4. В editor проверь все semantic strings, editing/save и две правки: короткую
   замену и намеренно длинную замену. Reflow/auto-fit не вызывает модель;
   если длинный текст не входит, виден warning, текст сохраняется целиком, а
   save не блокируется.
5. Экспортируй из того же canonical canvas PDF и PPTX. В PDF semantic strings
   должны находиться в text layer. В PPTX распакуй и проверь native text runs
   (`a:t`) и отсутствие raster image, заменяющего semantic element. Сравни
   рендеры editor/PDF/PPTX side-by-side с canonical canvas.
6. Добавь только релевантные deterministic tests для native element manifest,
   exact Unicode strings, locks/editability, long-text warning/save, PDF text
   layer, PPTX text runs, export parity и запрещённого raster text asset.
   Запусти scoped typecheck/tests и `git diff --check`; сеть запрещена.

## Gate: 3/3 editor, PDF и PPTX

Один fixture считается passed только при одновременном выполнении всех
условий ниже. Нельзя засчитать fallback, PNG screenshot или schema-valid
canvas вместо surface proof.

| Surface | Обязательное доказательство для каждого из `solar-01`, `porsche-01`, `nature-01` |
|---|---|
| Editor | 100% gold semantic strings видимы и NFC-exact в отдельных editable native elements; фон/декор locked; page number native+locked; короткая и длинная правка сохраняются без обрезания и без provider call. |
| PDF | Рендер визуально сохраняет native композицию без overflow/overlap/crop; все semantic strings извлекаются из PDF text layer в exact normalized виде, а не только видны на raster preview. |
| PPTX | Рендер сохраняет композицию без overflow/overlap/crop; все semantic strings существуют как native editable PPTX text runs в `ppt/slides/*.xml`, а не как текст внутри media image. |

Общий GO требует **3/3 fixtures × 3/3 surfaces** плюс `5/5` visual-similarity
review на каждом fixture. Любая одна потерянная строка, rasterized semantic
text, residual reference text, export divergence или visual FAIL делает весь
proof NO-GO.

## Артефакты

Все генерируемые доказательства держи вне product output в:

```text
D:\presentation\.codex-artifacts\image-first-editable-slides-v1\native-first-proof\
  summary.json
  solar-01\
  porsche-01\
  nature-01\
```

Каждая fixture directory обязана содержать:

```text
input.json                         # fixture, source/reference hashes, exact-string hashes
native-canvas.json                 # canonical editable canvas
native-element-manifest.json       # type, ID, locks, text/asset hashes, bounds, z-order
editor.png                         # evidence preview only
editor-edit-short.json
editor-edit-long.json
editor-long-text-warning.json
slide.pdf
pdf-text-extraction.txt
pdf-render.png
slide.pptx
pptx-text-runs.json
pptx-render.png
visual-review.md                   # five named PASS/FAIL checks and rationale
side-by-side.png                   # reference | native editor | PDF render | PPTX render
asset-inventory.json               # every raster asset; text-free verification and hash
```

`summary.json` обязан содержать per-fixture/per-surface verdict, exact-string
counts, raster-text violations, provider-call count, test command outcomes,
visual-review matrix и final aggregate. Не записывай туда secrets или ключи.

## Отчёт

Создай только после получения всех артефактов:

`D:\presentation\plans\image-first-editable-slides-v1\reports\02b-native-first-editable-slides.md`

Формат отчёта обязателен:

```text
# Plan 02b — native-first editable slides

## Verdict
NATIVE-FIRST GO | NATIVE-FIRST NO-GO | NATIVE-FIRST BLOCKED

## Scope and cost
- production routing changed: no
- paid calls: 0
- commit/deploy: no
- dirty-tree boundary: ...

## 3-fixture acceptance
| fixture | visual 5/5 | editor | PDF | PPTX | exact strings | raster-text violations | result | artifacts |

## Native/raster inventory
| fixture | native background/shapes/diagrams | allowed raster assets and hashes | forbidden-raster check |

## Editor, PDF and PPTX evidence
- exact paths to the three surface artifacts and machine-readable checks

## Tests and commands
| command | result |

## GO/NO-GO rationale
- fact-based explanation with exact artifact paths

## Only next step
- exactly one action under the rule below
```

В отчёте нельзя выдавать красивые PNG за editor/PDF/PPTX proof, называть
reference bitmap фоном нового слайда или объявлять native text-lift успехом.

## Решение и STOP

### NATIVE-FIRST GO

Выдаётся только при полном `3/3 × 3/3` gate, `5/5` visual review на всех
трёх слайдах, `paid calls: 0`, отсутствии production changes и наличии всех
перечисленных артефактов. GO доказывает лишь feasibility локального
native-first маршрута. Он **не** запускает старый План 03, paid benchmark,
production routing, commit или deploy. Следующее действие после GO выбирает
read-only coordinator по фактическому diff и report.

### NATIVE-FIRST NO-GO

Выдаётся при любом провале exact native text, одной из трёх export surfaces,
visual 5/5, запрете raster text/reference reuse или scope/cost boundary.
Остановись и сохрани полный evidence; не пытайся компенсировать результат
очисткой референса или платной генерацией.

**Единственный следующий шаг при NO-GO:** один бесплатный, изолированный
native-only remediation proof на тех же трёх fixtures, направленный ровно на
первый зафиксированный failed criterion (один renderer, один native primitive
или один export-parity defect). Он обязан сохранить те же запреты и не может
расширять набор, менять routing, использовать reference bitmap/text cleanup
или запускать Plan 03. Сначала сформулируй этот один remediation prompt в
отчёте; никакие другие планы или эксперименты не начинай.

### NATIVE-FIRST BLOCKED

Выдаётся только если отсутствует `FOUNDATION ACCEPTED`, требуемый локальный
renderer или необходимые source/gold fixtures. Зафиксируй точный blocker и
не подменяй его mock-успехом.
