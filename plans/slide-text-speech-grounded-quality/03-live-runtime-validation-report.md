# Live runtime validation report

## Verdict

**LIVE NOT ACCEPTED**

The single provider-backed presentation job ended terminally as failed:
economic_release_gate:cost_envelope. No Presentation row or PresentationDocument
was saved. Consequently, terminal ready state, slide-to-speech mapping,
grounded visible-text examples, sourceRefs, and custom-canvas evidence cannot
be proved. No retry, repair, regeneration, manual provider call, second POST,
or additional Docker build/restart was run.

## Boundary ledger

| Boundary | Result |
| --- | --- |
| Source, tests, .env, compose, Prisma, existing reports | Not edited |
| Git add / commit / revert / reset | Not run |
| Docker build | Exactly one: docker compose build worker |
| Docker restart | Exactly one: docker compose up -d worker |
| Other services rebuilt/restarted | None |
| Internal API POST | Exactly one, HTTP 201 |
| Direct database write | None; SQL was SELECT-only |
| Candidate presentation jobs | Exactly one |
| Tavily/web search after POST | None; zero matching CostEvent rows |

The requested AGENTS.md and all named plan/report files were read before
runtime mutation. The supplied previous executor report was read at
plans/slide-text-speech-grounded-quality/02-live-runtime-validation-report.md.
The referenced Codex thread ID was not available to the local thread reader.

## Preflight

Commands:

    docker info --format '{{.ServerVersion}} {{.OSType}} {{.Architecture}}'
    docker compose ps
    curl.exe -sS --fail --max-time 10 http://localhost:4000/v1/health
    git -c safe.directory=D:/presentation status --short
    git -c safe.directory=D:/presentation diff --name-only
    git -c safe.directory=D:/presentation diff --check

Output:

    29.4.2 linux x86_64
    {"ok":true,"service":"studydeck-api","at":"2026-08-08T21:24:36.863Z"}
    api, caddy, minio, postgres (healthy), redis (healthy), web, worker: Up

The pre-existing dirty tree was preserved. It contained worker task changes,
untracked task tests/plan files, .worktrees, and the historical deletion
.audit-bmw/tmpw120oeib/enlarged.pptx. The diff check exited 0; its output only
contained that pre-existing inaccessible deletion and CRLF warnings.

Safe flags read without disclosing secrets:

    API and worker: AI_PROVIDER=aitunnel
    API and worker: ALLOW_DEMO_GENERATION=false
    API and worker: PRESENTATION_IMAGES_ENABLED=true

Read-only database command pattern:

    $sql | docker compose exec -T postgres psql -U studydeck -d studydeck -P pager=off -x

Candidate output before the build:

    project=cmsbowv7a000zrk0it59j4e57
    status=script_ready; mode=with_sources; workflow=standard; slideCount=10
    speech_chars=11472; accepted_speech_present=true; presentation_rows=0

    narration job=cmsbowvbp0011rk0ij1mep1sl
    kind=narration; status=completed; queue_job_id=237

    envelope=cmsbowvbs0013rk0is8ky840d
    policy=standard-generation-cost-envelope-v6; status=active
    limit=20.00000000; reserved=0.00000000; settled=9.05208000
    released=0.90000000; presentation_job_id=(empty)
    source_snapshot_count=4; snapshot_provider=tavily

Immediately before the POST, the select for project state, accepted speech,
Presentation count, presentation-job count, and count of >=3-source snapshots
returned:

    script_ready|true|0|0|1

Read-only source inspection verified:

- apps/api/src/projects/projects.controller.ts:63-65: standard
  POST /v1/projects/:id/generate.
- apps/api/src/projects/projects.service.ts:535-540: normal
  generate-presentation queue enqueue.
- apps/api/src/projects/projects.service.ts:560-593: preservation of the
  completed narration envelope source snapshot in a new presentation envelope.
- apps/worker/src/tasks/generation.ts:154: refreshWeb is false for a
  presentation job.
- apps/worker/src/tasks/generation.ts:638-645: a valid persisted snapshot is
  returned before any web-search branch.

The current v10 policy cap is 27.90000000 RUB, and its defined buckets total
the same amount. The candidate had no v10 envelope; the normal route could
therefore create a new zero-cost v10 envelope and copy the four-source
snapshot, allowing the one job without an accounting overrun.

## One worker build and restart

Pre-build worker:

    container=953c0f4a5b226b315d58b06abcef24a713c3606cf7e4e1bc22e33e2a7c3dae83
    image=sha256:16db52ca98762122c019db274219854142ce3ab141ecc59924ac6662d390d1cf
    started=2026-08-08T19:15:56.536696352Z
    status=running
    image-created=2026-08-08T19:00:51.041321926Z

The one authorized build command:

    docker compose build worker

Build output:

    Exit code: 0
    Wall time: 496.3 seconds
    @studydeck/shared build: DONE
    @studydeck/worker build: DONE
    Image presentation-worker Built
    new-image=sha256:6b1f543851b5ff600bb4cd63b131bdaa47f0ad5ffdb0c360e99661893f316ee7
    created=2026-08-08T21:35:20.554053286Z

The one authorized restart command:

    docker compose up -d worker

Restart output:

    Container presentation-worker-1 Recreate
    Container presentation-worker-1 Recreated
    Container presentation-worker-1 Starting
    Container presentation-worker-1 Started
    Exit code: 0

Post-restart verification commands:

    $worker = docker compose ps -q worker
    docker compose ps worker
    docker inspect $worker --format 'container={{.Id}} image={{.Image}} started={{.State.StartedAt}} status={{.State.Status}}'
    docker image inspect $(docker inspect $worker --format '{{.Image}}') --format 'image={{.Id}} created={{.Created}}'
    docker compose logs --tail 30 worker

Output:

    container=418a4d9f5f686a301ca2a1039305f6bf468fcdc46520188ad386663180300952
    image=sha256:6b1f543851b5ff600bb4cd63b131bdaa47f0ad5ffdb0c360e99661893f316ee7
    started=2026-08-08T21:35:57.481592774Z
    status=running
    studydeck worker started
    queues=["generation","exports","admin-maintenance"]

The new image, container and start time prove the worker was updated before
submission.

## One ordinary provider-backed job

The only POST read local credentials into variables without printing them:

    $envLines = Get-Content -LiteralPath '.env' -Encoding utf8
    $tokenLine = $envLines | Where-Object { $_ -match '^INTERNAL_API_TOKEN=' } | Select-Object -First 1
    $userLine = $envLines | Where-Object { $_ -match '^TEMP_USER_ID=' } | Select-Object -First 1
    $token = $tokenLine.Split('=', 2)[1]
    $userId = $userLine.Split('=', 2)[1]
    curl.exe -sS --fail-with-body --max-time 30 -X POST 'http://localhost:4000/v1/projects/cmsbowv7a000zrk0it59j4e57/generate' -H "x-internal-token: $token" -H "x-user-id: $userId" -H 'Content-Type: application/json' --data '{}'

Output:

    {"projectId":"cmsbowv7a000zrk0it59j4e57","jobId":"cmskw9avh0001nk0kn3tof50w","queueJobId":"265","status":"queued"}
    HTTP_STATUS=201

First read-only poll:

    project_status=generating
    job_status=active; queueJobId=265
    progressStage=building_slides; progressPercent=60
    envelope_id=cmskw9az70003nk0k093gjty0
    policyVersion=standard-generation-cost-envelope-v10
    envelope_status=active; limit=27.90000000
    reserved=0.50000000; settled=0.17096000; snapshot_sources=4

Terminal read-only poll:

    project_status=failed
    job_status=failed; progressStage=failed; progressPercent=100
    job_error=economic_release_gate:cost_envelope
    envelope_status=active
    reserved=0.00000000; settled=11.78768000; released=0.00000000

## Terminal DB, ledger and quality evidence

Final readback:

    project=cmsbowv7a000zrk0it59j4e57; status=failed; presentation_rows=0
    narration job=cmsbowvbp0011rk0ij1mep1sl; completed; queue=237
    presentation job=cmskw9avh0001nk0kn3tof50w; failed; queue=265
    error=economic_release_gate:cost_envelope
    created=2026-08-08 21:37:00.75
    updated=2026-08-08 21:38:25.321

    envelope=cmskw9az70003nk0k093gjty0
    policy=v10; status=active; limit=27.90000000
    reserved=0.00000000; settled=11.78768000; released=0.00000000
    source_snapshot_count=4; snapshot_provider=tavily

All reservations settled; none are overrun or unresolved:

| Reservation ID | Bucket/stage | Reserved RUB | Settled RUB |
| --- | --- | ---: | ---: |
| cmskw9bqu0001oe0iaba9vl1h | narrative_plan | 1.50000000 | 0.17096000 |
| cmskw9jnu0005oe0iv2rizx0t | design_brief | 0.50000000 | 0.35940000 |
| cmskw9po30009oe0il8c9amtt | presentation | 12.00000000 | 10.87780000 |
| cmskwapjt000doe0iukpyfddf | quality_critique | 0.30000000 | 0.21754000 |
| cmskwaxnx000hoe0indt9mym4 | quality_repair attempt 1 | 1.00000000 | 0.06294000 |
| cmskwazti000loe0innhxax6i | quality_repair attempt 2 | 1.00000000 | 0.09904000 |

Six AiUsageEvent rows succeeded within this one job: AITunnel Luna for
narrative plan, design brief, quality critique and two repairs, and AITunnel
Terra for the presentation. Their event costs total 11.78768000 RUB. The
CostEvent query matching this job or this v10 envelope returned:

    (0 rows)

So no new Tavily web-search or image-search cost event occurred.

Worker log / operational-event evidence:

    presentation production quality gate: rejected
    issueCategories=["too_long","bad_narration"]

    recovering presentation from accepted narration and source snapshot
    fallback=accepted_narration_local_projection

    presentation production quality gate: released
    issueCategories=[]

    economic presentation release gate: passed=false
    categories=["cost_envelope"]

    cmskwb3w1000toe0iakyq6p77: Economic release gate rejected: cost_envelope
    cmskwb4ag000voe0ibhz742ga: Economic release gate rejected: cost_envelope

Read-only diagnosis of the terminal condition:
apps/worker/src/economic-release-gate.ts:50-52 adds cost_envelope whenever
limitRub is greater than 10 RUB. The current v10 policy requires a
27.90000000 RUB limit. Actual settlement is below its cap
(11.78768000 < 27.90000000), so this was not an accounting overrun; it is a
release-gate/policy incompatibility. No source change was authorized.

## Required artefact checks

| Required proof | Result |
| --- | --- |
| Updated worker image/container | Met |
| Exactly one job, no second job | Met |
| Terminal ready/completed presentation | Not met: job/project failed |
| Saved PresentationDocument | Not met: Presentation rows=0 |
| Slide N -> generatedText N -> speakerNotes -> speechScript N | Not available; no document |
| Three grounded visible-text examples | Not available; no document |
| Production quality gate | Observed, final economic gate rejected |
| sourceRefs/custom canvas | Not available; no document |
| Envelope/reservations/ledger without numerical overrun | Captured; no numerical overrun, incompatible gate |
| Absence of Tavily/web search after submission | Met: zero matching CostEvent rows |

No further commands were run after evidence collection.
