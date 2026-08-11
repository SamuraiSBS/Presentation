param(
  [string]$HostName = "deploy@your-server",
  [string]$RemotePath = "/opt/studydeck",
  [string]$ProductionEnvFile = ".env.production",
  [Parameter(ParameterSetName = "deploy", Mandatory = $true)]
  [string]$ReleaseManifestPath,
  [Parameter(ParameterSetName = "rollback", Mandatory = $true)]
  [switch]$Rollback
)

$ErrorActionPreference = "Stop"

function Assert-SafeRemoteArgument {
  param(
    [string]$Value,
    [string]$Name
  )

  if ([string]::IsNullOrWhiteSpace($Value) -or $Value -match "['`"`r`n]") {
    throw "$Name contains an unsupported character."
  }
}

Assert-SafeRemoteArgument -Value $RemotePath -Name "RemotePath"
Assert-SafeRemoteArgument -Value $ProductionEnvFile -Name "ProductionEnvFile"

if ($Rollback) {
  Write-Host "Rolling back the previous accepted release on ${HostName}:$RemotePath"
  & ssh $HostName "bash '$RemotePath/current/scripts/deploy-release.sh' --root '$RemotePath' --env-file '$ProductionEnvFile' --rollback"
  if ($LASTEXITCODE -ne 0) {
    throw "Remote rollback failed. The remote release state was left unchanged when readiness/smoke did not pass."
  }
  exit 0
}

$repositoryPath = (Resolve-Path -LiteralPath ".").Path.Replace("\\", "/")
if (& git -c "safe.directory=$repositoryPath" status --porcelain --untracked-files=all) {
  throw "Refusing deploy from a dirty working tree. Commit, stash, or remove every change first."
}

& "$PSScriptRoot/verify-release-manifest.ps1" -Path $ReleaseManifestPath
if ($LASTEXITCODE -ne 0) {
  throw "Release manifest validation failed."
}

$releaseManifest = Get-Content -LiteralPath $ReleaseManifestPath -Raw | ConvertFrom-Json
$releaseId = "{0}-{1}" -f $releaseManifest.gitSha.Substring(0, 12), (Get-Date -Format "yyyyMMddHHmmss")
$remoteReleasePath = "$RemotePath/releases/$releaseId"

Write-Host "Deploy target: ${HostName}:$RemotePath"
Write-Host "Staging immutable release directory: $remoteReleasePath"

# The tracked source archive and the CI artifact are transferred separately:
# release-manifest.json is normally downloaded from CI and is intentionally not
# required to be committed into the application repository.
& ssh $HostName "mkdir -p '$RemotePath/releases' '$RemotePath/backups' '$remoteReleasePath'"
if ($LASTEXITCODE -ne 0) {
  throw "Could not create the remote release directory."
}

& git archive --format=tar HEAD | ssh $HostName "tar -xf - -C '$remoteReleasePath'"
if ($LASTEXITCODE -ne 0) {
  throw "Could not transfer the committed release source archive."
}

Get-Content -LiteralPath $ReleaseManifestPath -Raw |
  & ssh $HostName "cat > '$remoteReleasePath/release-manifest.json'"
if ($LASTEXITCODE -ne 0) {
  throw "Could not transfer the accepted release manifest."
}

& ssh $HostName "bash '$remoteReleasePath/scripts/deploy-release.sh' --root '$RemotePath' --env-file '$ProductionEnvFile' --release-dir '$remoteReleasePath'"
if ($LASTEXITCODE -ne 0) {
  throw "Remote deploy failed. If a previous accepted release existed, deploy-release.sh attempted an automatic rollback; inspect its remote evidence before retrying."
}

Write-Host "Release $releaseId is ready. The previous release manifest remains at $RemotePath/previous/release-manifest.json."
