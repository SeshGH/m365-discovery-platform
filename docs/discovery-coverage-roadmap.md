# Discovery Coverage & Roadmap

This document defines the **intended discovery coverage**, **output lenses**, and **evolution path** of the M365 Discovery Platform.

It exists to:

* capture architectural intent
* prevent scope drift
* provide a shared reference for future development and discussion
* document why certain collectors and outputs exist (or are planned)

This is a **capability roadmap**, not an implementation backlog.

---

## Core principle

The platform is a **discovery engine**, not a report generator.

It collects **facts** (artefacts), derives **signals** (findings), and presents multiple views (lenses) over the same evidence depending on the use case.

Security posture is one output — not the only one.

---

## Discovery layers

### 1) Artefacts (evidence layer)

Artefacts are:

* raw, machine-readable outputs (JSON, CSV, XLSX, ZIP, etc.)
* immutable per run/job
* directly traceable to a specific job and run
* suitable for validation, debugging, audit, and downstream processing

Artefacts answer:

> “What exactly did we observe?”

Authoritative contracts:

* `docs/artefact-and-report-contracts.md`
* `docs/artefacts.md` (overview; defers to contracts)

---

### 2) Findings (interpretation layer)

Findings are:

* small, decision-ready signals
* human-readable and prioritised by severity
* traceable to a run and producing job

They answer:

> “What does this mean, and how important is it?”

Important:

* The platform’s **implemented** findings contract today includes `checkId`, `severity`, and descriptive fields.
* Additional taxonomy concepts (category/confidence/status/score) are **future-facing** and must not be assumed to exist in API payloads until implemented.

The findings model is defined in:

* `docs/findings-model.md` (source of truth)

Implemented check IDs are listed in:

* `docs/findings-registry.md`

---

### 3) Summaries / Reports (view layer)

Reports are derived views over the same underlying evidence.

In the current iteration, report artefacts are generated via worker “report collectors” so a portal/demo can download a small number of summary outputs per run.

Long-term direction:

* Reports remain derived views (not new sources of truth).
* The UI should be able to request/generate views over stored evidence without re-running discovery.

Implementation note (current behaviour):

* Report collectors may **retry automatically** until all non-report jobs in the run have reached a terminal state (`succeeded` or `failed`).
* This prevents generating misleading partial summaries if report jobs are picked up early in an asynchronous worker model.
* This retry behaviour is a safety mechanism; it does not introduce a new architectural phase or source of truth.

---

## Output lenses

The same discovery run can be viewed through different lenses.

These lenses share collectors, artefacts, and findings — they differ only in aggregation, emphasis, and presentation.

---

## Lens 1: Security posture

Focus:

* risk, misconfiguration, hygiene

Typical summary sections:

* findings by severity
* top risks
* privilege and access concerns
* audit and logging coverage
* identity and application security

---

## Lens 2: Migration / take-on / acquisition scoping

Focus:

* inventory, complexity, delivery effort

Typical summary sections:

* tenant inventory (users, apps, workloads)
* complexity drivers
* unknowns and gaps
* likely workstreams
* scoping assumptions and risks

---

## Current discovery coverage (implemented)

| Area                       | Collector ID                       | Evidence (Artefacts)                                                                | Implemented Finding IDs                                 |
| -------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Entra ID users             | `entra.users`                      | `users-inventory.json` (safe) and profile-aware variants (see contracts)            | `ENTRA_USERS_001`                                       |
| Enterprise app permissions | `entra.enterpriseApps.permissions` | `enterprise-app-permissions.json` (safe) and profile-aware variants (see contracts) | `ENTRA_EAP_001`, `ENTRA_EAP_002`                        |
| Tenant auth validation     | `entra.auth.test`                  | none                                                                                | none (tenant auth status is expressed via `TenantAuth`) |

Notes:

* Implemented finding IDs and meanings are tracked in `docs/findings-registry.md`.
* Artefact filenames and profile behaviour are defined in `docs/artefact-and-report-contracts.md`.
* **Profile enforcement is hardened at collector level**: only an explicit `dataProfile = "full"` enables PII-bearing artefacts; any unknown or missing value is treated as `safe`.

---

## Current reporting coverage (implemented)

Report collectors are executed as standard worker jobs to produce downloadable terminal artefacts:

| Report             | Collector ID             | Artefact (filename) |
| ------------------ | ------------------------ | ------------------- |
| Run summary (CSV)  | `report.runSummary.csv`  | `run-summary.csv`   |
| Run summary (XLSX) | `report.runSummary.xlsx` | `run-summary.xlsx`  |

Notes:

* Report jobs are enqueued last by the API for demo/UX value.
* Execution order is **not guaranteed** in a concurrent worker model.
* Report collectors validate run completeness at execution time and may retry until safe to generate output.

Direction for XLSX:

* Evolve toward a CloudGeezer-style workbook where each module/collector has its own sheet.
* Keep inventories as artefacts and/or referenced sheets; avoid duplicating large datasets into findings.

---

## Demo-only constraints (must not be treated as long-term behaviour)

The demo tenant and demo harness may apply limits that are explicitly not architectural guarantees.

Examples:

* Enterprise app enumeration caps (e.g. `ENTAPP_MAX_APPS`) causing truncation signals such as `ENTRA_EAP_002`.

Rule:

* Any demo-only limit must be documented as demo-only and surfaced as a data completeness signal (finding and/or report note).

---

## Local demo / validation workflow (PowerShell)

These snippets reflect the actual API response shape and PowerShell enumeration behaviour.

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
```

### Inspect jobs for a run (PowerShell-safe)

```powershell
# Set explicitly to avoid stale values in the current session
$runId = "<PASTE_RUN_ID_HERE>"
$jobs = $null

$jobs = Invoke-RestMethod "http://localhost:8080/runs/$runId/jobs" -ErrorAction Stop

($jobs | ForEach-Object { $_ } |
  Select-Object id, collectorId, status, attempts, lastError |
  ConvertTo-Json -Depth 5) | Out-String -Width 300
```

### Download report artefacts

Downloads use `GET /artefacts/:artefactId/download`.

The API responds with an HTTP **302 redirect** to a short-lived presigned URL.

Always request the download immediately before retrieving the file.
