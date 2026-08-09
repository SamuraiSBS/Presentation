# Live runtime post-lookup validation report

## Verdict

**LIVE NOT ACCEPTED**

The required read-only candidate SQL preflight did not complete.  The
`SELECT`-only `psql` invocation through the Postgres container timed out after
33.7 seconds and ended with `write /dev/stdout: The pipe is being closed`.
Under the explicit stop rule, no Docker build, Docker restart, internal API
POST, provider call, manual repair, regeneration, retry, or migration was run.

## Boundary ledger

| Boundary | Result |
| --- | --- |
| Source, tests, `.env`, compose, Prisma, prior reports | Not edited |
| Docker build `api worker` | Not run |
| Docker restart `api worker` | Not run |
| Internal API POST | Not run |
| Provider/Tavily/manual repair/regeneration/retry | Not run |
| Migration, deploy, web/caddy/full-compose build | Not run |
| Git add/commit/revert/reset | Not run |
| SQL mutation | Not run; attempted SQL was `SELECT`-only |
| New presentation job / v10 envelope | None created by this validation |

Only this report was changed after the stop decision.

## Inputs and static retry-lineage confirmation

Read before any runtime mutation:

- `AGENTS.md`;
- `00-implementation-prompt.md` and `01-read-only-coordinator-prompt.md`;
- `03-live-runtime-validation-report.md` and
  `04-live-runtime-retry-validation-report.md`;
- the supplied Codex thread reference.  The local thread reader could not
  resolve `019fe52b-0cb9-7933-ad86-d4ac11b8df1a`; the prior reports in this
  directory were available and were used only as historical context.

Static inspection of the current uncommitted API diff at
`apps/api/src/projects/projects.service.ts:555-586` confirms the repaired
presentation lookup includes both permitted lineage conditions:

```ts
OR: [
  { narrationJob: { is: { status: "completed" } } },
  { presentationJob: { is: { status: "failed" } } },
]
```

For a current-policy match, the same function updates
`presentationJobId` to the newly queued job rather than creating a new cost
envelope.  That proves the required code path statically, but it cannot
replace the mandated live database confirmation.

## Completed read-only preflight evidence

Docker and API checks succeeded:

```text
docker info --format '{{.ServerVersion}} {{.OSType}} {{.Architecture}}'
29.4.2 linux x86_64

GET http://localhost:4000/v1/health
{"ok":true,"service":"studydeck-api","at":"2026-08-09T06:41:27.837Z"}
```

`docker compose ps` showed all services running; Postgres and Redis were
healthy.  The pre-build identities remained:

| Service | Container ID | Image ID | StartedAt |
| --- | --- | --- | --- |
| API | `10aa30b5384d054fb5e053f5c0aa961f1eb2d8ddd73ed3e59660a7ab918b8b36` | `sha256:ca28af719a2066708ef83e67a1af9679267840d2ae3ccf43e2b36efaa4cf3d5a` | `2026-08-08T19:15:56.703235529Z` |
| worker | `418a4d9f5f686a301ca2a1039305f6bf468fcdc46520188ad386663180300952` | `sha256:6b1f543851b5ff600bb4cd63b131bdaa47f0ad5ffdb0c360e99661893f316ee7` | `2026-08-08T21:35:57.481592774Z` |

The existing dirty tree was preserved.  It contains the supplied API and
worker changes, related tests and plan files, plus the historical unrelated
deletion `.audit-bmw/tmpw120oeib/enlarged.pptx`.  `git diff --check` did not
report a diff-content defect; Git reported that inaccessible deleted path and
pre-existing CRLF conversion warnings.

## Stop condition

The required candidate query was deliberately limited to `SELECT` statements
over `Project`, `GenerationJob`, and `CostEnvelope`.  It was intended to prove
the old failed job `cmskw9avh0001nk0kn3tof50w`, the sole v10 envelope
`cmskw9az70003nk0k093gjty0`, its active `27.90000000 RUB` cap,
`11.78768000 RUB` settlement, zero reserve, four-source immutable snapshot,
and its old presentation-job binding immediately before build.

The command did not return those rows:

```text
Exit code: 124
Wall time: 33.7 seconds
command timed out after 33735 milliseconds
write /dev/stdout: The pipe is being closed.
```

The preceding reports recorded that candidate state, but it was not
re-confirmed in this validation.  The explicit pre-build condition is therefore
not met, and no alternative project or envelope was considered.

## Required runtime artefacts

| Required proof | Result |
| --- | --- |
| Current candidate/envelope SQL confirmation | Not met: read-only query timed out |
| New API/worker images and containers | Not met: build/restart prohibited after failure |
| One new ordinary presentation job and envelope rebind | Not met: POST prohibited after failure |
| Terminal ready/completed project and presentation | Not available |
| Saved PresentationDocument and slide-to-speech mapping | Not available |
| Grounded visible-text examples, quality gate, sourceRefs/custom canvas | Not available |
| New-run cost/reservation/AI-event evidence | Not available |
| Zero new Tavily/web-search events | No POST was made; no event could be initiated by this validation |

No further commands were run after the evidence collection and report update.
