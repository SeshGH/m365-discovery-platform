# Security Model

This document describes the **security-by-design principles**, trust boundaries, and risk controls used by the M365 Discovery Platform.

This platform is intentionally designed to operate in **MSP and enterprise environments**, where delegated administrative access to customer tenants is expected, but must still be handled with care, auditability, and least privilege.

---

## Core Principles

1. **Least privilege by default**
2. **Explicit trust boundaries**
3. **Worker-only execution of privileged actions**
4. **Read-only access wherever possible**
5. **Traceability over mutation**
6. **Sensitive data is opt-in, explicit, and auditable**

---

## Trust Boundaries

### API
- The API **never** calls Microsoft Graph
- The API **never** holds Graph credentials
- The API exposes **read-only views** of persisted state
- The API issues **short-lived presigned URLs** for artefact download

### Worker
- The worker is the **only component** that:
  - Holds Graph credentials
  - Calls Microsoft Graph
  - Executes discovery collectors
- Workers operate using **application-only (client credentials)** auth
- Workers are stateless and horizontally scalable

### Database
- Postgres stores:
  - Runs
  - Jobs
  - Findings
  - Artefact metadata
- The database **does not store raw Graph tokens**
- Artefact payloads are **not stored in Postgres**

### Object Storage (MinIO / S3)
- Raw artefacts (CSV, JSON, XLSX) are stored in object storage
- Artefact keys are predictable and scoped by:

runs/{runId}/jobs/{jobId}/{filename}

- Object storage access is **indirect**, via presigned URLs only

---

## Microsoft Graph Access Model

### Authentication
- Application-only (client credentials)
- `.default` scope
- Tenant-scoped token issuance
- Admin consent required per tenant

### Permission Strategy

The platform uses **read-only Microsoft Graph application permissions**.

Permissions are granted **only when required by an active collector**.

Examples:
- `User.Read.All`
- `Application.Read.All`
- `Directory.Read.All`
- `AuditLog.Read.All` (optional, for enrichment)

> Write permissions (e.g. `*.ReadWrite.*`) are **explicitly avoided**.

### Permission Hygiene

- Each collector is responsible for a **specific Graph surface**
- Required permissions are documented per collector
- Permission creep is treated as a defect
- Risky or excessive permissions in *customer* apps are flagged as findings

---

## Sensitive / PII Data Handling

### Definition

Personally Identifiable Information (PII) may include:
- User names, UPNs, email addresses
- Group memberships
- Application ownership
- Sign-in timestamps
- Other identity-linked attributes

### Platform Position

PII is **expected and legitimate** in MSP discovery scenarios, but must be:

- **Explicit**
- **Minimised by default**
- **Clearly labelled**
- **Auditable**
- **Easy to control and purge**

### Default Behaviour (Safe Mode)

By default:
- Collectors emit **summary and aggregate data**
- Findings avoid embedding raw PII
- Reports focus on posture, coverage, and risk signals

This mode is suitable for:
- Early-stage discovery
- Demos
- Low-risk assessments
- Broad tenant scans

### Explicit Sensitive Exports (Opt-in)

The platform supports (or will support) **explicit opt-in** sensitive exports, for example:
- Full user inventories
- Application permission listings
- Detailed per-object breakdowns

Key characteristics:
- Enabled per run (not global)
- Obvious in configuration and output
- Artefacts clearly labelled as sensitive
- Not silently enabled

### Artefact Responsibilities

When emitting sensitive data:
- Artefacts must be the **primary carrier** of PII
- Findings should reference artefacts, not duplicate raw data
- Filenames and artefact metadata should make sensitivity obvious

---

## Retention & Hardening (Planned)

The following controls are **planned and documented**, even if not yet fully enforced:

- Configurable artefact retention periods
- Automated purge of expired artefacts
- Stronger access controls in the portal UI
- Download auditing (who accessed what, when)
- Optional application-level encryption for sensitive artefacts

These measures are intentionally staged to avoid blocking early iteration while maintaining a clear security trajectory.

---

## Concurrency & Safety

- Jobs are locked atomically (`lockedBy`, `lockedAt`)
- Workers cannot execute the same job concurrently
- Stale jobs are safely re-queued
- Report collectors are gated until all non-report jobs are terminal

These mechanisms prevent:
- Duplicate execution
- Partial reports
- Race-condition artefacts

---

## Summary

This platform balances:
- **Operational reality** (MSP access, tenant-wide discovery)
- **Security best practice** (least privilege, isolation, auditability)
- **Extensibility** (future collectors, richer reports, portal UX)

Security decisions are explicit, documented, and treated as part of the core architecture — not an afterthought.
