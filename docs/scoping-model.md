# Scoping Model (Discovery-to-Scoping Summary)

This page defines the **Scoping Summary** concept in the M365 Discovery Platform.

The scoping model is a **decision-support lens** focused on reducing manual effort when scoping:
- on-prem → Azure migrations
- support take-ons / operational readiness
- tenant-to-tenant migrations (including acquisitions)

It is complementary to the **security findings model**:
- Findings = detailed risks and observations (security/engineering lens)
- Scoping summary = high-level signals and coverage clarity (delivery/scoping lens)

This document is the **source of truth** for how we describe scoping output in the UI and future reports.


## Goals

The scoping summary must be:
- **Coverage-aware**: explicitly state what was assessed vs not assessed
- **Evidence-backed**: derived from collected data, jobs, and artefacts
- **Explainable**: readable by engineers and decision-makers
- **Safe-by-design**: avoid overstating confidence or coverage


## What the Scoping Summary is (and isn’t)

### It is
- A structured **high-level overview** of discovery coverage and key signals that correlate with delivery effort.
- A summary designed to support decisions like:
  - “Do we have enough information to scope this accurately?”
  - “What are the likely effort drivers?”
  - “Where do we still have unknowns that require follow-up?”

### It is not
- A replacement for detailed findings.
- A guarantee of completeness.
- A “final report” (yet). It’s an evolving productised representation of discovery outputs.


## Inputs and how the summary is derived (current state)

In the current implementation, the scoping summary is derived **entirely from existing API data**:

### 1) Jobs (Run execution metadata)
Jobs provide:
- which collectors ran
- which succeeded or failed
- execution confidence signals (e.g., failures imply incomplete discovery)

From Jobs we derive:
- **Execution confidence**: succeeded/failed/running/queued counts
- **Attempted but failed** areas (partial coverage)

### 2) Findings (structured discrete items)
Findings provide:
- counts of discovery outputs
- severity distribution (used as an attention signal)

Today we also use some findings as lightweight inventory indicators (v1 approach).

### 3) Artefacts (files in object storage)
Artefacts provide:
- evidence bundles (JSON/CSV/etc.)
- future-ready sources of truth for inventory counts and summaries

Over time, **inventory and summary numbers should prefer artefacts** (explicit inventories) over inferring from findings.


## Coverage model (Covered / Attempted / Not assessed)

Scoping must be honest about what was actually collected.

Coverage is represented as:
- **Covered**: capabilities satisfied by collectors that succeeded
- **Attempted but failed**: capabilities mapped to collectors that failed
- **Not assessed**: capabilities we care about for scoping but were not collected in this run

This is derived from:
- a stable mapping of `collectorId → capability tags`
- a scoping “target set” of capabilities

This model ensures:
- the UI cannot accidentally imply coverage that did not occur
- gaps remain visible and actionable for follow-up discovery


## Scoping signals (examples)

The scoping summary should emphasise signals that correlate with delivery effort, such as:
- identity footprint (users/guests/admins)
- app/integration complexity (enterprise apps, high-priv permissions, ownership gaps)
- security baseline gaps that increase risk during migration/take-on (e.g., weak logging)
- device estate complexity (Intune enrollment, compliance posture)
- messaging/collaboration footprint (mailboxes, Teams, SharePoint sites, storage)

Important: signals should be phrased as **“indicators”**, not conclusions, unless backed by strong evidence.


## Relationship to Findings severity

Severity is primarily a **security risk** concept, but it can support scoping by indicating:
- where remediation work may be needed before/during a migration
- where operational readiness risk may increase take-on complexity

Guidance:
- Do not treat “high/critical counts” as a definitive estimate of effort.
- Use severity distribution as an **attention indicator** only.


## Report structure (future target)

The platform should evolve toward a per-tenant “report” view with:
- Executive summary (high-level)
- Coverage matrix (what’s in/out, and why)
- Security summary (top risks)
- Scoping summary (delivery effort drivers)
- Evidence pack (artefacts and supporting data)
- Trend over time (compare runs)

The scoping model will become one section of that report.


## Security-by-design notes

- The scoping summary must not leak secrets or sensitive identifiers.
- Summary text should avoid dumping raw evidence; link to artefacts for detail.
- “Unknowns” must remain explicit to prevent unsafe overconfidence.
- Keep the scoping summary derived from **read-only** API endpoints; no privileged calls from the web UI.


## Roadmap: scoping-first coverage expansion (examples)

As we productise, the scoping lens becomes more valuable as we add collectors that produce explicit inventories, e.g.:
- Entra privileged role assignments
- Guest/external user inventory
- Conditional Access policy inventory + coverage/risk flags
- Exchange Online mailbox inventory (counts, shared mailboxes, forwarding indicators)
- SharePoint/OneDrive inventory (sites, storage, sharing posture indicators)
- Teams inventory (teams count, app usage indicators)
- Intune device inventory (enrollment, platform mix, compliance rates)

Each new collector should:
- define which scoping capability tags it satisfies
- publish clear artefacts (inventory JSON) where appropriate
- write findings only when there is a meaningful risk or action item
