# Findings – Observed Checks Registry

This document defines **observed checks** produced by collectors in the M365 Discovery Platform.

Observed checks are:

* factual observations derived directly from tenant data
* non-opinionated (no prescriptive judgement)
* used as inputs into findings, reports, and future scoring

They intentionally differ from *findings*, which apply interpretation and severity.

---

## Purpose

This registry exists to:

* standardise how collectors emit observations
* ensure repeatability and consistency across collectors
* decouple data collection from risk interpretation
* support future rule engines, scoring, and UI visualisation

---

## Terminology

| Term                 | Meaning                                                                      |
| -------------------- | ---------------------------------------------------------------------------- |
| **Observed check**   | A single, named observation derived from tenant state                        |
| **Source collector** | Collector responsible for producing the observation                          |
| **Evidence**         | Raw or derived data supporting the observation                               |
| **Finding**          | A higher-level interpretation that may reference one or more observed checks |

---

## Observed check structure

Each observed check MUST include:

* `checkId` – stable, namespaced identifier
* `collectorId` – emitting collector
* `runId` – run the observation belongs to
* `jobId` – producing job (if applicable)
* `observedAt` – timestamp of observation
* `data` – machine-readable observation payload

Observed checks MAY include:

* `ruleId` – reference to a rule that may later consume this observation
* `references` – artefact links, object IDs, or URLs

Observed checks MUST NOT:

* assign severity
* make recommendations
* imply compliance or non-compliance

---

## Naming conventions

Observed check identifiers are **stable contracts**.

Current convention (implemented):

```
<AREA>_<DOMAIN>_OBS_<NNN>
```

Examples:

* `ENTRA_USERS_OBS_001`
* `ENTRA_EAP_OBS_001`
* `ENTRA_CA_OBS_001`
* `ENTRA_DIRROLES_OBS_005`

Notes:

* Earlier draft dot-notation examples (e.g. `entra.users.total`) are **conceptual only** and are not emitted by the worker today.
* Do not invent new ID formats without updating this registry and the relevant contracts.

---

## Relationship to Findings (Critical Rule)

Observed checks and findings are **intentionally separate layers**.

### Key principle

> **Observed checks record what exists. Findings decide what it means.**

An observed check:

* captures a fact, count, state, or boolean condition
* is always emitted, even when the value is zero or false
* must remain stable and repeatable across runs

A finding:

* interprets one or more observed checks
* assigns severity and guidance
* may change over time as interpretation logic evolves

---

### One-to-many mapping

A single observed check may:

* support **multiple findings**, or
* support **no findings at all** in some tenants

Example:

* Observed check: `ENTRA_EAP_OBS_001`
* Possible findings (now or future):

  * “High-risk Graph permissions detected”
  * “Third-party app governance required”

The observed check itself **never changes meaning**, even if findings do.

---

### No implied judgement

Observed checks must never:

* imply risk
* imply correctness or incorrectness
* embed policy assumptions

This allows:

* safer demos
* customer-specific interpretation
* future scoring and rule engines

---

## Implemented observed checks

> **Important formatting rule**
>
> Markdown tables break if a cell contains the `|` character (even inside inline code).
> To keep this registry readable and stable, tables list only `checkId` and a short description.
> Full payload shapes are documented under each check in a fenced code block.

---

### Entra Users

| checkId               | Description                                    |
| --------------------- | ---------------------------------------------- |
| `ENTRA_USERS_OBS_001` | User inventory summary (counts & completeness) |

**Payload shape**

```json
{
  "profile": "safe" or "full",
  "isComplete": boolean,
  "permissionDenied": string[],
  "notes": string[],
  "totalUsers": number (nullable),
  "enabledUsers": number (nullable),
  "disabledUsers": number (nullable),
  "memberUsers": number (nullable),
  "guestUsers": number (nullable),
  "fullExported": boolean
}
```

Notes:

* This observed check summarises the **state and completeness** of Entra user inventory at discovery time.
* All per-user data is **counts only**; no PII is included in observed checks.
* If Graph permissions are missing (HTTP 403), `isComplete = false` and affected counts MAY be `null`.
* `permissionDenied` records stable identifiers describing which Graph slices were blocked (e.g. `"microsoft.graph/users:list"`).
* `notes` provides human-readable context explaining any completeness gaps.
* Findings derived from this check (e.g. guest user presence) MUST be guarded by `isComplete === true`.

---

### Enterprise Applications

| checkId             | Description  |
| ------------------- | ------------ |
| `ENTRA_EAP_OBS_001` | Scan summary |

**Payload shape**

```json
{
  "totalApps": number,
  "scannedApps": number,
  "riskyAppsCount": number,
  "truncated": boolean,
  "maxApps": number,
  "dataProfile": "safe" or "full"
}
```

Notes:

* This observed check summarises enterprise app scan coverage and bounded signals.
* Demo tenant or API limits must surface via `truncated = true`.

---

### Conditional Access

| checkId            | Description                       |
| ------------------ | --------------------------------- |
| `ENTRA_CA_OBS_001` | Conditional Access policy summary |

**Payload shape**

```json
{
  "totalPolicies": number,
  "enabledPolicies": number,
  "reportOnlyPolicies": number,
  "disabledPolicies": number,
  "policiesTargetingAllUsers": number,
  "policiesWithMfaGrantControl": number,
  "policiesExcludingUsersCount": number,
  "hasLegacyAuthPolicyDetected": boolean,
  "namedLocationsCount": number,
  "dataProfile": "safe" or "full",
  "fullExported": boolean,
  "truncated": boolean
}
```

Notes:

* This observed check summarises the **state** of Conditional Access policies at discovery time.
* It contains **counts and booleans only** — no evaluation or judgement.
* Demo tenant or API limits must surface via `truncated = true`.
* Report-only policies are counted but are not treated as enforcement by findings.

---

### Directory Roles & Privileged Assignments

These observed checks support both **security posture** and **take-on / migration scoping** lenses by recording scale, complexity, and completeness of role assignment evidence.

| checkId                  | Description                               |
| ------------------------ | ----------------------------------------- |
| `ENTRA_DIRROLES_OBS_001` | Directory roles inventory summary         |
| `ENTRA_DIRROLES_OBS_002` | Assignment principal type distribution    |
| `ENTRA_DIRROLES_OBS_003` | Group-based role assignments present      |
| `ENTRA_DIRROLES_OBS_004` | Eligible / PIM coverage signal            |
| `ENTRA_DIRROLES_OBS_005` | Data completeness for role assignment set |

**Payload shapes**

`ENTRA_DIRROLES_OBS_001`

```json
{
  "roleDefinitionsCount": number,
  "rolesWithAnyActiveAssignmentCount": number,
  "activeAssignmentsCount": number,
  "dataProfile": "safe" or "full",
  "truncated": boolean
}
```

`ENTRA_DIRROLES_OBS_002`

```json
{
  "user": number,
  "group": number,
  "servicePrincipal": number,
  "unknown": number,
  "dataProfile": "safe" or "full",
  "truncated": boolean
}
```

`ENTRA_DIRROLES_OBS_003`

```json
{
  "present": boolean,
  "assignmentsCount": number,
  "dataProfile": "safe" or "full",
  "truncated": boolean
}
```

`ENTRA_DIRROLES_OBS_004`

```json
{
  "attempted": boolean,
  "succeeded": boolean,
  "eligibleAssignmentsCount": number (optional),
  "dataProfile": "safe" or "full",
  "truncated": boolean
}
```

`ENTRA_DIRROLES_OBS_005`

```json
{
  "isComplete": boolean,
  "truncated": boolean,
  "permissionDenied": string[],
  "slicesAttempted": string[],
  "slicesCompleted": string[],
  "notes": string[],
  "dataProfile": "safe" or "full"
}
```

Notes:

* These checks are **observational only** and do not imply risk.
* `permissionDenied` should contain stable strings describing which slice(s) were blocked (e.g., `"roleDefinitions"`, `"activeAssignments"`, `"eligibleAssignments"`).
* Demo tenant / API limits must surface via `truncated = true` and/or `isComplete = false`.

---

### Exchange Online – Mailboxes

Collector: `exchange.mailboxes.inventory`

| checkId                 | Description                    |
| ----------------------- | ------------------------------ |
| `EXO_MAILBOXES_OBS_001` | Mailbox inventory summary      |
| `EXO_MAILBOXES_OBS_002` | Mailbox inventory completeness |

**Payload shapes**

`EXO_MAILBOXES_OBS_001`

```json
{
  "totalMailboxes": number (nullable),
  "byType": {
    "user": number (nullable),
    "shared": number (nullable),
    "room": number (nullable),
    "equipment": number (nullable)
  },
  "byState": {
    "enabled": number (nullable),
    "disabled": number (nullable)
  },
  "sizeBuckets": {
    "under1GB": number (nullable),
    "1to10GB": number (nullable),
    "10to50GB": number (nullable),
    "40to50GB": number (nullable),
    "over50GB": number (nullable)
  },
  "dataProfile": "safe" or "full",
  "fullExported": boolean,
  "truncated": boolean
}
```

`EXO_MAILBOXES_OBS_002`

```json
{
  "isComplete": boolean,
  "truncated": boolean,
  "permissionDenied": string[],
  "slicesAttempted": string[],
  "slicesCompleted": string[],
  "notes": string[],
  "dataProfile": "safe" or "full"
}
```

Notes:

* These checks are **counts, buckets, and completeness signals only** — no mailbox identifiers or addresses are included.
* If Exchange data cannot be fully enumerated due to missing permissions or access restrictions, `isComplete = false` and relevant counts MAY be `null`.
* `permissionDenied` must contain stable identifiers describing blocked slices (e.g. `"exo:mailboxes:list"`, `"exo:mailboxStatistics:read"`, `"microsoft.graph/reports:getMailboxUsageDetail"`).
* `slicesAttempted` and `slicesCompleted` should reflect the collector’s internal slices (e.g. `"mailboxes"`, `"mailboxStatistics"`, `"mailboxUsageDetail"`).
* Demo tenant / API limits must surface via `truncated = true` and/or `isComplete = false`.

---

## Collector responsibilities

Collectors MUST:

* emit observed checks consistently
* include raw counts even when no findings are raised
* respect `dataProfile` boundaries
* avoid suppressing observations due to perceived insignificance

Collectors MUST NOT:

* infer risk level
* suppress checks because a finding was not raised

---

## Reporting and UI usage

Observed checks:

* must always be safe to render
* may appear in reports even when no findings exist
* are suitable for timelines, charts, and coverage indicators

Reports and UI layers must:

* tolerate empty observed-check sets
* avoid implying judgement without a finding

---

## Future extensions

This registry intentionally supports:

* scoring engines
* compliance mappings
* UI visualisation layers
* customer-specific interpretation rules

Observed checks are the **stable foundation** for all of the above.
