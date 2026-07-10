<#
Installs a per-user Codex account switcher.

Profiles are isolated through CODEX_HOME, so each one keeps its own auth.json.
No token is printed or stored in this repository.
#>
[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $HOME ".codex-accounts"),
  [string]$BinRoot = (Join-Path $HOME "bin"),
  [string]$InitialProfile = "personal"
)

$ErrorActionPreference = "Stop"

if ($InitialProfile -notmatch "^[a-zA-Z0-9][a-zA-Z0-9_-]*$") {
  throw "Profile name may contain only letters, digits, '_' and '-'."
}

New-Item -ItemType Directory -Force -Path $InstallRoot, $BinRoot | Out-Null

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($userPath -split ";" | Where-Object { $_ -eq $BinRoot }).Count -eq 0) {
  $newUserPath = if ([string]::IsNullOrWhiteSpace($userPath)) { $BinRoot } else { "$userPath;$BinRoot" }
  [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
}

$switcherPath = Join-Path $BinRoot "codex-account.ps1"

$switcher = @'
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet("list", "add", "use", "path")]
  [string]$Command = "list",
  [Parameter(Position = 1)]
  [string]$Profile,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CodexArgs
)

$ErrorActionPreference = "Stop"
$accountsRoot = Join-Path $HOME ".codex-accounts"
$sourceHome = Join-Path $HOME ".codex"

function Assert-ProfileName([string]$Name) {
  if ([string]::IsNullOrWhiteSpace($Name) -or $Name -notmatch "^[a-zA-Z0-9][a-zA-Z0-9_-]*$") {
    throw "Use a profile name containing only letters, digits, '_' and '-'."
  }
}

function Get-ProfilePath([string]$Name) {
  Assert-ProfileName $Name
  return (Join-Path $accountsRoot $Name)
}

function Copy-BaseSettings([string]$Destination) {
  $config = Join-Path $sourceHome "config.toml"
  if (Test-Path -LiteralPath $config) {
    Copy-Item -LiteralPath $config -Destination (Join-Path $Destination "config.toml") -Force
  }
}

function Get-CodexExecutable {
  $installed = Get-Command codex -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $installed) { return $installed.Source }

  $extensionRoot = Join-Path $HOME ".vscode\\extensions"
  $candidates = Get-ChildItem -LiteralPath $extensionRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "openai.chatgpt-*-win32-*" } |
    Sort-Object LastWriteTime -Descending |
    ForEach-Object {
      Get-ChildItem -LiteralPath (Join-Path $_.FullName "bin") -Recurse -Filter "codex.exe" -File -ErrorAction SilentlyContinue |
        Select-Object -First 1
    }

  $candidate = $candidates | Select-Object -First 1
  if ($null -ne $candidate) { return $candidate.FullName }

  throw "Codex CLI was not found. Install the Codex CLI or the OpenAI ChatGPT VS Code extension, then run this command again."
}

$codexExecutable = Get-CodexExecutable

switch ($Command) {
  "list" {
    if (-not (Test-Path -LiteralPath $accountsRoot)) {
      Write-Output "No Codex profiles. Add one with: codex-account add <name>"
      exit 0
    }
    Get-ChildItem -LiteralPath $accountsRoot -Directory | Sort-Object Name | ForEach-Object {
      $authorized = Test-Path -LiteralPath (Join-Path $_.FullName "auth.json")
      [PSCustomObject]@{ Profile = $_.Name; Authorized = if ($authorized) { "yes" } else { "no" }; Path = $_.FullName }
    } | Format-Table -AutoSize
  }
  "path" {
    $path = Get-ProfilePath $Profile
    Write-Output $path
  }
  "add" {
    Assert-ProfileName $Profile
    $path = Get-ProfilePath $Profile
    $authPath = Join-Path $path "auth.json"
    if (Test-Path -LiteralPath $authPath) { throw "Profile '$Profile' is already authorized. Use: codex-account use $Profile" }
    New-Item -ItemType Directory -Force -Path $path | Out-Null
    if (-not (Test-Path -LiteralPath (Join-Path $path "config.toml"))) {
      Copy-BaseSettings $path
    }
    Write-Host "Opening Codex login for profile '$Profile'..."
    $previousHome = $env:CODEX_HOME
    try {
      $env:CODEX_HOME = $path
      & $codexExecutable login
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
      $env:CODEX_HOME = $previousHome
    }
  }
  "use" {
    Assert-ProfileName $Profile
    $path = Get-ProfilePath $Profile
    if (-not (Test-Path -LiteralPath (Join-Path $path "auth.json"))) {
      throw "Profile '$Profile' is not authorized. Run: codex-account add $Profile"
    }
    $previousHome = $env:CODEX_HOME
    try {
      $env:CODEX_HOME = $path
      & $codexExecutable @CodexArgs
      exit $LASTEXITCODE
    } finally {
      $env:CODEX_HOME = $previousHome
    }
  }
}
'@

Set-Content -LiteralPath $switcherPath -Value $switcher -Encoding utf8

$commandPath = Join-Path $BinRoot "codex-account.cmd"
$command = "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0codex-account.ps1`" %*`r`n"
Set-Content -LiteralPath $commandPath -Value $command -Encoding ascii

$initialPath = Join-Path $InstallRoot $InitialProfile
if (-not (Test-Path -LiteralPath (Join-Path $initialPath "auth.json"))) {
  New-Item -ItemType Directory -Force -Path $initialPath | Out-Null
  $activeAuth = Join-Path $HOME ".codex\auth.json"
  if (-not (Test-Path -LiteralPath $activeAuth)) {
    throw "The current Codex account has no auth.json to import. Log in to Codex first."
  }
  Copy-Item -LiteralPath $activeAuth -Destination (Join-Path $initialPath "auth.json") -Force
  $activeConfig = Join-Path $HOME ".codex\config.toml"
  if (Test-Path -LiteralPath $activeConfig) {
    Copy-Item -LiteralPath $activeConfig -Destination (Join-Path $initialPath "config.toml") -Force
  }
}

Write-Host "Installed: $switcherPath"
Write-Host "Imported current signed-in account as: $InitialProfile"
Write-Host "Open a new terminal, then use: codex-account add work"
