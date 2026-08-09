# Paid runtime validation report

## Verdict

**LIVE ACCEPTED**

The one authorized ordinary provider-backed `POST` completed successfully.
It reused the required v10 envelope, did not create a new cap or a Tavily/web
search event, and saved a production-quality-gated PresentationDocument.  The
final document contains ten canvas-backed slides.  For every slide, the body
of its accepted `generatedText` section is exactly its `speakerNotes`, which
is exactly `speechScript[N].text`.

## Strict boundary ledger

| Boundary | Result |
| --- | --- |
| Source, tests, `.env`, compose, Prisma, existing reports | Not edited |
| Docker build/restart, web/caddy/full compose | Not run |
| Git add/commit/revert/reset, migration, deploy | Not run |
| Ordinary generation POST | Exactly one, HTTP 201 |
| Project | `cmsbowv7a000zrk0it59j4e57` only |
| New presentation job | `cmslgsa6z0001nv0jrduezc1u` only |
| Manual repair, regeneration, retry, direct provider call | Not run |
| DB writes outside the ordinary POST/worker flow | None; all checks were SELECT-only |
| New file | This report only |

## Preflight passed before the POST

The supplied current-preflight thread was read.  Its compact candidate SELECT
was repeated immediately before the POST and returned:

```text
failed|cmskw9avh0001nk0kn3tof50w/failed|0|1|
cmskw9az70003nk0k093gjty0|active|27.90000000|0.00000000|11.78768000|
cmskw9avh0001nk0kn3tof50w|4
```

This proves the exact required initial state: failed project; old failed
presentation job; no Presentation; one v10 envelope; active cap
`27.90000000 RUB`; reserve `0`; settlement `11.78768000 RUB`; the old job
binding; and four immutable snapshot sources.

`GET http://localhost:4000/v1/health` returned `ok:true`.  `docker compose ps`
showed API and worker Up, with Postgres and Redis healthy.  Neither API nor
worker was the historical report-05 image/container:

| Service | Current container | Current image | Started | Historical image to exclude |
| --- | --- | --- | --- | --- |
| API | `05abb195806df510d8f7c16ab59067415e64288c10a22484d09456cb738d2cd1` | `sha256:a2c306b09d42083fea5d77b8b7bbd7883b1f6925a76ec0341721fec66c0118d7` | `2026-08-09T07:05:15Z` | `sha256:ca28af...` |
| worker | `6f8ee238c828fd590b7cd68adbb1bfaa4b4c56943ade6577f5c7589771e06a8e` | `sha256:1ff50b13bf3548b716c1833c6d043c364dd578d6d204672e6b59d622321a7adf` | `2026-08-09T07:05:15Z` | `sha256:6b1f54...` |

Both images were created at approximately `07:03Z`, and both containers at
approximately `07:05Z`, so they are distinct from the report-05 instances.

Static diff inspection also confirmed both required repairs:

- API retry lookup includes `OR: [{ narrationJob: completed }, { presentationJob: failed }]` and rebinds `presentationJobId` to the new job.
- The economic gate now adds `cost_envelope` only when `reservedRub + settledRub > limitRub`; it no longer rejects solely because `limitRub > 10 RUB`.

## Single authorized submission and immediate lineage proof

The only ordinary route invocation returned:

```json
{"projectId":"cmsbowv7a000zrk0it59j4e57","jobId":"cmslgsa6z0001nv0jrduezc1u","queueJobId":"266","status":"queued"}
```

```text
HTTP_STATUS=201
```

Immediate read-only state was:

```text
new job=cmslgsa6z0001nv0jrduezc1u; job=active; project=generating
envelope=cmskw9az70003nk0k093gjty0
presentationJobId=cmslgsa6z0001nv0jrduezc1u
v10 envelopes=1; snapshot sources=4; Tavily web/image CostEvents=0
```

Thus the old binding was replaced in the same envelope; no additional v10 cap
was created.  The persisted immutable snapshot was used rather than a new
Tavily/web search.

## Terminal state and saved document

Read-only polling reached terminal success:

```text
completed|ready||completed|100|0.00000000|23.49590000|active
```

The final compact readback was:

```text
project=ready
job=cmslgsa6z0001nv0jrduezc1u; queue=266; completed/completed/100
Presentation=cmslgubx9000xog0jrkyrsx0h; revision=1
presentation jobs for project=2  (the old failed job plus this one new job)
v10 envelopes=1; envelope=cmskw9az70003nk0k093gjty0; bound job=new job
snapshot sources=4; CostEvents for the new job/envelope=0; Tavily events=0
```

The saved document reports `slideCount=10`, ten slides, ten `speechScript`
entries, `generationMode=local`, and the production marker:

```json
{"version":1,"capability":"silent-production-quality-gate"}
```

Provider-backed execution is independently recorded by seven successful
`AiUsageEvent` rows for the new job: AITunnel `gpt-5.6-luna` for narrative
plan, design brief, slide-text repair, quality critique and two quality
repairs; and AITunnel `gpt-5.6-terra` for the presentation itself.

## Complete slide-to-speech grounding map

For each row, `section N` is the Nth double-newline-delimited section of the
saved accepted `generatedText`.  `section body = notes` was checked after
removing only its `Слайд N: title` header; `notes = script` compares the full
stored strings.  Matching MD5 values prove exact equality of notes and
`speechScript[N]` without truncating the saved narration in this report.

| N | Section N header / slide title | Section chars | speakerNotes chars | `notes = script[N]` | `section body = notes` | Notes/script MD5 |
| ---: | --- | ---: | ---: | --- | --- | --- |
| 1 | Введение в фотоэнергетику | 1251 | 1216 | yes | yes | `0d838585009a0ef2ac3ea73b7fa61a62` |
| 2 | Исторические истоки фотоэффекта | 1351 | 1310 | yes | yes | `f4b00b77aaca1d5febba8bdd30d21054` |
| 3 | Устройство солнечного элемента | 1054 | 1014 | yes | yes | `c848dfb8d8c3e4224de0eb4701043cfc` |
| 4 | Физика фотоэлектрического преобразования | 1081 | 1031 | yes | yes | `42cc062a351ebc0ad45e0294593d460c` |
| 5 | Конструкция солнечной панели | 1152 | 1114 | yes | yes | `8a94027116da64cc0c7a463d26157bf3` |
| 6 | Факторы эффективности генерации | 1130 | 1089 | yes | yes | `5916ffe5b761e1057335243bfa7b03d6` |
| 7 | Преимущества солнечной энергетики | 1150 | 1107 | yes | yes | `ba64cdca3bb8609a66cc8d1fc129acfe` |
| 8 | Ограничения и недостатки | 1087 | 1053 | yes | yes | `8153d9e585f8e044af77f0a1764dd06f` |
| 9 | Практическое применение систем | 1129 | 1089 | yes | yes | `b67c389b3fcdbffa884cfc6e6d30f1ef` |
| 10 | Заключение и перспективы | 1069 | 1034 | yes | yes | `f6e5e62dcf0d8e1b0ffe5f1147cb583d` |

## Three grounded visible-text examples

Each visible thesis below is the opening text of its own accepted section N;
it was not taken from another section.  Each listed slide also carries the
shown source reference(s) in its saved `sourceRefs`.

| Slide | Visible thesis (saved) | Same-section grounding | Saved sourceRefs |
| ---: | --- | --- | --- |
| 2 | “Превращение света в электричество кажется современным чудом инженерии, но в его основе лежит фундаментальное физическое явление…” | It is the beginning of section 2 / `speakerNotes` / `speechScript[2]`; that section continues with Беккерель, фотоэффект and photons. | 4 refs, including the snapshot excerpt identifying the photoelectric effect and Alexander Becquerel (1839). |
| 5 | “Одиночный кремниевый фотоэлемент вырабатывает очень малое напряжение, обычно составляющее около половины вольта…” | It is the beginning of section 5 / `speakerNotes` / `speechScript[5]`; the same section explains series/parallel cells, encapsulation and protective layers. | 1 ref: the saved source on photovoltaic cells as semiconductor materials with photoelectric-effect properties. |
| 9 | “Сегодня сферы применения солнечных модулей охватывают самый широкий спектр задач — от микроэлектроники до масштабной национальной инженерии.” | It is the beginning of section 9 / `speakerNotes` / `speechScript[9]`; that section alone details mobile, rooftop, utility-scale and agricultural applications. | 3 refs: the captured history/principle article, the UniGreen solar-cell article, and the academic photoeffect source. |

## Quality, sourceRefs and custom canvas

Worker logs for queue job `266` recorded:

```text
presentation production quality gate:
  stage=polishing; issueCategories=[]; attempts=0; finalAction=released

economic presentation release gate:
  stage=validating; passed=true; categories=[]
```

All ten saved slides have a custom canvas object (version, dimensions,
background/style and `elements`), with elements per slide:

`6, 6, 7, 6, 6, 7, 6, 6, 7, 6`.

The saved source-ref counts by slide are:

`4, 4, 2, 1, 1, 3, 3, 4, 3, 1`.

## Cost envelope, reservations and usage ledger

Final envelope state:

| Envelope | Status | Limit RUB | Reserved RUB | Settled RUB | Released RUB | Numerical overrun |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `cmskw9az70003nk0k093gjty0` | active | 27.90000000 | 0.00000000 | 23.49590000 | 0.00000000 | no |

All 13 reservations on the reused envelope are terminal `settled`; none is
`reserved`, `provider_error`, `unknown_usage` or `overrun`.  The seven
reservations created by this new job are all settled:

| Stage | Settled RUB |
| --- | ---: |
| narrative_plan | 0.05564000 |
| design_brief | 0.33800000 |
| presentation | 10.78920000 |
| slide_text_repair | 0.04492000 |
| quality_critique | 0.22522000 |
| quality_repair attempt 1 | 0.12420000 |
| quality_repair attempt 2 | 0.13104000 |

The six earlier failed-attempt reservations on this same envelope are also
settled; together, all 13 sum to the final `23.49590000 RUB` ledger balance.
The seven new `AiUsageEvent` rows all have `status=succeeded` and no error
code.  The CostEvent query for the new job **or the reused envelope** returned
zero rows, which includes zero Tavily `web_search` or `image_search` rows.

No further runtime action was run after this evidence collection.
