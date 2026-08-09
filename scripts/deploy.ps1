param(
  [string]$HostName = "deploy@your-server",
  [string]$RemotePath = "/opt/studydeck",
  [string]$ProductionEnvFile = ".env.production"
)

$ErrorActionPreference = "Stop"

Write-Host "Deploy target: ${HostName}:$RemotePath"
ssh $HostName "mkdir -p $RemotePath"
git archive --format=tar HEAD | ssh $HostName "cd $RemotePath && tar -xf -"
ssh $HostName "cd $RemotePath && test -f '$ProductionEnvFile' && PRODUCTION_ENV_FILE='$ProductionEnvFile' npm run validate:production-config && docker compose --env-file '$ProductionEnvFile' -f compose.production.yml config --quiet && docker compose --env-file '$ProductionEnvFile' -f compose.production.yml build && docker compose --env-file '$ProductionEnvFile' -f compose.production.yml run --rm api npm run prisma:deploy && docker compose --env-file '$ProductionEnvFile' -f compose.production.yml up -d"
