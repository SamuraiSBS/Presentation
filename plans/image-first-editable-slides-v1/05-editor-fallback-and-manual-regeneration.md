# План-промт 05: редактор, fallback UX и ручная регенерация с отдельной ценой

Ты работаешь в `D:\presentation`. Реализуй пользовательский flow для нового opt-in режима. Все AI/provider вызовы в этом плане запрещены: тестируй на mocks и сохранённых fixtures.

## Перед началом

Прочитай полностью:

- `AGENTS.md`;
- `plans/image-first-editable-slides-v1/00-product-contract.md`;
- отчёты 01–04;
- актуальные shared document contracts;
- API project/generation routes;
- web editor и экран просмотра/редактирования речи;
- PDF/PPTX export code;
- существующий generation retry/cost quote UI.

Проверь `git status` и diff затрагиваемых surfaces. Сохрани все чужие изменения.

## Предусловие

План 04 должен иметь `PIPELINE ACCEPTED`. Если нет, не строй UI поверх недоказанного contract. Зафиксируй `PRODUCT FLOW BLOCKED BY PIPELINE` и остановись без изменений за пределами безопасных characterization tests.

## Цель

Пользователь должен:

- получить ровно выбранное число законченных слайдов;
- не различать по «сломано/не сломано» AI-result и native fallback: оба должны быть визуально готовыми;
- свободно менять любой смысловой текст;
- сохранять даже длинный текст без скрытого обрезания;
- видеть предупреждение, если текст переполняет композицию;
- никогда не запускать модель простой правкой;
- при желании вручную перегенерировать один слайд после показа гарантированной цены;
- сохранить старую рабочую версию до принятия новой.

Существующий экран просмотра и редактирования полного текста выступления обязателен и не должен исчезнуть или превратиться в скрытый автоматический шаг.

## Этап 1. Версии и состояние слайда

Добавь/уточни backward-compatible состояние:

```text
generatedContentLock       immutable origin
currentEditableValues      current user text
selectedVisualVersion      current accepted image/native version
pendingVisualVersion       optional unaccepted regeneration
renderOrigin               image_text_lift | native_evidence | native_fallback
visualStaleness            current | maybe_mismatched_after_edit
layoutState                fits | overflow_warning
generationDiagnostics      internal only
manualRegenerationQuote    separate envelope/expiry/status
```

Правила:

- пользовательская правка обновляет только current editable values/revision;
- исходный content lock и provenance сохраняются для истории;
- visual version не меняется автоматически;
- pending candidate не заменяет selected до успешного gate и явного принятия;
- optimistic revision предотвращает потерю параллельной правки;
- старые проекты без этих полей продолжают открываться;
- internal error/diagnostics не появляются на самом слайде.

Не создавай вторую конкурирующую копию presentation document. Сохрани один canonical canvas и ясную lineage.

## Этап 2. Свободное редактирование и локальный reflow

Редактируемы:

- title;
- theses;
- реальный conclusion;
- даты, числа, имена, термины и смысловые labels;
- text/labels native evidence objects.

Locked:

- raster background;
- decoration;
- page number;
- служебные элементы.

Пользователь может заменить текст любым содержанием и любой длиной.

После input/save:

1. Выполни только локальный reflow/fit в имеющейся композиции.
2. Не вызывай AI, web search или image regeneration.
3. Не обрезай строку, не вставляй ellipsis в сохранённое значение и не меняй смысл.
4. Не блокируй сохранение из-за overflow.
5. Если читаемый fit невозможен, сохрани полный текст и поставь `overflow_warning`.
6. Покажи понятное предупреждение и доступные бесплатные действия: изменить размер/положение блока в допустимых границах, выбрать локальный native layout или сократить текст вручную.
7. Не обещай, что старое изображение соответствует новому смыслу; поставь нейтральный `maybe_mismatched_after_edit`.

Font-size floor должен следовать актуальному продуктовой readable policy, а не быть снижен ради исчезновения warning.

## Этап 3. Presentation/editor UX

1. Image-first и native fallback открываются в том же редакторе, а не в отдельном тупиковом preview.
2. Все смысловые text elements имеют обычные возможности Tiptap/редактора, совместимые с текущей архитектурой.
3. Locked state визуально понятен, но не перегружает экран техническими badges.
4. Fallback не помечается как «ошибка» на слайде. Допустим спокойный status вне canvas, если пользователю действительно нужно знать о доступной регенерации.
5. `visualStaleness` после крупной правки объясняется человеческим языком: изображение может не соответствовать новому тексту; сохранение уже выполнено.
6. Не добавляй обязательное подтверждение между deck-wide content lock и первоначальной image generation.
7. Не ломай speech review/edit screen, navigation, autosave и существующие user custom canvases.

Проверь desktop и mobile/touch состояния, но не делай редизайн всего редактора.

## Этап 4. Ручная регенерация

Ручная регенерация — отдельная транзакция и отдельный cost envelope.

Flow:

1. Пользователь нажимает `Сгенерировать визуал заново` для одного слайда.
2. API получает актуальную editable revision и строит quote без provider generation.
3. UI до подтверждения показывает гарантированный maximum в рублях, модель/mode в пользовательски понятной форме и то, что будет ровно одна попытка.
4. Quote имеет ID, policy version, exact slide revision, ceiling и expiry.
5. Пользователь явно подтверждает конкретный quote.
6. Backend атомарно резервирует manual envelope.
7. Выполняется максимум один image call; платных retry/layout/vision нет.
8. Новый кандидат проходит локальный text lift и те же hard gates.
9. До принятия новый кандидат находится в `pendingVisualVersion`, а старый selected остаётся рабочим.
10. Пользователь принимает новый или оставляет старый.

Если вызов/cleanup/gate неуспешен:

- старый слайд остаётся;
- пользователь получает короткое понятное сообщение вне canvas;
- actual/uncertain cost показан и записан; при unknown settlement `uncertainRub` равен полному unsettled reserve;
- скрытый повтор запрещён;
- при известном settlement повторная кнопка создаёт новый quote и требует нового подтверждения;
- при uncertain settlement новая регенерация и другие paid stages запрещены до reconciliation.

Quote «примерно» или «от» недостаточен. Если maximum нельзя гарантировать, regeneration недоступна с честным объяснением.

## Этап 5. Good fallback UX

Проверь состояния:

- initial image call failed, показан хороший fallback;
- cleanup failed, показан fallback;
- native evidence slide — полноценный normal result;
- пользователь изменил fallback text;
- overflow warning;
- pending regeneration loading;
- pending failed;
- pending passed, preview before accept;
- accept new;
- reject/close, old preserved.

Пользователь не должен видеть пустую рамку, broken image, exception string, внутренний hash, provider response или случайный white/card template.

## Этап 6. Export parity

Проверь после правок и version switching:

- editor, PDF и PPTX используют selected canonical revision;
- pending candidate не попадает в export до принятия;
- полный пользовательский текст сохраняется, даже если есть overflow warning;
- export предупреждает о layout issue, но не подменяет текст и не вызывает AI;
- PPTX semantic text/native evidence редактируемы;
- locked background/page number остаются locked в поддерживаемой форме;
- отказ от pending candidate не меняет export.

Не ослабляй structural export blockers. Отдели предупреждение о переполнении от потери данных.

## Этап 7. Автоматические тесты

### Shared/API

- backward-compatible version state;
- original lock не меняется после edit;
- save arbitrary long text;
- optimistic revision conflict;
- quote bound to project/slide/revision/user;
- expired/altered/replayed quote rejected;
- manual envelope отдельно от initial;
- exactly one call after confirm;
- no call before confirm;
- selected preserved on every failure;
- accept/reject pending version.

### Web/editor

- editable semantic text and locked page number/background;
- no AI request on type/save/reflow;
- overflow warning without truncation/save block;
- mismatch notice after semantic edit;
- price visible before regeneration confirm;
- cancellation makes zero call;
- old slide visible during pending/failure;
- new visual requires accept;
- native evidence and fallback edit normally;
- speech review screen unchanged.

### Export

- selected/current text parity;
- pending excluded;
- long text not silently truncated;
- PDF/PPTX fixtures;
- editable PPTX text/data.

Используй mocks. Provider network запрещён.

## Проверка

Выполни targeted shared/API/web/export tests и typechecks. Для frontend visual smoke используй `npm run dev:web:fast` и `http://localhost:3020`, если runtime доступен. Не rebuild Docker web для обычной frontend проверки.

Сохрани screenshots/trace для ключевых состояний. Зелёные тесты не заменяют визуальную проверку editor flow.

## Отчёт и verdict

Создай:

`D:\presentation\plans\image-first-editable-slides-v1\reports\05-editor-fallback-and-manual-regeneration.md`

Укажи:

- `PRODUCT FLOW ACCEPTED`, `PRODUCT FLOW NOT ACCEPTED` или `PRODUCT FLOW BLOCKED BY PIPELINE`;
- изменённые файлы;
- state/version diagram;
- доказательство no-AI-on-edit;
- overflow persistence proof;
- manual quote/reservation/call-count evidence;
- old-version preservation proof;
- fallback/native-evidence screenshots;
- export parity;
- результаты tests/typechecks/smoke;
- `paid calls: 0`;
- `commit/deploy: нет`;
- что готово для Плана 06.

Verdict не может быть ACCEPTED, если правка текста запускает AI, строка обрезается, сохранение блокируется, price не показан заранее или старый рабочий слайд теряется.
