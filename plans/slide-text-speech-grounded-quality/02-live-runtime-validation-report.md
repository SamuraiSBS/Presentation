# Live runtime validation: visible slide text grounded in matching speech

## Scope and boundary

This was the separately authorized live-runtime validation of the accepted worker implementation. The only intended mutating runtime operation was a narrow `worker` rebuild/restart followed by exactly one provider-backed presentation generation job. No production source, schema, test, environment, migration, or compose file was edited.

**Final verdict: LIVE NOT ACCEPTED**

The required updated worker container could not be built and started within the allowed validation window. Per the authorization boundary, no generation job was created against the old worker image.

## Preflight evidence

| Check | Evidence | Result |
| --- | --- | --- |
| Current task diff | Only worker quality/planning/prompt/normalization/orchestration files are modified; `packages/shared`, API, and web are not in the current tracked diff. | Pass |
| Foreign worktree state | Preserved separately: deletion of `.audit-bmw/tmpw120oeib/enlarged.pptx`, `.worktrees/`, and pre-existing task files. | Not attributed to this validation |
| Docker engine | Docker `29.4.2`, `linux`, `x86_64`. | Pass |
| API health | `GET http://localhost:4000/v1/health` returned `{"ok":true,"service":"studydeck-api",...}`. | Pass |
| Current provider | `AI_PROVIDER=aitunnel`; demo generation is disabled. | Pass |
| Web-search route | A presentation job calls `prepareGenerationSources(..., { refreshWeb: false })`; the chosen project has an immutable stored source snapshot. | Pass |
| Candidate project | `cmsbowv7a000zrk0it59j4e57` (`Live generation smoke`), `script_ready`, `with_sources`, accepted speech length `11472`; its only prior job is `narration:completed`. | Pass |
| Existing source/cost evidence | Prior envelope `cmsbowvbs0013rk0is8ky840d`, policy `standard-generation-cost-envelope-v6`, limit `20.00000000 RUB`, settled `9.05208000 RUB`, active, with source snapshot. Current API preserves this snapshot when creating the current v10 presentation envelope, so the first presentation job would not call Tavily. | Pass, but no new job was submitted |

The intended job would have used the ordinary internal API route `POST /v1/projects/:id/generate`. No direct database write was used or planned.

## Narrow worker deploy attempt

Commands actually run (some were read-only preflight):

```powershell
git -c safe.directory=D:/presentation status --short
git -c safe.directory=D:/presentation diff --name-only
git -c safe.directory=D:/presentation diff --stat -- <target worker files>
git -c safe.directory=D:/presentation diff --check -- <target worker files>
docker info --format '{{.ServerVersion}} {{.OSType}} {{.Architecture}}'
docker compose ps
curl.exe -s --max-time 10 http://localhost:4000/v1/health
docker compose build worker
docker compose up -d worker
docker compose ps worker
docker compose logs --tail 100 worker
docker inspect <worker-container>
docker image inspect presentation-worker
docker compose exec -T postgres psql ...  # read-only SELECT only
```

The combined narrow deploy command did not finish before the 60-second command limit (`exit 124`). It produced no successful build/restart output. The subsequent status evidence proves that the pre-existing worker remained live:

```text
container=953c0f4a5b226b315d58b06abcef24a713c3606cf7e4e1bc22e33e2a7c3dae83
image=sha256:16db52ca98762122c019db274219854142ce3ab141ecc59924ac6662d390d1cf
started=2026-08-08T19:15:56.536696352Z
status=running
image-created=2026-08-08T19:00:51.041321926Z
```

The worker log only confirms the existing worker started; it does not prove it contains the current checkout diff. Therefore phase B did not pass.

## Generation and document evidence

No provider-backed presentation job was submitted, no project/presentation/job or new v10 CostEnvelope identifier exists for this validation, and no PresentationDocument was written. Consequently the required mapping is not available:

| Slide N | Accepted section N | speakerNotes | speechScript[N] |
| --- | --- | --- | --- |
| N/A | No validation document: generation was intentionally not started on the old worker. | N/A | N/A |

No production quality-gate, source-ref/canvas, terminal-state, or post-job ledger assertion can be claimed from runtime evidence.

## Cost and prohibited-action ledger

- No live generation job, retry, manual provider call, or paid repair was sent.
- No Tavily/web search was invoked.
- No Docker service other than the attempted `worker` build/restart was targeted.
- No API, web, Caddy, full compose rebuild, deployment, Git stage/commit, or direct database write was performed.
- The read-only SQL inspection found no new validation envelope or usage event.

## Runtime gap and required next authorization

The sole blocking gap is a completed narrow build/restart that proves a new worker image/container from the current checkout. A fresh, explicit authorization is required before retrying the `worker` build or creating the single provider-backed job. The next run must first record the new image and container IDs, then submit only one ordinary API generation job and inspect its job, document, and cost-envelope evidence.
