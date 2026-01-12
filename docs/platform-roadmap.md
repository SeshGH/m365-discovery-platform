# Platform Roadmap & Architectural Intent

This document captures the **intent, direction, and boundaries** of the M365 Discovery Platform.

It exists to:
- Maintain cohesion across development iterations
- Prevent architectural drift
- Provide a shared reference for future conversations, demos, and design decisions

This is **not** a delivery plan or backlog.
It describes *what kind of platform this is becoming*, not exact timelines.

---

## Platform Goals

The M365 Discovery Platform is designed to:

- Support **MSP-grade tenant discovery and security assessment**
- Be safe-by-default, yet capable of deep inspection when explicitly enabled
- Separate **data collection** from **presentation**
- Scale across tenants, collectors, and workers without rework
- Remain explainable, auditable, and defensible

---

## Core Architectural Decisions (Stable)

These are considered **foundational** and should not be changed lightly.

### Execution Model
- Discovery is executed by **workers**, not the API
- Each run fans out into **independent jobs**
- Jobs are concurrency-safe and idempotent
- Report generation is gated until all prerequisite jobs complete

### Trust Boundaries
- The API never calls Microsoft Graph
- The worker is the only privileged execution surface
- Artefacts are stored outside the database
- Artefact access is always indirect and time-limited

### Output Model
- **Findings** represent interpreted insight
- **Artefacts** represent raw or structured output
- Reports are *derived views*, not sources of truth

---

## Capability Tiers

The platform evolves through **capability tiers**, not feature spikes.

### Tier 1 — Safe Discovery (Default)
- Summary-level outputs
- Counts, posture signals, and coverage indicators
- Minimal PII
- Suitable for:
  - Early discovery
  - Demos
  - Low-risk assessments

### Tier 2 — Detailed Exports (Explicit)
- Full inventories (users, apps, permissions)
- Per-object detail
- Artefacts may contain PII
- Enabled explicitly per run or module

### Tier 3 — Operational & Commercial Views
- Workbook-style reports (CloudGeezer-style)
- Scoping lenses for:
  - Migrations
  - Take-ons
  - Tenant-to-tenant work
- Portal-driven review and export

---

## Reporting Direction

Reporting is treated as a **presentation layer**, not the core engine.

Current state:
- CSV and XLSX run summaries
- Job, finding, and artefact indexes

Planned direction:
- Multi-sheet workbooks
- One sheet per major collector/module
- Clear separation between:
  - Executive summary
  - Technical detail
  - Sensitive exports

---

## What This Platform Is Not

Explicit non-goals help maintain focus:

- ❌ A real-time monitoring system
- ❌ A SIEM or log ingestion platform
- ❌ An agent-based endpoint scanner
- ❌ A replacement for Defender, Sentinel, or Entra native controls

The platform complements these systems — it does not compete with them.

---

## Design Philosophy

- Prefer **clarity over cleverness**
- Prefer **explicit configuration over magic**
- Prefer **stable contracts over rapid refactors**
- Prefer **documentation alongside code**
- Prefer **auditability over convenience**

---

## Using This Document

This document should be referenced when:
- Starting a new chat or design discussion
- Evaluating whether a new idea fits the platform
- Preparing demos or internal presentations
- Onboarding contributors

If a proposal conflicts with this document, the conflict should be made explicit and discussed deliberately.

---

## Summary

This roadmap exists to ensure the platform grows **coherently**, not accidentally.

Features will evolve.
Collectors will expand.
Reports will improve.

The underlying intent and architectural posture should remain consistent.
