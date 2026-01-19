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
* **Severity (implemented):** `info`
* **Meaning:** One or more guest users exist in the tenant.
* **Notes:**

  * This is not inherently “bad”, but it is a governance and access complexity signal.
  * Inventory belongs in the users artefact; the finding is a summary signal.

---

## Entra — Enterprise App Permissions (`ENTRA_EAP_*`)

### `ENTRA_EAP_001` — High-privilege Graph permissions detected

* **Collector:** `entra.enterpriseApps.permissions`
* **Severity (implemented):** `high`
* **Meaning:** At least one enterprise application has high-privilege Microsoft Graph **application** permissions that materially increase tenant risk.
* **Notes:**

  * This is a decision-ready security signal.
  * Detailed evidence belongs in the enterprise app permissions artefact.

### `ENTRA_EAP_002` — Scan truncated (results may be incomplete)

* **Collector:** `entra.enterpriseApps.permissions`
* **Severity (implemented):** `info`
* **Meaning:** The scan was intentionally limited (e.g. demo cap / throttling controls), so results may not reflect the full tenant.
* **Demo-only:** Yes (current demo guardrails such as `ENTAPP_MAX_APPS`).
* **UI/reporting note:** Treat as a completeness warning; avoid implying the tenant is “clean” if truncation occurred.

---

## Entra — Conditional Access (`ENTRA_CA_*`)

### `ENTRA_CA_001` — No enabled Conditional Access policies detected

* **Collector:** `entra.conditionalAccess.policies`

* **Severity (implemented):** `low`

* **Meaning:** Conditional Access policies were enumerated successfully and **none** were in an enabled state.

* **Guards (to avoid false signals):**

  * Only emit when evidence is complete (i.e. not permission-denied and not truncated/capped).
  * Do **not** emit when `permissionDenied === true` or `truncated === true`.

* **Notes:**

  * This is a hygiene / baseline signal and can be interpreted differently depending on tenant maturity and licensing.
  * Detailed policy configuration remains in Conditional Access artefacts; the finding is a summary signal.
