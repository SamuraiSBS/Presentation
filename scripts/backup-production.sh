#!/usr/bin/env bash
# Creates a recoverable PostgreSQL + MinIO backup without exposing plaintext
# database data outside the deployment host. This script runs only on Linux
# production hosts; its public age recipient is safe to store in .env.production.
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

for command in age docker sha256sum date mktemp; do
  command -v "$command" >/dev/null || { echo "$command is required for backups" >&2; exit 1; }
done

# The production env file is an operator-controlled KEY=VALUE secret file. Do
# not pass its values on a command line: Docker receives them through --env-file.
set -a
# shellcheck disable=SC1090
. "$env_file"
set +a

require_value() {
  local key="$1"
  [[ -n "${!key:-}" ]] || { echo "$key is required for production backup" >&2; exit 1; }
}
for key in BACKUP_ENABLED BACKUP_AGE_RECIPIENT BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY BACKUP_OBJECT_LOCK_RETENTION_DAYS POSTGRES_USER POSTGRES_DB MINIO_ROOT_USER MINIO_ROOT_PASSWORD S3_BUCKET; do
  require_value "$key"
done
[[ "$BACKUP_ENABLED" == "true" ]] || { echo "BACKUP_ENABLED must be true" >&2; exit 1; }
[[ "$BACKUP_AGE_RECIPIENT" =~ ^age1[0-9a-z]+$ ]] || { echo "BACKUP_AGE_RECIPIENT is not an age public recipient" >&2; exit 1; }
[[ "$BACKUP_OBJECT_LOCK_RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] || { echo "BACKUP_OBJECT_LOCK_RETENTION_DAYS must be a positive integer" >&2; exit 1; }

compose() {
  PRODUCTION_ENV_FILE="$env_file" docker compose --project-name studydeck --env-file "$env_file" -f "$root/compose.production.yml" "$@"
}

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="$root/backups"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/studydeck-backup.XXXXXX")"
archive_name="postgres-${timestamp}.dump.age"
metadata_name="postgres-${timestamp}.metadata.json"
archive_path="$backup_dir/$archive_name"
metadata_path="$backup_dir/$metadata_name"
mkdir -p "$backup_dir"
umask 077
trap 'rm -rf "$work_dir"' EXIT

echo "Creating encrypted PostgreSQL backup at $timestamp"
compose exec -T postgres pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$archive_path"
[[ -s "$archive_path" ]] || { echo "Encrypted PostgreSQL backup is empty" >&2; exit 1; }
checksum="$(sha256sum "$archive_path" | awk '{print $1}')"
printf '{"createdAt":"%s","format":"pg_dump_custom_age","sha256":"%s","postgresDatabase":"%s"}\n' \
  "$timestamp" "$checksum" "$POSTGRES_DB" > "$metadata_path"

# The backup bucket is initialized once and then checked on every run. Object
# Lock must be enabled at bucket creation, so a pre-existing unprotected bucket
# fails rather than silently weakening the recovery guarantee.
docker run --rm --network none \
  --env BACKUP_S3_ENDPOINT --env BACKUP_S3_REGION --env BACKUP_S3_BUCKET \
  --env BACKUP_S3_ACCESS_KEY_ID --env BACKUP_S3_SECRET_ACCESS_KEY \
  --env BACKUP_OBJECT_LOCK_RETENTION_DAYS \
  --env ARCHIVE_NAME="$archive_name" --env METADATA_NAME="$metadata_name" \
  --volume "$backup_dir:/backup:ro" --entrypoint /bin/sh minio/mc:RELEASE.2025-01-17T23-25-50Z -ec '
    mc alias set backup "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" >/dev/null
    if ! mc ls "backup/$BACKUP_S3_BUCKET" >/dev/null 2>&1; then
      mc mb --with-lock "backup/$BACKUP_S3_BUCKET"
    fi
    mc version enable "backup/$BACKUP_S3_BUCKET"
    mc retention set --default COMPLIANCE "${BACKUP_OBJECT_LOCK_RETENTION_DAYS}d" "backup/$BACKUP_S3_BUCKET"
    mc encrypt set sse-s3 "backup/$BACKUP_S3_BUCKET"
    mc cp "/backup/$ARCHIVE_NAME" "backup/$BACKUP_S3_BUCKET/postgres/$ARCHIVE_NAME"
    mc cp "/backup/$METADATA_NAME" "backup/$BACKUP_S3_BUCKET/postgres/$METADATA_NAME"
    mc cp "/backup/$ARCHIVE_NAME" "backup/$BACKUP_S3_BUCKET/postgres/latest.dump.age"
    mc cp "/backup/$METADATA_NAME" "backup/$BACKUP_S3_BUCKET/postgres/latest.metadata.json"
  '

# The primary MinIO bucket is mirrored into a distinct, versioned and object-
# locked backup bucket. Each overwrite creates a retained version; we never use
# --remove, so a transient source-side deletion cannot erase recovery copies.
docker run --rm --network studydeck_default \
  --env MINIO_ROOT_USER --env MINIO_ROOT_PASSWORD --env S3_BUCKET \
  --env BACKUP_S3_ENDPOINT --env BACKUP_S3_REGION --env BACKUP_S3_BUCKET \
  --env BACKUP_S3_ACCESS_KEY_ID --env BACKUP_S3_SECRET_ACCESS_KEY \
  --entrypoint /bin/sh minio/mc:RELEASE.2025-01-17T23-25-50Z -ec '
    mc alias set source http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc alias set backup "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" >/dev/null
    mc mirror --overwrite "source/$S3_BUCKET" "backup/$BACKUP_S3_BUCKET/minio-current"
  '

echo "Backup accepted: postgres/$archive_name and minio-current (sha256=$checksum)"
