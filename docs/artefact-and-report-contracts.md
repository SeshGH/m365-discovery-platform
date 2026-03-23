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

#### Safe artefact shape (stable)

Root object:

* `capturedAt` (ISO string)
* `tenant.tenantId`
* `dataProfile`: `"safe"`
* `completeness` — `isComplete`, `truncated`, `permissionDenied[]`, `slicesAttempted[]`, `slicesCompleted[]`, `notes[]`
* `summary`:

  * `roleDefinitionsCount` — total role templates in tenant
  * `activatedRolesCount` — enabled roles returned by `/directoryRoles`
  * `scannedRolesCount` — roles actually enumerated (may be capped)
  * `rolesWithAnyActiveAssignmentCount`
  * `activeAssignmentsCount`
  * `globalAdminCount` — active Global Administrator assignments (additive field; `0` if role not found or permissionDenied)
  * `assignmentPrincipalTypeCounts` — `{ user, group, servicePrincipal, unknown }`
  * `truncated`, `maxRoles`, `concurrency`
  * `pim` — `{ attempted, succeeded, eligibleAssignmentsCount }`
* `roles[]` (safe) — per-role `{ roleId, roleTemplateId, roleDisplayName, assignmentCounts: { total, user, group, servicePrincipal, unknown } }`

#### Full artefact additions

* `tenant` extended with `primaryDomain`, `displayName`
* `dataProfile`: `"full"`
* `roles[]` (full) — per-role `{ roleId, roleTemplateId, roleDisplayName, assignments: [{ assignmentType, principalType, principal: { id, odataType, displayName, userPrincipalName, mail, appId, servicePrincipalType } }] }`

Notes:

* Evidence is consumed by XLSX reporting and run-metrics derivation layer
* Completeness is surfaced via observed checks (`ENTRA_DIRROLES_OBS_005`), not findings
* `globalAdminCount` also available on `ENTRA_DIRROLES_OBS_001` for lightweight UI derivation

---

## Exchange Online – Mailbox Inventory (exchange.mailboxes.inventory)

### Artefacts

#### `exchange-mailboxes-inventory.safe.json`

**Purpose:** Safe, non-PII, Graph-first mailbox sizing summary.

**Shape (stable):**

* `generatedAt` (ISO string)
* `profile`: `"safe"`
* `completeness`:

  * `isComplete` (boolean)
  * `truncated` (boolean)
  * `permissionDenied` (string[])
  * `slicesAttempted` (string[])
  * `slicesCompleted` (string[])
  * `notes` (string[])
  * `implemented` (boolean)
* `summary`:

  * `totalMailboxes` (number|null)
  * `byType` (object|null)
  * `byState` (object|null)
  * `sizeBuckets`:

    * `under1GB` (number|null)
    * `1to10GB` (number|null)
    * `10to50GB` (number|null)
    * `40to50GB` (number|null)
      *Count of mailboxes in the 40–50GB range (proactive sizing).*
    * `over50GB` (number|null)
  * `dataProfile`: `"safe"|"full"` (string)
  * `fullExported` (boolean)
* `mailboxFeatures` (object|null)

**Graph-first behaviour (important):**

* When running **Graph-only** (Linux/container compatible), the collector intentionally does **not** populate:

  * `summary.byType`
  * `summary.byState`
  * `mailboxFeatures`

These fields are set to `null` and must be treated as **explicit completeness signals** (not silent omissions).

#### `exchange-mailboxes-inventory.full.json`

Everything in the SAFE artefact plus:

* `profile`: `"full"`
* `mailboxUsageDetail`: array of **FULL-only** rows (PII allowed)

  * `userPrincipalName` (string)
  * `displayName` (string)
  * `storageUsedBytes` (number|null)
  * `storageUsedGb` (number|null)
  * `isDeleted` (boolean|null)
  * `reportPeriod` (string, e.g. `"D7"`)

**Data source note:** `sizeBuckets` and `mailboxUsageDetail` are derived from Microsoft Graph mailbox usage reports (CSV). This dataset may be delayed relative to real time.

---

## report.runSummary.xlsx (Excel)

### Exchange Online sheets

The Excel report includes two Exchange sheets when Exchange mailbox artefacts are present:

#### Sheet: **Exchange Mailboxes (Summary)**

**Source:** `exchange-mailboxes-inventory.safe.json` or `exchange-mailboxes-inventory.full.json` (profile-aware selection).

**Guaranteed fields rendered (when artefact loads):**

* `status` one of: `ok | truncated | permission-denied | error | not-available`
* `generatedAt`
* `artefact` (filename chosen)
* `profile`
* `totalMailboxes`
* `mailboxesOver50GB` (derived from `sizeBuckets.over50GB`)
* `nearLimit40to50GB` (from `sizeBuckets.40to50GB`)
* `bucket.under1GB`, `bucket.1to10GB`, `bucket.10to50GB`
* `completeness.isComplete`, `completeness.truncated`
* `completeness.permissionDeniedCount`
* `notes` (count + joined notes)

**Graph-only signalling:**

If the collector is in Graph-only mode, the summary sheet must explicitly indicate (via notes and/or null fields) that `byType`, `byState`, and `mailboxFeatures` are not collected.

#### Sheet: **Exchange Mailboxes**

**Profile behaviour:**

* **FULL runs:** renders rows from `mailboxUsageDetail[]`.
* **SAFE runs:** does **not** render mailbox-level rows (PII gated); a single status row is shown instead.

**Columns (FULL only):**

* `displayName`
* `userPrincipalName`
* `storageUsedGb`
* `isOver50GB` (`YES|NO`)
* `reportPeriod`

**Row cap:** implementation may cap rows for readability; any cap must be clearly stated in-sheet.

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

* Multi-sheet, human-readable workbook
* Designed for **review and presentation**, not raw data export
* Derived from artefacts and observed checks
* Must tolerate missing or unparseable artefacts

### Guaranteed sheets

The following sheets are **contractually stable**:

* **Run Summary** — run metadata, derived status, high-level counts
* **Users (Summary)** — user inventory counts (safe/full aware)
* **Enterprise Apps (Summary)** — app counts, risk/truncation signals
* **Conditional Access** — policy summary and completeness signals
* **Directory Roles** — role inventory and completeness overview
* **Exchange Mailboxes (Summary)** — mailbox counts and size buckets

### Explicitly excluded from XLSX

The XLSX report **intentionally does NOT include** raw tables for:

* Jobs
* Findings
* Observed checks
* Artefact inventories

These remain available via:

* API endpoints
* CSV exports
* JSON artefacts

This keeps the XLSX:

* executive-friendly
* stable over time
* decoupled from internal schemas

### Optional / future sheets

Additional **summary-only** sheets MAY be added in an append-only fashion.

Raw or schema-heavy tables MUST NOT be added without explicit contract revision.

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
* Guaranteed XLSX sheet set or semantic meaning of sheet contents
* Download behaviour (302 redirect, presigned URL semantics)

### What is allowed without versioning

The following are **non-breaking** and may evolve:

* Additional summary sheets (append-only)
* Additional fields added to existing summary sheets
* New collectors or observed checks
* New reports derived from existing artefacts

### Contract discipline

* Artefacts are **append-only evidence**
* Observed checks are **stable factual records**
* Findings may evolve independently

If behaviour and documentation diverge, **runtime behaviour wins** and documentation must be corrected immediately.
