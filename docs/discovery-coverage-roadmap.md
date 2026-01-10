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

It collects **facts** (artefacts), derives **interpretations** (findings), and presents
**multiple views (“lenses”)** over the same evidence depending on the use case.

Security posture is one output — not the only one.

---

## Discovery layers

### 1) Artefacts (evidence layer)
Artefacts are:
- raw, machine-readable outputs (JSON, CSV, ZIP, etc.)
- immutable
- directly traceable to a specific job and run
- suitable for validation, debugging, audit, and downstream processing

Examples:
- `users.json`
- `enterprise-app-permissions.json`
- `mailbox-inventory.csv` (future)

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
Summaries are **derived views**, not stored data.

They aggregate findings and execution metadata to present:
- high-level posture
- key risks
- coverage completeness
- effort or complexity indicators

Reports may later be exported as:
- UI dashboards
- PDF summaries
- Excel workbooks
- machine-readable JSON

---

## Output lenses

The same discovery run can be viewed through different lenses.

These lenses share collectors, artefacts, and findings — they differ only in
**aggregation, emphasis, and presentation**.

---

## Lens 1: Security Posture

This lens focuses on **risk, misconfiguration, and hygiene**.

Typical summary sections:
- overall posture score
- findings by severity
- top risks
- privilege and access concerns
- audit and logging coverage
- identity and application security

Example questions answered:
- Are there high-risk permissions in use?
- How exposed is the tenant?
- Are basic security controls missing?
- Where should remediation start?

This lens is most useful for:
- security assessments
- baseline reviews
- ongoing posture monitoring

---

## Lens 2: Migration / Take-on / Acquisition Scoping

This lens focuses on **inventory, complexity, and delivery effort**.

Typical summary sections:
- tenant inventory (users, apps, workloads)
- complexity drivers
- unknowns and gaps
- likely workstreams
- scoping assumptions and risks

Example questions answered:
- What are we migrating or supporting?
- How complex is this tenant?
- What will slow us down?
- What must be validated before committing effort?

This lens is most useful for:
- on-prem to Azure migrations
- M365 tenant take-ons
- tenant-to-tenant migrations (acquisitions)
- pre-sales discovery and estimation

---

## Current discovery coverage (implemented)

| Area | Collector ID | Artefacts | Findings |
|----|----|----|----|
| Entra ID users | `entra.users` | users.json | user inventory findings |
| Enterprise app permissions | `entra.enterpriseApps.permissions` | permissions.json | high-privilege permission findings |
| Tenant auth validation | `entra.auth.test` | none | connectivity / auth state |

---

## Planned discovery coverage (directional)

These are **intended areas**, not commitments.

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
- Intune enrollment coverage
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
- where confidence is reduced due to missing coverage

This allows summaries to explicitly state:
> “This discovery did not assess Exchange Online.”

---

## Non-goals (important)

The platform does **not** aim to:
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
