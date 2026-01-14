# Demo Runbook – M365 Discovery Platform

This document provides a **repeatable, step-by-step runbook** for internal consultants and technical pre-sales staff to demo and validate the M365 Discovery Platform.

It is intentionally:

* explicit
* PowerShell-first
* aligned to *implemented behaviour*, not future intent

This is **not** a customer-facing guide.

---

## Purpose of this runbook

Use this runbook to:

* demonstrate end-to-end discovery on a tenant
* validate collector behaviour (safe vs full)
* produce artefacts and reports for walkthroughs
* support internal demos and dry-runs before customer engagement

---

## Assumptions

* You are running locally on Windows
* API and worker are running
* Postgres and MinIO are running via Docker Compose
* You are using a **safe Microsoft CDX demo tenant** or another approved test tenant

---

## Start the platform (local)

> **Demo note:** For demos, the UI should be the *primary* interaction surface. PowerShell commands below are provided to explain or validate what the UI is doing under the hood.

From repo root:

```powershell
docker compose up -d
```

Start API and worker in separate terminals:

```powershell
pnpm dev:api
```

```powershell
pnpm dev:worker
```

---

## Create a SAFE discovery run (UI-first)

### Using the demo portal (recommended for demos)

1. Open the demo UI: `http://localhost:8080/demo`
2. In **Create Run**:

   * Enter **Tenant GUID** and **Primary Domain**
   * Set **Triggered by** to something descriptive (e.g. `portal-demo`)
   * Leave **Data profile** set to `safe` (default)
   * Enable desired modules (e.g. **Entra Users**, **Enterprise App Permissions**)
3. Click **Create run**

You should immediately see:

* A new run ID
* Jobs appearing and transitioning through `queued` → `running` → `succeeded`

Use this view to narrate:

* concurrency
* job isolation
* retry behaviour

### What the UI is doing under the hood (for validation)

The portal issues a POST to `/runs` with a payload equivalent to:

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:8080/runs" `
  -ContentType "application/json" `
  -Body (@{
    tenantGuid    = "<TENANT_GUID>"
    primaryDomain = "<TENANT_PRIMARY_DOMAIN>"
    triggeredBy   = "portal-demo"
    dataProfile   = "safe"
    modulesEnabled = @{
      entraUsers = $true
      enterpriseAppPermissions = $true
    }
  } | ConvertTo-Json)
```

---

## Monitor job execution (UI-first)

### Using the demo portal

* Observe job rows updating live under the run
* Point out:

  * collector IDs
  * attempts
  * that report jobs may wait or retry until non-report jobs complete

This visual flow is the **primary demo artefact** for orchestration behaviour.

### PowerShell validation (optional)

```powershell
$runId = "<PASTE_RUN_ID>"

Invoke-RestMethod "http://localhost:8080/runs/$runId/jobs" |
  ConvertTo-Json -Depth 50 |
  Out-String -Width 300
```

---

## Inspect artefacts (SAFE)

```powershell
Invoke-RestMethod "http://localhost:8080/runs/$runId/artefacts" |
  ConvertTo-Json -Depth 50 |
  Out-String -Width 300
```

Expected artefacts:

* `users-inventory.json` (safe)
* `enterprise-app-permissions.json` (safe)
* `run-summary.csv`
* `run-summary.xlsx`

---

## Download artefacts (UI gap + validation)

### Current state (important to call out in demos)

* The demo portal **does not yet expose artefact download links**
* This is intentional technical debt, not an API limitation

For demos, explicitly say:

> “The API already supports secure, time-limited downloads — the UI wiring is pending.”

### Validate artefacts exist

```powershell
$runId = "<PASTE_RUN_ID>"

Invoke-RestMethod "http://localhost:8080/runs/$runId/artefacts" |
  ConvertTo-Json -Depth 50 |
  Out-String -Width 300
```

### Validate redirect-based download

```powershell
$artefactId = "<PASTE_ARTEFACT_ID>"

try {
  Invoke-WebRequest -MaximumRedirection 0 "http://localhost:8080/artefacts/$artefactId/download" -ErrorAction Stop
} catch {
  $_.Exception.Response.StatusCode.value__ | Out-String
  $_.Exception.Response.Headers | Out-String -Width 300
}
```

Expected:

* HTTP **302**
* `Location` header with presigned URL
* `x-download-expires-at` header
