param(
  [string]$ApiUrl = "http://localhost:4000/v1",
  [string]$UserId = $env:TEMP_USER_ID
)

$ErrorActionPreference = "Stop"
if ($env:RUN_LIVE_GENERATION_SMOKE -ne "true") {
  throw "Set RUN_LIVE_GENERATION_SMOKE=true to run the credentialed generation smoke check."
}
if (-not $UserId) { throw "TEMP_USER_ID (or -UserId) is required." }
if (-not $env:INTERNAL_API_TOKEN) { throw "INTERNAL_API_TOKEN is required." }

$headers = @{ "x-user-id" = $UserId; "x-internal-token" = $env:INTERNAL_API_TOKEN; "content-type" = "application/json" }
$projectInput = @{ title = "Live generation smoke"; prompt = "Create a grounded ten-slide university presentation about the practical use of artificial intelligence in higher education, with a complete narration and sources."; scenario = "university_report"; level = "university_student"; mode = "with_sources"; slideCount = 10 } | ConvertTo-Json
$project = Invoke-RestMethod "$ApiUrl/projects" -Method Post -Headers $headers -Body $projectInput

Invoke-RestMethod "$ApiUrl/projects/$($project.id)/narration" -Method Post -Headers $headers | Out-Null
$deadline = (Get-Date).AddMinutes(12)
do {
  Start-Sleep -Seconds 3
  $current = Invoke-RestMethod "$ApiUrl/projects/$($project.id)" -Headers $headers
  if ($current.status -eq "failed") { throw "Narration recovery was exhausted; inspect protected worker telemetry." }
} while ($current.status -notin @("script_ready", "ready") -and (Get-Date) -lt $deadline)
if ($current.status -ne "script_ready") { throw "Narration did not become ready before the timeout." }

Invoke-RestMethod "$ApiUrl/projects/$($project.id)/narration" -Method Patch -Headers $headers -Body (@{ speechDraft = $current.speechDraft; accept = $true } | ConvertTo-Json) | Out-Null
do {
  Start-Sleep -Seconds 3
  $current = Invoke-RestMethod "$ApiUrl/projects/$($project.id)" -Headers $headers
  if ($current.status -eq "failed") { throw "Presentation recovery was exhausted; inspect protected worker telemetry." }
} while ($current.status -ne "ready" -and (Get-Date) -lt $deadline)

$document = $current.presentation.document
if ($current.status -ne "ready" -or $document.slides.Count -ne 10 -or -not $document.productionQualityGate) { throw "Released document did not pass the canonical readiness checks." }
if (-not $document.sources.Count -or -not $document.speechScript.Count) { throw "Released document is missing sources or narration." }

$export = Invoke-RestMethod "$ApiUrl/projects/$($project.id)/exports" -Method Post -Headers $headers -Body '{"type":"pptx"}'
Write-Host "Generation smoke passed: project=$($project.id) revision=$($current.presentationRevision) export=$($export.id)"
