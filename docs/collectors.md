# Collectors (Contract, Behaviour, and Design Rules)

Collectors are worker-executed modules that gather Microsoft 365 / Entra telemetry and produce:

- **Findings** (decision-ready signals: risks, gaps, misconfigurations, notable scoping complexity)
- **Artefacts** (evidence payloads: inventories, reports, raw/structured exports)

Collectors never run inside the API. They run in the **worker** and persist outputs via Prisma.

This document defines the **collector contract** and the rules we use to keep outputs consistent, safe, and useful.


## Goals

Collectors must produce outputs that are:

- **Consistent** (stable schema over time)
- **Explainable** (humans can interpret results)
- **Composable** (UI + reporting can aggregate across collectors)
- **Secure-by-design** (least privilege; avoid sensitive leakage)
- **Scoping-friendly** (inventory + complexity signals, not just security posture)


## Execution model (high level)

1. A **Run** is created (API) with a set of enabled modules/collectors.
2. The API enqueues **Jobs** for those collectors.
3. The worker dequeues jobs, executes the collector, and persists:
   - Findings (via Prisma)
   - Artefacts (uploaded to object storage + recorded in DB)
   - Job status, timing, and error information


## Collector interface (contract)

Collectors implement the `Collector` interface and must return a result object with this shape:

- `id` — collector identifier (must match the registered collector id)
- `status` — `"ok" | "warning" | "error"`
- `summary` — small, human-friendly summary (counts, flags)
- `data` — optional structured data (avoid large payloads)
- `artefacts` — optional downloadable outputs

Rules:
- `id` **must** equal the collector’s registered ID (e.g. `entra.users`)
- `summary` should be small and stable
- `data` should not contain large inventories
- Inventory-style outputs should be artefacts
- Throw errors for unexpected conditions (job will fail)


## Findings vs Artefacts

### Findings

Use findings for **signals** that are:

- Prioritisable (severity, confidence, score)
- Actionable (recommendation)
- Comparable across runs
- Useful to surface prominently in the UI

Examples:
- Enterprise app has high-privilege Graph permissions
- Too many Global Admins
- Conditional Access baseline missing
- Audit retention below recommended minimum


### Artefacts

Use artefacts for **evidence** or **inventory** that is:

- Large or multi-record
- Useful to download
- Supports findings
- Useful for scoping and effort estimation

Examples:
- Enterprise app permissions report (JSON/CSV)
- Users inventory
- Mailbox inventory
- SharePoint sites inventory


## Scoping vs Security (two lenses)

The platform intentionally supports **two complementary lenses**:

### Security assessment lens
- Focus: risk, misconfiguration, hardening opportunities
- Output: high-value findings with severity, confidence, recommendations

### Scoping / effort estimation lens (primary driver)
- Focus: what exists, scale, complexity, migration or take-on effort
- Output: inventories and “complexity driver” signals

A single collector may:
- Emit one or more artefacts (inventory/report)
- Emit a small number of findings that act as complexity or governance signals


## Design rules (must-follow)

1. **Least privilege**
   - Request only required Microsoft Graph permissions
   - Prefer read-only scopes

2. **Avoid sensitive leakage**
   - Do not store secrets or tokens
   - Keep findings evidence minimal

3. **Stable identifiers**
   - Use stable `checkId` values (e.g. `ENTRA_EAP_001`)
   - Do not change meaning of existing checkIds

4. **Avoid findings spam**
   - Inventory collectors should not emit hundreds of `info` findings long-term
   - Prefer artefacts + summary rollups

5. **Artefacts are the source of truth**
   - Findings should reference artefacts, not duplicate large datasets


## Current collectors

- `entra.users`
  - Inventory: users (counts-only artefact + summary)
  - Signal: inactive enabled users proportion (`ENTRA_USERS_002`)
    - A derived finding emitted when a high share of enabled users show no successful sign-in within a configured window.
    - Evidence is counts/percent only (no user list).

- `entra.enterpriseApps.permissions`
  - Inventory/report: enterprise app permissions (artefact)
  - Signal: high-privilege Graph permissions (`ENTRA_EAP_001`)


## Roadmap expectations

As the platform evolves:
- Every collector provides a stable summary
- Inventory lives in artefacts
- Findings are reserved for decision-making signals
- UI can reliably derive coverage and scoping confidence from collector success