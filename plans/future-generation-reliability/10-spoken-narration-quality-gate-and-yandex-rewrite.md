# 10 — Quality gate естественной речи и точечный Yandex rewrite

## Роль и границы

Выполни только этот пункт в новом чате Codex после 01–09. Сначала прочитай `AGENTS.md`, README пакета, все предыдущие планы, выполни `git status --short` и открой текущие реализации. Не отменяй изменения из предыдущих пунктов и не дублируй уже существующие проверки.

Yandex — единственный автор и редактор речи. Не вводи OpenAI, demo fallback, сторонний AI-сервис, новую очередь или непроверяемую локальную генерацию. Не изменяй существующие проекты/revisions/custom canvas. Не показывай значения из `.env`.

## Проблема

Текущая проверка речи ловит количество sections, длину и несколько template phrases, но пропускает тяжёлые поломки внутри формально допустимого предложения: массовые `;`, повторённые факты, дословные `slidePurpose`/`audienceQuestion`, вопрос-план вместо объяснения и чрезмерное повторение названия предмета.

Цель не в том, чтобы написать «идеальный русский» набором regex. Цель — детерминированно отсеять очевидно непригодный для устного чтения результат и предоставить Yandex ограниченную возможность естественно его переписать.

## Обязательное исследование

Проследи и используй существующие seams:

- `apps/worker/src/tasks/presentation/narration/processing.ts`;
- `apps/worker/src/tasks/presentation/providers/generation.ts`;
- `apps/worker/src/tasks/presentation/prompts/builders.ts`;
- `apps/worker/src/tasks/presentation/quality/orchestration.ts`;
- `apps/worker/src/tasks/presentation-quality.ts`;
- `apps/worker/src/tasks/presentation/constants.ts`;
- worker tests и shared helpers для token normalization.

Найди current predicates для generic/template narration, duplicated sentences, prompt echoes и duration. Расширяй их, а не создавай второй независимый валидатор.

## Реализация

### 1. Добавить узкие детерминированные сигналы брака

Добавь проверяемые и консервативные narration issues для:

- дословного leakage `slidePurpose` или `audienceQuestion` в соответствующий section;
- повтора законченного предложения внутри section или между соседними sections;
- повторяющейся значимой n-граммы/факта, которая не добавляет новую информацию;
- аномального числа `;` или конструкции `,;` в речи;
- незавершённой планировочной формулы или вопроса без естественного объяснения;
- чрезмерного повторения ключевого предмета в пределах section, если естественное местоимение/синоним не использовано.

Нормализуй регистр, пробелы, кавычки и простые русские словоформы ровно настолько, насколько уже позволяют shared/local helpers. Не добавляй новый NLP-пакет или внешнюю проверку языка без доказанной необходимости: проблема находится в pipeline, а не в отсутствии морфологического движка.

Пороги должны быть прозрачны, покрыты тестами и консервативны: не отклоняй научные числа, единичную точку с запятой или закономерно повторяемый термин в коротком техническом объяснении.

### 2. Yandex rewrite только для исправимых нарушений

Если нарушение относится к детерминированно исправимому качеству речи, направь Yandex ограниченный repair prompt. Он получает только проблемные section orders, canonical text, соответствующий narrative plan, разрешённый source context и конкретные причины брака. Запрети добавлять неподтверждённые факты, числа, citations, `slidePurpose`, `audienceQuestion`, мета-команды и вопросы планировщика.

Повторно проверь отредактированные sections всей существующей validation цепочкой. При неуспехе — safe `failed`, без частичного `speechDraft`; не пытайся локально «подчистить» текст эвристикой.

### 3. Согласованность данных

После успешного rewrite `generatedText`, `speakerNotes` и `speechScript` остаются проекциями одной accepted narration. Не меняй пользовательские правки готовой презентации и не затрагивай canvas. Не ослабляй factual grounding, release gate или статусы jobs.

## Детерминированные тесты

Добавь Saturn-like fixture с корректными фактами, но с дефектами исходного инцидента. Докажи, что:

1. 93 `;`, `,;`, многократный повтор факта и leakage `slidePurpose`/`audienceQuestion` отклоняются с понятными typed reasons.
2. Естественная 9–10-slide речь о Сатурне с несколькими необходимыми повторами термина не получает false positive.
3. Repair вызывает только Yandex и переписывает лишь отмеченные sections.
4. Успешный rewrite сохраняет section orders, заголовки, factual grounding и canonical narration contract.
5. Невалидный rewrite не сохраняется и не создаёт partial document/revision.
6. Existing template, duplicate и duration tests остаются зелёными или осознанно обновлены с объяснением изменившегося контракта.

## Проверка и приёмка

Запусти focused worker tests, затем `npm run typecheck -w @studydeck/worker`, `npm run build -w @studydeck/shared`, `docker compose config --quiet` и `git diff --check`. Не делай платных runtime-вызовов и Docker rebuild без отдельного пользовательского запроса.

Итог принимается, только если формально длинная, но непригодная речь больше не может стать `script_ready`; локальная логика лишь обнаруживает проблему, а содержательный rewrite делает Yandex; хорошая терминологически насыщенная речь не блокируется без причины; сохранены Yandex-only, safe failure, атомарность и contract accepted narration.
