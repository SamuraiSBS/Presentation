param(
  [string]$HostName = "root@5.129.211.196",
  [string]$StagingRoot = "/opt/studydeck/staging",
  [string]$StagingEnvFile = "/opt/studydeck/.env.staging",
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

Assert-SafeRemoteArgument -Value $HostName -Name "HostName"
Assert-SafeRemoteArgument -Value $StagingRoot -Name "StagingRoot"
Assert-SafeRemoteArgument -Value $StagingEnvFile -Name "StagingEnvFile"

if ($StagingRoot -notmatch "/staging$") {
  throw "Refusing a non-staging root: $StagingRoot"
}
if ([IO.Path]::GetFileName($StagingEnvFile) -ne ".env.staging") {
  throw "Refusing a non-staging environment file: $StagingEnvFile"
}

if ($Rollback) {
  Write-Host "Rolling back the previous accepted staging release on ${HostName}:$StagingRoot"
  & ssh $HostName "bash '$StagingRoot/current/scripts/deploy-staging-release.sh' --root '$StagingRoot' --env-file '$StagingEnvFile' --rollback"
  if ($LASTEXITCODE -ne 0) {
    throw "Remote staging rollback failed; inspect the staging release evidence before retrying."
  }
  exit 0
}

$repositoryPath = (Resolve-Path -LiteralPath ".").Path.Replace("\", "/")
if (& git -c "safe.directory=$repositoryPath" status --porcelain --untracked-files=all) {
  throw "Refusing staging deploy from a dirty working tree. Commit or remove every change first."
}

& "$PSScriptRoot/verify-release-manifest.ps1" -Path $ReleaseManifestPath
if ($LASTEXITCODE -ne 0) {
  throw "Release manifest validation failed."
}

$releaseManifest = Get-Content -LiteralPath $ReleaseManifestPath -Raw | ConvertFrom-Json
$releaseId = "{0}-{1}" -f $releaseManifest.gitSha.Substring(0, 12), (Get-Date -Format "yyyyMMddHHmmss")
$remoteReleasePath = "$StagingRoot/releases/$releaseId"

Write-Host "Staging immutable release directory: ${HostName}:$remoteReleasePath"
& ssh $HostName "mkdir -p '$remoteReleasePath'"
if ($LASTEXITCODE -ne 0) {
  throw "Could not create the remote staging release directory."
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

& ssh $HostName "bash '$remoteReleasePath/scripts/deploy-staging-release.sh' --root '$StagingRoot' --env-file '$StagingEnvFile' --release-dir '$remoteReleasePath'"
if ($LASTEXITCODE -ne 0) {
  throw "Remote staging deploy failed; inspect $remoteReleasePath/deploy-evidence.txt and the automatic rollback evidence."
}

Write-Host "Staging release $releaseId is ready. Production was not targeted."
