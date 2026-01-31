# Findings & Observed Checks

This document defines how **Observed Checks** and **Findings** are produced, related, and consumed within the M365 Discovery Platform.

It reflects **actual runtime behaviour** and is the source of truth for reviewers and contributors.

---

## Core principles (locked)

* **Observed checks are the source of truth**
* Findings are **derived views**, never raw data
* Findings must never be emitted without supporting observed checks
* Completeness and truncation are signalled only via observed checks
* Reports and UI consume findings but must always allow trace‑back to observed checks

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
* Represent **decision‑ready signals**, not raw facts
* Are safe to render and export
* May be informational, advisory, or risk‑based

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
* Cross‑collector reasoning
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
* Exists to prevent future quota‑related support issues
* Is derived entirely from Graph‑only data

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

## What this enables long‑term

This model allows:

* Graph‑only core operation
* Optional future EXO PowerShell workers
* MSP‑safe advisory findings
* Report, UI, and API evolution without breaking contracts

---

**If documentation and runtime behaviour disagree, runtime behaviour wins.**
