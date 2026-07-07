param(
  [int]$Port = 3020,
  [switch]$DemoPreview
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not (Test-Path 'node_modules\.bin\next.cmd')) {
  throw 'Dependencies are missing. Run npm install first.'
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  throw "Port $Port is already in use. Run: npm run dev:web:fast -- -Port <free-port>"
}

# Next.js runs with apps/web as its workspace directory, while this project
# keeps local configuration in the repository root.
if (Test-Path '.env') {
  foreach ($line in Get-Content '.env') {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) {
      continue
    }

    $separator = $trimmed.IndexOf('=')
    if ($separator -lt 1) {
      continue
    }

    $name = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim()
    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    Set-Item -Path "Env:$name" -Value $value
  }
}

$env:INTERNAL_API_URL = 'http://localhost:4000'
$env:NEXTAUTH_URL = "http://localhost:$Port"
$env:PUBLIC_APP_URL = "http://localhost:$Port"
if ($DemoPreview) {
  $env:NEXT_PUBLIC_DEMO_PREVIEW = 'true'
}

Write-Host 'Building the small shared package once...'
npm run build -w @studydeck/shared
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Starting StudyDeck web with hot reload at http://localhost:$Port"
Write-Host 'UI changes under apps/web will appear without a Docker rebuild.'
Write-Host 'Keep the API available at http://localhost:4000.'
Write-Host ""

npm run dev -w @studydeck/web -- -p $Port
exit $LASTEXITCODE
