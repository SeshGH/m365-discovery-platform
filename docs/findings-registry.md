# Findings Registry (Implemented Checks)

This document lists **implemented** finding `checkId` values and their meaning.

It exists to prevent:

* accidental ID reuse
* drifting meanings
* inconsistent naming across collectors

**Contract rule:** A `checkId` must never change meaning once shipped.

For the findings model and future taxonomy concepts, see:

* `docs/findings-model.md`

---

## Observed checks

Observed checks are **not findings**. They capture what was observed (facts and states) without forcing a pass/fail judgement.

* Observed check IDs and semantics are tracked in: `docs/findings-observed-checks.md`
* This registry remains **findings-only** to keep `checkId` meanings stable and easy to audit.

---

## Entra — Users (`ENTRA_USERS_*`)

### `ENTRA_USERS_001` — Guest users present

* **Collector:** `entra.users`
* **Severity (implemented):** `info`
* **Category (future-facing guidance):** `identity`
* **Meaning:** One or more guest users exist in the tenant. This is not inherently “bad”, but it is a governance and access complexity signal that should be reviewed.
* **UI note:** This is a small decision signal (counts only). Do not treat as inventory; the user inventory artefact remains the evidence layer.

---

## Entra — Enterprise App Permissions (`ENTRA_EAP_*`)

### `ENTRA_EAP_001` — High-privilege Graph permissions detected

* **Collector:** `entra.enterpriseApps.permissions`
* **Severity (implemented):** `high`
* **Category (future-facing guidance):** `application_permissions`
* **Meaning:** At least one enterprise application has high-privilege Microsoft Graph application permissions that materially increase tenant risk.
* **UI note:** This is a decision-ready security signal. Do not treat as inventory; detailed evidence belongs in the enterprise app permissions artefact.

### `ENTRA_EAP_002` — Scan truncated (results may be incomplete)

* **Collector:** `entra.enterpriseApps.permissions`
* **Severity (implemented):** `info`
* **Category (future-facing guidance):** `data_completeness`
* **Meaning:** The scan was intentionally limited (e.g. demo cap / throttling controls), so results may not reflect the full tenant.
* **Demo-only:** Yes (current demo guardrails such as `ENTAPP_MAX_APPS`)
* **UI note:** Present as a completeness warning. Avoid implying the tenant is “clean” if truncation occurred.
