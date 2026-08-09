# Live runtime retry validation report

## Verdict

**LIVE NOT ACCEPTED**

Stopped during the required read-only preflight. No Docker build, Docker
restart, internal API POST, provider call, queue mutation, SQL write, or retry
was performed.

The exact candidate project is present and has the required old failed
presentation attempt. However, the currently uncommitted API implementation
does not prove that the ordinary presentation route will reuse that v10
envelope. Its query selects only envelopes with a completed `narrationJob`
relation; the candidate v10 envelope has no `narrationJobId`. The ordinary
POST would therefore not select it and would fall through to `create`, which
would grant a new v10 cap. This violates the explicit no-new-cap preflight
condition, so proceeding would have been unsafe.

## Hard-boundary ledger

| Boundary | Result |
| --- | --- |
| Source, tests, `.env`, compose, Prisma, prior reports | Not edited |
| Git add / commit / revert / reset | Not run |
| Docker build (`api worker`) | Not run |
| Docker restart (`api worker`) | Not run |
| Internal API POST | Not run |
| Provider/Tavily/manual repair/regeneration | Not run |
| SQL mutations | Not run; all database checks were `SELECT`/schema inspection |
| New presentation jobs/envelopes | None |

Only this report was created after the stop decision.

## Inputs read

Before deciding, the executor read `AGENTS.md`, the requested implementation
and coordinator prompts, the previous live report, and the supplied Codex
thread reference. The local thread reader could not resolve that thread ID;
the prior live report was available at
`plans/slide-text-speech-grounded-quality/03-live-runtime-validation-report.md`
and was used as the prior accepted-repair report.

## Read-only runtime preflight

Successful checks:

```text
docker info --format '{{.ServerVersion}} {{.OSType}} {{.Architecture}}'
29.4.2 linux x86_64

curl.exe -sS --fail --max-time 10 http://localhost:4000/v1/health
{"ok":true,"service":"studydeck-api","at":"2026-08-09T06:18:31.077Z"}
```

`docker compose ps` showed all services running; Postgres and Redis were
healthy. Captured pre-build IDs:

| Service | Container | Image | Started | State |
| --- | --- | --- | --- | --- |
| API | `10aa30b5384d054fb5e053f5c0aa961f1eb2d8ddd73ed3e59660a7ab918b8b36` | `sha256:ca28af719a2066708ef83e67a1af9679267840d2ae3ccf43e2b36efaa4cf3d5a` | `2026-08-08T19:15:56.703235529Z` | running |
| worker | `418a4d9f5f686a301ca2a1039305f6bf468fcdc46520188ad386663180300952` | `sha256:6b1f543851b5ff600bb4cd63b131bdaa47f0ad5ffdb0c360e99661893f316ee7` | `2026-08-08T21:35:57.481592774Z` | running |

The dirty worktree was recorded and preserved. It contains the existing API
and worker diff, related tests, plan files and the historical
`.audit-bmw/tmpw120oeib/enlarged.pptx` deletion. No file was reverted.
`git diff --check` produced no content defect, but reported the pre-existing
inaccessible deleted path and CRLF warnings.

## Candidate and ledger confirmation

The mandated project was selected and no alternative was considered:

```text
project: cmsbowv7a000zrk0it59j4e57
status: failed; mode: with_sources; workflow: standard; slides: 10
accepted speech: present (11,472 characters)
presentations: 0
```

Its only presentation job is the required old failed job:

| Job | Kind | Status | Queue | Error |
| --- | --- | --- | --- | --- |
| `cmsbowvbp0011rk0ij1mep1sl` | narration | completed | `237` | `accepted_speech` |
| `cmskw9avh0001nk0kn3tof50w` | presentation | failed | `265` | `economic_release_gate:cost_envelope` |

The relevant v10 envelope is active and bound to that old failed presentation:

| Envelope | Policy | Status | Limit RUB | Reserved RUB | Settled RUB | `presentationJobId` |
| --- | --- | --- | ---: | ---: | ---: | --- |
| `cmskw9az70003nk0k093gjty0` | `standard-generation-cost-envelope-v10` | active | 27.90000000 | 0.00000000 | 11.78768000 | `cmskw9avh0001nk0kn3tof50w` |

Its immutable snapshot is an object with four `sources`, with provenance
`provider: tavily`; its captured source IDs are `cmsbowxw60005qp0isy9ws8mt`,
`cmsbowxyq0007qp0iyadsy5cn`, `cmsbowy0e0009qp0iur06op22`, and
`cmsbowy2p000bqp0il1mu3b9n`. Thus the stored snapshot itself would prevent a
need for a new web search only if the v10 envelope were actually reused.

## Blocking retry-lineage evidence

The normal route is `POST /v1/projects/:id/generate`
(`apps/api/src/projects/projects.controller.ts:63-65`) and calls
`createAitunnelEnvelope(project.id, "presentation")`.

The uncommitted diff correctly rebinds an envelope **if `existing` was found**:

```ts
const envelope = await tx.costEnvelope.update({
  where: { id: existing.id },
  data: { presentationJobId: job.id },
});
```

But the lookup that supplies `existing` is limited to:

```ts
where: { projectId, narrationJob: { is: { status: "completed" } } }
```

The actual v10 row above has `narrationJobId = NULL`, so it cannot be in that
result. The only row matching that relation is the historical v6 narration
envelope (`cmsbowvbs0013rk0is8ky840d`, limit 20.00000000 RUB), which cannot
match the current v10 policy. Consequently:

```ts
const existing = priorNarrationEnvelopes.find(
  (envelope) => envelope.policyVersion === policy.version,
) || null;
```

is `null` for this candidate, and the following `tx.costEnvelope.create(...)`
branch would create another v10 envelope. The test added for rebinding mocks
the query result directly, so it does not establish this real database
selection condition.

This also means the required claim "the planned retry keeps the same envelope
and does not create a new cap" cannot be made truthfully. Per the requested
stop rule, no build, restart or POST followed.

## Required artefacts

No new job was authorized because preflight failed. Therefore no terminal
ready state, PresentationDocument, slide-to-speech mapping, visible-text
examples, quality-gate result, sourceRefs/custom-canvas proof, or new-job
ledger exists for this run. No Tavily/web-search event can exist after a POST,
because no POST occurred.

## Commands performed

```text
docker info --format '{{.ServerVersion}} {{.OSType}} {{.Architecture}}'
docker compose ps
curl.exe -sS --fail --max-time 10 http://localhost:4000/v1/health
git -c safe.directory=D:/presentation status --short
git -c safe.directory=D:/presentation diff --name-only
git -c safe.directory=D:/presentation diff --check
docker inspect <api-container> <worker-container>
docker compose exec -T postgres psql ...   # SELECT-only and schema inspection
rg / Get-Content on the relevant API and worker source
```

No command after this report creation is authorized by this task.
