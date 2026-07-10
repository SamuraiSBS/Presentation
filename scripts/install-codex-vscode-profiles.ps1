<#
Creates VS Code launch profiles for separate Codex accounts and desktop shortcuts.
Each profile starts from the current VS Code user state, while CODEX_HOME selects
only the Codex account used by the extension and its local backend.
#>
[CmdletBinding()]
param(
  [string[]]$Profiles = @("personal", "work"),
  [string]$ProfilesRoot = (Join-Path $HOME ".vscode-codex-profiles"),
  [string]$BinRoot = (Join-Path $HOME "bin")
)

$ErrorActionPreference = "Stop"
$baseUserData = Join-Path $env:APPDATA "Code\User"

function Assert-ProfileName([string]$Name) {
  if ([string]::IsNullOrWhiteSpace($Name) -or $Name -notmatch "^[a-zA-Z0-9][a-zA-Z0-9_-]*$") {
    throw "Profile name may contain only letters, digits, '_' and '-'."
  }
}

New-Item -ItemType Directory -Force -Path $ProfilesRoot, $BinRoot | Out-Null

function Initialize-VSCodeProfile([string]$Destination) {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $destinationUserData = Join-Path $Destination "User"
  $initializedMarker = Join-Path $Destination ".copied-from-default-profile"
  if ((Test-Path -LiteralPath $baseUserData) -and -not (Test-Path -LiteralPath $initializedMarker)) {
    New-Item -ItemType Directory -Force -Path $destinationUserData | Out-Null
    Copy-VSCodeState -Source $baseUserData -Destination $destinationUserData
    New-Item -ItemType File -Force -Path $initializedMarker | Out-Null
  }
}

function Copy-VSCodeState([string]$Source, [string]$Destination) {
  Get-ChildItem -LiteralPath $Source -Force -ErrorAction SilentlyContinue | ForEach-Object {
    $target = Join-Path $Destination $_.Name
    try {
      if ($_.PSIsContainer) {
        New-Item -ItemType Directory -Force -Path $target | Out-Null
        Copy-VSCodeState -Source $_.FullName -Destination $target
      } else {
        Copy-Item -LiteralPath $_.FullName -Destination $target -Force
      }
    } catch {
      Write-Warning "Skipped a busy VS Code state file: $($_.FullName)"
    }
  }
}

$launcherPath = Join-Path $BinRoot "codex-vscode.ps1"
$launcher = @'
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$ProfileName,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CodeArgs
)

$ErrorActionPreference = "Stop"

if ($ProfileName -notmatch "^[a-zA-Z0-9][a-zA-Z0-9_-]*$") {
  throw "Profile name may contain only letters, digits, '_' and '-'."
}

function Get-VSCodeCommand {
  $command = Get-Command code -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $command) { return $command.Source }

  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code\Code.exe"),
    (Join-Path $env:ProgramFiles "Microsoft VS Code\Code.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft VS Code\Code.exe")
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  if ($candidates.Count -gt 0) { return $candidates[0] }
  throw "VS Code was not found. Install VS Code or add its 'code' command to PATH."
}

$profilesRoot = Join-Path $HOME ".vscode-codex-profiles"
$dataDir = Join-Path $profilesRoot $ProfileName
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$codexHome = Join-Path (Join-Path $HOME ".codex-accounts") $ProfileName
New-Item -ItemType Directory -Force -Path $codexHome | Out-Null

$code = Get-VSCodeCommand
$previousCodexHome = $env:CODEX_HOME
try {
  $env:CODEX_HOME = $codexHome
  & $code "--user-data-dir=$dataDir" "--new-window" @CodeArgs
} finally {
  $env:CODEX_HOME = $previousCodexHome
}
'@
Set-Content -LiteralPath $launcherPath -Value $launcher -Encoding utf8

$desktop = [Environment]::GetFolderPath("DesktopDirectory")
$shell = New-Object -ComObject WScript.Shell

foreach ($profile in $Profiles) {
  Assert-ProfileName $profile
  $dataDir = Join-Path $ProfilesRoot $profile
  Initialize-VSCodeProfile $dataDir

  $shortcutPath = Join-Path $desktop "VS Code - Codex $profile.lnk"
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$launcherPath`" `"$profile`""
  $shortcut.WorkingDirectory = $HOME
  $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll, 167"
  $shortcut.Description = "VS Code with Codex account profile: $profile"
  $shortcut.Save()
}

Write-Host "Installed VS Code Codex profiles: $($Profiles -join ', ')"
Write-Host "Desktop shortcuts were created in: $desktop"
Write-Host "The current VS Code settings and extension state were copied to each profile."
Write-Host "Codex uses its matching CODEX_HOME profile: ~/.codex-accounts/<profile>."
