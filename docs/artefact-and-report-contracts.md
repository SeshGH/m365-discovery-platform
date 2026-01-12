# Artefact & Report Contracts

## Purpose

This document defines **stable, enforceable contracts** for artefacts and reports produced by the M365 Discovery Platform. It is the **authoritative source of truth** for:

* Artefact classification and lifecycle
* Bucket/key naming guarantees
* Safe vs full data handling rules
* Reporting outputs and consumption expectations
* Demo-only behaviour

This document describes **current behaviour as implemented**. It does **not** introduce new features or change runtime behaviour.

---

## Global Artefact Model

### Artefact Classes

Artefacts fall into exactly one of the following classes:

| Class        | Definition                                                                             |
| ------------ | -------------------------------------------------------------------------------------- |
| **Raw**      | Direct collector outputs derived from tenant data (profile-aware)                      |
| **Derived**  | Secondary artefacts calculated from raw artefacts (non-terminal)                       |
| **Terminal** | Final outputs intended for human or UI consumption; never consumed by other collectors |

---

## Storage Contract

### Bucket

* Bucket name: `process.env.S3_BUCKET ?? "artefacts"`
* Single shared bucket for all runs

### Key Structure (Guaranteed)

All artefacts are written using the following immutable key format:

```
runs/{runId}/jobs/{jobId}/{filename}
```

Where:

* `runId` = owning run ID
* `jobId` = job that produced the artefact
* `filename` = collector-defined filename

**Guarantees**:

* Keys are deterministic
* Artefacts are immutable per job
* Collectors must not overwrite artefacts

---

## Safe vs Full Data Profile Rules

### General Rules

* `dataProfile` is inherited from the run and persisted in job payloads
* Default behaviour is **safe-by-design**
* Collectors **must never emit sensitive data** when `dataProfile === "safe"`

### Filename Signalling

Collectors may use filename suffixes to indicate sensitivity:

* `.full.json` → explicitly PII-bearing
* `.safe.json` → non-sensitive snapshot produced during a full run

Absence of suffix implies **safe-mode compatible output**.

---

## Collector Artefact Contracts

### `entra.users` (Raw / Derived)

| Profile | Filename                    | Class   | Notes                      |
| ------- | --------------------------- | ------- | -------------------------- |
| safe    | `users-inventory.json`      | Derived | Counts-only, no PII        |
| full    | `users-inventory.safe.json` | Derived | Counts-only snapshot       |
| full    | `users-inventory.full.json` | Raw     | PII-bearing user inventory |

**Important**:

* Safe runs never emit PII
* Full runs emit both safe and full artefacts

---

### `entra.enterpriseApps.permissions` (Raw)

| Profile | Filename                               | Class |
| ------- | -------------------------------------- | ----- |
| safe    | `enterprise-app-permissions.json`      | Raw   |
| full    | `enterprise-app-permissions.full.json` | Raw   |

#### Demo-only behaviour

* Application enumeration is capped via `ENTAPP_MAX_APPS` (default: 50)
* Truncation is surfaced in artefact metadata and reports
* Limits are **explicitly demo-only** and must not be relied upon long-term

---

## Reporting Artefacts (Terminal)

### Run Summary CSV

* Filename: `run-summary.csv`
* Class: **Terminal**

Includes:

* run metadata
* derived status
* timestamps and durations
* job and artefact counts
* **dataProfile**

---

### Run Summary Excel

* Filename: `run-summary.xlsx`
* Class: **Terminal**

Sheets:

* Overview
* Jobs
* Artefacts
* Users (if safe user artefact present)
* Enterprise Apps (if artefact present)
* Optional per-collector summary (demo-only convenience)

**Consumption rules**:

* Only safe-compatible artefacts are auto-loaded
* `.full.json` artefacts are never implicitly consumed
* Missing or invalid artefacts degrade gracefully with notes

---

## Artefact Download API Contract

### Routes

* `GET /artefacts/:artefactId/download`
* `GET /runs/:runId/artefacts/:artefactId/download` (backward compatibility)

### Behaviour

* API responds with **HTTP 302 redirect** to a presigned S3/MinIO URL
* Response includes `X-Download-Expires-At` header
* No JSON body is returned

This behaviour is **intentional and stable**.

---

## Stability Guarantees

The following are considered **breaking changes** and must not be made without explicit versioning:

* Artefact key structure
* Filename conventions
* Safe vs full emission rules
* Report column/sheet guarantees
* Download redirect behaviour

---

## Relationship to Other Docs

* `docs/artefacts.md` → descriptive overview only; defers to this contract
* `docs/collectors.md` → collector responsibilities; defers to this contract
* `README.md` → high-level summary; must not redefine behaviour

This document is the **single authoritative contract** for artefacts and reports.
