# Findings Model (Taxonomy, Severity, Confidence, Status, Score)

This page defines the **standard model** used to describe Findings produced by collectors in the M365 Discovery Platform.

The goal is to ensure findings are:
- **Decision-ready** (prioritised and explainable)
- **Consistent** across collectors and over time
- **Future-proof** for UI, reporting, and automation
- **Secure-by-design** (clear risk communication and defensible outputs)

This document is intentionally practical: it describes *what* each field means and *how* to apply it consistently.


## Why we model findings this way

A single discovery signal needs to be explainable to three audiences:

- **Security/technical:** What is wrong and what evidence supports it?
- **Decision maker:** How bad is it and what should we do first?
- **Platform/automation:** How do we sort, group, trend, and workflow this finding?

To support those audiences we classify each finding using:
- **Category** (where it belongs)
- **Severity** (how bad it is if ignored)
- **Confidence** (how sure we are)
- **Status** (lifecycle state)
- **Score** (numeric prioritisation / trending)


## Core fields

### Category
**Purpose:** grouping, filtering, ownership, roadmap coverage.

Category answers:
> “What area of M365 does this relate to?”

Categories should map to common M365 security domains and customer mental models.

**Typical categories**
- `identity`
- `access`
- `application_permissions`
- `tenant_configuration`
- `audit_and_logging`
- `data_protection`
- `device_management`

**Notes**
- Category is not a risk rating.
- Category should be stable over time (avoid overly granular categories).


### Severity
**Purpose:** prioritisation, escalation, risk communication.

Severity answers:
> “If ignored, how bad could this realistically be?”

Severity is **impact-based**, not “how confident are we”.

**Severity ladder**
- `info` — Worth knowing; no meaningful risk on its own
- `low` — Minor weakness / defence-in-depth improvement
- `medium` — Legitimate security concern; should be planned and addressed
- `high` — Serious exposure if abused; prioritise remediation
- `critical` — Direct compromise path or tenant-wide high-impact risk

**What severity is judged against**
- Blast radius (single user vs tenant-wide)
- Privilege level involved (admin roles, high-impact permissions)
- Likelihood of misuse (easy to exploit vs requires chained conditions)
- Business impact (data exposure, control, persistence)
- Alignment with common frameworks (CIS, Zero Trust concepts, Secure Score themes)

**Examples**
- **High:** Too many Global Admins / daily-use accounts holding GA
- **Critical:** Enterprise app has tenant-wide write permissions (e.g., directory write) without appropriate governance
- **Medium:** Audit retention too low to support investigation
- **Low:** Minor configuration hardening opportunity with limited exposure
- **Info:** Inventory-only observations, no risk implied


### Confidence
**Purpose:** credibility, reducing false positives, review workflows.

Confidence answers:
> “How sure are we that this is actually a problem?”

Confidence is about **signal quality**, not impact.

**Typical confidence levels**
- `high` — Based on direct, authoritative evidence (e.g., explicit permission values)
- `medium` — Reasonable inference with good evidence but some assumptions
- `low` — Heuristic / incomplete telemetry / higher false-positive risk

**Examples**
- **High confidence:** App permissions explicitly include high-impact scopes
- **Medium confidence:** “Unused in 30 days” where logs are limited or sampled
- **Low confidence:** Behavioural inference based on incomplete signals

**Guidance**
- Do not inflate confidence to justify severity.
- A `critical` finding can still be `low` confidence if evidence is incomplete (and should be handled carefully in reporting/UI).


### Status
**Purpose:** operational lifecycle tracking.

Status answers:
> “Where is this finding in its lifecycle?”

**Typical statuses**
- `open` — newly identified or still outstanding
- `acknowledged` — reviewed/accepted risk; remediation planned or deferred
- `resolved` — verified remediated or no longer present
- `false_positive` — confirmed not applicable / incorrect

**Notes**
- Status enables repeat-run comparisons and workflow in future UI.
- Status does not change the underlying evidence; it records human/operational decisions.


## Numeric score

Severity is designed for **humans**.
A numeric score supports **sorting, trending, dashboards, and summaries**.

Score should **co-exist** with severity, not replace it.

### Recommended initial approach: derived score
Use severity as a base score, then optionally adjust based on scope and confidence.

**Base score mapping**
- `info` → 0
- `low` → 20
- `medium` → 50
- `high` → 80
- `critical` → 100

**Optional adjustments (examples)**
- Confidence adjustment:
  - `low` confidence: −10
  - `high` confidence: +0 (or +5 if you want extra emphasis)
- Scope adjustment:
  - tenant-wide impact: +10
  - privileged role involved: +10

**Examples**
1) **Critical app permission, high confidence, tenant-wide**
- Base: 100
- Scope: +10
- Score: **110**

2) **High severity, low confidence (needs review)**
- Base: 80
- Confidence: −10
- Score: **70**

3) **Medium severity, tenant-wide, medium confidence**
- Base: 50
- Scope: +10
- Score: **60**

**Guidance**
- Keep the scoring rules simple and explainable.
- Any “clever” scoring model should come later, once real findings data exists to validate it.


## Using the model when writing findings

Collectors should aim to produce findings that are:
- **Clear** (human-readable title/summary)
- **Evidence-based** (include key supporting data)
- **Classified** (category, severity, confidence)
- **Actionable** (recommended remediation where appropriate)

A good mental model:
- **Category** = what cupboard the issue lives in
- **Severity** = how much it’s on fire
- **Confidence** = how sure we are it’s actually on fire
- **Status** = what we’re doing about it
- **Score** = how we sort and trend it


## Reporting and UI implications (future-facing)

This model enables:
- Filtering by category (e.g., “show only application permissions”)
- Sorting by severity/score (e.g., “top 10 risks”)
- Trend reporting across runs (e.g., “risk score decreasing over time”)
- Safe handling of low-confidence findings (e.g., review queues, muted by default)

This document is a contract: collectors and the API/worker should remain consistent with these definitions.
