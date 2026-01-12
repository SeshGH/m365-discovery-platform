# UI / Portal Groundwork (Contract-Driven)

## Purpose

This document defines how a future UI/portal should **consume and present existing API data** from the M365 Discovery Platform.

It does **not** introduce UI features or backend changes. It exists to:

* Prevent UI assumptions from leaking into backend contracts
* Provide stable view-model expectations for portal development
* Encode safe-by-default handling of artefacts and findings

All behaviour described here reflects **current implemented API behaviour**.

---

## Authoritative Sources

The UI must defer to the following documents:

* **Artefact & Report Contracts** — `docs/artefact-and-report-contracts.md`
* **Collectors** — `docs/collectors.md`
* **Runs & Jobs** — `docs/runs-and-jobs.md`

This document describes *how to consume*, not *what to change*.

---

## UI Domain Objects (View Models)

### Run (List View)

Derived from `GET /runs`.

UI fields:

* `id`
* `tenant.displayName`
* `status`
* `dataProfile` (safe | full)
* `createdAt`
* `startedAt`
* `endedAt`
* `counts.jobs`
* `counts.findings`
* `counts.artefacts`

Rules:

* Runs must be treated as immutable historical records
* `status` is derived server-side and must not be recalculated in the UI

---

### Run (Detail View)

Derived from:

* `GET /runs/:runId`
* `GET /runs/:runId/jobs`
* `GET /runs/:runId/findings`
* `GET /runs/:runId/artefacts`

UI sections:

* Run metadata
* Job execution timeline
* Findings summary
* Artefacts list

---

### Job

Derived from `GET /runs/:runId/jobs`.

UI fields:

* `id`
* `collectorId`
* `status`
* `attempts`
* `startedAt` (derived)
* `endedAt` (derived)
* `lastError` (if present)
* `counts.findings`
* `counts.artefacts`

Rules:

* Jobs are immutable once terminal
* `startedAt` / `endedAt` are derived values provided by the API
* UI must not infer job completion beyond `status`

---

### Finding

Derived from `GET /runs/:runId/findings`.

UI fields:

* `severity`
* `title`
* `description`
* `recommendation`
* `evidence`
* `references`

Rules:

* Findings are decision-ready signals, not raw data
* UI should avoid embedding artefact content directly into findings views

---

### Artefact

Derived from `GET /runs/:runId/artefacts`.

UI fields:

* `id`
* `type`
* `sizeBytes`
* `createdAt`
* `jobId`
* `filename` (derived from `key`)

Classification rules (from contract):

* **Raw**: inventory or evidence artefacts
* **Derived**: calculated summaries
* **Terminal**: reports intended for download

The UI must not assume ordering beyond `createdAt`.

---

## Safe vs Full Handling Rules

* UI must display `dataProfile` prominently at run level
* UI must never automatically fetch or render `.full.json` artefacts
* `.full.json` artefacts may only be downloaded via explicit user action
* Safe artefacts are the default UI-visible evidence layer

---

## Report Handling

* CSV and Excel reports are **terminal artefacts**
* Reports may not be immediately available due to job concurrency
* UI must tolerate temporary absence of report artefacts
* UI should communicate "report pending" rather than failure

Report collectors retry until prerequisites are met; the UI must not infer failure prematurely.

---

## Artefact Download Behaviour

Downloads use the following flow:

1. UI issues `GET /artefacts/:artefactId/download`
2. API responds with **HTTP 302 redirect**
3. Browser follows redirect to presigned object storage URL

Rules:

* UI must not expect a JSON body
* UI must tolerate short-lived URLs
* UI may read `X-Download-Expires-At` for informational purposes only

---

## Error Handling & Retry Semantics

* Transient states (running jobs, pending reports) are normal
* UI should poll read-only endpoints rather than retrying actions
* Failed jobs should be surfaced with `lastError`, not retried by UI

---

## Pagination & Ordering (Current State)

* `GET /runs` returns up to 50 runs (server-side limit)
* Other list endpoints are unpaginated (current behaviour)
* UI must not assume pagination guarantees

Future pagination changes must be treated as versioned API changes.

---

## Non-Goals (Explicit)

This document does **not**:

* Define UI layout or styling
* Introduce new API fields
* Change backend behaviour
* Define authentication or authorization models

---

## Stability Guarantees

UI implementations may safely rely on:

* Artefact key structure
* Terminal report filenames
* Safe vs full emission rules
* 302 redirect download behaviour

Any change to these requires explicit contract versioning.
