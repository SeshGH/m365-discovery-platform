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
* **Emission model:** Collector-emitted (not derivation pipeline). Emitted directly by `entraConditionalAccessPoliciesCollector.ts` during the collection job.
* **Derived from observed check(s):** `ENTRA_CA_OBS_001`
* **Severity (implemented):** `low`
* **Meaning:** Conditional Access policies were enumerated successfully and **none** were in an enabled state.
* **Guards (to avoid false signals):**
  * Only emit when evidence is complete (i.e. not permission-denied and not truncated/capped).
  * Do **not** emit when `permissionDenied === true` or `truncated === true`.
* **Notes:**
  * This is a hygiene / baseline signal and can be interpreted differently depending on tenant maturity and licensing.
  * Detailed policy configuration remains in Conditional Access artefacts; the finding is a summary signal.
  * Because this is collector-emitted, it is **not** in the `DERIVATIONS` registry in `findings/index.ts`. The posture findings below (`ENTRA_CA_002`–`ENTRA_CA_004`) are derivation-pipeline findings and all gate on `enabledPolicies > 0` to avoid double-noise.

---

### `ENTRA_CA_002` — No Conditional Access policy enforces MFA

* **Collector:** `entra.conditionalAccess.policies`
* **Derivation:** `entra.conditionalAccess.posture` (`entraConditionalAccessFinding.ts`)
* **Derived from observed check(s):** `ENTRA_CA_OBS_001`
* **Severity (implemented):** `medium`
* **Meaning:** Conditional Access policies are present and enabled, but none of them have an MFA grant control (`builtInControls` includes `"mfa"`). No MFA enforcement is detectable via Conditional Access.
* **Guards (to avoid false signals):**
  * Only emit when `permissionDenied === false` and `truncated === false` (reliable data).
  * Only emit when `enabledPolicies > 0` (zero-policy case is `ENTRA_CA_001` territory).
  * Only emit when `policiesWithMfaGrantControl === 0`.
* **Notes:**
  * The collector's `policiesWithMfaGrantControl` counts enabled policies where `grantControls.builtInControls` includes `"mfa"`.
  * Does not attempt to infer MFA from authentication strength policies or per-app controls — only the standard `mfa` built-in control is checked.
  * A tenant may have MFA enforced via per-user MFA or other mechanisms not visible to this collector; the finding is a CA-scoped signal, not a global MFA absence claim.

---

### `ENTRA_CA_003` — Legacy authentication protocols not blocked by Conditional Access

* **Collector:** `entra.conditionalAccess.policies`
* **Derivation:** `entra.conditionalAccess.posture` (`entraConditionalAccessFinding.ts`)
* **Derived from observed check(s):** `ENTRA_CA_OBS_001`
* **Severity (implemented):** `medium`
* **Meaning:** No enabled Conditional Access policy is detected that blocks legacy authentication protocols (Exchange ActiveSync and Other client app types with a Block grant control). Legacy protocols do not support modern authentication and can bypass MFA.
* **Guards (to avoid false signals):**
  * Only emit when `permissionDenied === false` and `truncated === false`.
  * Only emit when `enabledPolicies > 0`.
  * Only emit when `hasLegacyAuthPolicyDetected === false`.
* **Notes:**
  * The collector's `detectsLegacyAuthBlock` checks for a policy with `clientAppTypes` containing `"exchangeactivesync"` or `"other"` AND `grantControls.builtInControls` containing `"block"`.
  * If a policy targets legacy auth but uses grant controls other than Block (e.g. MFA), `hasLegacyAuthPolicyDetected` will be `false` and this finding will still emit — the detection is specifically for Block-based legacy auth blocking.

---

### `ENTRA_CA_004` — Conditional Access policies contain user exclusions

* **Collector:** `entra.conditionalAccess.policies`
* **Derivation:** `entra.conditionalAccess.posture` (`entraConditionalAccessFinding.ts`)
* **Derived from observed check(s):** `ENTRA_CA_OBS_001`
* **Severity (implemented):** `low`
* **Meaning:** One or more enabled Conditional Access policies have entries in their `excludeUsers` array. Excluded users bypass the policy's controls (including MFA). The finding title includes the total exclusion count for immediate context.
* **Guards (to avoid false signals):**
  * Only emit when `permissionDenied === false` and `truncated === false`.
  * Only emit when `enabledPolicies > 0`.
  * Only emit when `policiesExcludingUsersCount > 0`.
* **Notes:**
  * `policiesExcludingUsersCount` is the **sum** of `excludeUsers.length` across all scanned policies — not a count of policies with exclusions. A single policy with 3 excluded users contributes 3.
  * Break-glass / emergency access accounts are a valid reason to have exclusions; the finding is a governance advisory, not an automatic misconfiguration flag.
  * Group exclusions (`excludeGroups`) are not counted here — only `excludeUsers` entries are reflected in `policiesExcludingUsersCount`.

---

### `ENTRA_CA_005` — No enabled all-users MFA Conditional Access policy detected in available evidence

* **Collector:** `entra.conditionalAccess.policies`
* **Derivation:** `entra.conditionalAccess.posture` (`entraConditionalAccessFinding.ts`)
* **Derived from observed check(s):** `ENTRA_CA_DERIVED_001` (derived OBS — see `docs/findings-observed-checks.md`)
* **Severity (implemented):** `medium`
* **Meaning:** Conditional Access policies exist in an enabled state, but the available per-policy evidence does not contain any policy that simultaneously satisfies all three of: enabled state, an MFA grant control (`builtInControls` includes `"mfa"`), and all-users targeting (`includeUsers: "All"`).
* **Guards (to avoid false signals):**
  * Only emit when `ENTRA_CA_DERIVED_001` is present in the run's observed checks. Absence of the OBS means the CA artefact was incomplete (permission-denied or truncated) and this finding must not fire.
  * Only emit when `hasAnyEnabledPolicy === true`. When no policies are enabled, `ENTRA_CA_001` is the primary signal; do not double-emit.
  * Only emit when `hasEnabledMfaForAllUsers !== true`.
  * Note: the `enabledPolicies === 0` early return in OBS-001 processing (which would prevent any CA finding from emitting) is safe here because `enabledPolicies === 0` implies `hasAnyEnabledPolicy === false`, which is already a guard above.
* **Relationship to `ENTRA_CA_002`:**
  * `ENTRA_CA_002` fires when `policiesWithMfaGrantControl === 0` (no MFA policy in any state, from `ENTRA_CA_OBS_001`).
  * `ENTRA_CA_005` fires when `hasEnabledMfaForAllUsers === false` (no policy satisfies the enabled + all-users + MFA intersection, from `ENTRA_CA_DERIVED_001`).
  * Both may co-emit when no MFA CA policies exist at all. `ENTRA_CA_005` provides distinct value when MFA policies exist in some form but none is the enabled + all-users combination.
* **Evidence limitations (must be noted — do not suppress the finding based on these):**
  1. **Authentication strength grants:** CA policies using `authenticationStrength` grants (e.g. phishing-resistant MFA) rather than the standard `mfa` built-in control are **not visible** in the safe artefact profile. Such policies would not set `hasEnabledMfaForAllUsers = true` and would not suppress this finding.
  2. **Role-targeted policies:** CA policies that target specific directory roles via `includeRoles` are **not detected** as all-users policies. The safe artefact strips `includeRoles` GUIDs; only `includeRolesCount` is preserved. A policy covering only Global Administrators (not `includeUsers: "All"`) would not suppress this finding.
  * Both limitations are documented in the recommendation text to inform the reviewer that a false positive is possible when either pattern is in use.
* **Notes:**
  * This is a CA-scoped, evidence-bounded signal. It does not claim that MFA is absent from the tenant — only that the per-policy evidence does not show an enabled, all-users, MFA-grant-control policy.
  * The finding wording deliberately says "not detected in available evidence" rather than "does not exist" to accurately reflect the evidence bounds.

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

### `ENTRA_GLOBAL_ADMIN_001` — Multiple Global Administrators detected

* **Collector:** `entra.directoryRoles.assignments`
* **Derivation:** `entra.directoryRoles.privilegedAccess` (`entraDirectoryRolesFinding.ts`)
* **Derived from observed check(s):** `ENTRA_DIRROLES_OBS_001`, `ENTRA_DIRROLES_OBS_005`

* **Severity (implemented):** `medium`

* **Meaning:** Based on available evidence, more than one Global Administrator assignment exists in this tenant. Standing Global Administrator access shared across multiple accounts increases blast radius — if any one of those accounts is compromised, the attacker immediately holds the highest level of privilege in the Microsoft 365 environment. This is a baseline governance signal about the existence of shared standing GA access, not a comment on the absolute count being unusually high.

* **Guards (to avoid false signals):**
  * Only emit when core evidence is complete (`ENTRA_DIRROLES_OBS_005.isComplete === true` and not truncated). Absence of completeness confirmation means the count may be understated; no finding is emitted.
  * Only emit when `globalAdminCount > 1` (strict: two or more GA assignments observed).
  * Do **not** emit when `globalAdminCount` is `null` or absent.

* **Relationship to `ENTRA_DIRROLES_010`:**
  * `ENTRA_GLOBAL_ADMIN_001` — baseline governance signal: "more than one GA assignment exists at all" (threshold: `> 1`)
  * `ENTRA_DIRROLES_010` — elevated count signal: "the number of GA assignments is unusually high" (threshold: `>= 3`, with severity escalating at `>= 5`)
  * Both findings may co-emit when `globalAdminCount >= 3`. Each addresses a distinct risk dimension and neither supersedes the other.

* **Notes:**
  * Uses `ENTRA_DIRROLES_OBS_001.globalAdminCount`, derived via the well-known Global Administrator template ID `62e90394-69f5-4237-9190-012177145e10` with display-name fallback.
  * The recommendation deliberately does not frame this as a fault — it is a governance prompt. The tenant may have legitimate operational reasons for multiple GA accounts (e.g., break-glass accounts, delegation across geo regions). The recommendation points to role minimisation and PIM/JIT as the stronger future-state control.

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

### `ENTRA_PIM_001` — No PIM-eligible role assignments detected

* **Collector:** `entra.directoryRoles.assignments`
* **Derivation:** `entra.directoryRoles.privilegedAccess` (`entraDirectoryRolesFinding.ts`)
* **Derived from observed check(s):** `ENTRA_DIRROLES_OBS_001`, `ENTRA_DIRROLES_OBS_004`, `ENTRA_DIRROLES_OBS_005`

* **Severity (implemented):** `medium`

* **Meaning:** The Privileged Identity Management (PIM) eligibility schedules API was successfully queried and returned zero eligible role assignments, while standing active role assignments are present in the directory. This suggests privileged access is granted on a permanent basis rather than through just-in-time (JIT) activation. Standing privileged access widens the window of exposure if a privileged account is compromised — an attacker gains immediate and continuous elevated access without needing to trigger or approve a PIM activation request.

* **Guards (to avoid false signals):**
  1. `ENTRA_DIRROLES_OBS_004` must be present. The collector only emits this OBS when `DIRROLES_ENABLE_PIM_SLICE !== "0"` (env-controlled, default `"1"`). Absence means the PIM slice was explicitly disabled; the finding is skipped silently.
  2. `ENTRA_DIRROLES_OBS_004.succeeded === true`. The collector sets `succeeded: false` on 403 (Entra ID P2 not licensed or admin consent missing) and on any other API error. Absence of eligibility data must not be read as absence of eligible roles.
  3. `eligibleAssignmentsCount === 0`. The collector sets this to `schedules.length` on success and leaves it `undefined` on failure. `asNumber(undefined)` returns `null`, so the `=== 0` check silently guards the undefined path.
  4. Core completeness (`ENTRA_DIRROLES_OBS_005.isComplete === true` and `truncated !== true`) — active assignment data must be trustworthy.
  5. `ENTRA_DIRROLES_OBS_001.activeAssignmentsCount > 0`. If there are no standing assignments there is nothing to protect with JIT; emitting would be noise.

* **Evidence limitation — PIM for Groups:**
  The `roleEligibilitySchedules` endpoint covers **direct role eligibility** only. PIM for Groups — where group membership is eligible and that group holds a directory role — creates equivalent JIT coverage that is **not visible** via this endpoint. A tenant using PIM for Groups would still show `eligibleAssignmentsCount === 0` and `ENTRA_PIM_001` would fire. The recommendation text acknowledges this so reviewers can dismiss the finding when PIM for Groups is in active use.

* **Relationship to `ENTRA_DIRROLES_010` and `ENTRA_DIRROLES_012`:**
  * `ENTRA_DIRROLES_010` — flags an elevated count of Global Administrators (blast-radius risk)
  * `ENTRA_DIRROLES_012` — flags a large total active-assignment surface (governance complexity)
  * `ENTRA_PIM_001` — flags the absence of JIT governance over whatever standing assignments exist
  * All three can co-emit and each addresses a distinct risk dimension.

---

## SharePoint — Admin Settings (`SPO_SHARING_*`, `SPO_LEGACY_AUTH_*`)

### `SPO_SHARING_001` — SharePoint tenant sharing capability is permissive

* **Collector:** `sharepoint.admin.settings`
* **Derivation:** `spo.admin.settings.sharing` (`spoSharingFinding.ts`)
* **Derived from observed check(s):** `SPO_ADMIN_OBS_001`
* **Severity (implemented):** `medium` or `info` (depends on sharing level — see below)
* **Meaning:** The tenant-level SharePoint sharing setting is in a permissive state. The finding fires for two distinct sharing levels with different severities:

  | `sharingCapability` value | Severity | Title |
  |---|---|---|
  | `externalUserAndGuestSharing` | `medium` | "SharePoint tenant sharing allows anonymous links" |
  | `externalUserSharingOnly` | `info` | "SharePoint tenant sharing allows external user invitations" |

* **Guards (to avoid false signals):**
  * Only emit when `sharingCapability` is a non-null string (null implies the API call failed or was permission-denied).
  * No finding emitted for `"disabled"` or `"existingExternalUserSharingOnly"`.
* **Notes:**
  * This is a tenant-level governance signal. Site-level sharing controls may be more restrictive.
  * `externalUserAndGuestSharing` (Anyone links) is the highest-risk setting; link-expiry and scope policies should be validated.
  * `externalUserSharingOnly` is common in organisations with legitimate external collaboration; the `info` severity reflects that it is a well-known, commonly-accepted configuration.

---

### `SPO_LEGACY_AUTH_001` — SharePoint legacy authentication protocols are enabled

* **Collector:** `sharepoint.admin.settings`
* **Derivation:** `spo.admin.settings.sharing` (`spoSharingFinding.ts`)
* **Derived from observed check(s):** `SPO_ADMIN_OBS_001`
* **Severity (implemented):** `medium`
* **Meaning:** The SharePoint tenant-level setting `isLegacyAuthProtocolsEnabled` is `true`. Legacy authentication (pre-modern-auth clients using basic auth or forms-based auth to SharePoint) bypasses Conditional Access policies entirely, including any policy that enforces MFA.
* **Guards (to avoid false signals):**
  * Only emit when `SPO_ADMIN_OBS_001.isComplete === true`. The collector sets `isComplete: false` on any API failure (403 or unexpected error); in those cases `isLegacyAuthProtocolsEnabled` will be `null` and must not produce a finding.
  * Only emit when `isLegacyAuthProtocolsEnabled === true` (explicit boolean, not null or false).
* **Relationship to `ENTRA_CA_003`:**
  * `ENTRA_CA_003` fires when no Conditional Access policy blocks legacy auth at the Azure AD identity broker level.
  * `SPO_LEGACY_AUTH_001` fires when the SharePoint service layer still accepts legacy auth, regardless of any CA policy.
  * Both findings can co-emit and both are independently valid. They operate at different control layers. Disabling legacy auth at the SharePoint service level is recommended even when CA-level blocking is in place (defence in depth).
* **Notes:**
  * Some legacy integrations (on-premises connectors, third-party line-of-business tools) may genuinely require legacy auth. The recommendation text acknowledges this; the finding is the prompt to verify.
  * `medium` severity reflects that legacy auth enablement is a concrete bypass vector for MFA, but its impact depends on whether legacy clients are actually in use in the tenant.

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

---

## Exchange — Mailboxes (`EXO_MAILBOXES_*`)

### `EXO_MAILBOXES_COVERAGE_001` — Exchange mailbox usage report unavailable

* **Collector:** `exchange.mailboxes.inventory`
* **Derivation:** `exo.mailboxes.coverage` (`exoMailboxesCoverageFinding.ts`)
* **Derived from observed check(s):** `EXO_MAILBOXES_OBS_001`

* **Severity (implemented):**
  * `medium` when `permissionDenied` includes `"microsoft.graph/reports:getMailboxUsageDetail"` (active permissions gap)
  * `low` when `truncated === true` (unexpected/transient failure)
  * `info` otherwise (report not yet generated — 400/404 path)

* **Meaning:** The Exchange mailbox usage report could not be retrieved. Mailbox count, size distribution, and licensing pressure metrics are unavailable for this run.

* **Guards:**
  * Only emits when `EXO_MAILBOXES_OBS_001.isComplete === false`.
  * Suppressed when `isComplete === true` or when the OBS is absent entirely.

* **Title variants:**
  * `permissionDenied` includes `"microsoft.graph/reports:getMailboxUsageDetail"` → "Exchange mailbox usage report unavailable — reporting permissions missing"
  * `truncated === true` (unexpected failure) → "Exchange mailbox usage report unavailable"
  * All other incomplete cases (400/404, report not ready) → "Exchange mailbox usage report unavailable — report data not yet generated"

* **Notes:**
  * Exists to prevent a run with zero `EXO_LICENSE_001` findings from being misread as "no mailbox pressure" when the real cause is missing or unavailable reporting data.
  * Permission-denied path: `Reports.Read.All` application permission requires admin consent.
  * Report-not-ready path: Exchange reporting initialisation can take 24–48 hours on new or lightly used tenants; re-running usually resolves it.

---

## Exchange — Transport Rules (`EXO_TRANSPORT_*`)

### `EXO_TRANSPORT_001` — Mail flow rule routing email to external recipients detected

* **Collector:** `exchange.transportRules`
* **Derivation:** `exchange.transportRules.posture` (`exchangeTransportRulesFinding.ts`)
* **Derived from observed check(s):** `EXO_TRANSPORT_OBS_001`

* **Severity (implemented):** `high`

* **Meaning:** At least one **enabled** Exchange transport rule contains an action that routes messages to addresses outside the tenant's primary domain. Actions checked: `RedirectMessageTo`, `ForwardMessageTo`, `BlindCopyTo`, `CopyTo`.

* **Guards (to avoid false signals):**
  * Only emit when `EXO_TRANSPORT_OBS_001.isComplete === true` (i.e. `permissionDenied === false` and `truncated === false`). When collection was incomplete, the absence of this finding **must not** be read as "no forwarding rules exist".
  * Only emit when `rulesWithExternalForwardingCount > 0`.

* **Notes:**
  * **Detection scope:** "External" is determined at collection time by comparing each recipient address against the tenant's `primaryDomain` and any `.onmicrosoft.com` routing domain. Tenants with multiple verified custom domains may receive false positives for rules forwarding to a secondary custom domain — reviewers should verify recipient domains against the organisation's verified domain list.
  * **Risk context:** Auto-forwarding transport rules are among the most common persistence mechanisms observed in business email compromise (BEC) attacks. Attackers create rules to silently forward a copy of received mail to an external mailbox, enabling ongoing surveillance without visible inbox items.
  * The finding title includes the count of affected rules. The `references.forwardingRuleNames` field carries up to 10 rule names for quick identification during review (capped to bound the finding payload size).
  * A `high` severity reflects the near-certain data-exfiltration risk when external forwarding is unexplained. Legitimate partner-relay rules should be documented and excepted; the finding is the prompt to confirm that documentation exists.
  * **Required permissions:** `Exchange.ManageAsApp` application role + Exchange Administrator role assignment for the app service principal. These are separate from the Microsoft Graph permissions used by other collectors and must be granted independently in the Exchange admin centre.

---

### `EXO_TRANSPORT_002` — Mail flow rule bypasses spam filtering (SCL -1)

* **Collector:** `exchange.transportRules`
* **Derivation:** `exchange.transportRules.posture` (`exchangeTransportRulesFinding.ts`)
* **Derived from observed check(s):** `EXO_TRANSPORT_OBS_001`

* **Severity (implemented):** `medium`

* **Meaning:** At least one **enabled** Exchange transport rule sets the Spam Confidence Level (SCL) to `-1`. SCL -1 instructs Exchange Online Protection to skip spam analysis for any message matched by the rule's conditions, delivering those messages directly to the inbox regardless of content.

* **Guards (to avoid false signals):**
  * Only emit when `EXO_TRANSPORT_OBS_001.isComplete === true`.
  * Only emit when `rulesWithSclBypassCount > 0`.

* **Notes:**
  * **Why `SetSCL=-1` specifically:** SCL -1 is the only Exchange-defined value that unconditionally bypasses spam analysis. Other `SetSCL` values (0–9) adjust the score but do not remove filtering. A rule with `SetSCL=-1` is an explicit, deliberate bypass.
  * **Legitimate uses:** Trusted on-premises relay servers, approved bulk mail systems, and shared-mailbox relay scenarios commonly use SCL bypass rules. The finding is intentionally `medium` (not `high`) because legitimate uses are common — the value is in prompting a review, not raising an alarm.
  * **Attack pattern:** Phishing infrastructure operators sometimes create broad SCL bypass rules (e.g. targeting all inbound mail from a specific domain or IP range they control) to ensure malicious payloads reach inboxes past EOP spam filtering. A bypass rule with unexpectedly broad conditions is the signal to investigate.
  * The finding title includes the count of affected rules. `references.sclBypassRuleNames` carries up to 10 rule names for reviewer orientation.

---

### `EXO_TRANSPORT_003` — Mail flow rule with suppressive action and no scope conditions detected

* **Collector:** `exchange.transportRules`
* **Derivation:** `exchange.transportRules.posture` (`exchangeTransportRulesFinding.ts`)
* **Derived from observed check(s):** `EXO_TRANSPORT_OBS_001`

* **Severity (implemented):** `high`

* **Meaning:** At least one **enabled** Exchange transport rule carries a suppressive action (`DeleteMessage` or `Quarantine`) **and** has no detectable narrowing conditions. A rule that silently deletes or quarantines messages without any scope restriction applies to all messages in the connector's context with no discrimination.

* **Guards (to avoid false signals):**
  * Only emit when `EXO_TRANSPORT_OBS_001.isComplete === true` (i.e. `permissionDenied === false` and `truncated === false`).
  * Only emit when `rulesWithSuppressiveActionCount > 0`.
  * The **breadth heuristic** in the collector already pre-filters: only rules where ALL of the following condition fields are absent or empty are counted — `SenderDomainIs`, `From`, `FromAddressContainsWords`, `FromAddressMatchesPatterns`, `FromMemberOf`, `SenderIpRanges`, `SubjectContainsWords`, `SubjectMatchesPatterns`, `RecipientDomainIs`, `SentTo`, `SentToMemberOf`, `RecipientAddressContainsWords`, `AnyOfRecipientAddressContainsWords`, `MessageTypeMatches`. Narrow admin rules (e.g. "delete NDRs from a specific domain") are excluded by this heuristic and will not generate findings.

* **Notes:**
  * **Attack pattern:** Attackers who have compromised an admin account sometimes create broad delete or quarantine rules to suppress security alert emails, password change notifications, or sign-in alerts that would otherwise surface the compromise to legitimate users. Rules with no conditions maximise the suppression surface.
  * **Heuristic limitation:** The collector checks a representative but not exhaustive set of condition fields. Exchange has additional condition fields (e.g. `HeaderContainsWords`, `AttachmentExtensionMatchesWords`, `HasSenderOverride`) that are not in the breadth check. A rule that uses only one of those unlisted conditions will still appear "broad" here. Reviewers should always confirm the full rule configuration directly in the Exchange admin centre.
  * `high` severity reflects the potential for complete mail-loss or alert suppression at tenant scale. Legitimate suppressive rules (e.g. deleting meeting-room auto-accept noise) should have narrow conditions; the finding is the prompt to confirm those conditions exist.
  * `references.suppressiveActionRuleNames` carries up to 10 rule names for quick identification during review.

---

### Observed check: `EXO_TRANSPORT_OBS_001`

> **Registry note:** Observed checks are documented here inline for the Exchange transport rules domain because no separate `findings-observed-checks.md` entry exists yet for this collector. Move to that document when the transport rules OBS section is formalised.

* **Collector:** `exchange.transportRules`
* **API:** `POST https://outlook.office365.com/adminapi/beta/{tenantId}/InvokeCommand` (`Get-TransportRule`)

**Payload shape:**

```jsonc
{
  // ── Completeness signals (always present) ─────────────────────────────────
  // Derivation pipeline must gate on isComplete before drawing risk conclusions.
  "isComplete": true,         // true iff permissionDenied===false && truncated===false
  "permissionDenied": false,  // 401/403 from Exchange Admin API
  "truncated": false,         // any other error (token failure, 5xx, network)
  "errorCode": null,          // HTTP status that caused failure, or null
  "errorMessage": null,       // truncated error body (≤400 chars), or null

  // ── Facts (meaningful only when isComplete === true) ──────────────────────
  "totalRules": 5,            // total transport rules in tenant
  "enabledRulesCount": 3,     // rules in "Enabled" state

  // ── EXO_TRANSPORT_001: external-forwarding detection ──────────────────────
  "rulesWithExternalForwardingCount": 1, // enabled rules with external recipient in any forwarding action
  "forwardingRuleNames": ["Rule name"],  // names of those rules (max 20 entries)

  // ── EXO_TRANSPORT_002: spam-filter bypass detection ───────────────────────
  "rulesWithSclBypassCount": 1,          // enabled rules where SetSCL === -1
  "sclBypassRuleNames": ["Rule name"],   // names of those rules (max 20 entries)

  // ── EXO_TRANSPORT_003: broad suppressive-action detection ─────────────────
  // Only counts enabled rules with DeleteMessage=true or Quarantine=true
  // that also have NO detectable narrowing conditions (breadth heuristic).
  "rulesWithSuppressiveActionCount": 0,      // enabled broad suppressive-action rules
  "suppressiveActionRuleNames": [],          // names of those rules (max 20 entries)

  // ── Context ───────────────────────────────────────────────────────────────
  "tenantPrimaryDomain": "contoso.com"  // domain used for "external" determination at collection time
}
```

**`isComplete` is the primary gate** for findings derivation. `permissionDenied` and `truncated` are retained as separate booleans to allow future coverage findings to distinguish between the two failure modes (actionable permissions gap vs transient error).

**Permission failure path** (`permissionDenied: true`): the app registration lacks `Exchange.ManageAsApp` or the service principal has not been assigned an Exchange management role in this tenant. This is separate from the Microsoft Graph permissions required by other collectors.

**Truncated path** (`truncated: true`): token acquisition failure (misconfigured credentials), unexpected HTTP error, or network failure. Re-running the scan after confirming credentials and role assignments usually resolves it.

---

## Exchange — Connectors (`EXO_CONNECTOR_*`)

### `EXO_CONNECTOR_001` — Inbound connector accepts mail without sender IP restriction or TLS certificate validation

* **Collector:** `exchange.connectors`
* **Derivation:** `exchange.connectors.posture` (`exchangeConnectorsFinding.ts`)
* **Derived from observed check(s):** `EXO_CONNECTOR_OBS_001`

* **Severity (implemented):** `medium`

* **Meaning:** At least one **enabled** inbound Exchange connector has neither a sender IP restriction (`SenderIPAddresses`) nor a TLS certificate identity check (`RestrictDomainsToCertificate` / `TlsSenderCertificateName`). Without at least one of these controls, the connector relies solely on sender domain matching (`SenderDomains`), which any SMTP server can spoof.

* **Guards (to avoid false signals):**
  * Only emit when `EXO_CONNECTOR_OBS_001.isComplete === true` (i.e. `permissionDenied === false` and `truncated === false`). When collection was incomplete, the absence of this finding must not be read as "no permissive connectors exist".
  * Only emit when `permissiveInboundConnectorsCount > 0`.

* **Notes:**
  * **Detection logic:** A connector is "permissive" when all three conditions hold:
    1. `Enabled === true`
    2. `SenderIPAddresses` is absent or empty (no source IP restriction)
    3. `RestrictDomainsToCertificate !== true` AND `TlsSenderCertificateName` is empty/null (no TLS cert identity check)
    If the connector has either a non-empty `SenderIPAddresses` list OR a certificate check, it is **not** flagged.
  * **Why `RequireTLS=true` alone does not qualify:** `RequireTLS` enforces that the connection uses TLS but does not validate the sender's certificate subject. Any SMTP server with a valid TLS certificate passes. Certificate identity validation (`RestrictDomainsToCertificate` + `TlsSenderCertificateName`) is required to verify WHO holds the certificate.
  * **Risk context:** Permissive inbound connectors are a common misconfiguration in hybrid Exchange environments. An attacker with knowledge of the tenant's connector domains can route spoofed mail through the connector, potentially bypassing anti-phishing controls and triggering `TreatMessagesAsInternal` trust if that setting is enabled.
  * **Legitimate use:** Many on-premises relay and partner connectors are legitimately permissive when the sending server's IP range is dynamic or unknown. The finding is `medium` (not `high`) to reflect that legitimate uses are common and a review-prompt is more appropriate than an alarm.
  * `references.permissiveInboundConnectorNames` carries up to 10 connector names for reviewer orientation.
  * **Required permissions:** same as other Exchange collectors — `Exchange.ManageAsApp` application role + Exchange Administrator role for the service principal.

---

### Observed check: `EXO_CONNECTOR_OBS_001`

> **Registry note:** Observed checks are documented here inline for the Exchange connectors domain. Move to `docs/findings-observed-checks.md` when the connectors OBS section is formalised.

* **Collector:** `exchange.connectors`
* **API:** `POST https://outlook.office365.com/adminapi/beta/{tenantId}/InvokeCommand` (`Get-InboundConnector`)

**Payload shape:**

```jsonc
{
  // ── Completeness signals (always present) ─────────────────────────────────
  "isComplete": true,         // true iff permissionDenied===false && truncated===false
  "permissionDenied": false,  // 401/403 from Exchange Admin API
  "truncated": false,         // any other error (token failure, 5xx, network)
  "errorCode": null,          // HTTP status that caused failure, or null
  "errorMessage": null,       // truncated error body (≤400 chars), or null

  // ── Inventory facts (meaningful only when isComplete === true) ────────────
  "totalInboundConnectors": 2,           // total inbound connectors (enabled + disabled)
  "enabledInboundConnectorsCount": 2,    // connectors in enabled state

  // ── EXO_CONNECTOR_001: permissive inbound connector detection ─────────────
  // A connector is "permissive" when enabled AND has no SenderIPAddresses AND
  // has no TLS cert check (RestrictDomainsToCertificate or TlsSenderCertificateName).
  "permissiveInboundConnectorsCount": 1,             // count of permissive connectors
  "permissiveInboundConnectorNames": ["Connector"]   // names of those connectors (max 20)
}
```

**`isComplete` is the primary gate** for findings derivation. `permissionDenied` and `truncated` are retained as separate booleans to allow future coverage findings to distinguish between the two failure modes.

**Permission failure path** (`permissionDenied: true`): same as the transport rules collector — `Exchange.ManageAsApp` application role + Exchange Administrator role for the service principal must be granted.

**Truncated path** (`truncated: true`): token acquisition failure or unexpected HTTP error. Re-running the scan usually resolves it.

