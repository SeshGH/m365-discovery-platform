# Findings Registry (Implemented Finding Checks)

This document lists **implemented** finding `checkId` values and their meaning.

It exists to prevent:

* accidental ID reuse
* drifting meanings
* inconsistent naming across collectors

**Contract rule:** A finding `checkId` must never change meaning once shipped.

For the findings model and taxonomy guidance, see:

* `docs/findings-model.md`

---

## What belongs in this registry

This registry is **findings-only**.

* ✅ **Findings**: interpreted signals that carry severity and (optionally) recommendation / evidence.
* ❌ **Observed checks**: factual observations (no severity, no judgement).

Observed check IDs and semantics live in:

* `docs/findings-observed-checks.md`

---

## Naming & stability rules

* `checkId` values are **stable contracts**.
* A `checkId` **must never change meaning** once shipped.
* Do not reuse IDs, even if a check is deprecated.

Recommended format:

```
{DOMAIN}_{AREA}_{NNN}
```

Examples:

* `ENTRA_USERS_001`
* `ENTRA_EAP_002`

---

## Entra — Users (`ENTRA_USERS_*`)

### `ENTRA_USERS_001` — Guest users present

* **Collector:** `entra.users`

* **Derived from observed check(s):** `ENTRA_USERS_OBS_001`

* **Severity (implemented):** `info`

* **Meaning:** One or more guest users exist in the tenant.

* **Guards (to avoid false signals):**

  * Only emit when user inventory evidence is complete (`ENTRA_USERS_OBS_001.isComplete === true`).
  * Do **not** emit when Graph access to list users was permission-denied (completeness gap).

* **Notes:**

  * This is not inherently “bad”, but it is a governance and access complexity signal.
  * Inventory belongs in the users artefact; the finding is a summary signal.

---

## Entra — Enterprise App Permissions (`ENTRA_EAP_*`)

### `ENTRA_EAP_001` — High-privilege Graph permissions detected

* **Collector:** `entra.enterpriseApps.permissions`
* **Derived from observed check(s):** `ENTRA_EAP_OBS_001`
* **Severity (implemented):** `high`
* **Meaning:** At least one enterprise application has high-privilege Microsoft Graph **application** permissions that materially increase tenant risk.
* **Notes:**

  * This is a decision-ready security signal.
  * Detailed evidence belongs in the enterprise app permissions artefact.

### `ENTRA_EAP_002` — Scan truncated (results may be incomplete)

* **Collector:** `entra.enterpriseApps.permissions`
* **Derived from observed check(s):** `ENTRA_EAP_OBS_001`
* **Severity (implemented):** `info`
* **Meaning:** The scan was intentionally limited (e.g. demo cap / throttling controls), so results may not reflect the full tenant.
* **Demo-only:** Yes (current demo guardrails such as `EAP_MAX_APPS` — default cap is 100).
* **UI/reporting note:** Treat as a completeness warning; avoid implying the tenant is “clean” if truncation occurred.

### `ENTRA_EAP_COVERAGE_001` — Enterprise app permission review incomplete (scan capped)

* **Collector:** `entra.enterpriseApps.permissions`
* **Derivation:** `entra.enterpriseApps.highPrivilegePermissions` (`eapHighPrivFinding.ts`)
* **Derived from observed check(s):** `ENTRA_EAP_OBS_001`
* **Severity (implemented):** `info`
* **Meaning:** The enterprise application scan was capped by configured guardrails (`EAP_MAX_APPS`, default 100) before all tenant apps were reviewed. Permission review findings from this run are indicative only.
* **Guards:** Only emits when `ENTRA_EAP_OBS_001.truncated === true`.
* **Notes:**
  * Exists to prevent a clean-looking run (zero `ENTRA_EAP_HIGH_PRIV_001` findings) from being misread as “all apps are clean” when coverage is partial.
  * Includes scanned app count and cap limit in the title for immediate context.
  * Non-alarmist: `info` severity — this is a coverage signal, not a security signal.

---

## Entra — Conditional Access (`ENTRA_CA_*`)

### `ENTRA_CA_001` — No enabled Conditional Access policies detected

* **Collector:** `entra.conditionalAccess.policies`

* **Derived from observed check(s):** `ENTRA_CA_OBS_001`

* **Severity (implemented):** `low`

* **Meaning:** Conditional Access policies were enumerated successfully and **none** were in an enabled state.

* **Guards (to avoid false signals):**

  * Only emit when evidence is complete (i.e. not permission-denied and not truncated/capped).
  * Do **not** emit when `permissionDenied === true` or `truncated === true`.

* **Notes:**

  * This is a hygiene / baseline signal and can be interpreted differently depending on tenant maturity and licensing.
  * Detailed policy configuration remains in Conditional Access artefacts; the finding is a summary signal.

---

## Entra — Directory Roles (`ENTRA_DIRROLES_*`)

### `ENTRA_DIRROLES_001` — Non-user principals assigned to directory roles

* **Collector:** `entra.directoryRoles.assignments`

* **Derived from observed check(s):** `ENTRA_DIRROLES_OBS_002`, `ENTRA_DIRROLES_OBS_003`, `ENTRA_DIRROLES_OBS_005`

* **Severity (implemented):** `low`

* **Meaning:** At least one directory role assignment targets a **group** and/or **service principal**.

* **Guards (to avoid false signals):**

  * Only emit when core evidence is complete (`ENTRA_DIRROLES_OBS_005.isComplete === true`).
  * Do **not** emit when role enumeration is truncated or permission-denied.

* **Notes:**

  * This is not automatically “bad”, but it is a strong governance and operational complexity signal.
  * It supports both lenses:

    * **Security posture** (attack surface / privileged non-user principals)
    * **Take-on / migration scoping** (governance maturity and access model complexity)

---

### `ENTRA_DIRROLES_002` — Directory roles assigned to groups

* **Collector:** `entra.directoryRoles.assignments`

* **Derived from observed check(s):** `ENTRA_DIRROLES_OBS_002`, `ENTRA_DIRROLES_OBS_003`, `ENTRA_DIRROLES_OBS_005`

* **Severity (implemented):** `medium`

* **Meaning:** One or more directory roles are assigned to **groups** (group-based role assignment is present).

* **Guards (to avoid false signals):**

  * Only emit when core evidence is complete (`ENTRA_DIRROLES_OBS_005.isComplete === true`).
  * Do **not** emit when role enumeration is truncated or permission-denied.

* **Notes:**

  * This can be a valid governance pattern, but it increases change-control and troubleshooting complexity.
  * Evidence remains counts-only; inventory detail remains in the directory roles artefact.

---

### `ENTRA_DIRROLES_010` — Excess number of Global Administrators

* **Collector:** `entra.directoryRoles.assignments`
* **Derivation:** `entra.directoryRoles.privilegedAccess` (`entraDirectoryRolesFinding.ts`)
* **Derived from observed check(s):** `ENTRA_DIRROLES_OBS_001`, `ENTRA_DIRROLES_OBS_005`

* **Severity (implemented):**
  * `high` if `globalAdminCount >= 5`
  * `medium` if `globalAdminCount >= 3`

* **Meaning:** The tenant has an elevated number of Global Administrator assignments, increasing blast radius of compromise.

* **Guards (to avoid false signals):**
  * Only emit when core evidence is complete (`ENTRA_DIRROLES_OBS_005.isComplete === true` and not truncated).
  * Only emit when `globalAdminCount >= 3`.

* **Notes:**
  * Uses `ENTRA_DIRROLES_OBS_001.globalAdminCount`, derived via the well-known Global Administrator template ID `62e90394-69f5-4237-9190-012177145e10` with display-name fallback.

---

### `ENTRA_DIRROLES_011` — Service principals assigned to directory roles

* **Collector:** `entra.directoryRoles.assignments`
* **Derivation:** `entra.directoryRoles.privilegedAccess` (`entraDirectoryRolesFinding.ts`)
* **Derived from observed check(s):** `ENTRA_DIRROLES_OBS_002`, `ENTRA_DIRROLES_OBS_005`

* **Severity (implemented):** `medium`

* **Meaning:** One or more directory roles are assigned to service principals (non-human privileged access).

* **Guards (to avoid false signals):**
  * Emits whenever `ENTRA_DIRROLES_OBS_002.servicePrincipal > 0` is observed; partial data still warrants flagging presence of non-human privileged access.

* **Notes:**
  * Service principals with directory roles require strict credential and lifecycle governance.

---

### `ENTRA_DIRROLES_012` — Broad privileged assignment surface

* **Collector:** `entra.directoryRoles.assignments`
* **Derivation:** `entra.directoryRoles.privilegedAccess` (`entraDirectoryRolesFinding.ts`)
* **Derived from observed check(s):** `ENTRA_DIRROLES_OBS_001`, `ENTRA_DIRROLES_OBS_005`

* **Severity (implemented):** `medium`

* **Meaning:** The total count of active directory role assignments is large (`>= 20`), indicating elevated governance complexity.

* **Guards (to avoid false signals):**
  * Only emit when core evidence is complete (`ENTRA_DIRROLES_OBS_005.isComplete === true` and not truncated).
  * Only emit when `activeAssignmentsCount >= 20`.

---

## SharePoint — Sites (`SPO_SITES_*`)

### `SPO_SITES_COVERAGE_001` — SharePoint site inventory incomplete

* **Collector:** `sharepoint.sites.inventory`
* **Derivation:** `spo.sites.coverage` (`spoSitesCoverageFinding.ts`)
* **Derived from observed check(s):** `SPO_SITES_OBS_001`

* **Severity (implemented):**
  * `medium` when `permissionDenied` includes `"microsoft.graph/sites:list"` (active permissions gap)
  * `low` when `isComplete === false` but no permission denial (transient/unexpected failure)

* **Meaning:** The SharePoint site inventory did not complete. Site count metrics and any downstream findings that rely on site enumeration will be absent or partial for this run.

* **Guards:**
  * Only emits when `SPO_SITES_OBS_001.isComplete === false`.
  * Suppressed when `isComplete === true` (collection succeeded) or when the OBS is absent entirely.

* **Notes:**
  * Permission-denied path (`medium`): missing `Sites.Read.All` application permission — actionable, requires admin consent.
  * Transient failure path (`low`): unexpected non-403 error — re-running the scan usually resolves it.
  * Exists to prevent a run with no SharePoint findings from being misread as "nothing to worry about" when the real cause is missing access.

---

### `SPO_SITES_COVERAGE_002` — SharePoint storage usage report unavailable

* **Collector:** `sharepoint.sites.inventory`
* **Derivation:** `spo.sites.coverage` (`spoSitesCoverageFinding.ts`)
* **Derived from observed check(s):** `SPO_SITES_OBS_010`

* **Severity (implemented):** `info`

* **Meaning:** The SharePoint storage usage report (Graph `reports/getSharePointSiteUsageDetail`) could not be retrieved. Storage total metrics for this run are absent.

* **Guards:**
  * Only emits when `SPO_SITES_OBS_010.isComplete === false`.
  * Suppressed when `isComplete === true` or the OBS is absent entirely.

* **Title variants (all emit `info`):**
  * `permissionDenied` includes `"microsoft.graph/reports:getSharePointSiteUsageDetail"` → "SharePoint storage usage report unavailable — reporting permissions missing"
  * `truncated === true` (unexpected failure) → "SharePoint storage usage report unavailable"
  * All other incomplete cases (400/404, report not yet generated) → "SharePoint storage usage report unavailable — report data not yet generated"

* **Notes:**
  * `info` severity — storage totals being absent is a coverage gap, not a security finding.
  * Permission-denied path: `Reports.Read.All` (or equivalent) application permission requires admin consent.
  * Report-not-ready path: Microsoft 365 usage reports can take 24–48 hours to initialise on new or lightly used tenants; re-running usually resolves it.

