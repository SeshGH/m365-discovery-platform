# Scoping Lens (Migration, Take-on, Acquisition)

This document defines the **Scoping Lens** of the M365 Discovery Platform.

The Scoping Lens is a view over discovery results that helps automate what is often done manually during:
- on-prem → Azure migrations (and associated M365 readiness work)
- support take-ons / managed service onboarding
- tenant-to-tenant migrations (acquisitions)

This lens complements (not replaces) the Security Posture lens.

---

## Core principle

A “Discovery Report” is not a single exported file.

It is a **tenant + run** view consisting of:
- a high-level summary
- detailed findings (prioritised)
- evidence artefacts (raw exports)
- explicit coverage/unknowns

The Scoping Lens prioritises:
- **inventory**
- **complexity drivers**
- **unknowns / assumptions**
- **workstream sizing signals**

---

## What this lens should answer

### Scoping questions (typical MSP use)
- What are we supporting or migrating?
- How complex is this tenant?
- What will slow us down?
- What assumptions are we making due to missing coverage?
- What are the likely workstreams and effort drivers?

This lens is explicitly designed to support:
- presales estimation and proposal scoping
- internal handover into delivery
- repeat-runs during remediation and validation

---

## Scoping Summary sections

The UI (and future exports) should present a standard structure.

### 1) Snapshot
A small “at a glance” summary for the tenant/run:
- tenant name / primary domain (where available)
- run window (startedAt → endedAt)
- run status and job success rate
- modules enabled

### 2) Inventory (what exists)
Inventory is the foundation for scoping and effort sizing.
Typical inventory items (increasing over time):
- users (count, guests vs members)
- privileged/admin users (count)
- enterprise applications (count, ownership coverage)
- groups / dynamic groups (count)
- mailboxes (count and size bands) *(future)*
- SharePoint sites / storage *(future)*
- Teams footprint *(future)*
- devices and enrollment coverage *(future)*

Inventory values should be derived from:
- artefacts (preferred for raw counts)
- findings (where we currently model “inventory as findings”)

### 3) Complexity drivers (what increases effort)
These are “scoping findings” — not necessarily security findings.

Examples:
- high number of enterprise apps without owners
- significant guest/external collaboration footprint
- large mailbox or file storage footprint
- legacy authentication patterns in use
- high count of privileged users / role sprawl
- inconsistent naming conventions (UPN/domain patterns)
- lack of clear governance signals

These should map to findings categories where possible, but may also use:
- `other` category for non-security scoping signals
- confidence tagging (high/medium/low) to control how hard we state conclusions

### 4) Risks, assumptions, and unknowns (explicit)
This is the single most important section for MSP scoping.

Each run should surface:
- which workloads were assessed vs not assessed
- which collectors failed (and therefore reduce confidence)
- what data is missing that may change the estimate

Examples:
- “Exchange Online not assessed — mailbox sizing unknown”
- “Intune device compliance not assessed — endpoint management effort unknown”
- “Jobs failed for enterprise app permissions — app integration complexity unknown”

Unknowns should be derived from:
- enabled modules vs executed collectors
- job status (failed/missing)
- explicit “coverage” metadata (future)

### 5) Suggested workstreams (directional)
This is not a plan — it is a suggested decomposition for estimation.

Workstreams may include:
- Identity & Access
- Applications / SSO integrations
- Exchange / Collaboration
- Endpoint & Device Management
- Data / SharePoint / OneDrive
- Security baseline alignment
- Monitoring & operational readiness

Workstreams are derived from:
- the presence of certain findings
- inventory scale
- coverage gaps
- known complexity drivers

### 6) Evidence and traceability
Every summary section should remain defensible by linking back to:
- findings (human-readable)
- artefacts (raw evidence)
- jobs (execution trace)

This is non-negotiable for credibility.

---

## Relationship to the Findings Model

The Findings Model (`docs/findings-model.md`) is the contract for all findings.

The Scoping Lens uses that model, but may introduce findings that are:
- not strictly “security issues”
- instead represent “effort signals” or “inventory signals”

Guidance:
- Keep severity meaningful. Do not inflate scoping signals into “critical” unless they are true risk.
- Prefer `info`/`low` for pure inventory observations.
- Use `confidence` carefully: scoping inferences often start at medium confidence.

---

## Current state (today)

The current platform can already support a minimal Scoping Summary using:
- Entra users collector output
- enterprise app permissions collector output
- jobs table (success/failure)

Even before new collectors are added, the Scoping Lens can present:
- run status / job success rate
- user count (from Entra users findings or artefact if added)
- enterprise app permission risk indicators (as an effort signal)
- explicit unknowns (everything not yet assessed)

---

## Roadmap approach (thin vertical slices)

The correct implementation strategy is:
1) define summary sections (this document)
2) implement the summary UI using existing data
3) add collectors one-by-one that populate missing scoping fields
4) update docs as collectors land

### Suggested next collector slices (scoping-first)
These are ordered by “scoping value per effort”.

1) **Entra: privileged role assignments**
   - admin role sprawl impacts support model and risk acceptance
2) **Entra: guest/external users summary**
   - acquisition/t2t complexity signal
3) **Enterprise apps: ownership + secrets/certs inventory**
   - SSO integration complexity and ownership gaps
4) **Exchange: mailbox inventory (count + size bands)**
   - key driver for migration effort and cutover planning
5) **SharePoint/OneDrive: storage + site count**
   - major data migration driver
6) **Teams: teams/channels/apps inventory**
   - collaboration migration complexity
7) **Intune: enrollment + compliance coverage**
   - endpoint readiness and take-on complexity

This list is directional; it should be refined as real customer needs are observed.

---

## UI implications (near-term)

Near-term UI should add a “Scoping Summary” block for a run that:
- provides snapshot + inventory counts available today
- surfaces unknowns explicitly
- links to evidence via artefacts download

This should be added incrementally without requiring a full portal redesign.
