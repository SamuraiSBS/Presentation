param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = "Stop"
$repositoryPath = (Resolve-Path -LiteralPath ".").Path.Replace("\\", "/")

if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
  throw "Release manifest not found: $Path"
}

$manifest = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
$head = (& git -c "safe.directory=$repositoryPath" rev-parse HEAD).Trim()
if ($manifest.gitSha -ne $head) {
  throw "Release manifest gitSha does not match HEAD ($head)."
}

if ($manifest.releaseGate -ne "passed") {
  throw "Release manifest does not prove a passed release gate."
}

if ($manifest.migrationCompatibility -ne "no-schema-change") {
  throw "Release manifest must prove the no-schema-change migration policy."
}

$requiredImages = @("api", "worker", "web")
foreach ($service in $requiredImages) {
  $imageReference = [string]$manifest.images.$service
  if ($imageReference -notmatch '^[a-z0-9][a-z0-9._/-]*(?::[0-9]+)?/[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$') {
    throw "Release manifest image '$service' must be a full immutable registry reference ending in @sha256:<digest>."
  }
}

Write-Host "Release manifest accepted for $head."
