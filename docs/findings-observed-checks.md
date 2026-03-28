# Findings & Observed Checks

This document defines how **Observed Checks** and **Findings** are produced, related, and consumed within the M365 Discovery Platform.

It reflects **actual runtime behaviour** and is the source of truth for reviewers and contributors.

---

## Core principles (locked)

* **Observed checks are the source of truth**
* Findings are **derived views**, never raw data
* Findings must never be emitted without supporting observed checks
* Completeness and truncation are signalled only via observed checks
* Reports and UI consume findings but must always allow trace-back to observed checks

---

## Observed Checks

Observed checks:

* Are written **directly by collectors**
* Represent facts, measurements, or bounded scans
* May be partial or truncated
* Carry completeness signals

Each observed check has:

* `checkId` (stable, immutable)
* `collectorId`
* `data` (JSON, shape defined by the collector contract)
* Optional completeness signals:

  * `isComplete`
  * `truncated`
  * `permissionDenied`
  * `slicesAttempted` / `slicesCompleted`

Observed checks are **idempotent per (runId, jobId, checkId)**.

### Example

```json
{
  "checkId": "EXO_MAILBOXES_OBS_001",
  "collectorId": "exchange.mailboxes.inventory",
  "data": {
    "totalMailboxes": 21,
    "sizeBuckets": {
      "40to50GB": 0,
      "over50GB": 0
    },
    "isComplete": true
  }
}
```

---

## Findings

Findings:

* Are **derived from observed checks**
* Represent **decision-ready signals**, not raw facts
* Are safe to render and export
* May be informational, advisory, or risk-based

Findings **must not**:

* Introduce assumptions not present in observed checks
* Mask truncation or incompleteness
* Depend on reports or UI logic

### Finding derivation model

Findings are produced by **finding derivations**, which:

* Read from the full set of observed checks for a run
* Emit zero or more findings
* Are deterministic and repeatable

This allows:

* Multiple findings per observed check
* Cross-collector reasoning
* Stable, testable behaviour

---

## Finding severity

Severity reflects **decision urgency**, not technical failure:

* `critical` – immediate security or operational risk
* `high` – significant risk or misconfiguration
* `medium` – notable issue requiring review
* `low` – minor issue
* `info` – advisory / scoping / context

Example:

* Exchange mailbox licensing pressure is **`info`**, not a fault

---

## Example: Exchange Online mailbox licensing advisory

**Observed checks**:

* `EXO_MAILBOXES_OBS_001` – mailbox size distribution
* `EXO_MAILBOXES_OBS_010` – derived licensing signal

**Derived finding**:

* `EXO_LICENSE_001`
* Severity: `info`
* Purpose: scoping reminder for mailbox licensing limits

This finding:

* Does **not** imply misconfiguration
* Exists to prevent future quota-related support issues
* Is derived entirely from Graph-only data

---

## Completeness & truncation

Only observed checks may signal:

* Truncation
* Partial coverage
* Permission denial

Findings must:

* Respect these signals
* Avoid false confidence

The UI surfaces completeness warnings at the run level and links them back to the originating observed checks.

---

## Finding design principles, intent, and lifecycle

This section defines **what findings are allowed to do**, **what they must not do**, and how they are categorised and interpreted over time.

These rules exist to preserve long-term contract stability, prevent alert fatigue, and ensure findings remain MSP-safe as the platform scales.

### What findings must *not* do (hard constraints)

Findings must **never**:

* Reinterpret or transform raw data

  * No recalculation, rebucketing, or thresholding beyond what observed checks already define
  * Findings summarise meaning; they do not perform analysis

* Hide or mask incompleteness

  * Truncation, partial coverage, or permission gaps must always remain visible via observed checks
  * Findings must downgrade confidence or severity if evidence is incomplete

* Imply fault unless a true misconfiguration is proven

  * Advisory, licensing, sizing, or hygiene findings must not suggest non-compliance or blame

* Act as a task list or remediation engine

  * Findings provide signals, not instructions
  * No "you must fix" or prescriptive remediation steps

* Be unstable over time

  * Finding IDs, meaning, and intent must remain valid as collectors, UI, and reports evolve

* Exist without a clear audience

  * Every finding must be meaningful to an MSP pre-sales, delivery, or technical review audience

---

### Finding categories (descriptive only)

Findings may optionally be assigned a **primary category** for grouping and presentation.

Categories are:

* Descriptive, not functional
* Not used for severity or logic
* Intended for UI grouping, filtering, and conversation framing

#### Supported categories (v1)

* **Security posture** – authentication, access, privilege, and control signals
* **Licensing & cost awareness** – sizing, utilisation, and commercial considerations
* **Operational hygiene** – stale, inactive, or legacy artefacts
* **Migration & modernisation considerations** – readiness and future-state blockers
* **Discovery completeness & confidence** – truncation, partial visibility, permission gaps

Each finding should have **one primary category** to avoid UI ambiguity.

---

### Finding lifecycle & intent

Findings represent **point-in-time signals**, but are interpreted within an MSP workflow.

Lifecycle reflects **intent**, not severity:

* **Informational** – awareness only; no action implied
* **Advisory** – consideration recommended; may influence scoping or design
* **Actionable** – likely requires intervention, supported by strong evidence

Lifecycle and severity are **independent dimensions**:

* Severity answers: *How serious is this?*
* Lifecycle answers: *What should the reader do with this information?*

This separation allows findings to evolve in relevance without changing IDs or meaning.

---

### Design summary

Observed checks explain **what exists**.

Findings explain **why it matters**.

Findings do **not** explain **how to fix it**.

---

## What this enables long-term

This model allows:

* Graph-only core operation
* Optional future EXO PowerShell workers
* MSP-safe advisory findings
* Report, UI, and API evolution without breaking contracts

---

**If documentation and runtime behaviour disagree, runtime behaviour wins.**

---

## SharePoint — Admin Settings (`SPO_ADMIN_OBS_001`)

### `SPO_ADMIN_OBS_001` — SharePoint admin tenant settings

* **Collector:** `sharepoint.admin.settings` (`sharepointAdminSettingsCollector.ts`)
* **API:** `GET https://graph.microsoft.com/v1.0/admin/sharepoint/settings`
* **Required permission:** `SharePointTenantSettings.Read.All` (application, admin consent required)

**Payload shape:**

```jsonc
{
  // ── Completeness signals (always present) ─────────────────────────────────
  "isComplete": true,           // true iff the API call succeeded without error
  "permissionDenied": [],       // ["microsoft.graph/admin/sharepoint/settings"] on 403
  "notes": ["..."],             // human-readable collector notes

  // ── Settings (meaningful only when isComplete === true) ───────────────────
  // All settings fields are null when isComplete === false.

  // ── SPO_SHARING_001: tenant sharing capability ────────────────────────────
  // Values: "disabled" | "existingExternalUserSharingOnly" |
  //         "externalUserSharingOnly" | "externalUserAndGuestSharing" | null
  "sharingCapability": "externalUserSharingOnly",

  // ── SPO_LEGACY_AUTH_001: legacy authentication protocols ──────────────────
  // true  = legacy auth is enabled at the SharePoint service level
  // false = legacy auth is disabled
  // null  = API call failed (use isComplete to distinguish)
  "isLegacyAuthProtocolsEnabled": false,

  // ── SPO_RESHARING_001: external users can re-share content ───────────────
  // true  = external users can re-share files, folders, and sites they received access to
  // false = re-sharing by external users is disabled
  // null  = API call failed (use isComplete to distinguish)
  "isResharingByExternalUsersEnabled": false,

  // ── Unconsumed (collected, no finding yet) ────────────────────────────────
  "isRequireAcceptingUserToMatchInvitedUserEnabled": true
}
```

**`isComplete` is the primary gate** for all settings-based findings. On any API failure the entire settings block is null; the absence of findings must not be read as "settings are safe."

**Permission failure path** (`permissionDenied` includes `"microsoft.graph/admin/sharepoint/settings"`): `SharePointTenantSettings.Read.All` application permission has not been granted or consented. This permission requires Global Administrator or SharePoint Administrator consent.

**Current consumers:**

| Finding | Derivation | Condition |
|---|---|---|
| `SPO_SHARING_001` | `spo.admin.settings.sharing` | `sharingCapability === "externalUserAndGuestSharing"` OR `"externalUserSharingOnly"` |
| `SPO_LEGACY_AUTH_001` | `spo.admin.settings.sharing` | `isComplete === true` AND `isLegacyAuthProtocolsEnabled === true` |
| `SPO_RESHARING_001` | `spo.admin.settings.sharing` | `isComplete === true` AND `isResharingByExternalUsersEnabled === true` |

---

## Entra — Directory Roles (`ENTRA_DIRROLES_OBS_*`)

### `ENTRA_DIRROLES_OBS_001` — Directory roles assignment summary

* **Collector:** `entra.directoryRoles.assignments` (`entraDirectoryRolesAssignmentsCollector.ts`)
* **APIs:**
  * `GET https://graph.microsoft.com/v1.0/directoryRoleTemplates?$select=id,displayName`
  * `GET https://graph.microsoft.com/v1.0/directoryRoles?$select=id,displayName,roleTemplateId`
  * `GET https://graph.microsoft.com/v1.0/directoryRoles/{id}/members` (per role)
* **Required permissions:** `RoleManagement.Read.Directory` (application)

**Payload shape:**

```jsonc
{
  // Total count of role definition templates returned by the API
  "roleDefinitionsCount": 90,

  // Count of roles that have at least one active member assignment
  "rolesWithAnyActiveAssignmentCount": 12,

  // Total count of active directory role assignments across all roles
  "activeAssignmentsCount": 25,

  // Count of assignments to the Global Administrator role specifically
  // Derived via template ID 62e90394-69f5-4237-9190-012177145e10 with display-name fallback.
  // Defaults to 0 if the Global Administrator role is not found in the enumeration.
  "globalAdminCount": 2,

  // Data profile used during collection ("safe" | "full")
  "dataProfile": "safe",

  // true if the directory roles list was capped at DIRROLES_MAX_ROLES (default 50)
  "truncated": false
}
```

**Note:** `ENTRA_DIRROLES_OBS_001` reflects the **active** assignment surface only (standing assignments). Eligible (PIM) assignments are covered by `ENTRA_DIRROLES_OBS_004`. The completeness gate for findings that read this OBS is `ENTRA_DIRROLES_OBS_005.isComplete === true` and `truncated !== true`.

**Current consumers:**

| Finding | Derivation | Condition |
|---|---|---|
| `ENTRA_GLOBAL_ADMIN_001` | `entra.directoryRoles.privilegedAccess` | core complete AND `globalAdminCount > 1` |
| `ENTRA_DIRROLES_010` | `entra.directoryRoles.privilegedAccess` | core complete AND `globalAdminCount >= 3` |
| `ENTRA_DIRROLES_012` | `entra.directoryRoles.privilegedAccess` | core complete AND `activeAssignmentsCount >= 20` |
| `ENTRA_PIM_001` | `entra.directoryRoles.privilegedAccess` | core complete AND `activeAssignmentsCount > 0` AND OBS_004 succeeded with `eligibleAssignmentsCount === 0` |

---

### `ENTRA_DIRROLES_OBS_004` — PIM role eligibility schedules

* **Collector:** `entra.directoryRoles.assignments` (`entraDirectoryRolesAssignmentsCollector.ts`)
* **API:** `GET https://graph.microsoft.com/v1.0/roleManagement/directory/roleEligibilitySchedules`
* **Required permission:** `RoleEligibilitySchedule.Read.Directory` (application) — requires Entra ID P2 licensing
* **Emission condition:** Only written when the `DIRROLES_ENABLE_PIM_SLICE` environment variable is not `"0"` (default `"1"` = enabled). Absence of this OBS means the PIM slice was deliberately disabled.

**Payload shape:**

```jsonc
{
  // ── Attempt flag (always present when OBS is emitted) ─────────────────────
  "attempted": true,

  // ── Query outcome ─────────────────────────────────────────────────────────
  // true  = roleEligibilitySchedules API call succeeded
  // false = 403 (P2 not licensed or admin consent missing), or any other error
  "succeeded": true,

  // ── Eligibility count (only present when succeeded === true) ──────────────
  // schedules.length on success; undefined on failure
  "eligibleAssignmentsCount": 0,

  // ── Optional metadata ─────────────────────────────────────────────────────
  "dataProfile": "...",
  "truncated": false
}
```

**Key guard: `succeeded` must be checked before drawing conclusions from `eligibleAssignmentsCount`.**
When `succeeded === false`, `eligibleAssignmentsCount` is absent (`undefined`). An `asNumber(undefined)` call returns `null`, not `0` — but consuming findings must still explicitly gate on `succeeded === true` to avoid treating an API failure as "zero eligible assignments."

**Permission failure path:** A 403 response (sets `succeeded: false`) indicates either that Entra ID P2 licensing is not present for the tenant or that the `RoleEligibilitySchedule.Read.Directory` application permission has not been consented. In both cases no eligibility conclusions can be drawn.

**Limitation — PIM for Groups:** This OBS covers direct role eligibility schedules only. PIM for Groups (where group membership is eligible and that group holds a directory role) creates equivalent JIT coverage that is **not** visible via the `roleEligibilitySchedules` endpoint. `eligibleAssignmentsCount` will be `0` even when PIM for Groups is actively governing privileged access.

**Current consumers:**

| Finding | Derivation | Condition |
|---|---|---|
| `ENTRA_PIM_001` | `entra.directoryRoles.privilegedAccess` | `succeeded === true` AND `eligibleAssignmentsCount === 0` AND core complete AND `activeAssignmentsCount > 0` |

---

## Derived Observed Checks

Some observed checks are **not written directly by collectors**. Instead, they are computed in a second-stage derivation pass that runs after all collector jobs are terminal and before findings are derived. These are called **Derived Observed Checks**.

Derived OBS:

* Are written with `jobId: null` to distinguish them from collector-written OBS
* Are stored in the same `ObservedCheck` table
* Are idempotent: deleted and re-inserted on each derivation pass
* May read artefact content from S3 to distill per-object data into structured signals
* Are emitted ONLY when the source artefact is complete — absence of the OBS is itself the incompleteness signal to findings

The pipeline order is:

```
collectors → raw OBS → derived OBS → findings
```

Derived OBS exist because artefact content (stored in S3) is not accessible to the findings derivation layer. Derived OBS bridge that gap.

---

### `ENTRA_CA_DERIVED_001` — Conditional Access MFA coverage signal

* **Derivation module:** `derivedObservedChecks/index.ts` (`evaluateCaArtefact`)
* **Source artefact:** `conditional-access-policies.safe.json`
* **Collector:** `entra.conditionalAccess.policies`

**Payload fields:**

| Field | Type | Description |
|---|---|---|
| `hasAnyEnabledPolicy` | `boolean` | At least one policy with `state === "enabled"` |
| `hasAnyMfaPolicy` | `boolean` | At least one policy with `"mfa"` in `builtInControls` (any state) |
| `hasEnabledMfaForAllUsers` | `boolean` | At least one policy: enabled AND mfa AND `targetsAllUsers === true` |

**Guards (conditions that prevent emission):**

* No `conditional-access-policies.safe.json` artefact record found for the run → **do not emit**
* S3 read fails → **do not emit**
* JSON parse fails → **do not emit**
* `summary.permissionDenied === true` OR `summary.truncated === true` → **do not emit**

Absence of `ENTRA_CA_DERIVED_001` in the run's observed checks is the completeness signal. Findings must treat the OBS as a guard: if it is not present, do not emit.

**Limitation — role-targeted policies:**

`hasEnabledMfaForAllUsers` is derived from `conditions.users.targetsAllUsers`. CA policies that target specific directory roles via `includeRoles` are **not detected** here because `includeRoles` IDs are stripped from the safe artefact profile. This produces conservative false negatives (fails to credit role-targeted protection) but never false positives.

**Limitation — authentication strength grants:**

CA policies using `authenticationStrength` grants (e.g. phishing-resistant MFA) rather than the `mfa` built-in control are not visible in the safe artefact profile. Such policies do not set `hasEnabledMfaForAllUsers = true`.

**Current consumers:**

| Finding | Derivation | Condition |
|---|---|---|
| `ENTRA_CA_005` | `entra.conditionalAccess.posture` | `hasAnyEnabledPolicy === true` AND `hasEnabledMfaForAllUsers !== true` |

---

