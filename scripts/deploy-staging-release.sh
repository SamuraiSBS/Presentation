#!/usr/bin/env bash
# Runs on the Linux deployment host for the isolated staging environment.
# This script deliberately cannot target the production Compose project or
# production environment file. It deploys only CI-published digest references,
# keeps the last accepted staging release available for rollback, and never
# starts staging Caddy because production owns the public host ports.
set -euo pipefail

readonly PROJECT_NAME="studydeck-staging"
readonly APP_SERVICES=(api worker web)
readonly DEPENDENCY_SERVICES=(postgres redis minio create-bucket clamav)

usage() {
  echo "Usage: $0 --root <staging-root> --env-file <staging-env-file> (--release-dir <dir> | --rollback)" >&2
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

root="$(cd -- "$root" && pwd -P)"
if [[ "$env_file" != /* ]]; then
  env_file="$root/$env_file"
fi
env_file="$(cd -- "$(dirname -- "$env_file")" && pwd -P)/$(basename -- "$env_file")"

[[ "$root" == */staging ]] || { echo "Refusing non-staging root: $root" >&2; exit 1; }
[[ "$(basename -- "$env_file")" == ".env.staging" ]] || { echo "Refusing non-staging environment file: $env_file" >&2; exit 1; }
[[ -f "$env_file" ]] || { echo "Staging environment file not found: $env_file" >&2; exit 1; }
command -v docker >/dev/null || { echo "docker is required on the deploy host" >&2; exit 1; }
command -v node >/dev/null || { echo "node is required on the deploy host to validate release manifests" >&2; exit 1; }
command -v flock >/dev/null || { echo "flock is required to serialize deployments" >&2; exit 1; }

mkdir -p "$root/releases"
exec 9>"$root/.deploy.lock"
if ! flock -n 9; then
  echo "Another staging deployment or rollback holds $root/.deploy.lock; refusing concurrent mutation." >&2
  exit 1
fi

validate_manifest() {
  local manifest="$1"
  node - "$manifest" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path, 'utf8'));
const imagePattern = /^[a-z0-9][a-z0-9._/-]*(?::[0-9]+)?\/[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$/;
if (!/^[0-9a-f]{40}$/i.test(manifest.gitSha || '')) throw new Error('manifest gitSha must be a commit SHA');
if (manifest.releaseGate !== 'passed') throw new Error('manifest does not prove a passed release gate');
if (manifest.migrationCompatibility !== 'no-schema-change') throw new Error('manifest must prove the no-schema-change migration policy');
for (const service of ['api', 'worker', 'web']) {
  if (!imagePattern.test(manifest.images?.[service] || '')) throw new Error(`manifest image ${service} is not an immutable digest reference`);
}
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
  shift
  local manifest="$directory/release-manifest.json"
  validate_manifest "$manifest"
  STUDYDECK_API_IMAGE="$(manifest_value "$manifest" api)" \
  STUDYDECK_WORKER_IMAGE="$(manifest_value "$manifest" worker)" \
  STUDYDECK_WEB_IMAGE="$(manifest_value "$manifest" web)" \
  PRODUCTION_ENV_FILE="$env_file" \
    docker compose --project-name "$PROJECT_NAME" --env-file "$env_file" \
      -f "$directory/compose.production.yml" \
      -f "$directory/compose.release.yml" \
      -f "$directory/compose.staging.yml" "$@"
}

health_ready() {
  local directory="$1"
  compose_for "$directory" exec -T api node -e 'fetch("http://127.0.0.1:4000/v1/health/ready").then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))'
}

wait_for_healthy() {
  local directory="$1"
  local deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do
    local healthy=true
    for service in "${APP_SERVICES[@]}"; do
      local container_id
      container_id="$(compose_for "$directory" ps -q "$service")"
      if [[ -z "$container_id" ]] || [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)" != "healthy" ]]; then
        healthy=false
        break
      fi
    done
    if [[ "$healthy" == true ]] && health_ready "$directory"; then
      return 0
    fi
    sleep 5
  done
  echo "Timed out waiting for staging API, worker, web, and API readiness after 180 seconds." >&2
  return 1
}

wait_for_dependencies() {
  local directory="$1"
  local deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do
    local healthy=true
    for service in postgres redis minio clamav; do
      local container_id
      container_id="$(compose_for "$directory" ps -q "$service")"
      if [[ -z "$container_id" ]] || [[ "$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)" != "healthy" ]]; then
        healthy=false
        break
      fi
    done
    local bucket_id bucket_state bucket_exit_code
    bucket_id="$(compose_for "$directory" ps -q create-bucket)"
    bucket_state="$(docker inspect --format '{{.State.Status}}' "$bucket_id" 2>/dev/null || true)"
    bucket_exit_code="$(docker inspect --format '{{.State.ExitCode}}' "$bucket_id" 2>/dev/null || true)"
    if [[ "$healthy" == true && "$bucket_state" == exited && "$bucket_exit_code" == 0 ]]; then
      return 0
    fi
    sleep 5
  done
  echo "Timed out waiting for staging dependencies and bucket initialization after 180 seconds." >&2
  return 1
}

verify_runtime_images() {
  local directory="$1"
  local manifest="$directory/release-manifest.json"
  for service in "${APP_SERVICES[@]}"; do
    local container_id expected actual
    container_id="$(compose_for "$directory" ps -q "$service")"
    expected="$(manifest_value "$manifest" "$service")"
    actual="$(docker inspect --format '{{.Config.Image}}' "$container_id")"
    if [[ "$actual" != "$expected" ]]; then
      echo "Staging service $service is not running the manifest image: expected $expected, got $actual" >&2
      return 1
    fi
  done
}

internal_smoke() {
  local directory="$1"
  health_ready "$directory" || return
  compose_for "$directory" exec -T api node -e 'fetch("http://127.0.0.1:4000/v1/health/workers").then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))' || return
  compose_for "$directory" exec -T web node -e 'fetch("http://127.0.0.1:3000/").then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))'
}

write_evidence() {
  local directory="$1"
  local status="${2:-unknown}"
  local evidence="$directory/deploy-evidence.txt"
  {
    echo "recorded_at=$(date --iso-8601=seconds)"
    echo "status=$status"
    echo "release_dir=$directory"
    echo "project_name=$PROJECT_NAME"
    echo "acceptance_started=false"
    echo "provider_calls=0"
    echo "production_deploy=false"
    echo "production_env_touched=false"
    echo "== docker compose ps =="
    compose_for "$directory" ps
    echo "== runtime images =="
    for service in "${APP_SERVICES[@]}"; do
      container_id="$(compose_for "$directory" ps -q "$service" || true)"
      if [[ -n "$container_id" ]]; then
        docker inspect --format "$service|container={{.Name}}|image={{.Config.Image}}|id={{.Image}}|health={{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" "$container_id" || true
      fi
    done
    echo "== /v1/health/ready =="
    compose_for "$directory" exec -T api node -e 'fetch("http://127.0.0.1:4000/v1/health/ready").then(async (response) => { console.log(await response.text()); process.exit(response.ok ? 0 : 1) }).catch((error) => { console.error(error.message); process.exit(1) })' || true
    echo "== /v1/health/workers =="
    compose_for "$directory" exec -T api node -e 'fetch("http://127.0.0.1:4000/v1/health/workers").then(async (response) => { console.log(await response.text()); process.exit(response.ok ? 0 : 1) }).catch((error) => { console.error(error.message); process.exit(1) })' || true
  } > "$evidence" 2>&1 || true
}

activate_release() {
  local directory="$1"
  compose_for "$directory" config --quiet || return
  # Do not include caddy: production owns ports 80/443, and staging is
  # intentionally reached through the private Docker network for acceptance.
  compose_for "$directory" pull "${APP_SERVICES[@]}" || return
  compose_for "$directory" up -d --no-build "${DEPENDENCY_SERVICES[@]}" || return
  wait_for_dependencies "$directory" || return
  compose_for "$directory" run --rm --no-deps --entrypoint ./node_modules/.bin/prisma api migrate deploy || return
  compose_for "$directory" up -d --no-build "${APP_SERVICES[@]}" || return
  verify_runtime_images "$directory" || return
  wait_for_healthy "$directory" || return
  internal_smoke "$directory"
}

rollback_to() {
  local directory="$1"
  echo "Rolling back staging application services to $(basename "$directory")"
  compose_for "$directory" config --quiet || return
  compose_for "$directory" pull "${APP_SERVICES[@]}" || return
  compose_for "$directory" up -d --no-build "${APP_SERVICES[@]}" || return
  verify_runtime_images "$directory" || return
  wait_for_healthy "$directory" || return
  internal_smoke "$directory"
}

if [[ "$rollback" == true ]]; then
  previous="$(readlink -f "$root/previous" 2>/dev/null || true)"
  [[ -n "$previous" && -f "$previous/release-manifest.json" ]] || { echo "No previous accepted staging release is available for rollback." >&2; exit 1; }
  rollback_to "$previous"
  old_current="$(readlink -f "$root/current" 2>/dev/null || true)"
  ln -sfn "$previous" "$root/current"
  if [[ -n "$old_current" && "$old_current" != "$previous" ]]; then
    ln -sfn "$old_current" "$root/previous"
  fi
  write_evidence "$previous" rollback-accepted
  echo "Staging rollback accepted: $previous"
  exit 0
fi

release_dir="$(cd -- "$release_dir" && pwd -P)"
case "$release_dir" in
  "$root"/releases/*) ;;
  *) echo "Refusing release outside staging releases: $release_dir" >&2; exit 1 ;;
esac
[[ -f "$release_dir/release-manifest.json" ]] || { echo "Missing release manifest in $release_dir" >&2; exit 1; }
validate_manifest "$release_dir/release-manifest.json"
previous="$(readlink -f "$root/current" 2>/dev/null || true)"

if activate_release "$release_dir"; then
  if [[ -n "$previous" && "$previous" != "$release_dir" ]]; then
    ln -sfn "$previous" "$root/previous"
  fi
  ln -sfn "$release_dir" "$root/current"
  write_evidence "$release_dir" deploy-accepted
  echo "Staging deploy accepted: $release_dir"
  exit 0
fi

write_evidence "$release_dir" deploy-failed-before-acceptance
ln -sfn "$release_dir" "$root/failed"
echo "Staging deploy failed; retained evidence at $release_dir/deploy-evidence.txt" >&2
if [[ -n "$previous" && -f "$previous/release-manifest.json" ]]; then
  if rollback_to "$previous"; then
    write_evidence "$previous" automatic-rollback-accepted
    echo "Automatic staging rollback accepted: $previous" >&2
  else
    echo "Automatic staging rollback also failed; inspect $root/current and release evidence immediately." >&2
  fi
else
  echo "No previous accepted staging release exists, so there is nothing safe to roll back to automatically." >&2
fi
exit 1
