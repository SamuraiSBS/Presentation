#!/usr/bin/env bash
# Restores the latest encrypted PostgreSQL backup and MinIO mirror into fresh,
# disposable Docker volumes. It never attaches to the production data volumes.
set -euo pipefail

usage() {
  echo "Usage: $0 --root <deployment-root> --env-file <production-env-file>" >&2
  exit 64
}

root=""
env_file=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) root="${2:-}"; shift 2 ;;
    --env-file) env_file="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[[ -n "$root" && -n "$env_file" ]] || usage
root="$(cd "$root" && pwd)"
if [[ "$env_file" != /* ]]; then env_file="$root/$env_file"; fi
[[ -f "$env_file" ]] || { echo "Production environment file not found: $env_file" >&2; exit 1; }

for command in age docker date mktemp; do
  command -v "$command" >/dev/null || { echo "$command is required for a restore drill" >&2; exit 1; }
done
set -a
# shellcheck disable=SC1090
. "$env_file"
set +a

require_value() {
  local key="$1"
  [[ -n "${!key:-}" ]] || { echo "$key is required for restore drill" >&2; exit 1; }
}
for key in BACKUP_AGE_IDENTITY_FILE BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY MINIO_ROOT_USER MINIO_ROOT_PASSWORD S3_BUCKET; do
  require_value "$key"
done
[[ -r "$BACKUP_AGE_IDENTITY_FILE" ]] || { echo "BACKUP_AGE_IDENTITY_FILE is not readable" >&2; exit 1; }

drill_id="studydeck-restore-drill-$(date -u +%Y%m%dT%H%M%SZ)-$$"
postgres_name="${drill_id}-postgres"
minio_name="${drill_id}-minio"
postgres_volume="${drill_id}-postgres-data"
minio_volume="${drill_id}-minio-data"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/studydeck-restore-drill.XXXXXX")"
umask 077
cleanup() {
  docker rm -f "$postgres_name" "$minio_name" >/dev/null 2>&1 || true
  docker volume rm "$postgres_volume" "$minio_volume" >/dev/null 2>&1 || true
  rm -rf "$work_dir"
}
trap cleanup EXIT

echo "Downloading latest encrypted backup for isolated restore drill"
docker run --rm --network none \
  --env BACKUP_S3_ENDPOINT --env BACKUP_S3_REGION --env BACKUP_S3_BUCKET \
  --env BACKUP_S3_ACCESS_KEY_ID --env BACKUP_S3_SECRET_ACCESS_KEY \
  --volume "$work_dir:/drill" --entrypoint /bin/sh minio/mc:RELEASE.2025-01-17T23-25-50Z -ec '
    mc alias set backup "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" >/dev/null
    mc cp "backup/$BACKUP_S3_BUCKET/postgres/latest.dump.age" /drill/latest.dump.age
    mc cp "backup/$BACKUP_S3_BUCKET/postgres/latest.metadata.json" /drill/latest.metadata.json
  '
[[ -s "$work_dir/latest.dump.age" ]] || { echo "Latest encrypted PostgreSQL backup is empty" >&2; exit 1; }

docker volume create "$postgres_volume" >/dev/null
docker run -d --name "$postgres_name" \
  --env POSTGRES_DB=restore_drill --env POSTGRES_USER=restore_drill --env POSTGRES_PASSWORD=restore-drill-only \
  --volume "$postgres_volume:/var/lib/postgresql/data" postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do
  if docker exec "$postgres_name" pg_isready -U restore_drill -d restore_drill >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$postgres_name" pg_isready -U restore_drill -d restore_drill >/dev/null
age --decrypt --identity "$BACKUP_AGE_IDENTITY_FILE" "$work_dir/latest.dump.age" \
  | docker exec -i "$postgres_name" pg_restore --exit-on-error --clean --if-exists --no-owner --no-privileges -U restore_drill -d restore_drill
table_count="$(docker exec "$postgres_name" psql -U restore_drill -d restore_drill -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")"
[[ "$table_count" =~ ^[1-9][0-9]*$ ]] || { echo "Restored PostgreSQL drill has no public tables" >&2; exit 1; }

docker volume create "$minio_volume" >/dev/null
docker run -d --name "$minio_name" \
  --env MINIO_ROOT_USER=restore-drill-root --env MINIO_ROOT_PASSWORD=restore-drill-password \
  --volume "$minio_volume:/data" minio/minio:RELEASE.2025-01-20T14-49-07Z server /data >/dev/null
for _ in $(seq 1 30); do
  if docker run --rm --network "container:$minio_name" --entrypoint /bin/sh minio/mc:RELEASE.2025-01-17T23-25-50Z -ec 'mc alias set drill http://127.0.0.1:9000 restore-drill-root restore-drill-password >/dev/null'; then break; fi
  sleep 1
done
docker run --rm --network "container:$minio_name" \
  --env BACKUP_S3_ENDPOINT --env BACKUP_S3_REGION --env BACKUP_S3_BUCKET \
  --env BACKUP_S3_ACCESS_KEY_ID --env BACKUP_S3_SECRET_ACCESS_KEY --env S3_BUCKET \
  --entrypoint /bin/sh minio/mc:RELEASE.2025-01-17T23-25-50Z -ec '
    mc alias set drill http://127.0.0.1:9000 restore-drill-root restore-drill-password >/dev/null
    mc alias set backup "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" >/dev/null
    mc mb -p "drill/$S3_BUCKET"
    mc mirror --overwrite "backup/$BACKUP_S3_BUCKET/minio-current" "drill/$S3_BUCKET"
    mc ls "drill/$S3_BUCKET" >/dev/null
  '

echo "Restore drill accepted: PostgreSQL tables=$table_count; MinIO mirror restored; source metadata=$(tr -d '\n' < "$work_dir/latest.metadata.json")"
