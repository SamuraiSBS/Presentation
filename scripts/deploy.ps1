param(
  [string]$HostName = "deploy@your-server",
  [string]$RemotePath = "/opt/studydeck",
  [string]$ProductionEnvFile = ".env.production",
  [Parameter(Mandatory = $true)]
  [string]$ReleaseManifestPath
)

$ErrorActionPreference = "Stop"
$repositoryPath = (Resolve-Path -LiteralPath ".").Path.Replace("\\", "/")

if (& git -c "safe.directory=$repositoryPath" status --porcelain --untracked-files=all) {
  throw "Refusing deploy from a dirty working tree. Commit, stash, or remove every change first."
}

& "$PSScriptRoot/verify-release-manifest.ps1" -Path $ReleaseManifestPath
$releaseManifest = Get-Content -LiteralPath $ReleaseManifestPath -Raw | ConvertFrom-Json
$apiImage = [string]$releaseManifest.images.api
$workerImage = [string]$releaseManifest.images.worker
$webImage = [string]$releaseManifest.images.web

Write-Host "Deploy target: ${HostName}:$RemotePath"
ssh $HostName "mkdir -p $RemotePath"
git archive --format=tar HEAD | ssh $HostName "cd $RemotePath && tar -xf -"
ssh $HostName "cd $RemotePath && test -f '$ProductionEnvFile' && STUDYDECK_API_IMAGE='$apiImage' STUDYDECK_WORKER_IMAGE='$workerImage' STUDYDECK_WEB_IMAGE='$webImage' PRODUCTION_ENV_FILE='$ProductionEnvFile' docker compose --env-file '$ProductionEnvFile' -f compose.production.yml -f compose.release.yml config --quiet && STUDYDECK_API_IMAGE='$apiImage' STUDYDECK_WORKER_IMAGE='$workerImage' STUDYDECK_WEB_IMAGE='$webImage' PRODUCTION_ENV_FILE='$ProductionEnvFile' docker compose --env-file '$ProductionEnvFile' -f compose.production.yml -f compose.release.yml pull api worker web && STUDYDECK_API_IMAGE='$apiImage' STUDYDECK_WORKER_IMAGE='$workerImage' STUDYDECK_WEB_IMAGE='$webImage' PRODUCTION_ENV_FILE='$ProductionEnvFile' npm run validate:production-config && STUDYDECK_API_IMAGE='$apiImage' STUDYDECK_WORKER_IMAGE='$workerImage' STUDYDECK_WEB_IMAGE='$webImage' PRODUCTION_ENV_FILE='$ProductionEnvFile' docker compose --env-file '$ProductionEnvFile' -f compose.production.yml -f compose.release.yml run --rm --no-deps --no-build api npm run prisma:deploy && STUDYDECK_API_IMAGE='$apiImage' STUDYDECK_WORKER_IMAGE='$workerImage' STUDYDECK_WEB_IMAGE='$webImage' PRODUCTION_ENV_FILE='$ProductionEnvFile' docker compose --env-file '$ProductionEnvFile' -f compose.production.yml -f compose.release.yml up -d --no-build"
