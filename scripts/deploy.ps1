param(
  [string]$HostName = "deploy@your-server",
  [string]$RemotePath = "/opt/studydeck"
)

$ErrorActionPreference = "Stop"

Write-Host "Deploy target: ${HostName}:$RemotePath"
ssh $HostName "mkdir -p $RemotePath"
git archive --format=tar HEAD | ssh $HostName "cd $RemotePath && tar -xf -"
ssh $HostName "cd $RemotePath && docker compose build && docker compose run --rm api npm run prisma:deploy && docker compose up -d"
