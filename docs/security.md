# Security

This document describes the security model of the M365 Discovery Platform, including threat boundaries, design decisions, and least-privilege rationale.

Security is treated as a **first-class design constraint**, not an afterthought.

---

## Security goals

The platform is designed to:

- Minimise the blast radius of credential compromise
- Separate privileged operations from request handling
- Avoid exposing sensitive data via the API
- Make security boundaries explicit and auditable
- Support incremental hardening without architectural rewrites

---

## Trust boundaries

The platform is intentionally split into multiple trust zones.

### API (Fastify)

The API:
- Accepts requests from users or automation
- Validates input and persists state (Runs, Jobs, Tenants)
- Serves **read-only** views of findings and artefacts
- Generates **short-lived presigned URLs** for artefact download

The API:
- **Does not** call Microsoft Graph
- **Does not** execute discovery logic
- **Does not** stream large artefacts
- **Does not** hold broad Graph permissions

This limits the impact of API-layer vulnerabilities.

---

### Worker (background process)

The worker:
- Polls jobs from the database
- Executes collectors
- Performs Microsoft Graph calls
- Uploads artefacts to object storage
- Writes findings and artefact metadata

The worker is the **only component** that:
- Holds Microsoft Graph credentials
- Uploads artefacts to object storage

This makes the worker the primary privileged execution boundary.

---

### Database (Postgres)

Postgres is used for:
- Platform state (Tenants, Runs, Jobs)
- Findings and artefact metadata
- Execution traceability

Sensitive secrets are **not** stored in the database.

---

### Object storage (MinIO / S3)

Object storage is used for:
- Artefact content only (JSON, CSV, reports)

The database stores:
- bucket/key
- size
- hash

The API never proxies artefact contents.

---

## Authentication and Microsoft Graph access

### Tenant authentication model

Tenant connectivity is validated via a **worker-executed auth test**:

- API enqueues an `entra.auth.test` job
- Worker performs a lightweight app-only Graph call
- `TenantAuth` is updated with:
  - `status` (`connected` or `error`)
  - `lastError`
  - `consentedAt`

The API never calls Graph directly.

---

### Least privilege rationale

Collectors are expected to:
- Request only the Graph permissions required for their scope
- Prefer lightweight list or metadata calls
- Avoid exporting unnecessary tenant data

Auth tests intentionally use minimal endpoints to validate connectivity without broad access.

---

## Job execution and isolation

- Jobs are executed one at a time per worker
- Jobs are locked using `lockedAt` and `lockedBy`
- Stale locks are automatically requeued
- Retries use exponential backoff
- Each job records:
  - attempts
  - lastError
  - result summary

This ensures:
- no double execution
- recoverability from crashes
- traceability of failures

---

## Artefact security

Artefacts are handled using a defence-in-depth approach:

- Artefacts are uploaded by the worker only
- Object storage credentials are never exposed to users
- API issues **short-lived presigned URLs**
- URLs are time-bounded and non-guessable
- Downloads are served directly from object storage

Artefact integrity is tracked using SHA-256 hashes.

---

## Data minimisation

The platform deliberately separates:

- **Findings** (human-readable insights)
- **Artefacts** (raw or structured exports)

Collectors should:
- Prefer Findings for summarised insight
- Use Artefacts only when raw data is required
- Avoid duplicating sensitive data across both

---

## Failure handling and visibility

Security-relevant failures are surfaced explicitly:

- Failed auth tests update `TenantAuth.status = error`
- Collector failures populate `Job.lastError`
- Run status reflects aggregate job outcomes
- Errors are preserved for audit and troubleshooting

Failures are never silently swallowed.

---

## Threat considerations

The platform design mitigates common threats:

- API compromise does not expose Graph credentials
- Artefact access is time-limited
- Job execution is isolated and traceable
- Long-running or stuck jobs are automatically recovered

Remaining risks (e.g. worker host compromise) are acknowledged and can be addressed with:
- container isolation
- secret rotation
- managed identity (future enhancement)

---

## Future hardening (intentional, not required now)

Planned improvements include:
- Managed identity or workload identity for Graph access
- Separate object storage credentials per component
- Row-level security for multi-tenant UI access
- Artefact retention and automatic cleanup
- Fine-grained audit logging

The current architecture supports these enhancements without major refactoring.

---

## Summary

Security in the M365 Discovery Platform is based on:
- clear trust boundaries
- least-privilege execution
- explicit job-based execution
- minimal API responsibility

This enables safe iteration, auditability, and long-term maintainability.