# Findings & Observed Checks

This document defines how **Observed Checks** and **Findings** are produced, related, and consumed within the M365 Discovery Platform.

It reflects **actual runtime behaviour** and is the source of truth for reviewers and contributors.

---

## Core principles (locked)

* **Observed checks are the source of truth**
* Findings are **derived views**, never raw data
* Findings must never be emitted without supporting observed checks
* Completeness and truncation are signalled only via observed checks
* Reports and UI consume findings but must always allow trace-back to observed checks

---

## Observed Checks

Observed checks:

* Are written **directly by collectors**
* Represent facts, measurements, or bounded scans
* May be partial or truncated
* Carry completeness signals

Each observed check has:

* `checkId` (stable, immutable)
* `collectorId`
* `data` (JSON, shape defined by the collector contract)
* Optional completeness signals:

  * `isComplete`
  * `truncated`
  * `permissionDenied`
  * `slicesAttempted` / `slicesCompleted`

Observed checks are **idempotent per (runId, jobId, checkId)**.

### Example

```json
{
  "checkId": "EXO_MAILBOXES_OBS_001",
  "collectorId": "exchange.mailboxes.inventory",
  "data": {
    "totalMailboxes": 21,
    "sizeBuckets": {
      "40to50GB": 0,
      "over50GB": 0
    },
    "isComplete": true
  }
}
```

---

## Findings

Findings:

* Are **derived from observed checks**
* Represent **decision-ready signals**, not raw facts
* Are safe to render and export
* May be informational, advisory, or risk-based

Findings **must not**:

* Introduce assumptions not present in observed checks
* Mask truncation or incompleteness
* Depend on reports or UI logic

### Finding derivation model

Findings are produced by **finding derivations**, which:

* Read from the full set of observed checks for a run
* Emit zero or more findings
* Are deterministic and repeatable

This allows:

* Multiple findings per observed check
* Cross-collector reasoning
* Stable, testable behaviour

---

## Finding severity

Severity reflects **decision urgency**, not technical failure:

* `critical` – immediate security or operational risk
* `high` – significant risk or misconfiguration
* `medium` – notable issue requiring review
* `low` – minor issue
* `info` – advisory / scoping / context

Example:

* Exchange mailbox licensing pressure is **`info`**, not a fault

---

## Example: Exchange Online mailbox licensing advisory

**Observed checks**:

* `EXO_MAILBOXES_OBS_001` – mailbox size distribution
* `EXO_MAILBOXES_OBS_010` – derived licensing signal

**Derived finding**:

* `EXO_LICENSE_001`
* Severity: `info`
* Purpose: scoping reminder for mailbox licensing limits

This finding:

* Does **not** imply misconfiguration
* Exists to prevent future quota-related support issues
* Is derived entirely from Graph-only data

---

## Completeness & truncation

Only observed checks may signal:

* Truncation
* Partial coverage
* Permission denial

Findings must:

* Respect these signals
* Avoid false confidence

The UI surfaces completeness warnings at the run level and links them back to the originating observed checks.

---

## Finding design principles, intent, and lifecycle

This section defines **what findings are allowed to do**, **what they must not do**, and how they are categorised and interpreted over time.

These rules exist to preserve long-term contract stability, prevent alert fatigue, and ensure findings remain MSP-safe as the platform scales.

### What findings must *not* do (hard constraints)

Findings must **never**:

* Reinterpret or transform raw data

  * No recalculation, rebucketing, or thresholding beyond what observed checks already define
  * Findings summarise meaning; they do not perform analysis

* Hide or mask incompleteness

  * Truncation, partial coverage, or permission gaps must always remain visible via observed checks
  * Findings must downgrade confidence or severity if evidence is incomplete

* Imply fault unless a true misconfiguration is proven

  * Advisory, licensing, sizing, or hygiene findings must not suggest non-compliance or blame

* Act as a task list or remediation engine

  * Findings provide signals, not instructions
  * No "you must fix" or prescriptive remediation steps

* Be unstable over time

  * Finding IDs, meaning, and intent must remain valid as collectors, UI, and reports evolve

* Exist without a clear audience

  * Every finding must be meaningful to an MSP pre-sales, delivery, or technical review audience

---

### Finding categories (descriptive only)

Findings may optionally be assigned a **primary category** for grouping and presentation.

Categories are:

* Descriptive, not functional
* Not used for severity or logic
* Intended for UI grouping, filtering, and conversation framing

#### Supported categories (v1)

* **Security posture** – authentication, access, privilege, and control signals
* **Licensing & cost awareness** – sizing, utilisation, and commercial considerations
* **Operational hygiene** – stale, inactive, or legacy artefacts
* **Migration & modernisation considerations** – readiness and future-state blockers
* **Discovery completeness & confidence** – truncation, partial visibility, permission gaps

Each finding should have **one primary category** to avoid UI ambiguity.

---

### Finding lifecycle & intent

Findings represent **point-in-time signals**, but are interpreted within an MSP workflow.

Lifecycle reflects **intent**, not severity:

* **Informational** – awareness only; no action implied
* **Advisory** – consideration recommended; may influence scoping or design
* **Actionable** – likely requires intervention, supported by strong evidence

Lifecycle and severity are **independent dimensions**:

* Severity answers: *How serious is this?*
* Lifecycle answers: *What should the reader do with this information?*

This separation allows findings to evolve in relevance without changing IDs or meaning.

---

### Design summary

Observed checks explain **what exists**.

Findings explain **why it matters**.

Findings do **not** explain **how to fix it**.

---

## What this enables long-term

This model allows:

* Graph-only core operation
* Optional future EXO PowerShell workers
* MSP-safe advisory findings
* Report, UI, and API evolution without breaking contracts

---

**If documentation and runtime behaviour disagree, runtime behaviour wins.**
