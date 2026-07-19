# StudyDeck AI: качественная речь и надёжная генерация презентации в режиме защиты

## Назначение документа

Это самодостаточный implementation prompt для нового чата Codex в репозитории `D:\presentation`.

Нужно не обсуждать и не перепроектировать режим защиты заново, а реализовать исправления до измеримого пользовательского результата:

> Пользователь загружает материалы проекта, получает содержательный и естественный текст выступления, подтверждает его и без ручного спасения получает готовую редактируемую презентацию, compliance-отчёт и экспорт PPTX/PDF.

Основной scope — `workflow = requirements_driven`, но общие исправления narration/presentation pipeline должны работать и для стандартного режима, если они не являются defense-специфичными. Не ухудшай обычный `/new` и существующие презентации.

Этот документ продолжает:

- `plans/requirements-driven-defense-mode/01-product-and-technical-handoff.md`;
- `plans/requirements-driven-defense-mode/02-production-readiness-and-complete-flow.md`.

Первый документ остаётся продуктовым контрактом. Второй остаётся общим production-readiness handoff. Этот план фиксирует более свежий runtime-аудит и подробно задаёт работу над качеством речи и надёжностью генерации. Если старый снимок runtime-состояния расходится с актуальным кодом, сначала воспроизведи состояние и опирайся на подтверждённый текущий результат. Evidence-first, backend-authoritative transitions и запрет ослаблять quality gates остаются обязательными.

## Инструкция исполнителю

После получения этого prompt приступай к реализации напрямую. Не возвращайся к этапу продуктового планирования и не ограничивайся новым отчётом.

Перед изменениями полностью прочитай:

1. `AGENTS.md`;
2. `PRODUCT.md`;
3. `DESIGN.md`;
4. оба предыдущих defense handoff;
5. этот документ;
6. актуальные версии файлов, перечисленных в разделе «Основные области кода».

Затем:

1. выполни `git -c safe.directory=D:/presentation status --short`;
2. зафиксируй существующие пользовательские изменения и не откатывай их;
3. воспроизведи ключевые дефекты до исправлений;
4. реализуй этапы по порядку;
5. после каждого этапа запускай узкие тесты;
6. в конце выполни deterministic E2E и один контролируемый real-provider smoke на production-like runtime `http://localhost:3010`;
7. не коммить, не пушь и не выполняй remote deploy без отдельной команды пользователя.

## Конечный результат

Работа считается успешной только при одновременном выполнении следующих условий:

1. Речь основана на подтверждённых материалах, не содержит выдуманных характеристик проекта и не маскирует отсутствие данных общими фразами.
2. Речь звучит естественно по-русски, не повторяет одинаковые начала/концовки и соответствует утверждённому таймингу.
3. Факты, требования и материалы разумно распределены между слайдами; второй слайд не становится складом всех несопоставленных сущностей.
4. Подтверждённая речь стабильно превращается в презентацию.
5. Локально исправимые дефекты одного слайда не уничтожают всю генерацию.
6. Polishing не может превратить уже валидный результат в окончательный failure.
7. Quality gates сохраняются: нельзя сохранять презентацию с блокирующими дубликатами, пропущенными слайдами, выдуманными фактами или потерянными placeholders.
8. Ошибка сообщает реальную причину и следующий шаг, а не всегда предлагает проверить баланс AI.
9. После успешной генерации открываются editor, compliance и export; PPTX/PDF относятся к текущей revision.
10. Полный путь подтверждён автоматическим deterministic E2E и контролируемым real-provider smoke.

## Зафиксированный runtime-аудит от 18 июля 2026 года

Сначала перепроверь эти наблюдения. Не считай их вечным состоянием кода, но используй как обязательную regression matrix.

### P0. Речь с выдуманными фактами при нулевой доказательной базе

На тестовом проекте `cmrqntpnt000wo70izj0utwjm`:

- GitHub analysis завершился `failed`;
- source сохранился без извлечённого текста;
- план был построен и подтверждён с `0` facts и `0` requirements;
- AI всё равно создал речь и UI показал «Текст готов к проверке»;
- в речи появились неподтверждённые утверждения о системе защиты, архитектуре безопасности, шифровании, аутентификации, мониторинге, тестировании и эффективности.

Это прямое нарушение обещания «без выдуманных фактов».

### P0. Неработоспособное распределение плана

На предоставленном проекте `cmrqksjco0003o70ixuwr4fls`:

- analysis содержал 29 facts и 22 requirements;
- все 29 facts, 10 requirements и 4 materials попали на слайд 2;
- слайды 3–11 остались без фактов;
- большинство facts были фрагментами README, markdown-заголовками, командами или кусками списков;
- locator у большинства фактов был одинаковым: `README.md / абзац 1`.

Текущий fallback `targetSlideByText` направляет сущность без совпадения на второй слайд. Это приводит к перегруженной речи второго слайда и пустому boilerplate на остальных.

### P0. Реальная генерация слайдов завершается failure

После ручной замены речи предоставленного проекта на 12 неповторяющихся разделов, 352 слова и примерно 3 минуты generation job дошёл до реальной сборки, выполнялся около 2 минут 45 секунд и завершился ошибкой:

```text
AI generation quality check failed: unresolved visible slide text: slide 12 visible text is duplicated
```

Presentation не была сохранена. Полный editor/compliance/export happy path не состоялся.

### P1. Дополнительные подтверждённые проблемы

- `https://github.com/octocat/Hello-World` отклоняется, потому что корневой файл называется `README` без расширения: первый фильтр его находит, второй отбрасывает.
- Анализ repository retry выполняется несколько раз даже для детерминированной non-retryable ошибки формата/содержимого.
- UI считает речь примерно на 3 минуты готовой для плана на 8 минут.
- Ошибка quality gate отображается как проблема баланса AI-провайдера.
- В defense script отображаются стандартные source checkboxes, но backend запрещает их и требует `/defense/assets`.
- Выбор другого типа защиты закрывает dialog до нажатия «Перестроить план».
- `/export` с `0` slides показывает активные PPTX/PDF/compliance actions; backend их отклоняет generic-ошибкой.
- Сохранённый `Project.speechDraft` нельзя скачать как DOCX, если `Presentation.document` ещё не создан.
- Progress длительной генерации остаётся слишком общим, отмены из UI нет.

## Неподлежащие ослаблению инварианты

### Evidence-first

- Факт проекта допустим только при наличии evidence из включённого source с осмысленным locator либо явного подтверждения пользователя.
- Название проекта, заголовок плана и цель слайда сами по себе не являются доказательством факта.
- Требование описывает ожидаемое поведение или структуру, но не подтверждает, что проект уже реализует это поведение.
- Интернет-изображение не является источником факта.
- При недостатке данных остаётся структурированный placeholder; модель не заполняет пробел правдоподобной догадкой.
- Речь, visible slide text, notes, compliance и exports должны использовать один и тот же approved grounding.

### Качество без обходов

- Не удаляй и не ослабляй проверки duplicate text, missing slides, forbidden template phrases, source grounding, placeholders и export readiness.
- Исправляй причины и repair behavior, а не пороги ради зелёного smoke.
- Demo fallback не может выдаваться за real-provider acceptance.
- Нельзя сохранять partial/invalid presentation как `ready`.
- Можно сохранять лучший ранее полученный кандидат только если он полностью прошёл все блокирующие проверки.

### Совместимость

- Сохрани OpenAI, Yandex и разрешённый demo fallback.
- Не создавай второй независимый генератор, отдельную очередь или новый редактор.
- Используй существующие BullMQ jobs, shared Zod contracts, Prisma, NestJS API, TanStack Query, editor и export pipeline.
- Сохрани публичный facade `apps/worker/src/tasks/presentation.ts` и shared barrel exports.
- Не изменяй legacy MVP в корне репозитория.

## Основные области кода

Перепроверь список через `rg`; он задаёт ожидаемый scope, но не запрещает менять связанные тесты и контракты.

### Shared и persistence

- `packages/shared/src/defense/schemas.ts`
- `packages/shared/src/defense/inputs.ts`
- `packages/shared/src/defense/compliance.ts`
- `packages/shared/src/projects/inputs.ts`
- `packages/shared/src/presentation/**`
- `packages/shared/src/index.ts`
- `prisma/schema.prisma`
- новая Prisma migration только если для структурированной речи или typed failure действительно нет подходящего текущего поля

### Defense worker

- `apps/worker/src/tasks/defense/repository.ts`
- `apps/worker/src/tasks/defense/provenance.ts`
- `apps/worker/src/tasks/defense/analysis.ts`
- `apps/worker/src/tasks/defense/plan-builder.ts`
- `apps/worker/src/tasks/defense/grounding.ts`
- `apps/worker/src/tasks/defense/jobs.ts`
- `apps/worker/src/tasks/defense/compliance.ts`

### Общий narration/presentation pipeline

- `apps/worker/src/tasks/generation.ts`
- `apps/worker/src/tasks/presentation/orchestrator.ts`
- `apps/worker/src/tasks/presentation/narration/processing.ts`
- `apps/worker/src/tasks/presentation/planning/builders.ts`
- `apps/worker/src/tasks/presentation/prompts/builders.ts`
- `apps/worker/src/tasks/presentation/providers/generation.ts`
- `apps/worker/src/tasks/presentation/normalization/presentation.ts`
- `apps/worker/src/tasks/presentation/quality/orchestration.ts`
- `apps/worker/src/tasks/presentation.ts`

### API

- `apps/api/src/defense/defense.service.ts`
- `apps/api/src/projects/projects.service.ts`
- `apps/api/src/jobs/**`
- `apps/api/src/exports/exports.service.ts`
- соответствующие controller/service tests

### Web

- `apps/web/src/components/defense/defense-review-workspace.tsx`
- `apps/web/src/components/defense/defense-plan-workspace.tsx`
- `apps/web/src/components/defense/defense-compliance-panel.tsx`
- `apps/web/src/components/defense/defense-export-compliance.tsx`
- `apps/web/src/components/project-script-review-query.tsx`
- `apps/web/src/components/export-panel-query.tsx`
- `apps/web/src/lib/defense-queries.ts`
- `apps/web/src/lib/defense-ui.ts`
- `apps/web/src/lib/project-queries.ts`
- route pages для review/plan/script/editor/export

### Тесты

- `apps/worker/src/tasks/defense/*.test.ts`
- `apps/worker/src/tasks/presentation.test.ts`
- `apps/worker/src/tasks/presentation-quality.test.ts`
- `apps/worker/src/tasks/generation.test.ts`
- `apps/api/src/defense/defense.service.test.ts`
- `apps/api/src/projects/projects.service.test.ts`
- `apps/api/src/exports/exports.service.test.ts`
- `apps/web/src/lib/defense-ui.test.ts`
- новые component tests для script/export error states
- `e2e/requirements-driven-defense.spec.ts`

## План реализации

Выполняй этапы по порядку. Этапы 1–6 являются core pipeline и предшествуют UI-полировке.

### Этап 0. Baseline и воспроизведение

1. Зафиксируй dirty worktree и не включай чужие изменения в свою работу.
2. Проверь `docker compose ps`, API health и текущий `WEB_PORT=3010` runtime.
3. Получи через API фактические workspace/plan/project/job состояния двух audit projects, не полагаясь только на UI.
4. Зафиксируй точные worker errors и provider attribution для narration и presentation jobs.
5. Запусти текущие targeted typechecks/tests до изменений.
6. Создай детерминированные fixtures, воспроизводящие:
   - failed analysis + zero evidence;
   - 29 unmatched facts;
   - перегруженный второй слайд;
   - повторяющиеся narration edges;
   - duplicated visible text на одном слайде;
   - target duration 8 минут и речь 3 минуты.
7. Не используй реальные AI-вызовы, пока эти failures не зафиксированы unit/integration тестами.

Критерий этапа: каждый P0 воспроизводится автоматическим падающим тестом или детерминированным fixture test.

### Этап 1. Надёжное ingestion и качественная evidence segmentation

#### Repository

1. Исправь обработку extensionless root `README`: файл, найденный как README, не должен затем отбрасываться только из-за отсутствия расширения.
2. Сохрани текущие SSRF/redirect/host/size limits.
3. Классифицируй repository failures как минимум на:
   - invalid URL;
   - unsupported host/path;
   - repository not found/private;
   - rate limit;
   - no supported documents;
   - timeout/network;
   - document too large.
4. Детерминированные 4xx/content failures помечай non-retryable; timeout, 429 и допустимые 5xx — retryable согласно ограниченной policy.
5. Не показывай raw English worker message пользователю; сохраняй техническую причину в logs.

#### Provenance и facts

1. Сегментируй Markdown с учётом headings, paragraph boundaries, lists и fenced code, а не только `\n\n`.
2. Locator должен различать раздел/подраздел/абзац либо устойчивый line range. Все факты большого README не могут ссылаться на `абзац 1`.
3. Не превращай в ProjectFact без дополнительного контекста:
   - чистые markdown headings;
   - URL;
   - команды запуска;
   - пути файлов;
   - короткие list labels;
   - fragment без сказуемого/законченной мысли;
   - шаблонную инструкцию, не описывающую факт проекта.
4. Требование и факт должны оставаться разными сущностями: фраза «система должна шифровать данные» не доказывает «система шифрует данные».
5. Сохрани полезные технические факты, команды и версии как evidence, если они являются завершённым утверждением и нужны для соответствующего слайда.
6. Добавь quality metadata или deterministic classification reason, достаточные для тестирования отбраковки мусора; не обязательно показывать внутренние score пользователю.
7. Если после фильтрации нет достаточных фактов, analysis должен честно сообщить `insufficient_evidence`, а не `review_ready`.

Критерий этапа: canonical extensionless README обрабатывается; facts имеют разные устойчивые locators; мусорные фрагменты не становятся подтверждёнными facts.

### Этап 2. Backend readiness gates и структурированная доказательная речь

1. Введи единый backend-computed `DefenseReadiness` или эквивалентную структуру:
   - analysis status/revision;
   - active confirmed fact count;
   - active requirement count;
   - unresolved conflict count;
   - unresolved required placeholder count;
   - plan approval/revision;
   - narration readiness и причины блокировки;
   - presentation readiness и причины блокировки.
2. Нельзя build/confirm plan и запускать narration при `analysisStatus=failed`, stale analysis или отсутствии минимальной evidence basis.
3. Не вводи произвольное правило «обязательно N фактов» для всех проектов. Минимум должен зависеть от структуры плана:
   - factual slides требуют хотя бы одного fact/explicit author confirmation либо placeholder;
   - identity/title slides могут опираться на authorProfile;
   - requirement-only slide может описывать требование как требование, но не как реализованный результат.
4. Для каждого plan slide вычисляй `groundingState`: `grounded`, `requirement_only`, `placeholder_required` или `structural`.
5. Рассмотри введение shared `DefenseNarrationDocument` как канонического внутреннего артефакта:

```ts
type DefenseNarrationDocument = {
  version: number;
  analysisRevision: number;
  planRevision: number;
  targetDurationSeconds: number;
  sections: Array<{
    slideOrder: number;
    title: string;
    text: string;
    timingSeconds: number;
    factIds: string[];
    requirementIds: string[];
    placeholderIds: string[];
    groundingState: "grounded" | "requirement_only" | "placeholder_required" | "structural";
  }>;
};
```

6. Не копируй этот тип вслепую. Сначала проверь существующие shared presentation/defense schemas и добавь минимальный совместимый контракт.
7. Если structured document негде надёжно хранить, добавь additive Prisma field/revision в `DefenseWorkspace` или совместимое место. Сохрани `Project.speechDraft` как обратносуместимое plain-text представление для существующего script editor.
8. При ручной правке речи сохраняй provenance разрешённых facts/requirements; после значимого изменения запускай deterministic revalidation. Не пытайся автоматически доказать новую пользовательскую фактическую фразу ссылкой на старый fact.
9. Если полноценная claim-level проверка требует отдельного подтверждения пользователя, показывай конкретное предупреждение/placeholder вместо молчаливого принятия.

Критерий этапа: zero-evidence проект не может получить «готовую» доказательную речь; допустимый placeholder path остаётся доступным и понятным.

### Этап 3. Балансировщик требований, фактов и материалов в плане

1. Удали fallback «нет совпадения → второй слайд».
2. Введи явные slide roles для preset sections, например identity, problem, goals, requirements, architecture, implementation, evidence/results, demo, risks, conclusion. Используй существующие preset keys, если они уже дают эквивалентную информацию.
3. Распределяй сущности по совокупности:
   - rule.position / explicit slide order;
   - semantic/token match;
   - source role;
   - fact/requirement category;
   - slide role;
   - текущая нагрузка слайда;
   - capacity по timingSeconds.
4. Для нулевого semantic score используй load-balanced role-aware fallback, а не фиксированный слайд.
5. Не обязательно помещать каждый извлечённый факт в план. Выбирай наиболее релевантные, а остальные оставляй доступными в review.
6. Добавь ограничения/предупреждения:
   - слишком много required requirements на одном слайде;
   - слишком много facts для заданного тайминга;
   - factual slide без facts/placeholders;
   - один material назначен всем слайдам без причины;
   - plan coverage ниже обязательных требований.
7. Добавляй placeholder на каждый factual gap, а не один общий placeholder на весь deck.
8. Plan builder должен возвращать diagnostics, используемые API/UI и тестами: assigned/unassigned facts, overloaded slides, missing evidence, coverage.
9. Adaptive mode может перестраивать необязательные sections, но не должен терять required requirements и подтверждённые facts.

Критерий этапа: fixture с 29 facts не кладёт их все на слайд 2; каждый factual slide имеет обоснованное содержимое или явный placeholder; total timing остаётся в пределах target.

### Этап 4. Генератор естественной речи, привязанный к таймингу

1. Строй narration per slide из structured plan/grounding, а не из одного длинного общего prompt.
2. Для каждого section передавай модели только относящиеся к нему facts, requirements, author data, placeholders, цель и timing.
3. В prompt жёстко различай:
   - `Факт проекта` — можно утверждать;
   - `Требование` — можно формулировать только как требование;
   - `Неизвестно` — оставить placeholder/нейтрально обозначить необходимость уточнения;
   - `Структурный переход` — не превращать в новый факт.
4. Генерируй речь на русском, пригодную для устного выступления студента:
   - законченные предложения;
   - конкретика раньше общих выводов;
   - минимум канцелярита и рекламных формулировок;
   - без «На данном слайде представлено…»;
   - без повторяющегося «По техническому заданию требуется…» на каждом слайде;
   - без одинаковых первых или последних предложений соседних sections;
   - без выдуманных метрик, тестов, технологий и результатов.
5. Рассчитывай target words из timing: базово около 120 слов/мин, с допустимой конфигурацией существующего speech director.
6. Проверяй одновременно:
   - per-slide words относительно timingSeconds;
   - overall duration относительно approved target;
   - sentence count и завершённость;
   - repeated first/last edges;
   - high semantic similarity соседних sections;
   - generic/template phrases;
   - plan/fact/requirement coverage;
   - placeholder preservation.
7. Рекомендуемое initial acceptance окно: overall narration 90–110% target duration, per-slide 75–125% выделенного timing. Если существующие тесты/реальный spoken pace доказывают лучшие границы, зафиксируй их явно и используй один общий source of truth.
8. Не помечай речь `script_ready`, если блокирующая проверка не пройдена. Сохрани repairable draft и structured diagnostics, но UI должен честно показывать «Нужна доработка».
9. UI должен показывать target/actual duration, отклонение и проблемные sections. Сохранение ручного черновика разрешено; запуск slides блокируется при критическом отклонении или invalid sections.

Критерий этапа: речь для 8-минутного плана не считается готовой при длительности 3 минуты; секции различаются содержанием и не повторяют шаблонные концовки.

### Этап 5. Deterministic narration repair до повторного AI-запроса

1. Используй и доработай существующие функции в `narration/processing.ts`, не создавая параллельный repair pipeline.
2. Выполняй deterministic repairs там, где это безопасно:
   - удаление точного повторения;
   - устранение одинакового edge соседних sections;
   - нормализация заголовков;
   - восстановление отсутствующего section из approved grounding;
   - сжатие явно перегруженного section без удаления обязательных facts/placeholders;
   - дополнение слишком короткого section только разрешёнными grounding items.
3. Repair не должен заменять отсутствующий факт общим правдоподобным текстом.
4. После каждого repair заново запускай полный narration validator.
5. AI selective repair вызывай только для оставшихся section-level issues и передавай только проблемные sections плюс их approved grounding.
6. Ограничь количество попыток и учитывай cost; одна и та же неизменяемая ошибка не должна трижды тратить запрос.
7. Сохраняй diagnostics: какие sections исправлены локально, какие AI, какие остаются блокирующими.

Критерий этапа: известный provided-project narration fixture проходит без перегруженного второго слайда и повторяющихся концовок либо завершает job точной структурированной ошибкой с номерами sections.

### Этап 6. Надёжная генерация слайдов и локальный repair

1. Зафиксируй accepted narration как канонический источник для speakerNotes и смысловой основы visible text.
2. Не позволяй presentation provider повторно переписать речь фактами, отсутствующими в accepted narration/grounding.
3. Валидируй raw response до normalization: количество слайдов, order, required fields, usable text.
4. После normalization выполняй defense grounding и проверку сохранности:
   - plan order;
   - fact/requirement refs;
   - placeholders;
   - accepted narration;
   - user assets.
5. Раздели blocking issues на deck-level и slide-level.
6. Для slide-level problems выполняй deterministic локальный repair прежде нового provider call:
   - duplicated visible text;
   - одинаковые thesis/bullets;
   - generic/meta text;
   - фрагмент или оборванное предложение;
   - visible text, не связанный с narration;
   - пустой visual description;
   - потерянный placeholder.
7. При duplicated slide text используй конкретику соответствующего section: уникальный факт, requirement, title, approved narration sentence или placeholder. Не создавай новый факт.
8. Если нужен AI repair, отправляй только проблемные slides и immutable context соседей, чтобы не перегенерировать весь deck.
9. После repair запускай полный quality gate и `assertDefensePresentation`.
10. Храни в памяти job несколько полностью проверенных candidate snapshots:
    - normalized candidate;
    - grounded candidate;
    - deterministic repaired candidate;
    - AI repaired/polished candidate.
11. Выбирай лучший candidate по quality score только среди кандидатов, прошедших все blocking checks.
12. Если pre-polish candidate валиден, а polishing внёс блокирующий дефект, откатись к валидному pre-polish candidate. Нельзя завершать job failure только потому, что необязательное улучшение ухудшило уже пригодную презентацию.
13. Если ни одного валидного candidate нет, не сохраняй presentation; верни typed failure с конкретными slide orders/reasons и разрешённым retry scope.
14. Не ослабляй `visible text is duplicated`; добейся, чтобы repair реально устранял причину.

Критерий этапа: fixture с duplicated visible text на слайде 12 исправляется локально, остальные 11 слайдов и accepted narration не меняются; итог проходит текущие строгие quality gates.

### Этап 7. Stage-aware jobs, retries и идемпотентность

1. Сохрани отдельные этапы analysis, narration и presentation; не запускай следующий этап до успешного завершения предыдущего.
2. Retry должен знать scope:
   - retry repository fetch;
   - retry analysis;
   - repair/retry narration;
   - repair/retry selected slides;
   - retry export.
3. Не создавай новый полный платный запрос, если можно продолжить с сохранённого accepted artifact текущей revision.
4. Double click, reload и повторная доставка BullMQ не создают дублирующие jobs.
5. Request keys должны учитывать project/workflow/analysisRevision/planRevision/narrationRevision/presentationRevision и operation.
6. Обновляй `progressStage`, `progressLabel`, `progressPercent` и `stageStartedAt` на реальных границах pipeline.
7. Реализуй backend cancel request для cancellable provider/repair этапов через существующий `cancelRequestedAt`; не обещай мгновенную отмену уже завершённого внешнего запроса.
8. Non-retryable content/validation failures не должны автоматически повторяться как network failure.

Критерий этапа: повтор действия после slide-level failure не повторяет анализ и narration; двойной клик создаёт одну job.

### Этап 8. Typed failure contract и честный UI

1. Введи shared enum/union failure codes, например:
   - `provider_auth`;
   - `provider_quota`;
   - `provider_rate_limit`;
   - `provider_timeout`;
   - `provider_invalid_response`;
   - `repository_invalid`;
   - `repository_no_documents`;
   - `insufficient_evidence`;
   - `plan_unbalanced`;
   - `narration_quality`;
   - `narration_duration`;
   - `presentation_quality`;
   - `presentation_duplicate_text`;
   - `stale_revision`;
   - `storage_failure`;
   - `queue_failure`.
2. Адаптируй список к существующим error classes; не дублируй уже имеющийся тип.
3. Если текущих `Project.error` и `GenerationJob.error` недостаточно, добавь минимальные `errorCode` и безопасный structured `errorDetails`. Миграция должна быть additive и обратносуместимой.
4. Технический stack/message остаётся в pino/Sentry; клиент получает локализованное объяснение, stage, affected slide/section и доступные actions.
5. Убери универсальный fallback «Проверьте баланс» для quality errors.
6. Для defense workflow показывай:
   - retry конкретного этапа;
   - возврат к review/plan/script;
   - список проблемных sections/slides;
   - не потерян ли принятый текст;
   - требуется ли новый платный provider call.
7. Provider attribution в logs/usage/events должна быть согласована на всех уровнях.
8. Не показывай пользователю raw English worker errors.

Критерий этапа: duplicate slide text отображается как проблема качества слайда 12, а quota error — как проблема квоты; actions различаются.

### Этап 9. Web states для plan, script, editor и export

1. Review:
   - при failed/stale analysis CTA plan disabled или ведёт только к безопасному существующему draft с явным предупреждением;
   - показывай readiness reasons;
   - факты с плохим locator нельзя молча считать качественными.
2. Plan:
   - показывай diagnostics распределения и overloaded slides;
   - внутренние tokens visual strategy переводи в понятные подписи или скрывай;
   - исправь Select внутри type-change dialog;
   - rebuild показывает pending/success/revision change.
3. Script:
   - показывай target/actual duration и per-section warnings;
   - блокируй slide generation только при blocking diagnostics, сохраняя возможность редактировать;
   - defense sources редактируются через `/defense/assets` или становятся read-only с объяснением;
   - accepted speech сохраняется после presentation failure;
   - retry slide generation не перезапускает narration без необходимости.
4. Editor:
   - при отсутствии presentation оставь существующий возврат к script;
   - после успеха показывай актуальный defense compliance panel и placeholders.
5. Export:
   - при `0` slides не показывай активные PPTX/PDF/compliance actions;
   - объясняй, какой этап нужно завершить;
   - DOCX речи генерируй из accepted `speechDraft`/structured narration, даже если Presentation ещё не создана;
   - не утверждай, что речь уже находится в PPTX, если PPTX/presentation отсутствует.
6. Длительные stages показывают конкретный прогресс и cancel/retry там, где backend это поддерживает.
7. Сохрани keyboard/dialog/tabs semantics, mobile layout и touch targets не меньше 44 px для основных действий.

Критерий этапа: пользователь всегда понимает текущий stage, причину блокировки, сохранённые результаты и следующий безопасный action.

### Этап 10. Compliance и export после успешной генерации

1. Compliance запускается только при существующей Presentation текущей revision и approved plan.
2. Report проверяет:
   - required requirements coverage;
   - fact provenance;
   - unresolved placeholders/conflicts;
   - narration/slide timing;
   - missing/duplicate visible text;
   - stale revisions.
3. После editor change report становится stale.
4. Backend export acknowledgement остаётся обязательным при известных проблемах.
5. PPTX/PDF presentation exports и PDF compliance report остаются разными артефактами.
6. Export worker использует тот же validated PresentationDocument, что web renderer.
7. Smoke проверяет ненулевой размер, content type, revision и количество слайдов; по возможности распакуй PPTX в тесте и проверь наличие notes/slides без визуального golden snapshot всего файла.

Критерий этапа: готовый defense deck проходит editor → compliance → report PDF → acknowledged presentation export.

## Тестовая стратегия

### Unit tests: repository, analysis и provenance

Добавь минимум:

1. GitHub root `README` без расширения принимается.
2. `README.md`, `docs/*.md`, GitLab repository продолжают работать.
3. `no supported docs` — non-retryable; 429/timeout — retryable.
4. Markdown headings/list/code получают устойчивые locators.
5. Heading, URL, команда и fragment не становятся самостоятельным fact.
6. Требование «должно быть» не превращается в факт «реализовано».
7. Evidence с excluded source или пустым locator не проходит.

### Unit tests: plan

1. 29 unmatched facts распределяются load-balanced, а не все на slide 2.
2. Explicit position и required requirement сохраняются.
3. Capacity зависит от timing.
4. Unassigned facts диагностируются.
5. Factual slide без evidence получает placeholder.
6. Adaptive не удаляет required items.
7. Plan diagnostics обнаруживают overload и insufficient coverage.

### Unit tests: narration

1. Zero-evidence factual slide не получает invented text.
2. Requirement формулируется как requirement, не как реализованный факт.
3. 3-minute speech не проходит target 8 minutes.
4. Повторяющиеся starts/ends определяются и чинятся.
5. Overlong section сжимается без удаления fact/placeholder refs.
6. Short section дополняется только approved grounding.
7. Manual edit инвалидирует readiness при новой неподтверждённой factual claim.
8. OpenAI/Yandex malformed responses обрабатываются одинаковым contract.

### Unit tests: presentation quality/repair

1. Duplicate visible text только на slide 12 исправляется без изменения остальных slides.
2. Polishing, ухудшивший валидный candidate, откатывается к pre-polish candidate.
3. Invalid candidate никогда не сохраняется как ready.
4. Missing slide repair не меняет accepted narration соседних slides.
5. Defense placeholders/sourceRefs не теряются при normalization/repair.
6. `preserveAcceptedGeneratedText` и canonical narration остаются совместимыми.
7. Quality gates продолжают отклонять неустранённые duplicate/template/grounding issues.

### API/service integration tests

1. Failed/stale analysis → confirm/build/narration rejected typed error.
2. Sufficient grounded plan → narration job enqueued once.
3. Zero facts разрешён только для действительно structural/identity plan или при явных placeholders, но не для выдуманной factual речи.
4. Manual narration save → validation diagnostics → accept only when ready.
5. Presentation retry reuses accepted narration revision.
6. Double click/repeated request создаёт одну job.
7. Error code/details доходят до project/job payload без stack/secrets.
8. Compliance без presentation rejected typed error.
9. Export без presentation disabled на web и rejected API.
10. DOCX speech доступен из accepted narration до создания presentation.

### Component tests

Покрой минимум:

- failed analysis review state;
- plan readiness/overload diagnostics;
- target vs actual speech duration;
- defense-aware source controls;
- narration quality error против quota error;
- retained accepted speech после presentation failure;
- zero-slide export locked state;
- compliance locked state;
- type-change dialog не закрывается при выборе option.

### Deterministic Playwright E2E

Расширь `e2e/requirements-driven-defense.spec.ts`. Тест должен проходить через настоящий web proxy, API, database и job state machine. AI/provider responses могут быть детерминированными fixtures на уровне provider adapter, но не полной браузерной подменой route responses.

Сценарий:

1. Создать defense project.
2. Загрузить README/ТЗ с достаточными фактами и требованиями.
3. Запустить analysis и дождаться review-ready.
4. Проверить разные locators и отсутствие мусорных facts.
5. Построить план и проверить отсутствие overload slide 2.
6. Подтвердить план и получить narration.
7. Проверить target duration, уникальность sections и отсутствие invented claims.
8. Отредактировать один section, сохранить и подтвердить.
9. Запустить slides.
10. Provider fixture сначала возвращает duplicate visible text на одном slide.
11. Pipeline локально чинит slide; job становится ready без полной повторной генерации.
12. Открыть editor и проверить количество slides, notes, placeholders/source refs.
13. Запустить compliance, дождаться report.
14. Изменить slide, проверить stale report, запустить новый.
15. Подготовить PPTX/PDF и compliance PDF.
16. Проверить download, content type, ненулевой размер и текущую revision.
17. Отдельно проверить failure state: accepted narration остаётся доступной и скачивается как DOCX после presentation failure.

Добавь negative E2E:

- failed analysis не позволяет запустить plan/narration;
- zero evidence создаёт placeholders, не invented speech;
- narration duration mismatch блокирует slides;
- quota error и quality error показывают разные messages/actions;
- double click не создаёт две jobs;
- `/export` при 0 slides не предлагает ложные actions.

### Real-provider acceptance на предоставленном проекте

После прохождения всех deterministic tests:

1. Не разрушай исходный проект. Создай duplicate/controlled copy проекта `cmrqksjco0003o70ixuwr4fls` либо новый проект с теми же материалами.
2. Используй real API/worker/provider runtime с `NEXT_PUBLIC_DEMO_PREVIEW=false`.
3. Разрешён один контролируемый полный AI-run и необходимые selective repairs. Не запускай бесконтрольные повторы.
4. Зафиксируй provider, job ids, stages, duration и финальные quality diagnostics без вывода секретов.
5. Речь должна:
   - иметь 12 sections;
   - соответствовать approved target duration в принятом окне;
   - не перегружать один slide;
   - не повторять одинаковые endings;
   - не добавлять неподтверждённые технологии/метрики/результаты.
6. Presentation должна:
   - содержать 12 slides;
   - пройти strict quality gate;
   - открыться в editor;
   - сохранить accepted narration, source refs и placeholders;
   - пройти compliance;
   - экспортироваться в PPTX/PDF.
7. Если real provider недоступен из-за ключа/квоты, deterministic E2E всё равно обязан пройти. Отдельно укажи внешний blocker; не маскируй его demo fallback.

## Метрики качества и acceptance thresholds

Используй существующий StudyDeck quality score и дополни его измеримыми defense dimensions. Не создавай второй несвязанный score.

Минимум фиксируй:

| Dimension | Блокирующее условие |
|---|---|
| Evidence grounding | invented factual claim; fact без допустимого evidence; потерянный required placeholder |
| Plan balance | все/большинство unrelated facts на одном slide; factual slide без fact/placeholder |
| Narration completeness | отсутствующий или слишком короткий section |
| Narration duration | overall вне согласованного окна target duration |
| Narration uniqueness | повторяющиеся sentence edges или высоко похожие соседние sections |
| Slide completeness | количество slides не соответствует approved plan |
| Visible text | duplicate, template phrase, fragment, unusable/meta text |
| Defense integrity | plan order, source refs, requirements или placeholders потеряны |
| Export readiness | presentation отсутствует, invalid/stale revision или blocking compliance state без acknowledgement |

Числовые пороги держи централизованно и покрывай тестами. В final report объясни выбранные значения и покажи результаты на fixtures и real smoke.

## Наблюдаемость

1. Для каждой generation operation логируй `projectId`, `workflow`, `generationJobId`, provider, analysis/plan/narration/presentation revisions, stage, attempt и repair scope.
2. Не логируй API keys, signed URLs, полный source text, полный speech или персональные author fields.
3. Usage/cost event должен ссылаться на фактического provider.
4. Typed failure code должен совпадать в job, project payload, logs и UI.
5. Логируй переход к предыдущему валидному candidate после неудачного polishing как ожидаемое recovery event, а не скрытый success.
6. Добавь metrics/counters, если текущая observability допускает это без новой системы:
   - narration repair attempts;
   - slide repair attempts;
   - quality failure codes;
   - successful fallback-to-valid-candidate;
   - average stage duration.

## Команды проверки

Сначала узкие tests/typechecks, затем полный gate. Актуализируй команды по `package.json`, если scripts изменились.

```powershell
npm run prisma:generate

npm run typecheck -w @studydeck/shared
npm run test -w @studydeck/shared

npm run typecheck -w @studydeck/api
npm run test -w @studydeck/api

npm run typecheck -w @studydeck/worker
npm run test -w @studydeck/worker

npm run typecheck -w @studydeck/web
npm run test -w @studydeck/web

npm run lint
npm run check
npm run test
npm run build
npm run test:e2e -- e2e/requirements-driven-defense.spec.ts
docker compose config --quiet
```

Текущий lint gate в репозитории: `eslint apps packages e2e --max-warnings 57`. Не повышай warning budget и не скрывай новые warnings. Если baseline уже падает, покажи точную разницу до/после.

### Production-like runtime

Изменения почти наверняка затронут shared/API/worker/web. Для финального acceptance используй совместимые образы:

```powershell
$env:WEB_PORT='3010'
docker compose build web api worker
docker compose run --rm api npm run prisma:deploy
docker compose up -d web api worker
docker compose ps
curl.exe -s http://localhost:4000/v1/health
curl.exe -s -o NUL -w "%{http_code}" http://localhost:3010/new/defense
```

После rebuild проверь именно `http://localhost:3010`, а не только dev preview. Видимый порт без healthy API/worker/database не считается успешным runtime.

## Матрица приёмки

| Область | Обязательный результат |
|---|---|
| Repository | Extensionless README работает; non-retryable failures не тратят повторные попытки |
| Provenance | Facts имеют точные устойчивые locators; мусорные fragments отфильтрованы |
| Readiness | Failed/stale/insufficient analysis не запускает invented narration |
| Plan | Facts/requirements распределены по смыслу и capacity; нет свалки на slide 2 |
| Placeholders | Каждый пробел evidence остаётся видимым до ручного подтверждения |
| Speech content | Естественная русская речь без выдуманных фактов и шаблонных повторов |
| Speech timing | Actual duration соответствует approved target; проблемные sections видимы |
| Narration repair | Локальные проблемы исправляются без повторной генерации всего текста |
| Slide generation | Approved narration стабильно превращается в полный deck |
| Slide repair | Один duplicate slide исправляется локально, остальные slides не регрессируют |
| Candidate safety | Неудачный polishing не уничтожает ранее валидный candidate |
| Quality gates | Не ослаблены; invalid deck не становится ready |
| Retry | Повторяется только нужный stage; double click/reload идемпотентны |
| Errors | Provider/quota/quality/evidence/stale/storage failures различимы и локализованы |
| Script UI | Target/actual timing, diagnostics и retained accepted speech отображаются честно |
| Editor | Готовый defense deck открывается и сохраняет grounding/placeholders |
| Compliance | Report создаётся, версионируется и становится stale после edit |
| Export | PPTX/PDF/compliance PDF создаются; zero-slide actions заблокированы |
| Speech DOCX | Доступен из accepted speech даже до успешной presentation generation |
| Deterministic E2E | Полный путь проходит без внешней AI-квоты |
| Real smoke | Копия предоставленного проекта проходит до editor/compliance/PPTX/PDF |
| Regression | Standard workflow, OpenAI, Yandex, demo fallback и существующий editor не сломаны |

## Definition of Done

Задача завершена только если:

1. Все три P0 из runtime-аудита имеют regression tests и больше не воспроизводятся.
2. Нельзя получить «готовую» речь с выдуманными фактами после failed analysis или при zero evidence.
3. Provided-project fixture больше не отправляет все facts на slide 2.
4. Речь проходит содержательные, grounding, uniqueness и timing checks.
5. Accepted narration не теряется при presentation failure.
6. Duplicate visible slide text исправляется, а не приводит к бессмысленному полному retry.
7. Polishing не может ухудшить валидный candidate до окончательного failure.
8. Presentation успешно сохраняется, открывается в editor и проходит compliance/export.
9. Ошибки имеют typed code и корректный русский UX; quality failure не называется проблемой баланса.
10. Targeted и full tests/typechecks/build выполнены; lint baseline не ухудшен.
11. Deterministic E2E проходит через реальный app/API/persistence/job lifecycle.
12. На `localhost:3010` выполнен production-like smoke и, при доступном provider, real-project acceptance.
13. Нет ослабленных quality gates, скрытых demo fallbacks или ручных DB-правок, необходимых для happy path.

Нельзя считать задачу завершённой, если:

- речь стала длиннее, но осталась общей и недоказательной;
- презентация сохраняется только после отключения duplicate/quality checks;
- happy path проходит только на browser mocks;
- исправлен только provided project hardcoded-правилом;
- editor открывается, но compliance/export не работают;
- real failure скрывается сообщением «проверьте баланс»;
- остаётся необходимость вручную редактировать БД, job status или presentation JSON.

## Что не входит в scope

- приватные GitHub/GitLab repositories;
- анализ всего исходного кода repository;
- OCR сканированных документов;
- новый visual canvas/editor;
- новый AI provider;
- новая queue architecture;
- полный редизайн StudyDeck;
- удалённый deploy, commit или push без отдельной команды.

## Формат финального отчёта исполнителя

В конце сообщи:

1. какие P0/P1 исправлены и как теперь выглядит полный пользовательский путь;
2. список изменённых файлов по shared/Prisma/API/worker/web/tests;
3. migrations и обратную совместимость;
4. новые readiness/quality/error contracts;
5. результаты narration и presentation fixtures до/после;
6. все запущенные команды и фактические результаты;
7. результаты deterministic E2E;
8. результаты production-like runtime и URL;
9. id копии предоставленного проекта, real-provider stages, duration и итоговые artifacts;
10. наличие editor/compliance/PPTX/PDF результата;
11. оставшиеся внешние blockers и риски;
12. финальный `git status --short` с подтверждением, что чужие изменения не затронуты.
