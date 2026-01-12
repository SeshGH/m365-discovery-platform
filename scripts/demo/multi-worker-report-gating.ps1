<#
.SYNOPSIS
  Demo harness: proves multi-worker concurrency + report gating retry semantics.

.DESCRIPTION
  - Starts API + two named workers (A/B) in separate PowerShell windows
  - Optionally injects DEMO_DELAY_EAP_MS to force a race (local-only)
  - Creates a run via the API
  - Polls jobs until terminal and prints PowerShell-safe JSON snapshots

.NOTES
  - Safe for demos (CDX demo tenant).
  - Does NOT change platform behaviour; it only automates a demo workflow.
  - Uses repo scripts: pnpm dev:api / pnpm dev:worker.

.EXAMPLE
  .\scripts\demo\multi-worker-report-gating.ps1 -TenantGuid "<GUID>" -PrimaryDomain "example.onmicrosoft.com" -DemoDelayEapMs 15000
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$TenantGuid,

  [Parameter(Mandatory = $true)]
  [string]$PrimaryDomain,

  [int]$DemoDelayEapMs = 15000,

  [string]$ApiBaseUrl = "http://localhost:8080",

  [int]$PollIntervalMs = 750,

  [int]$TimeoutSeconds = 90,

  [switch]$StopExistingFirst
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info([string]$msg) { Write-Host "[demo] $msg" }
function Write-Warn([string]$msg) { Write-Host "[demo] WARNING: $msg" -ForegroundColor Yellow }

# Repo root = location of this script -> scripts/demo -> repo root
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Start-PwshWindow {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$Command
  )

  # Opens a new PowerShell window and keeps it open (-NoExit) so you can see logs during the demo.
  Start-Process -FilePath "pwsh" -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location -LiteralPath '$repoRoot'; `$Host.UI.RawUI.WindowTitle = '$Title'; $Command"
  ) | Out-Null
}

function Wait-ForApi {
  param([int]$Seconds = 20)

  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $null = Invoke-RestMethod "$ApiBaseUrl/health" -Method Get -TimeoutSec 3
      return $true
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  return $false
}

Write-Info "Repo root: $repoRoot"
Write-Info "API base:  $ApiBaseUrl"

if ($StopExistingFirst) {
  Write-Info "Stopping existing API/worker processes via pnpm dev:stop..."
  & pnpm -C $repoRoot dev:stop | Out-Host
}

# Start API + 2 workers in separate windows for live log viewing
Write-Info "Starting API in a new window..."
Start-PwshWindow -Title "M365 Discovery API" -Command "pnpm dev:api"

Write-Info "Starting Worker A in a new window..."
$cmdA = @"
`$env:WORKER_NAME = 'A'
`$env:DEMO_DELAY_EAP_MS = '$DemoDelayEapMs'
pnpm dev:worker
"@
Start-PwshWindow -Title "M365 Discovery Worker A" -Command $cmdA

Write-Info "Starting Worker B in a new window..."
$cmdB = @"
`$env:WORKER_NAME = 'B'
`$env:DEMO_DELAY_EAP_MS = '$DemoDelayEapMs'
pnpm dev:worker
"@
Start-PwshWindow -Title "M365 Discovery Worker B" -Command $cmdB

Write-Info "Waiting for API health..."
if (-not (Wait-ForApi -Seconds 25)) {
  Write-Warn "API did not become healthy in time. Check the API window logs."
  throw "API not healthy"
}

Write-Info "Creating a run (tenantGuid=$TenantGuid, primaryDomain=$PrimaryDomain)..."

$body = @{
  tenantGuid     = $TenantGuid
  primaryDomain  = $PrimaryDomain
  triggeredBy    = "demo-script"
  modulesEnabled = @{
    entraUsers               = $true
    enterpriseAppPermissions = $true
  }
} | ConvertTo-Json -Depth 10

$r = Invoke-RestMethod "$ApiBaseUrl/runs" -Method Post -ContentType "application/json" -Body $body
$runId = $r.runId

Write-Info "Run created: $runId"
Write-Info "Polling jobs (interval=${PollIntervalMs}ms, timeout=${TimeoutSeconds}s)..."

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)

while ((Get-Date) -lt $deadline) {
  $jobs = Invoke-RestMethod "$ApiBaseUrl/runs/$runId/jobs" -ErrorAction Stop

  # PowerShell-safe: force enumeration, then print JSON snapshot
  ($jobs | ForEach-Object { $_ } |
    Select-Object collectorId, status, attempts, lockedBy, lockedAt, lastError |
    ConvertTo-Json -Depth 6) | Out-String -Width 300 | Write-Host

  $pending = @($jobs | Where-Object { $_.status -in @("queued", "running") }).Count
  if ($pending -eq 0) {
    Write-Info "Run jobs are terminal. Demo complete."
    Write-Info "Tip: Use /runs/$runId/artefacts to find report artefacts and download via presigned URL."
    return
  }

  Start-Sleep -Milliseconds $PollIntervalMs
}

throw "Timed out waiting for run $runId to complete. Check worker logs and /runs/$runId/jobs."
