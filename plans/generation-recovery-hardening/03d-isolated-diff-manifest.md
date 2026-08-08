# 03d — изолированное выделение recovery diff

## Цель и границы

Этот документ фиксирует отдельный, неплатный этап после результата `hold` в
Prompt 03c. Его единственная задача — разложить текущий незакоммиченный diff
на переносимые recovery-кандидаты и удерживаемые изменения. Он не принимает
Prompt 03 и не является разрешением на Prompt 04.

На этом первом проходе запрещены тесты, Docker, миграции, generation,
AI/AITunnel/Tavily, сеть, commit, push, deploy, reset, checkout, clean и
изменение исходных product-файлов. Индекс также не используется: текущая
рабочая копия остаётся источником истины до отдельного решения о применении
кандидата в чистой рабочей копии.

## Исходная граница

В `HEAD` нет staged changes. На момент начала этапа рабочее дерево содержит
историческое удаление `.audit-bmw/tmpw120oeib/enlarged.pptx`, 16 изменённых
tracked product-файлов, один untracked worker test и untracked plan-пакет.
Исторический PPTX не является частью кандидата и не должен читаться,
изменяться, восстанавливаться или удаляться этим этапом.

## Полностью атрибутируемые, но dependency-held hunks

Следующие изменения полностью атрибутируются сохранёнными отчётами Prompt 01
или 03a. Это фиксирует их происхождение, но не доказывает, что любой из них
можно перенести на чистый `HEAD` как самостоятельный patch: для всех пяти
остаются неотделённые prerequisites.

| Файл | Hunk в текущем diff | Атрибуция | Evidence | Статус |
|---|---|---|---|---|
| `apps/api/src/projects/projects.service.ts` | `createAitunnelEnvelope`, исходные `findMany`/attempt-group/reuse snapshot изменения (около старых строк 551–592) | Prompt 01 | `Отчёт 01-project-budget-and-source-reuse.txt` | dependency-held |
| `apps/api/src/projects/projects.service.test.ts` | harness `findMany` и test `reuses an exhausted presentation attempt group...` (около старых строк 60, 227) | Prompt 01 | `Отчёт 01-project-budget-and-source-reuse.txt` | dependency-held |
| `apps/worker/src/economic-release-gate.ts` | разрешение exhausted-envelope только при `acceptedNarrationRecovery` (старая строка 54) | Prompt 03a | `Третий отчёт 03-one-real-end-to-end-proof.txt` | dependency-held |
| `apps/worker/src/economic-release-gate.test.ts` | test `releases accepted-artifact local recovery after a cap-blocked envelope` (после старой строки 40) | Prompt 03a | `Третий отчёт 03-one-real-end-to-end-proof.txt` | dependency-held |
| `apps/worker/src/cost-envelope.test.ts` | transaction-mock и test `atomically blocks a presentation reservation...` (import/mock и после старой строки 38) | Prompt 03a | `Шестой отчёт 03-one-real-end-to-end-proof.txt` | dependency-held |

API service+test также не являются самостоятельным candidate bundle: они
зависят от неотделённого v10 shared/cost-policy source. Аналогично,
`cost-envelope.test.ts` содержит ожидания v10/27.90 и transaction-mock test,
которые нельзя отделить от policy/`reserveCostEnvelope` source. Экономический
gate pair зависит от неотделённого `acceptedNarrationRecovery` contract и
Prompt 02 local-recovery path.

**Итог: `0 transferable candidate bundles from current evidence`.**

## Связанные recovery bundles: не переносить по файлам целиком

| Файл или bundle | Подтверждённая часть | Неотделённая/внешняя часть | Решение |
|---|---|---|---|
| `generation.ts` | accepted-narration local recovery, terminal-envelope guard, сохранение presentation diagnostic (Prompt 02/03a) | source-search retry, emergency canvas и ранние recovery hunks перемешаны в том же file diff | переносить только после hunk-level reconstruction |
| `generation.test.ts` | tests local recovery и terminal presentation retry (Prompt 02/03a) | source-search fixtures и более ранние generation tests | hunk-level reconstruction |
| `generation-recovery-actual-gate.test.ts` | весь файл содержит нужные E2E deterministic checks Prompt 02/03a | файл был untracked до поздних дополнений; граница Prompt 02 против 03a не нужна для package candidate | переносить целиком только вместе с зависимым bundle |
| `presentation/orchestrator.ts` | local projection from accepted full narration, source refs, speech/script preservation, roomy layouts (Prompt 02) | version/presentation changes требуют совместимого narration/quality baseline | hunk-level reconstruction |
| `presentation.test.ts` | accepted narration/local projection assertions (Prompt 02) | два неустранённых failures `bad_narration`, `schema_risk`; файл не доказывает baseline | hunk-level reconstruction, не считать proof |
| `presentation-quality.ts`, `presentation/narration/processing.ts`, `presentation/narration/full-document-v6.test.ts`, `presentation/providers/generation.ts` | возможные prerequisites accepted-narration contract | нет file-level Prompt 01/02/03a attribution в финальном 03c | dependency-held |
| `cost-envelope.ts`, `web-search.ts`, `packages/shared/src/generation/cost-envelope.ts` | policy/source-search prerequisites | origin outside confirmed 03a ядра | dependency-held |

## Исключения

- `.audit-bmw/tmpw120oeib/enlarged.pptx` — исторический, не трогать.
- `apps/worker/src/tasks/presentation-quality.ts` и два named failures в
  `presentation.test.ts` — не считать частью принятого recovery evidence.
- `plans/generation-recovery-hardening/` — handoff/evidence, не product
  candidate и не включать в будущий product commit автоматически.

## Остановка

Этот документ не является применением patch, staging или коммитом. Никаких
дальнейших действий, включая создание worktree, сборку candidate, тесты или
запуски, не выполнять без нового явного решения пользователя.
