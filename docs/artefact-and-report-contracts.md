# Artefact & Report Contracts

> **Authoritative contract – stable and versioned**
>
> This document defines the **evidence and reporting contracts** for the M365 Discovery Platform.
>
> It MUST stay aligned with:
>
> * `docs/collectors.md`
> * `docs/discovery-coverage-roadmap.md`
> * `docs/findings-observed-checks.md`
>
> Other documentation may explain behaviour, but **this file is the source of truth for artefact and report contracts**.

---

## Purpose

This document exists to:

* Define **stable artefact naming, shapes, and storage rules**
* Define **report artefacts and their guarantees**
* Protect downstream consumers (UI, reporting, automation) from breaking change
* Make demo-only behaviour explicit and non-binding

If something is unclear, **prefer being explicit over being clever**.

---

## Core principles

1. **Artefacts are evidence**

   * Immutable per run/job
   * Directly traceable to a collector execution
   * Never silently rewritten or inferred

2. **Reports are derived views**

   * Never a source of truth
   * Must tolerate missing or partial artefacts

3. **Stability over convenience**

   * Filenames, keys, and JSON shapes are contracts
   * Changes require explicit versioning or additive evolution

4. **Safe by default**

   * `safe` profile is always the default
   * `full` is explicit and opt-in

---

## Terminology

| Term          | Meaning                                                |
| ------------- | ------------------------------------------------------ |
| **Artefact**  | A stored evidence payload (JSON, CSV, XLSX, ZIP, etc.) |
| **Report**    | A derived artefact aggregating multiple artefacts      |
| **Collector** | Worker-executed module that emits evidence             |
| **Run**       | A single discovery execution                           |
| **Job**       | One collector execution within a run                   |

---

## Artefact storage model

Artefacts are uploaded to object storage (MinIO / S3-compatible) and referenced from the database.

### Required metadata (DB)

Each artefact record MUST include:

* `id`
* `runId`
* `jobId`
* `type`
* `bucket`
* `key`
* `sizeBytes`
* `hash` (if applicable)
* `createdAt`

### Storage rules

* Artefacts are **write-once**
* Artefacts are **never mutated** after upload
* Artefacts are **never deleted** as part of a run lifecycle

---

## Object storage key structure

All artefacts MUST follow this structure:

```
runs/{runId}/jobs/{jobId}/{filename}
```

Rules:

* `runId` and `jobId` MUST match database records
* `{filename}` is the contract surface exposed to consumers

---

## Artefact naming conventions

### General rules

* Filenames are **lowercase kebab-case**
* Extensions are meaningful (`.json`, `.csv`, `.xlsx`)
* Profile-specific artefacts use explicit suffixes

### Profile suffixes

| Profile | Suffix       |
| ------- | ------------ |
| safe    | `.safe.json` |
| full    | `.full.json` |

Legacy filenames MAY exist but must be documented and supported by reports.

---

## Implemented artefact contracts

### Entra Users

Collector ID: `entra.users`

Artefacts:

| Filename                    | Profile | Notes                   |
| --------------------------- | ------- | ----------------------- |
| `users-inventory.json`      | legacy  | Backwards compatibility |
| `users-inventory.safe.json` | safe    | Default safe export     |
| `users-inventory.full.json` | full    | PII-bearing export      |

Contract guarantees:

* JSON root is an object
* `summary` is always present
* `users[]` MAY be omitted in safe runs

---

### Enterprise App Permissions

Collector ID: `entra.enterpriseApps.permissions`

Artefacts:

| Filename                               | Profile | Notes                   |
| -------------------------------------- | ------- | ----------------------- |
| `enterprise-app-permissions.json`      | legacy  | Backwards compatibility |
| `enterprise-app-permissions.safe.json` | safe    | Default                 |
| `enterprise-app-permissions.full.json` | full    | Expanded export         |

Contract guarantees:

* `summary` MUST be present
* `apps[]` MAY be truncated
* Truncation MUST be surfaced in `summary.truncated`

---

### Conditional Access Policies

Collector ID: `entra.conditionalAccess.policies`

Artefacts:

| Filename                                | Profile | Notes           |
| --------------------------------------- | ------- | --------------- |
| `conditional-access-policies.safe.json` | safe    | Always emitted  |
| `conditional-access-policies.full.json` | full    | Explicit opt-in |

Rules:

* Reports MUST only consume **safe-compatible artefacts**
* Membership identifiers MUST NOT be relied upon

---

### Directory Roles & Privileged Assignments

Collector ID: `entra.directoryRoles.assignments`

Artefacts:

| Filename                                | Profile | Notes    |
| --------------------------------------- | ------- | -------- |
| `directory-roles-assignments.safe.json` | safe    | Default  |
| `directory-roles-assignments.full.json` | full    | Expanded |

Notes:

* No findings currently emitted
* Evidence is consumed by XLSX reporting only

---

### Exchange Online – Mailbox Inventory

Collector ID: `exchange.mailboxes.inventory`

Artefacts:

| Filename                                 | Profile | Notes                       |
| ---------------------------------------- | ------- | --------------------------- |
| `exchange-mailboxes-inventory.safe.json` | safe    | Counts, types, size buckets |
| `exchange-mailboxes-inventory.full.json` | full    | Per-mailbox inventory (PII) |

Contract guarantees:

* JSON root is an object
* `summary` MUST be present
* Safe artefact contains **no mailbox identifiers**
* Full artefact is emitted **only** when `dataProfile=full`
* Partial or permission-limited data MUST surface via completeness signals

---

## Report artefact contracts

Reports are implemented as **report collectors**.

### Run Summary – CSV

Collector ID: `report.runSummary.csv`

Artefact:

* `run-summary.csv`

Guarantees:

* One row per run
* Summary-level counts only
* CSV completeness may lag XLSX

---

### Run Summary – XLSX

Collector ID: `report.runSummary.xlsx`

Artefact:

* `run-summary.xlsx`

Guarantees:

* Multi-sheet workbook
* Human-readable
* Derived from artefacts, observed checks, and findings
* Must tolerate missing artefacts

Sheets MAY include:

* Run Summary
* Jobs
* Findings
* Observed Checks
* Artefacts
* Module-specific sheets (Users, Enterprise Apps, CA, Directory Roles, Exchange)

---

## Report execution rules

* Reports MAY execute before all jobs complete
* Reports MUST verify readiness (`assertReportReadyOrThrow`)
* If unsafe to generate:

  * No artefact is produced
  * Job is retried automatically

This behaviour is intentional and **not orchestration logic**.

---

## Artefact download contract

* API never streams artefacts directly
* Download endpoints return **HTTP 302 redirects**
* Redirect targets are **pre-signed URLs** with expiry

This protects API scalability and security.

---

## Demo-only constraints

The following are **explicitly demo-only** and NOT long-term guarantees:

* Enumeration caps
* Truncation limits
* Reduced scopes

Demo constraints MUST surface as:

* `truncated` flags
* completeness notes

They MUST NOT silently alter artefact shape.

---

## Change management

Any change to this document requires:

* Explicit review
* Confirmation against:

  * `collectors.md`
  * `discovery-coverage-roadmap.md`
* Clear statement of backward compatibility impact

If in doubt:

> **Do not break contracts. Add new ones.**

---

## Versioning & Breaking Change Policy

This document defines **stable contracts**. Any change that alters meaning, shape, or guarantees is considered a **breaking change** and must be explicitly versioned and communicated.

### What counts as a breaking change

The following **MUST NOT** change without a version bump and migration plan:

* Artefact key structure (`runs/{runId}/jobs/{jobId}/{filename}`)
* Filename conventions and suffix semantics (`.safe.json`, `.full.json`)
* Safe vs full emission rules
* JSON shape of documented artefacts
* Report sheet names, column meanings, or removal of existing sheets
* Download behaviour (302 redirect, presigned URL semantics)

### What is allowed without versioning

The following are **non-breaking** and may evolve:

* Additional artefacts or sheets (append-only)
* Additional fields added to existing artefacts (never removing or reinterpreting fields)
* New collectors or observed checks
* New reports derived from existing artefacts

### Contract discipline

* Artefacts are **append-only evidence**
* Observed checks are **stable factual records**
* Findings may evolve independently

If behaviour and documentation diverge, **runtime behaviour wins** and documentation must be corrected immediately.
