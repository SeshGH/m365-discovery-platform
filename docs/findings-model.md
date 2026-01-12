# Findings Model (Contract, Taxonomy Guidance, and Future Extensions)

This page defines the **standard model** used to describe Findings produced by collectors in the M365 Discovery Platform.

It has two parts:

1. **Implemented contract (today):** the fields and severity values the platform currently persists and exposes via the API.
2. **Taxonomy guidance (future-facing):** additional classification concepts we intend to adopt over time, without implying they exist yet.

The goal is to ensure findings are:
- **Decision-ready** (prioritised and explainable)
- **Consistent** across collectors and over time
- **Future-proof** for UI, reporting, and automation
- **Secure-by-design** (clear risk communication and defensible outputs)

This document is intentionally practical: it describes what each field means and how to apply it consistently.

---

## Findings are signals, not inventory

A Finding is an **interpreted signal** (risk, gap, misconfiguration, governance issue, or meaningful scoping complexity driver).

Inventory should not be encoded as Findings.

Examples of **inventory (not findings)**:
- “User exists”
- “Mailbox exists”
- “100 SharePoint sites exist”

Those belong in **artefacts** as inventories/reports, with **summary** counts used by scoping lenses.

Examples of **signals (good findings)**:
- “Enterprise app has high-privilege Graph permissions”
- “Audit retention too low to support investigation”
- “Privileged roles assigned to daily-use accounts”
- “Guest users present with no lifecycle controls”
- “Scan truncated; results may be incomplete” (data completeness signal, often demo-only)

This rule keeps the Findings view decision-ready and reduces noise as coverage grows.

---

## Implemented contract (current behaviour)

### Core finding fields (today)

Findings currently persist and are exposed by the API with the following fields:

- `checkId` — stable identifier for the check/signal (contract)
- `severity` — impact rating (see ladder below)
- `title` — short human-readable summary
- `description` — explanation of what was detected and why it matters
- `recommendation` — suggested remediation / next action
- `evidence` — short supporting details (must not be a large payload)
- `references` — optional links/notes for further reading (if present)
- `runId` / `jobId` — traceability to run and producing job
- `createdAt` — timestamp

**Rule:** Findings must remain **small and readable**. Large inventories and raw evidence belong in artefacts.

### Stable Check IDs (contract)

`checkId` values are treated as stable contracts.

Rules:
- A `checkId` must never change meaning once shipped.
- Prefer predictable, namespaced IDs.

Current implemented examples:
- `ENTRA_EAP_001` — high-privilege Graph permissions detected
- `ENTRA_EAP_002` — scan truncated (results may be incomplete)

Recommended format:
- `{DOMAIN}_{AREA}_{NNN}` (e.g. `ENTRA_EAP_003`)

### Severity (contract)

Severity answers:
> “If ignored, how bad could this realistically be?”

Severity is impact-based (not confidence).

**Severity ladder (supported by reporting today)**
- `info` — worth knowing; no meaningful risk on its own
- `low` — minor weakness / defence-in-depth improvement
- `medium` — legitimate concern; should be planned and addressed
- `high` — serious exposure if abused; prioritise remediation
- `critical` — direct compromise path or tenant-wide high-impact risk
- `unknown` — only if impact cannot be determined (should be rare)

**Guidance**
- Avoid overusing `unknown`. If you have enough evidence to raise a finding, you usually have enough to classify impact.
- Do not encode inventory as `info` findings long-term; use artefacts + summaries instead.

---

## Taxonomy guidance (future-facing; not necessarily implemented yet)

The concepts in this section are **intended direction**. They may be implemented later via:
- additional persisted fields,
- derived classification from `checkId`,
- or UI-layer grouping rules.

Until implemented, they must not be assumed to exist in API payloads.

### Category (future-facing)

**Purpose:** grouping, filtering, ownership, roadmap coverage.

Category answers:
> “What area of M365 does this relate to?”

Suggested category set (keep stable and not overly granular):
- `identity`
- `access`
- `application_permissions`
- `tenant_configuration`
- `audit_and_logging`
- `data_protection`
- `device_management`
- `data_completeness` (for truncation/partial coverage signals)

Mapping guidance:
- `ENTRA_EAP_*` generally maps to `application_permissions`
- truncation/partial scan findings (like `ENTRA_EAP_002`) map to `data_completeness`

### Confidence (future-facing)

**Purpose:** credibility, reducing false positives, review workflows.

Confidence answers:
> “How sure are we that this is actually a problem?”

Suggested levels:
- `high` — direct, authoritative evidence
- `medium` — reasonable inference with good evidence but some assumptions
- `low` — heuristic / incomplete telemetry / higher false-positive risk

Guidance:
- Do not inflate confidence to justify severity.
- A `critical` finding can be low confidence if evidence is incomplete (treat carefully in UI/reporting).

### Status (future-facing)

**Purpose:** operational lifecycle tracking across repeat runs.

Suggested statuses:
- `open`
- `acknowledged`
- `resolved`
- `false_positive`

Status records human/operational decisions; it must not change the underlying evidence.

### Numeric score (future-facing)

Severity is designed for humans. A numeric score supports sorting and trending.

Suggested initial derived mapping:
- `info` → 0
- `low` → 20
- `medium` → 50
- `high` → 80
- `critical` → 100

Optional adjustments (later):
- confidence adjustment (e.g. low confidence −10)
- scope adjustment (e.g. tenant-wide +10)

Guidance:
- Keep scoring rules simple and explainable.
- “Clever” scoring should come later once you have enough data to validate it.

---

## Writing good findings

Collectors should aim to produce findings that are:
- **Clear** (human-readable title/summary)
- **Evidence-based** (include key supporting details)
- **Actionable** (recommend remediation where appropriate)
- **Non-invasive** (avoid leaking sensitive data into findings)

A good mental model:
- Severity = how much it’s on fire
- Evidence = why we think it’s on fire
- Recommendation = what to do about it
