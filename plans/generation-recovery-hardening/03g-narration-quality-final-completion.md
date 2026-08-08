# 03g — финальное исправление narration quality и один E2E completion run

## Цель

Единственный run Prompt 03e дошёл до реального OpenAI/Tavily flow, сохранил
один envelope и остался под cap, но завершился `failed` до Presentation:
фактические narration candidates были 805 и 871 слов и не прошли строгие
diagnostics `section_count` и `whole_speech_below_minimum`.

Этот prompt должен устранить именно эту причину без ослабления quality gates,
после чего провести один новый completion E2E. Он не повторяет предыдущий run:
у него один новый project, один normal user-visible flow и один общий cap.

## Полномочия и запреты

Реализация, deterministic tests, candidate Docker rebuild и один local commit
при полном успехе разрешены. Новый paid E2E запускается только если
пользователь явно подтвердит запуск этого prompt с его cost envelope.

Не менять provider routing/model/keys, prices, FX snapshot policy, run cap,
demo policy, source requirements, quality thresholds и исторический
`.audit-bmw/tmpw120oeib/enlarged.pptx`. Не делать push/deploy, retry,
второй project или второй E2E после failure.

## Рабочая область

Продолжай только в candidate worktree:

`D:\presentation\.worktrees\generation-recovery-autonomous`

на ветке `codex/generation-recovery-autonomous`. Исходный `D:\presentation`
не редактируй.

## Фаза A — бесплатная причинная диагностика

1. Извлеки read-only saved diagnostics, accepted/rejected narration metadata,
   full provider response metadata и точные limits для failed project
   `cmskimbng0003s70jyjecs7sv`. Не раскрывай keys или полный пользовательский
   prompt.
2. Проследи путь OpenAI narration: prompt construction, parsing, validation,
   possible rewrite/repair, accepted-speech persistence и transition к
   presentation. Докажи конкретную причину, почему ответ с 805/871 словами
   не был доведён до валидного принятого narration artifact.
3. Не исправляй проблему снижением minimum, подавлением `section_count`,
   заменой текста demo/template prose или фиктивным local expansion.

## Фаза B — минимальное исправление и deterministic proof

Исправь только подтверждённую причину. Допустимо, например:

- сделать contract/prompt для full narration однозначным по числу sections и
  minimum word budget;
- корректно направить недлинный real candidate в существующий bounded
  narration rewrite path;
- сохранить исходные sources и one-envelope/cap lineage при rewrite.

Недопустимо: добавлять неограниченные retries, создавать новый envelope,
повторять Tavily после snapshot или принимать текст, не прошедший quality gate.

Добавь deterministic tests, которые доказывают:

1. 805/871-word ответ с теми же diagnostics не принимается и направляется в
   ровно один bounded repair path либо честно terminates без presentation;
2. валидный repaired full narration имеет нужное число sections/word budget и
   проходит существующий quality gate без template/demo текста;
3. repair наследует тот же envelope, FX snapshot и source snapshot, не создаёт
   новых envelope/Tavily calls и соблюдает cap;
4. исчерпанный budget или невалидный repair завершает flow без provider retry,
   Presentation и ложного `ready`;
5. прежние OpenAI pricing/FX/envelope tests остаются зелёными.

Запусти relevant worker/API tests, typechecks, `presentation.test.ts` и
`git diff --check`. Две baseline failures допускаются только при
воспроизводимом совпадении с чистым `HEAD`; не маскируй их.

## Фаза C — финальный completion E2E

Перед платным run обязательно: все бесплатные gates зелёные, candidate
api/worker пересобраны из этой worktree, demo off, credentials present,
provider/model/FX source/cap/start ledger зафиксированы без secrets и queues
пусты.

Затем создай ровно один новый обычный учебный project с включёнными sources и
запусти один normal user-visible generation flow. Никаких ручных retry.

Принимай completion только при одновременных условиях:

- project `ready`, валидная `Presentation` и ожидаемый slide count;
- real provider/model и Tavily WEB sources с URL/source refs;
- accepted speech, speaker notes и slide text согласованы;
- canvas/export/parity checks прошли;
- один envelope lineage; фактический `settled <= cap` с persisted FX snapshot;
- нет demo/mock/generic substitution.

При любом failure остановись: больше paid run не разрешён.

## Commit и отчёт

Только при полном completion создай один локальный commit candidate branch.
В отчёте приложи: cause→fix→tests, candidate image/container IDs, project/job/
envelope IDs, sources, quality/canvas/export evidence, complete cost ledger,
fact-versus-cap и commit SHA. При failure приложи diagnostics и расход, но не
commit. Push/deploy запрещены.
