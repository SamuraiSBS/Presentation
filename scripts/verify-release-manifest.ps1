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

& node (Join-Path $repositoryPath "scripts/validate-release-manifest.mjs") --manifest $Path --repository $repositoryPath
if ($LASTEXITCODE -ne 0) {
  throw "Release manifest compatibility or image validation failed."
}

Write-Host "Release manifest accepted for $head."
