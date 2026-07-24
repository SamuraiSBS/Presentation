# Economic standard generation

This runbook applies only to newly started standard runs with
`AI_PROVIDER=aitunnel`. It does not alter saved presentations, Yandex flows,
or requirements-driven defense projects.

## Fixed path and release gate

The persisted `CostEnvelope` is created for the narration run and then linked
to its presentation job. Its versioned policy is capped at **10 RUB**:

| Bucket | Cap (RUB) |
| --- | ---: |
| Mandatory Tavily source snapshot | 0.50 |
| Candidate narration | 4.00 |
| One narration fallback | 4.00 |
| Tavily images | 0.50 |
| Export / infrastructure reserve | 1.00 |

The only approved AI Tunnel model IDs are `gemini-3.5-flash-lite` and
`gemini-3.6-flash`. The catalog snapshot is stored with the envelope, so a
running job never follows a silently changed provider alias or price.

Before a generated document is saved, the economic release gate requires:

- a persisted Tavily source snapshot with at least three sources;
- accepted narration inside the selected Russian timing budget;
- exactly ten ordered slides, factual-source references, and a passing canvas audit;
- no more than two Tavily image searches and two Tavily images;
- a saved envelope at or below 10 RUB with no unresolved paid reservation.

If the gate cannot release the run, the user sees the calm recovery message to
clarify the topic or add materials. The detailed category is retained only in
the generation job, logs, and admin cost telemetry.

## Telemetry and exports

`/admin/costs` exposes each envelope with its limit, reserved/settled/remaining
amounts, reservation settlements, actual AI model, Tavily query count, cost
sources, and termination reason. Missing provider prices remain `null` and are
counted as unknown; they are not converted to zero.

User-initiated PDF/PPTX exports are deterministic for one presentation revision
and are idempotent by revision and file type. Repeating the same export reuses
the existing artifact or job. Export compute and storage are recorded as
`CostEvent`s, but repeated user exports are explicitly outside the 10 RUB
generation cap; this keeps the release gate tied to the bounded generation run.

## Safe price updates

Do not fetch provider prices at request time. Update the reviewed catalog in
`packages/shared/src/generation/cost-envelope.ts`, give it a new catalog/version
and effective date, then run shared and worker tests. Deploy the change before
starting new runs. Existing envelopes retain their stored policy and catalog
snapshots, so they must not be rewritten.
