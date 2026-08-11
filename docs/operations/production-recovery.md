# Production backup, recovery and incident runbook

This runbook is the operational contract for StudyDeck production. It applies
to the Linux deployment host at `/opt/studydeck` and must be rehearsed in
staging before a production release is accepted.

## Service objective and ownership

| Item | Target | Source of truth |
| --- | --- | --- |
| Database and object RPO | 24 hours | `BACKUP_RPO_HOURS` |
| Recovery RTO | 4 hours | `BACKUP_RTO_HOURS` |
| Backup retention and immutable hold | 35 days | `BACKUP_RETENTION_DAYS`, `BACKUP_OBJECT_LOCK_RETENTION_DAYS` |
| Restore-drill freshness | at most 7 days | `BACKUP_DRILL_MAX_AGE_DAYS` |
| Incident owner | named on-call person | `OPERATIONS_OWNER` |
| First notification channel | incident Telegram channel | `OPERATIONS_ALERT_CHANNEL` |

The on-call owner opens the incident in the configured channel, records UTC
timestamps and the release digest, assigns a recovery operator and keeps the
user-facing status message current. Do not put secrets, prompts, source text,
signed URLs, Stripe payloads or customer data in that channel.

## One-time production setup

1. Create an off-site S3-compatible backup account, endpoint and a **dedicated**
   backup bucket. It must not be the application MinIO endpoint or bucket.
2. Enable bucket versioning, Object Lock and server-side encryption for that
   account. The backup script checks and configures a `COMPLIANCE` default hold;
   permission failures are a failed backup, not a warning.
3. Create an `age` recovery key pair. Put only its public recipient in
   `BACKUP_AGE_RECIPIENT`; keep the private identity in the recovery secret
   store and mount it as `BACKUP_AGE_IDENTITY_FILE` (`0600`, owned by
   `studydeck`). A lost private identity makes encrypted database backups
   unrecoverable.
4. Fill all `BACKUP_*`, `OPERATIONS_OWNER` and `OPERATIONS_ALERT_CHANNEL`
   values in `/opt/studydeck/.env.production`, then run:

   ```bash
   sudo apt-get update && sudo apt-get install -y age
   sudo usermod -aG docker studydeck  # re-login the service account after this
   cd /opt/studydeck/current
   npm run validate:production-config
   sudo install -m 0644 infra/systemd/studydeck-backup.service /etc/systemd/system/
   sudo install -m 0644 infra/systemd/studydeck-backup.timer /etc/systemd/system/
   sudo install -m 0644 infra/systemd/studydeck-restore-drill.service /etc/systemd/system/
   sudo install -m 0644 infra/systemd/studydeck-restore-drill.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now studydeck-backup.timer studydeck-restore-drill.timer
   sudo systemctl start studydeck-backup.service
   ```

5. Prove the first recovery before launch:

   ```bash
   sudo systemctl start studydeck-restore-drill.service
   sudo journalctl -u studydeck-restore-drill.service -n 100 --no-pager
   systemctl list-timers 'studydeck-*'
   ```

`backup-production.sh` produces a custom-format `pg_dump`, encrypts it with
the age public recipient before upload, writes a checksum/metadata file, and
mirrors the primary MinIO bucket. The remote bucket is versioned, encrypted and
Object-Locked. It intentionally never mirrors with `--remove`, so a temporary
source deletion does not erase a recovery copy.

`restore-drill.sh` downloads the newest encrypted dump, restores it into fresh
disposable PostgreSQL and MinIO Docker volumes, verifies that database tables
exist and that the object mirror can be copied, then deletes only those drill
containers and volumes. It never uses the production containers or volumes.

## Daily checks and failed backup response

The backup timer runs at 02:17 UTC and the restore drill runs Sunday at 04:00
UTC. At the start of each on-call shift, check the last successful units:

```bash
systemctl status studydeck-backup.service studydeck-restore-drill.service --no-pager
journalctl -u studydeck-backup.service -u studydeck-restore-drill.service --since '8 days ago' --no-pager
```

If a backup or drill fails, notify `OPERATIONS_ALERT_CHANNEL` immediately,
create an incident owned by `OPERATIONS_OWNER`, and repair credentials, Object
Lock permissions, `age` identity access or Docker before the RPO window
expires. A missed backup or drill means the production gate is **HOLD**.

## Incident procedures

### PostgreSQL corruption or accidental data loss

1. Declare the incident; stop `api` and `worker` to prevent writes. Preserve
   the failing release directory, application logs and the timestamp of the
   last known-good state.
2. Run the restore drill first if there is any uncertainty about the artifact:
   `sudo systemctl start studydeck-restore-drill.service`.
3. Restore only into a fresh PostgreSQL volume/container. Verify migrations,
   row counts for affected records and application readiness there before any
   cutover. Never restore a dump over the live volume without an approved
   change record and a new safety dump.
4. Replace the production data volume only during the declared maintenance
   window; start `postgres`, then `redis`, `minio`, `api`, `worker`, `web` and
   confirm `/v1/health/ready`. Record observed RPO/RTO.

### Redis or BullMQ queue failure

1. Pause new work by stopping `worker`; do not delete Redis data or run a
   blanket queue clean command.
2. Capture `docker compose ... logs redis worker`, queue waiting/active/failed
   counts and affected job IDs. Redis is not the system of record: PostgreSQL
   job state and idempotency keys determine safe re-enqueueing.
3. Restore Redis only when a full Redis loss is proven and the operator has a
   job-by-job replay plan. Restart `worker` after Redis is healthy and monitor
   duplicate suppression, queue lag and failed jobs.

### MinIO loss or object corruption

1. Stop writers (`api`, `worker`) and preserve the affected object keys and
   timestamps. Do not use `mc mirror --remove` during recovery.
2. Restore the relevant `minio-current` version into a fresh bucket first.
   Inspect object count and a representative signed download before cutover.
3. For a user-visible erroneous overwrite/delete, choose the previous retained
   object version from the Object-Locked backup bucket; record the exact version
   ID used. Resume writers only after API readiness and download checks pass.

### Stripe webhook degradation

1. Confirm the endpoint health and Stripe dashboard delivery failures. Do not
   mark invoices/subscriptions manually from a chat message.
2. Preserve event IDs, enable/replay only the missing events through Stripe's
   supported dashboard flow, and verify idempotent handling in the API.
3. Reconcile subscription state, credits and duplicate-event handling before
   closing the incident.

### AI or search provider outage

1. Check provider status, Sentry error grouping and the configured provider
   credentials; capture only safe request IDs and error categories.
2. Leave jobs in their existing bounded retry/recovery path. Do not repeatedly
   re-run paid generation to probe an outage.
3. If the outage exceeds the user-facing threshold, post a status notice and
   disable new paid work only through the approved operational flag/change.
   After recovery, verify one controlled non-production request before normal
   traffic resumes.

### Sentry or alerting outage

1. Treat loss of alerting as an observability incident. Confirm application
   readiness, structured logs and the Telegram health alert path separately.
2. Check DSN/release/environment configuration and Sentry project status; do
   not emit production test exceptions containing customer data.
3. Restore alert delivery and document the monitoring gap. Escalate if the gap
   overlaps a production deployment or the backup RPO window.

### Secret rotation

1. Create the replacement credential in the secret manager first; do not
   revoke the active credential before the replacement has passed a controlled
   health/backup check.
2. Rotate one boundary at a time (application secret, database password,
   MinIO application credentials, backup-object-store credentials, provider or
   Stripe webhook secret). Restart only the affected services and verify
   readiness plus the corresponding integration.
3. For an age recipient rotation, keep the old private recovery identity in
   the recovery secret store until every Object-Locked backup encrypted to it
   has expired. Change the public recipient, run a new backup and restore
   drill, then record both key-retirement dates.
4. Revoke the old credential only after the replacement evidence is recorded.
   If revocation fails or a dependency rejects the new credential, restore the
   previous secret version and escalate through the incident channel.

### Release rollback

Use application rollback only for a bad release; it does not undo database
data. From a clean operator workstation run:

```powershell
.\scripts\deploy.ps1 -HostName deploy@your-server -RemotePath /opt/studydeck -Rollback
```

The rollback is accepted only after immutable-image startup, readiness and
public smoke pass. If migrations or data corruption are involved, follow the
database procedure above instead and keep the previous release evidence.

## Drill evidence and release gate

Keep the successful journal entry (UTC date, backup timestamp, restored table
count and MinIO mirror result) with the release evidence. Before approving a
release, verify: newest backup is within RPO, newest drill is within seven days,
the remote bucket has versioning/Object Lock/encryption, the owner and alert
channel are reachable, and the rollback procedure has passed its readiness
smoke. Otherwise the status remains **NO-GO / HOLD**.
