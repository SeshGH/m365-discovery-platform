# Discovery Coverage & Roadmap

This document defines the **intended discovery coverage**, **output lenses**, and **evolution path** of the M365 Discovery Platform.

It exists to:
- capture architectural intent
- prevent scope drift
- provide a shared reference for future development and discussion
- document *why* certain collectors and outputs exist (or are planned)

This is a **capability roadmap**, not an implementation backlog.

---

## Core principle

The platform is a **discovery engine**, not a report generator.

It collects **facts** (artefacts), derives **interpretations** (findings), and presents multiple views (lenses) over the same evidence depending on the use case.

Security posture is one output â€” not the only one.

---

## Discovery layers

### 1) Artefacts (evidence layer)

Artefacts are:
- raw, machine-readable outputs (JSON, CSV, XLSX, ZIP, etc.)
- immutable per run/job
- directly traceable to a specific job and run
- suitable for validation, debugging, audit, and downstream processing

Artefacts answer:
> â€œWhat exactly did we observe?â€

---

### 2) Findings (interpretation layer)

Findings are:
- normalised
- human-readable
- opinionated
- scored and prioritised

They are derived from artefacts and enriched with:
- severity
- confidence
- lifecycle status
- numeric score

Findings answer:
> â€œWhat does this mean, and how important is it?â€

The findings model is defined in:
- `docs/findings-model.md` (source of truth)

---

### 3) Summaries / Reports (view layer)

Reports are derived views over the same underlying evidence.

In the current iteration, we generate report artefacts via worker â€œreport collectorsâ€ so the portal/demo can download a single summary file per run.

Long-term direction:
- Reports should remain derived views (not new sources of truth).
- The UI should be able to generate or request reports without re-running discovery.

**Important behavioural note (current implementation):**
- Report collectors may **retry automatically** until all *non-report* jobs in the run have reached a terminal state (`succeeded` or `failed`).
- This prevents generating misleading â€œpartialâ€ summaries if report jobs are picked up early in an asynchronous worker model.
- This retry behaviour is an implementation detail for safety and demo correctness â€” it does **not** introduce a new architectural phase or source of truth.

---

## Output lenses

The same discovery run can be viewed through different lenses.

These lenses share collectors, artefacts, and findings â€” they differ only in aggregation, emphasis, and presentation.

---

## Lens 1: Security Posture

Focus:
- risk, misconfiguration, hygiene

Typical summary sections:
- posture score (future)
- findings by severity
- top risks
- privilege and access concerns
- audit and logging coverage
- identity and application security

---

## Lens 2: Migration / Take-on / Acquisition Scoping

Focus:
- inventory, complexity, delivery effort

Typical summary sections:
- tenant inventory (users, apps, workloads)
- complexity drivers
- unknowns and gaps
- likely workstreams
- scoping assumptions and risks

---

## Current discovery coverage (implemented)

| Area | Collector ID | Evidence (Artefacts) | Example Findings |
|---|---|---|---|
| Entra ID users | `entra.users` | `users-inventory.json` | e.g. sign-in activity unavailable (permission missing), inactivity/other signals as implemented |
| Enterprise app permissions | `entra.enterpriseApps.permissions` | `enterprise-app-permissions.json` | `ENTRA_EAP_001` high-privilege permissions; `ENTRA_EAP_002` scan truncated |
| Tenant auth validation | `entra.auth.test` | none | Tenant auth status is expressed via `TenantAuth` (not via findings) |

---

## Current reporting coverage (implemented)

Report collectors are executed as standard worker jobs to produce downloadable summary artefacts:

| Report | Collector ID | Artefact |
|---|---|---|
| Run summary (CSV) | `report.runSummary.csv` | `run-summary.csv` |
| Run summary (XLSX) | `report.runSummary.xlsx` | `run-summary.xlsx` |

Notes:
- Report jobs are enqueued last by the API for demo/UX value.
- Execution order is **not guaranteed** in a concurrent worker model.
- Report collectors therefore validate run completeness at execution time and may retry until safe to generate output.

Direction for XLSX:
- Evolve toward a â€œCloudGeezer-style workbookâ€ where each module/collector has its own sheet.
- Keep inventories as artefacts and/or referenced sheets; avoid duplicating huge datasets into findings.

---

## Local demo / validation workflow (PowerShell)

These snippets reflect the **actual API response shape** and PowerShell enumeration behaviour.

### Create a run

```powershell
Invoke-RestMethod "http://localhost:8080/runs" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{
    "tenantGuid": "00000000-0000-0000-0000-000000000000",
    "primaryDomain": "example.onmicrosoft.com",
    "triggeredBy": "manual",
    "modulesEnabled": {
      "entraUsers": true,
      "enterpriseAppPermissions": true
    }
  }'

### Inspect jobs for a run (PowerShell-safe)

    # Set explicitly to avoid stale values in the current session
    $runId = "<PASTE_RUN_ID_HERE>"
    $jobs = $null

    $jobs = Invoke-RestMethod "http://localhost:8080/runs/$runId/jobs" -ErrorAction Stop

    ($jobs | ForEach-Object { $_ } |
      Select-Object id, collectorId, status, attempts, lastError |
      ConvertTo-Json -Depth 5) | Out-String -Width 300

### Download report artefacts

- Report artefacts are stored per run/job (e.g. run-summary.csv, run-summary.xlsx)
- Download URLs are presigned and short-lived
- Always request a fresh presign URL immediately before download

