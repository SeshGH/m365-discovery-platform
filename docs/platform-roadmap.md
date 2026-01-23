# Platform Roadmap & Architectural Intent

This document captures the **intent, direction, and boundaries** of the M365 Discovery Platform.

It exists to:

* maintain cohesion across development iterations
* prevent architectural drift
* provide a shared reference for future conversations, demos, and design decisions

This is **not** a delivery plan or backlog.
It describes what kind of platform this is becoming, not exact timelines.

---

## Platform goals

The M365 Discovery Platform is designed to:

* support **MSP-grade tenant discovery and security assessment**
* be safe-by-default, yet capable of deep inspection when explicitly enabled
* separate **data collection**, **interpretation**, and **presentation**
* scale across tenants, collectors, and workers without rework
* remain explainable, auditable, and defensible

---

## Core architectural decisions (stable)

These are considered **foundational** and should not be changed lightly.

### Execution model

* Discovery is executed by **workers**, not the API
* Each run fans out into **independent jobs**
* Jobs are concurrency-safe and idempotent
* Report generation is gated until prerequisite jobs reach a terminal state

### Trust boundaries

* The API never calls Microsoft Graph or Exchange Online
* The worker is the only privileged execution surface
* Artefact payloads are stored outside the database
* Artefact access is always indirect and time-limited

### Output model

* **Artefacts** represent raw or structured evidence
* **Observed checks** represent factual, non-judgemental observations
* **Findings** represent interpreted, decision-ready signals
* **Reports** are derived views, not sources of truth

Authoritative contracts:

* `docs/artefact-and-report-contracts.md`
* `docs/findings-model.md`
* `docs/findings-registry.md`
* `docs/findings-observed-checks.md`

---

## Capability tiers

The platform evolves through **capability tiers**, not feature spikes.

### Tier 1 — Safe discovery (default, implemented)

* Summary-level outputs
* Counts, posture signals, and coverage indicators
* Minimal PII
* Suitable for:

  * early discovery
  * demos
  * low-risk assessments

### Tier 2 — Detailed exports (explicit, partially implemented)

* Full inventories (users, apps, permissions, mailboxes)
* Per-object detail
* Artefacts may contain PII
* Enabled explicitly via run configuration (`dataProfile: "full"`)

Rules:

* Safe runs must never emit sensitive data
* Full runs may emit both safe and full artefacts
* Sensitive artefacts must never be auto-consumed by reports or UI

### Tier 3 — Operational & commercial views (future)

* Workbook-style reports
* Scoping lenses for:

  * migrations
  * take-ons
  * tenant-to-tenant work
* Portal-driven review, filtering, and export

---

## Reporting direction

Reporting is treated as a **presentation layer**, not the core engine.

### Current state (implemented)

* CSV and XLSX run summaries
* Job, finding, and artefact indexes
* Reports are produced as **terminal artefacts**

Download behaviour:

* Downloads use `GET /artefacts/:artefactId/download`
* The API responds with an **HTTP 302 redirect** to a short-lived presigned URL
* The API never streams artefact bodies

### Planned direction

* Multi-sheet workbooks
* One sheet per major collector/module
* Clear separation between:

  * executive summary
  * technical detail
  * sensitive exports

Reports must always remain derived views over stored evidence.

---

## Demo constraints vs architectural guarantees

Some limits exist purely to keep demos safe and predictable.

Examples:

* Enterprise app enumeration caps (e.g. `ENTAPP_MAX_APPS`)
* Artificial truncation surfaced as data completeness signals

Rules:

* Demo-only behaviour must be explicitly documented as such
* Demo constraints must never become relied-upon architecture
* Incomplete data must be surfaced as a signal, not hidden

---

## Exchange Online collector – current state

The Exchange Online mailbox collector (`exchange.mailboxes.inventory`) is now **implemented and stable**, but still evolving.

This section documents **exactly how it works today**, and which parts are demo-safe versus long-term intent.

### Data sources (dual-path by design)

The collector intentionally uses **two different data sources**, each for what it does best:

1. **Exchange Online PowerShell (app-only, certificate auth)**

   * Used for:

     * mailbox type distribution (user / shared / room / equipment)
     * enabled vs disabled mailbox counts
   * Rationale:

     * Graph does not reliably expose mailbox state
     * EXO cmdlets are authoritative for recipient classification

2. **Microsoft Graph reports (CSV)**

   * Used for:

     * mailbox size usage buckets
   * Endpoint:

     * `reports/getMailboxUsageDetail`
   * Rationale:

     * avoids per-mailbox Graph calls
     * aligns with Microsoft’s own reporting surfaces

This split is **intentional** and should not be collapsed without a clear replacement.

---

### Safe vs full behaviour

The collector is **profile-aware**:

#### Safe profile (`dataProfile: "safe"`)

* Emits:

  * counts and buckets only
  * no mailbox identifiers
  * no UPNs, display names, or addresses
* Artefact:

  * `exchange-mailboxes-inventory.safe.json`

#### Full profile (`dataProfile: "full"`)

* Emits:

  * the same safe summary
  * **plus per-mailbox usage detail** derived from Graph reports
* Includes PII fields such as:

  * `userPrincipalName`
  * `displayName`
* Artefact:

  * `exchange-mailboxes-inventory.full.json`

Rules:

* Safe artefacts must never contain PII
* Full artefacts may contain PII, but are never auto-consumed by reports

---

### Completeness and error handling

The collector is explicitly **completeness-aware**.

Internal slices:

* `mailboxes` (EXO PowerShell)
* `mailboxUsageDetail` (Graph CSV report)

Behaviour:

* Missing permissions or EXO connection failures:

  * do **not** crash the entire run
  * surface as:

    * `isComplete = false`
    * populated `permissionDenied`
    * human-readable `notes`
* Only unrecoverable worker misconfiguration (e.g. missing env vars) fails the job

This allows:

* safe demos in constrained tenants
* honest signalling of coverage gaps
* predictable report behaviour

---

### Demo-only constraints

Current limitations that are **explicitly demo-driven**:

* Size buckets are derived from **delayed Graph reports**, not real-time statistics
* No per-mailbox EXO statistics are queried yet (to avoid heavy EXO calls)

These must:

* remain clearly documented
* never be relied upon as architectural guarantees

---

### Long-term intent (not yet implemented)

Planned future evolution for Exchange Online discovery:

* Replace or augment Graph CSV usage data with:

  * EXO `Get-EXOMailboxStatistics` (selective, gated)
* Introduce:

  * mailbox quota vs usage signals
  * archive mailbox coverage
* Add findings derived from observed checks (e.g. large mailboxes, disabled-but-licensed mailboxes)

All future work must:

* preserve safe vs full boundaries
* keep EXO access isolated to workers
* emit observed checks before findings

---

## What this platform is not

Explicit non-goals help maintain focus:

* ❌ A real-time monitoring system
* ❌ A SIEM or log ingestion platform
* ❌ An agent-based endpoint scanner
* ❌ A replacement for Defender, Sentinel, or Entra native controls

The platform complements these systems — it does not compete with them.

---

## Design philosophy

* prefer **clarity over cleverness**
* prefer **explicit configuration over magic**
* prefer **stable contracts over rapid refactors**
* prefer **documentation alongside code**
* prefer **auditability over convenience**

---

## Using this document

This document should be referenced when:

* starting a new design discussion
* evaluating whether a new idea fits the platform
* preparing demos or internal presentations
* onboarding contributors

If a proposal conflicts with this document, the conflict should be made explicit and discussed deliberately.

---

## Summary

This roadmap exists to ensure the platform grows **coherently**, not accidentally.

Collectors will expand.
Observed checks will deepen.
Findings will mature.
Reports will improve.

The underlying intent and architectural posture should remain consistent.
