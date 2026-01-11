# Discovery Coverage & Roadmap

This document defines the **intended discovery coverage**, **output lenses**, and **evolution path** of the M365 Discovery Platform.

It exists to:
- capture architectural intent
- prevent scope drift
- provide a shared reference for future development and discussion
- document *why* certain collectors and outputs exist (or are planned)

This is a **capability roadmap**, not an implementation backlog.

---

## Core principle

The platform is a **discovery engine**, not a report generator.

It collects **facts** (artefacts), derives **interpretations** (findings), and presents multiple views (lenses) over the same evidence depending on the use case.

Security posture is one output — not the only one.

---

## Discovery layers

### 1) Artefacts (evidence layer)

Artefacts are:
- raw, machine-readable outputs (JSON, CSV, XLSX, ZIP, etc.)
- immutable per run/job
- directly traceable to a specific job and run
- suitable for validation, debugging, audit, and downstream processing

Artefacts answer:
> “What exactly did we observe?”

---

### 2) Findings (interpretation layer)

Findings are:
- normalised
- human-readable
- opinionated
- scored and prioritised

They are derived from artefacts and enriched with:
- severity
- confidence
- lifecycle status
- numeric score

Findings answer:
> “What does this mean, and how important is it?”

The findings model is defined in:
- `docs/findings-model.md` (source of truth)

---

### 3) Summaries / Reports (view layer)

Reports are derived views over the same underlying evidence.

In the current iteration, we generate report artefacts via worker “report collectors” so the portal/demo can download a single summary file per run.

Long-term direction:
- Reports should remain derived views (not new sources of truth).
- The UI should be able to generate or request reports without re-running discovery.

---

## Output lenses

The same discovery run can be viewed through different lenses.

These lenses share collectors, artefacts, and findings — they differ only in aggregation, emphasis, and presentation.

---

## Lens 1: Security Posture

Focus:
- risk, misconfiguration, hygiene

Typical summary sections:
- posture score (future)
- findings by severity
- top risks
- privilege and access concerns
- audit and logging coverage
- identity and application security

---

## Lens 2: Migration / Take-on / Acquisition Scoping

Focus:
- inventory, complexity, delivery effort

Typical summary sections:
- tenant inventory (users, apps, workloads)
- complexity drivers
- unknowns and gaps
- likely workstreams
- scoping assumptions and risks

---

## Current discovery coverage (implemented)

| Area | Collector ID | Evidence (Artefacts) | Example Findings |
|---|---|---|---|
| Entra ID users | `entra.users` | `users-inventory.json` | e.g. sign-in activity unavailable (permission missing), inactivity/other signals as implemented |
| Enterprise app permissions | `entra.enterpriseApps.permissions` | `enterprise-app-permissions.json` | `ENTRA_EAP_001` high-privilege permissions; `ENTRA_EAP_002` scan truncated |
| Tenant auth validation | `entra.auth.test` | none | Tenant auth status is expressed via `TenantAuth` (not via findings) |

---

## Current reporting coverage (implemented)

Report collectors are currently executed as jobs at the end of runs to produce downloadable summary artefacts:

| Report | Collector ID | Artefact |
|---|---|---|
| Run summary (CSV) | `report.runSummary.csv` | `run-summary.csv` |
| Run summary (XLSX) | `report.runSummary.xlsx` | `run-summary.xlsx` |

Direction for XLSX:
- Evolve toward a “CloudGeezer-style workbook” where each module/collector has its own sheet.
- Keep inventories as artefacts and/or referenced sheets; avoid duplicating huge datasets into findings.

---

## Planned discovery coverage (directional)

These are intended areas, not commitments.

### Identity & Access
- Conditional Access policies
- MFA coverage and exclusions
- Privileged role assignments
- Guest and external user analysis

### Applications
- Enterprise app ownership gaps
- App authentication patterns (secrets vs certs)
- Third-party SaaS risk indicators

### Exchange / Collaboration
- Mailbox inventory and sizing
- Shared mailbox sprawl
- Teams and SharePoint footprint
- External sharing posture

### Device & Endpoint
- Intune enrolment coverage
- Compliance policy gaps
- Platform fragmentation

### Operational readiness
- Break-glass account presence
- Audit log retention
- Alerting and monitoring coverage

---

## Coverage gaps and confidence

Each run should be able to express:
- which collectors ran successfully
- which areas were not assessed
- where confidence is reduced due to missing coverage (e.g. missing permissions, truncated scans)

This allows summaries to explicitly state:
> “This discovery did not assess Exchange Online.”

---

## Demo-only notes

For safe demonstrations, a Microsoft CDX/demo tenant may be used. The platform design still assumes:
- no real customer credentials are stored
- no secrets are persisted
- least-privilege app permissions are used and documented

---

## Non-goals (important)

The platform does not aim to:
- replace specialist migration tooling
- perform remediation
- present opinionated “one-size-fits-all” advice
- generate polished reports before evidence exists

Those concerns are intentionally layered above the core engine.

---

## Why this document exists

This roadmap exists to:
- keep development aligned with intent
- support consistent future decision-making
- act as a reference point for new contributors
- anchor future conversations and design discussions

It should evolve slowly and deliberately.
