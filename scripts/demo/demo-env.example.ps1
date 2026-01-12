<#
.SYNOPSIS
  Demo environment helper for the M365 Discovery Platform.

.DESCRIPTION
  Sets environment variables commonly used during demos so
  demo scripts can be run without repeatedly typing tenant details.

  This file is intentionally an EXAMPLE.
  Copy it to demo-env.ps1 (ignored by git) or dot-source it directly
  and replace placeholder values for your demo tenant.

.NOTES
  - Safe for local demos only.
  - Does NOT affect platform behaviour.
  - Intended for PowerShell sessions running demo scripts.

.EXAMPLE
  . .\scripts\demo\demo-env.example.ps1
  .\scripts\demo\multi-worker-report-gating.ps1 `
    -TenantGuid $env:TENANT_GUID `
    -PrimaryDomain $env:PRIMARY_DOMAIN
#>

Set-StrictMode -Version Latest

# ---------------------------
# Demo tenant configuration
# ---------------------------

# Entra tenant GUID (Directory ID)
$env:TENANT_GUID = "<TENANT_GUID_HERE>"

# Primary domain (e.g. contoso.onmicrosoft.com)
$env:PRIMARY_DOMAIN = "<PRIMARY_DOMAIN_HERE>"

# ---------------------------
# Optional demo tuning
# ---------------------------

# Artificial delay used by some collectors to force concurrency races
# (local demo only – safe to leave unset in production-style runs)
$env:DEMO_DELAY_EAP_MS = "15000"

Write-Host "[demo-env] Demo environment variables set:"
Write-Host "  TENANT_GUID        = $($env:TENANT_GUID)"
Write-Host "  PRIMARY_DOMAIN     = $($env:PRIMARY_DOMAIN)"
Write-Host "  DEMO_DELAY_EAP_MS  = $($env:DEMO_DELAY_EAP_MS)"
