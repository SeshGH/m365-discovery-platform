# Report Snapshots (Portal-derived exports)

This document defines the **Run Report Snapshot** concept that replaces legacy CSV/XLSX run summaries.

A Report Snapshot is a **derived, immutable export** of what the portal shows for a given run.

It is **not** a source of truth.

Source of truth remains:

Artefacts → Observed Checks → Findings → Reports (views)

---

## Goals

A Report Snapshot must:

* Be **portable** (attachable to customer records such as D365)
* Be **immutable** and **time-stamped**
* Be **non-interpretable** (no embedded logic)
* Preserve **traceability** back to observed checks
* Never mask **completeness / permission gaps**

---

## Non-goals

A Report Snapshot must **not**:

* Recompute metrics that belong in observed checks
* Contain new derived logic not present in findings
* Become a second UI with independent rules
* Replace artefacts, observed checks, or findings as evidence

---

## Run Report Snapshot contract (v1)

### Identity

* `reportType`: `run.snapshot`
* `reportVersion`: `1`
* `tenantId`: string
* `runId`: string
* `generatedAt`: ISO 8601 timestamp
* `generatedBy`: `portal` | `api`
* `sourceCommit`: optional git SHA (if available in runtime metadata)

### Scope metadata

* `tenant`:

  * `displayName` (if available)
  * `primaryDomain` (if available)
* `run`:

  * `startedAt`
  * `completedAt`
  * `status`
  * `profile`: `safe` | `full`

### Completeness & confidence (required)

* `completenessSummary`:

  * `isCompleteOverall`: boolean
  * `warnings`: array of { `type`, `message`, `observedCheckIds`[] }

Notes:

* Completeness is **reported**, not inferred.
* Warnings must reference supporting observed check IDs.

### Findings summary (required)

* `findingsByCategory`: ordered list of category sections

  * `category`: one of:

    * `security-posture`
    * `licensing-cost`
    * `operational-hygiene`
    * `migration-modernisation`
    * `discovery-completeness`
  * `items`: array of

    * `findingId`
    * `severity`
    * `title`
    * `summary`
    * `observedCheckRefs`: { `checkId` }[]

Notes:

* Category and ordering are **presentation aids**, not logic.
* Each finding must link back to observed checks.

### Optional appendix (v1, optional)

* `appendix`:

  * `observedCheckIndex`: { `checkId`, `collectorId`, `isComplete?`, `truncated?`, `permissionDenied?` }[]

---

## Export formats

### Primary: PDF

* The default export.
* Represents a **visual snapshot** of the portal view for the run.
* Must include:

  * Tenant + run metadata
  * Completeness/confidence section
  * Findings grouped by category
  * Traceability references (observed check IDs)

### Optional: HTML snapshot

* Portable, renderable snapshot of the portal report view.
* May be used as an internal intermediate for PDF generation.

---

## Storage semantics

Report Snapshots may be stored as artefacts for retrieval and audit.

Recommended artefact keys:

* `reports/run.snapshot.v1.pdf`
* `reports/run.snapshot.v1.html` (optional)

Rules:

* Snapshots are **immutable** once generated.
* Multiple generations are allowed **only** if versioned by timestamp or explicit revision key.

---

## Deprecation of legacy run summary reports

Legacy collectors:

* `report.runSummary.csv`
* `report.runSummary.xlsx`

are deprecated and should be:

1. Removed from **default run orchestration**
2. Retained temporarily for backwards compatibility (manual runs only), then
3. Deleted once the portal snapshot export is available and validated

---

## Invariants

* Runtime behaviour is authoritative.
* Collectors, artefact keys, and schemas are immutable contracts.
* Report snapshots are derived views only and must never become evidence.
