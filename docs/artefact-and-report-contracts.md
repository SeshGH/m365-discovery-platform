# Artefact & Report Contracts

## Purpose

This document defines **stable, enforceable contracts** for artefacts and reports produced by the M365 Discovery Platform. It is the **authoritative source of truth** for:

* Artefact classification and lifecycle
* Bucket and key naming guarantees
* Safe vs full data handling rules
* Reporting outputs and consumption expectations
* Demo-only behaviour boundaries

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

### `entra.users`

| Profile | Filename                    | Class   | Notes                |
| ------- | --------------------------- | ------- | -------------------- |
| safe    | `users-inventory.json`      | Derived | Counts-only, no PII  |
| full    | `users-inventory.safe.json` | Derived | Counts-only snapshot |
| full    | `users-inventory.full.json` | Raw     | PII-bearing          |

Rules:

* Safe runs never emit PII
* Full runs emit both safe and full artefacts

---

### `entra.enterpriseApps.permissions`

| Profile | Filename                               | Class |
| ------- | -------------------------------------- | ----- |
| safe    | `enterprise-app-permissions.json`      | Raw   |
| full    | `enterprise-app-permissions.full.json` | Raw   |

Demo-only behaviour:

* Enumeration capped via `ENTAPP_MAX_APPS` (default: 50)
* Truncation is explicitly surfaced

---

### `entra.conditionalAccess.policies`

| Profile | Filename                                | Class | Notes                     |
| ------- | --------------------------------------- | ----- | ------------------------- |
| safe    | `conditional-access-policies.safe.json` | Raw   | No membership identifiers |
| full    | `conditional-access-policies.full.json` | Raw   | PII-bearing               |

Rules:

* Safe runs emit only the safe artefact
* Full runs emit both safe and full artefacts

---

### `entra.directoryRoles.assignments`

| Profile | Filename                                | Class | Notes            |
| ------- | --------------------------------------- | ----- | ---------------- |
| safe    | `directory-roles-assignments.safe.json` | Raw   | Role counts only |
| full    | `directory-roles-assignments.full.json` | Raw   | PII-bearing      |

Rules:

* Safe artefacts contain no user identifiers
* Full artefacts may contain PII

---

## Reporting Artefacts (Terminal)

### Run Summary CSV

* Filename: `run-summary.csv`
* Class: **Terminal**

Includes:

* Run metadata
* Derived run status
* Job and artefact counts
* `dataProfile`

---

### Run Summary Excel

* Filename: `run-summary.xlsx`
* Class: **Terminal**

Primary human-facing report.

Current sheets:

* Run Summary
* Jobs
* Findings
* Observed Checks
* Artefacts
* Users (Summary)
* Users (Full)
* Enterprise Apps (Perms)
* Conditional Access
* Directory Roles

Rules:

* Reports degrade gracefully when artefacts are missing
* Only safe-compatible artefacts are implicitly consumed
* `.full.json` artefacts are never implicitly consumed

---

## Artefact Download API Contract

Routes:

* `GET /artefacts/:artefactId/download`
* `GET /runs/:runId/artefacts/:artefactId/download`

Behaviour:

* API returns **HTTP 302 redirect** to a presigned URL
* `X-Download-Expires-At` header is included
* Artefact content is never streamed via API

---

## Stability Guarantees

The following are **breaking changes** and require explicit versioning:

* Artefact key structure
* Filename conventions
* Safe vs full emission rules
* Report sheet names or layout
* Download redirect behaviour

---

## Related Documentation

* `docs/collectors.md`
* `docs/findings-model.md`
* `docs/discovery-coverage-roadmap.md`

This document is the **single source of truth** for artefact and report contracts.
