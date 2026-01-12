# Findings Registry (Implemented Checks)

This document lists **implemented** finding `checkId` values and their meaning.

It exists to prevent:
- accidental ID reuse
- drifting meanings
- inconsistent naming across collectors

**Contract rule:** A `checkId` must never change meaning once shipped.

For the findings model and future taxonomy concepts, see:
- `docs/findings-model.md`

---

## Entra — Enterprise App Permissions (`ENTRA_EAP_*`)

### `ENTRA_EAP_001` — High-privilege Graph permissions detected
- **Collector:** `entra.enterpriseApps.permissions`
- **Severity (implemented):** `high`
- **Category (future-facing guidance):** `application_permissions`
- **Meaning:** At least one enterprise application has high-privilege Microsoft Graph application permissions that materially increase tenant risk.
- **UI note:** This is a decision-ready security signal. Do not treat as inventory; detailed evidence belongs in the enterprise app permissions artefact.

### `ENTRA_EAP_002` — Scan truncated (results may be incomplete)
- **Collector:** `entra.enterpriseApps.permissions`
- **Severity (implemented):** `info`
- **Category (future-facing guidance):** `data_completeness`
- **Meaning:** The scan was intentionally limited (e.g. demo cap / throttling controls), so results may not reflect the full tenant.
- **Demo-only:** Yes (current demo guardrails such as `ENTAPP_MAX_APPS`)
- **UI note:** Present as a completeness warning. Avoid implying the tenant is “clean” if truncation occurred.
