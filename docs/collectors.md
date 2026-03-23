# Collectors

> **Authoritative contracts** (stable and versioned):
>
> * `docs/artefact-and-report-contracts.md` (artefact naming, keys, storage rules, report expectations)
> * `docs/runs-and-jobs.md` (run/job lifecycle, orchestration rules)
>
> This page describes **collector behaviour** and how we keep outputs consistent. It must not redefine artefact/report contracts.

Collectors are worker-executed modules that gather Microsoft 365 / Entra telemetry and produce:

* **Observed checks** (preferred pattern): factual observations, no judgement
* **Findings**: decision-ready signals (severity + recommendation)
* **Artefacts**: evidence payloads (inventories / exports / derived reports)

Collectors never run inside the API. They run in the **worker** and persist outputs via Prisma.

---

## Goals

Collectors must produce outputs that are:

* **Consistent** (stable shapes and IDs over time)
* **Explainable** (humans can interpret results)
* **Composable** (UI + reporting can aggregate across collectors)
* **Secure-by-design** (least privilege; avoid sensitive leakage by default)
* **Scoping-friendly** (inventory + complexity signals, not just posture)

---

## Execution model (high level)

1. A **Run** is created via the API (modules enabled + `dataProfile`).
2. The API enqueues one or more **Jobs** for the run.
3. The worker polls jobs, executes collectors, and persists:

   * observed checks
   * findings
   * artefacts (uploaded to object storage + recorded in DB)
   * job status/timing/errors

Collectors do **not** manage orchestration, retries, or concurrency directly.

---

## Collector interface (contract)

Collectors implement `Collector` and return a `CollectorResult`:

* `id` — collector identifier (must match the registered collector id)
* `status` — `ok` | `error`
* `summary` — small, stable summary (counts/flags)
* `artefacts` — optional downloadable outputs
* may emit findings/observed checks via Prisma within execution

Rules:

* `id` **must** equal the collector’s registered ID (e.g. `entra.users`).
* `status` must be `ok` on success and `error` on failure.
* `summary` must stay small and stable.
* Large inventories must be emitted as artefacts (not embedded into findings).
* Fail cleanly and write a useful `lastError` when failing.

### Collector result contract (v1)

This is the **runtime contract** that keeps worker → API → UI/reporting stable.

* All collectors return a `CollectorResult` shape.
* The worker normalises collector outputs before persistence (`normalizeCollectorResult`), so downstream consumers can assume a predictable shape.

`CollectorResult` expectations:

* `id`: string (usually equals `collector.id`)
* `status`: `ok` | `error`
* `summary?`: small JSON object (counts/flags, stable keys)
* `artefacts?`: array of `CollectorArtefact` where:

  * `type`: **Prisma enum** `ArtefactType` (`json` | `csv` | `raw`)
  * `filename`: stable, documented filename
  * `contentType`: MIME type (e.g. `application/json`, `text/csv`)
  * `content`: `string` or `Buffer` (collector returns bytes; worker uploads to object storage + writes DB row)

Notes:

* Use `type: "raw"` for binary outputs (e.g. `.xlsx`).
* Collectors must not invent new `type` values; only use `json|csv|raw`.
* Safe-by-default still applies: returning an artefact does not imply it is safe to contain sensitive content.

---

## Data profile handling (safe vs full)

Runs have a `dataProfile`:

* **`safe`** (default): summary-only, low-impact, avoids PII-heavy exports.
* **`full`**: explicit opt-in for sensitive inventories/exports.

Collector responsibilities:

* Treat unknown values as `safe`.
* Make safe/full behaviour **explicit** (do not infer).
* Where artefact output differs, use profile-specific filenames (`*.safe.json`, `*.full.json`) or documented legacy naming.

See also:

* `docs/collector-hardening-checklist.md`

---

## Observed checks vs findings

### Observed checks (preferred)

Observed checks store **what was observed** without asserting compliance, severity, or remediation.

* Stable identifiers are **contracts**.
* The semantic registry for observed checks is:

  * `docs/findings-observed-checks.md`

Observed checks are exposed via:

* `GET /runs/:runId/observed-checks`

### Findings

Findings are **interpreted signals** intended to be decision-ready.

* `checkId` values are **stable contracts**.
* Implemented findings live in a dedicated derivation layer (`apps/worker/src/findings/*`).
* Findings are derived **only** from observed checks (never directly from raw artefacts).

Model guidance:

* `docs/findings-model.md`

---

## Artefacts (evidence layer)

Artefacts are the evidence and inventory layer:

* downloadable outputs stored in object storage
* referenced from DB (`bucket`, `key`, etc.)

Rules:

* filenames/keys/JSON shapes are treated as **contracts**
* reports must keep working even if some inputs are missing/unparseable

See:

* `docs/artefacts.md`
* `docs/artefact-and-report-contracts.md`

---

## Reporting collectors

Report collectors are normal collectors whose purpose is to export **derived views** over a run.

Current report collector IDs:

* `report.runSummary.csv` → uploads `run-summary.csv`
* `report.runSummary.xlsx` → uploads `run-summary.xlsx`

### Reporting scope and intent (important)

Reporting collectors are **intentionally opinionated**.

* Reports are **derived artefacts**, not sources of truth.
* They are designed for **human consumption** (consultants, reviewers, clients), not forensic debugging.
* Reports **must not** attempt to mirror raw database tables or API payloads.

Specifically for the run summary reports:

* Jobs, findings, and observed checks are **not exported as raw tables** in Excel.
* Those datasets remain available via:

  * API endpoints
  * JSON artefacts
  * Portal / UI views
* The Excel report focuses on:

  * run metadata and status
  * high-level counts and completeness signals
  * curated domain summaries (e.g. Users, Exchange, Enterprise Apps, Conditional Access, Directory Roles)

This separation prevents accidental misuse of reports as audit logs and keeps outputs stable as internal models evolve.

Correctness is enforced by retry-until-ready semantics (see `assertReportReadyOrThrow`).

---

## Current collectors (implemented)

### `entra.users`

**Purpose**

* Collects user summary (safe) and optional richer inventory (full).

**Observed checks (current)**

* `ENTRA_USERS_OBS_001` — user counts summary (total/member/guest/enabled/disabled + profile + fullExported)

**Findings (current)**

* `ENTRA_USERS_001` — Guest users present (severity: `info`)

**Artefacts (current)**

* Users inventory JSON (profile-aware candidates consumed by reporting):

  * `users-inventory.safe.json`
  * `users-inventory.full.json`

---

### `entra.enterpriseApps.permissions`

**Purpose**

* Scans enterprise applications and captures permissions shape and a bounded “risky” signal.

**Observed checks (current)**

* `ENTRA_EAP_OBS_001` — scan summary (total apps, scanned apps, risky apps count, truncated flag, maxApps, profile)

**Findings (current)**

* `ENTRA_EAP_001` — High-privilege Graph permissions detected (severity: `high`)
* `ENTRA_EAP_002` — Scan truncated (results may be incomplete) (severity: `info`, often demo guardrails)

**Artefacts (current)**

* Enterprise app permissions JSON (profile-aware candidates consumed by reporting):

  * `enterprise-app-permissions.safe.json`
  * `enterprise-app-permissions.full.json`

---

### `entra.conditionalAccess.policies`

**Purpose**

* Enumerates Conditional Access policies and emits evidence + summary observations.

**Observed checks (current)**

* `ENTRA_CA_OBS_001` — Conditional Access policy summary (counts/states/flags + profile + fullExported + truncated)

**Findings (current)**

* `ENTRA_CA_001` — No enabled Conditional Access policies detected (severity: `low`)

  * Emitted only when Conditional Access evidence is complete
  * (not truncated and not permission-denied)

**Artefacts (current)**

* Conditional Access policies JSON (profile-aware; safe is always emitted):

  * `conditional-access-policies.safe.json`
  * `conditional-access-policies.full.json`

---

### `entra.directoryRoles.assignments`

**Purpose**

* Inventories Entra directory roles and privileged role assignments
* Surfaces scale, complexity, and completeness signals
* Supports security posture and take-on / migration scoping lenses

**Observed checks (current)**

* `ENTRA_DIRROLES_OBS_001` — Directory roles inventory summary

  * `roleDefinitionsCount` — total role templates available in the tenant
  * `rolesWithAnyActiveAssignmentCount` — roles that have at least one active member
  * `activeAssignmentsCount` — total active role assignments across all scanned roles
  * `globalAdminCount` — number of active Global Administrator assignments (well-known templateId `62e90394-69f5-4237-9190-012177145e10` + display-name fallback)
  * `dataProfile`, `truncated`

* `ENTRA_DIRROLES_OBS_002` — Assignment principal type distribution (user / group / servicePrincipal / unknown counts)
* `ENTRA_DIRROLES_OBS_003` — Group-based role assignments present
* `ENTRA_DIRROLES_OBS_004` — Eligible / PIM coverage signal (best-effort; may be absent if PIM slice disabled)
* `ENTRA_DIRROLES_OBS_005` — Data completeness for role assignment set (isComplete, permissionDenied, slices, notes)

**Findings (current)**

* `ENTRA_DIRROLES_001` — Non-user principals assigned to directory roles (severity: `low`)
* `ENTRA_DIRROLES_002` — Directory roles assigned to groups (severity: `info`)

**Artefacts (current)**

* Directory roles assignments JSON (profile-aware):

  * `directory-roles-assignments.safe.json`
  * `directory-roles-assignments.full.json`

---

### `exchange.mailboxes.inventory`

**Purpose**

* Provides a **Graph-only** Exchange Online mailbox inventory for scoping and licensing awareness.
* Designed to avoid any dependency on Windows or Exchange Online PowerShell.

**Key design decisions (locked)**

* Uses **Microsoft Graph mailbox usage reports** only
* No EXO PowerShell, no Windows worker dependency
* Data may lag real-time usage and is treated as advisory
* Any future EXO PowerShell-based collector is explicitly deferred and optional

**Observed checks (current)**

* `EXO_MAILBOXES_OBS_001` — Mailbox usage summary

  * total mailboxes
  * size buckets (`under1GB`, `1to10GB`, `10to50GB`, `40to50GB`, `over50GB`)
  * completeness flags (`isComplete`, `truncated`, `permissionDenied`)

* `EXO_MAILBOXES_OBS_010` — Derived mailbox licensing signal

  * near-limit (40–50GB) count
  * over-limit (>50GB) count
  * advisory signal strength

**Findings (current)**

* `EXO_LICENSE_001` — Mailbox licensing pressure (severity: `info`)

  * Advisory / scoping reminder only
  * Emitted when mailboxes are nearing or exceeding 50GB
  * Intended to prevent future quota-related support issues post-migration

**Artefacts (current)**

* None (Graph-only summary via observed checks)

Notes:

* Missing or unavailable Graph reports surface as **completeness signals**, not failures
* This collector is intentionally conservative and never emits `high`/`critical` findings

---

## Definition of done

A collector is considered **done** when:

* it meets `docs/collector-hardening-checklist.md`
* it runs cleanly for `safe` and `full`
* it produces stable artefacts and/or stable observed checks
* it does not break reporting if inputs are missing/unparseable
* it is documented here (and any new IDs are registered)
