# Collectors (Contract, Behaviour, and Design Rules)

Collectors are worker-executed modules that gather Microsoft 365 / Entra telemetry and produce:

- **Findings** (decision-ready signals: risks, gaps, misconfigurations, notable scoping complexity)
- **Artefacts** (evidence payloads: inventories, reports, raw/structured exports)

Collectors never run inside the API. They run in the **worker** and persist outputs via Prisma.

This document defines the **collector contract** and the rules we use to keep outputs consistent, safe, and useful.

---

## Goals

Collectors must produce outputs that are:

- **Consistent** (stable schema over time)
- **Explainable** (humans can interpret results)
- **Composable** (UI + reporting can aggregate across collectors)
- **Secure-by-design** (least privilege; avoid sensitive leakage)
- **Scoping-friendly** (inventory + complexity signals, not just security posture)

---

## Execution model (high level)

1. A **Run** is created (API) with a set of enabled modules/collectors.
2. The API enqueues **Jobs** for those collectors (and, in the current iteration, report jobs are enqueued last).
3. The worker dequeues jobs, executes the collector, and persists:
   - Findings (via Prisma)
   - Artefacts (uploaded to object storage + recorded in DB)
   - Job status, timing, and error information

---

## Collector interface (contract)

Collectors implement the `Collector` interface and return a `CollectorResult` with this shape:

- `id` — collector identifier (must match the registered collector id)
- `status` — `"ok" | "warning" | "error"`
- `summary` — small, human-friendly summary (counts, flags)
- `data` — optional structured data (avoid large payloads)
- `artefacts` — optional downloadable outputs

Rules:
- `id` **must** equal the collector’s registered ID (e.g. `entra.users`)
- `summary` should be small and stable
- `data` should not contain large inventories
- inventory-style outputs should be artefacts
- throw errors for unexpected conditions (job will fail / retry)

---

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
- Audit retention below recommended minimum

### Artefacts

Use artefacts for **evidence** or **inventory** that is:

- Large or multi-record
- Useful to download
- Supports findings
- Useful for scoping and effort estimation

Examples:
- Enterprise app permissions export (JSON)
- Users inventory
- Run summary exports (CSV/XLSX)

---

## Scoping vs Security (two lenses)

The platform intentionally supports two complementary lenses:

### Security assessment lens
- Focus: risk, misconfiguration, hardening opportunities
- Output: high-value findings with severity, confidence, recommendations

### Scoping / effort estimation lens (primary driver)
- Focus: what exists, scale, complexity, migration or take-on effort
- Output: inventories and “complexity driver” signals

A single collector may:
- emit one or more artefacts (inventory/report)
- emit a small number of findings that act as complexity or governance signals

---

## Design rules (must-follow)

1. **Least privilege**
   - Request only required Microsoft Graph permissions
   - Prefer read-only scopes

2. **Avoid sensitive leakage**
   - Do not store secrets or tokens
   - Keep finding evidence minimal (counts, identifiers only where required)

3. **Stable identifiers**
   - Use stable `collectorId` values (e.g. `entra.users`)
   - Use stable `checkId` values (e.g. `ENTRA_EAP_001`)
   - Do not change the meaning of existing IDs once shipped

4. **Avoid findings spam**
   - Inventory collectors should not emit hundreds of low-value `info` findings long-term
   - Prefer artefacts + summary rollups

5. **Artefacts are the evidence layer**
   - Findings should reference the evidence conceptually and avoid duplicating large datasets

6. **Treat contracts as stable**
   - Collector IDs, artefact keys, and exported report schema are treated as contracts.
   - If a contract must change, document it and version it deliberately.

---

## Report collectors (current iteration)

To support demos and early user value, we also run “report” collectors. These are normal worker collectors but their purpose is to export aggregated views of a run.

Current report collector IDs:
- `report.runSummary.csv` → uploads `run-summary.csv`
- `report.runSummary.xlsx` → uploads `run-summary.xlsx`

These are enqueued last so they run after discovery collectors have produced findings and artefacts.

> Demo vs long-term: Reports are derived views. Long-term, the platform should be able to generate report artefacts from stored findings/artefacts without needing to re-run discovery.

---

## Current collectors (implemented)

- `entra.users`
  - Artefact: users inventory (JSON)
  - Findings: user/audit signals as implemented (e.g. permission gaps, inactivity signals)

- `entra.enterpriseApps.permissions`
  - Artefact: enterprise app permissions export (JSON)
  - Findings:
    - `ENTRA_EAP_001` high-privilege Graph permissions detected
    - `ENTRA_EAP_002` scan truncated (results may be incomplete)

- `entra.auth.test`
  - Purpose: validates app-only Graph access and updates tenant auth state
  - Artefacts: none (currently)
  - Findings: none (currently; status is expressed via TenantAuth)

---

## Roadmap expectations

As the platform evolves:
- collectors provide stable summaries
- inventories live in artefacts
- findings are reserved for decision-making signals
- the UI can reliably derive coverage and scoping confidence from collector success
- the Excel workbook evolves toward “one sheet per module” (CloudGeezer-like), but remains a view over evidence, not the evidence itself
