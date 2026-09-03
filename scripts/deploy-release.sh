#!/usr/bin/env bash
# Runs on the Linux deployment host. It deliberately deploys only CI-published
# digest references and keeps the last accepted source/manifest pair available
# for both automatic failure recovery and `scripts/deploy.ps1 -Rollback`.
set -euo pipefail

usage() {
  echo "Usage: $0 --root <remote-path> --env-file <production-env-file> (--release-dir <dir> | --rollback)" >&2
  exit 64
}

root=""
env_file=""
release_dir=""
rollback=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) root="${2:-}"; shift 2 ;;
    --env-file) env_file="${2:-}"; shift 2 ;;
    --release-dir) release_dir="${2:-}"; shift 2 ;;
    --rollback) rollback=true; shift ;;
    *) usage ;;
  esac
done

[[ -n "$root" && -n "$env_file" ]] || usage
if [[ "$rollback" == true && -n "$release_dir" ]] || [[ "$rollback" == false && -z "$release_dir" ]]; then
  usage
fi

root="$(cd "$root" && pwd)"
if [[ "$env_file" != /* ]]; then
  env_file="$root/$env_file"
fi
[[ -f "$env_file" ]] || { echo "Production environment file not found: $env_file" >&2; exit 1; }
command -v docker >/dev/null || { echo "docker is required on the deploy host" >&2; exit 1; }
command -v node >/dev/null || { echo "node is required on the deploy host to validate release manifests" >&2; exit 1; }
command -v flock >/dev/null || { echo "flock is required to serialize deployments" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required for the public smoke test" >&2; exit 1; }
command -v gzip >/dev/null || { echo "gzip is required for database backups" >&2; exit 1; }

mkdir -p "$root/releases" "$root/backups"
exec 9>"$root/.deploy.lock"
if ! flock -n 9; then
  echo "Another deployment or rollback holds $root/.deploy.lock; refusing concurrent mutation." >&2
  exit 1
fi

validate_manifest() {
  local manifest="$1"
  local validator_repository="${release_dir:-${directory:-}}"
  local validator="$validator_repository/scripts/validate-release-manifest.mjs"
  if [[ -f "$validator" ]]; then
    node "$validator" --manifest "$manifest" --repository "$validator_repository"
    return
  fi

  # A rollback may target a release created before the migration-policy
  # validator was introduced. Keep rollback validation strict, but do not
  # require a file that cannot exist in that older immutable source archive.
  node - "$manifest" <<'NODE'
const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const imagePattern = /^[a-z0-9][a-z0-9._/-]*(?::[0-9]+)?\/[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$/;
if (!/^[0-9a-f]{40}$/i.test(manifest.gitSha || '')) throw new Error('legacy manifest gitSha must be a commit SHA');
if (manifest.releaseGate !== 'passed') throw new Error('legacy manifest does not prove a passed release gate');
if (manifest.migrationCompatibility !== 'no-schema-change') throw new Error('legacy rollback manifest must prove no-schema-change');
for (const service of ['api', 'worker', 'web']) {
  if (!imagePattern.test(manifest.images?.[service] || '')) throw new Error(`legacy manifest image ${service} is not immutable`);
}
console.log(`Legacy release manifest accepted: ${manifest.gitSha}`);
NODE
}

manifest_value() {
  local manifest="$1"
  local property="$2"
  node - "$manifest" "$property" <<'NODE'
const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log(manifest.images[process.argv[3]]);
NODE
}

compose_for() {
  local directory="$1"
  local manifest="$directory/release-manifest.json"
  validate_manifest "$manifest"
  STUDYDECK_API_IMAGE="$(manifest_value "$manifest" api)" \
  STUDYDECK_WORKER_IMAGE="$(manifest_value "$manifest" worker)" \
  STUDYDECK_WEB_IMAGE="$(manifest_value "$manifest" web)" \
  PRODUCTION_ENV_FILE="$env_file" \
    docker compose --project-name studydeck --env-file "$env_file" \
      -f "$directory/compose.production.yml" -f "$directory/compose.release.yml" "${@:2}"
}

backup_database() {
  local directory="$1"
  local release_name
  release_name="$(basename "$directory")"
  local backup="$root/backups/${release_name}.pre-migration.sql.gz"
  local temporary_backup="${backup}.partial"
  umask 077
  rm -f "$temporary_backup"
  compose_for "$directory" exec -T postgres sh -ec 'pg_dump --clean --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip -c > "$temporary_backup"
  mv "$temporary_backup" "$backup"
  [[ -s "$backup" ]] || { echo "Database backup is empty: $backup" >&2; return 1; }
  printf 'Pre-migration backup: %s\n' "$backup"
}

wait_for_healthy() {
  local directory="$1"
  local deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do
    local api worker web
    api="$(compose_for "$directory" ps -q api)"
    worker="$(compose_for "$directory" ps -q worker)"
    web="$(compose_for "$directory" ps -q web)"
    if [[ -n "$api" && -n "$worker" && -n "$web" ]] && \
      [[ "$(docker inspect --format '{{.State.Health.Status}}' "$api" 2>/dev/null || true)" == "healthy" ]] && \
      [[ "$(docker inspect --format '{{.State.Health.Status}}' "$worker" 2>/dev/null || true)" == "healthy" ]] && \
      [[ "$(docker inspect --format '{{.State.Health.Status}}' "$web" 2>/dev/null || true)" == "healthy" ]] && \
      compose_for "$directory" exec -T api node -e 'fetch("http://127.0.0.1:4000/v1/health/ready").then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'; then
      return 0
    fi
    sleep 5
  done
  echo "Timed out waiting for API, worker, web, and API readiness after 180 seconds." >&2
  return 1
}

smoke_release() {
  local directory="$1"
  local site_domain
  site_domain="$(grep -E '^SITE_DOMAIN=' "$env_file" | tail -n 1 | cut -d= -f2-)"
  [[ -n "$site_domain" ]] || { echo "SITE_DOMAIN is required for the public Caddy smoke test." >&2; return 1; }
  compose_for "$directory" exec -T api node -e 'fetch("http://127.0.0.1:4000/v1/health/ready").then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))' || return
  compose_for "$directory" exec -T web node -e 'fetch("http://127.0.0.1:3000/").then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))' || return
  curl --fail --silent --show-error --insecure --connect-timeout 5 \
    --resolve "${site_domain}:443:127.0.0.1" "https://${site_domain}/api/internal-health" >/dev/null
}

write_evidence() {
  local directory="$1"
  local evidence="$directory/deploy-evidence.txt"
  {
    echo "recorded_at=$(date --iso-8601=seconds)"
    echo "release_dir=$directory"
    echo "== docker compose ps =="
    compose_for "$directory" ps
    echo "== readiness =="
    compose_for "$directory" exec -T api node -e 'fetch("http://127.0.0.1:4000/v1/health/ready").then(async (r) => { console.log(await r.text()); process.exit(r.ok ? 0 : 1) }).catch(() => process.exit(1))'
  } > "$evidence" 2>&1 || true
}

activate_release() {
  local directory="$1"
  compose_for "$directory" config --quiet || return
  compose_for "$directory" pull api worker web || return
  # Start only dependencies before the backup/migration step. Application
  # containers (and therefore public traffic changes) remain untouched until
  # the immutable images and database state have passed preflight.
  compose_for "$directory" up -d --no-build postgres redis minio create-bucket || return
  backup_database "$directory" || return
  # CI has already proved the migration policy embedded in the manifest. This
  # command applies an expand-only nullable migration before the new app starts.
  # Rollback is application-only: the previous Prisma schema ignores the extra
  # nullable column, so attempting a destructive database rollback is unsafe.
  compose_for "$directory" run --rm --no-deps --no-build --entrypoint ./node_modules/.bin/prisma api migrate deploy || return
  compose_for "$directory" up -d --no-build || return
  wait_for_healthy "$directory" || return
  smoke_release "$directory" || return
}

rollback_to() {
  local directory="$1"
  echo "Rolling back application services to $(basename "$directory")"
  compose_for "$directory" config --quiet || return
  compose_for "$directory" pull api worker web || return
  compose_for "$directory" up -d --no-build || return
  wait_for_healthy "$directory" || return
  smoke_release "$directory" || return
}

if [[ "$rollback" == true ]]; then
  previous="$(readlink -f "$root/previous" 2>/dev/null || true)"
  [[ -n "$previous" && -f "$previous/release-manifest.json" ]] || { echo "No previous accepted release is available for rollback." >&2; exit 1; }
  rollback_to "$previous"
  old_current="$(readlink -f "$root/current" 2>/dev/null || true)"
  ln -sfn "$previous" "$root/current"
  if [[ -n "$old_current" && "$old_current" != "$previous" ]]; then
    ln -sfn "$old_current" "$root/previous"
  fi
  write_evidence "$previous"
  echo "Rollback accepted: $previous"
  exit 0
fi

release_dir="$(cd "$release_dir" && pwd)"
[[ -f "$release_dir/release-manifest.json" ]] || { echo "Missing release manifest in $release_dir" >&2; exit 1; }
validate_manifest "$release_dir/release-manifest.json"
previous="$(readlink -f "$root/current" 2>/dev/null || true)"

if activate_release "$release_dir"; then
  if [[ -n "$previous" && "$previous" != "$release_dir" ]]; then
    ln -sfn "$previous" "$root/previous"
  fi
  ln -sfn "$release_dir" "$root/current"
  write_evidence "$release_dir"
  echo "Deploy accepted: $release_dir"
  exit 0
fi

write_evidence "$release_dir"
ln -sfn "$release_dir" "$root/failed"
echo "Deploy failed; retained failed release evidence at $release_dir/deploy-evidence.txt" >&2
if [[ -n "$previous" && -f "$previous/release-manifest.json" ]]; then
  if rollback_to "$previous"; then
    write_evidence "$previous"
    echo "Automatic rollback accepted: $previous" >&2
  else
    echo "Automatic rollback also failed; inspect $root/current and both release evidence files immediately." >&2
  fi
else
  echo "No previous accepted release exists, so there is nothing safe to roll back to automatically." >&2
fi
exit 1
