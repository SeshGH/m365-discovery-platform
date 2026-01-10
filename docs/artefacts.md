# Artefacts

Artefacts are binary or structured outputs produced by collectors (e.g. JSON exports, CSV reports) that are too large or awkward to store inline as Findings.

Artefacts are:
- uploaded by the **worker** to object storage (MinIO/S3)
- recorded in Postgres with metadata (bucket/key/hash/size)
- retrieved via **presigned URLs** from the API

This keeps the API stateless and avoids proxying large downloads through the API process.

---

## Data model

An Artefact row records:

- `runId` (required)
- `jobId` (optional; preferred for traceability)
- `type` (enum; includes `json`)
- `bucket` / `key` (object storage address)
- `uri` (`s3://bucket/key` convenience)
- `hash` (sha256 of uploaded content)
- `sizeBytes`
- `createdAt`

---

## Storage layout

Artefacts are stored using predictable, partitioned keys:

- `runs/<runId>/jobs/<jobId>/<filename>`

Example:

- `runs/cmk7.../jobs/cmk7.../enterprise-app-permissions.json`

Benefits:
- easy per-run and per-job grouping
- avoids “flat bucket” listing performance issues
- reduces accidental collisions
- makes cleanup strategies straightforward later

---

## Upload flow (worker)

1) Collector returns `CollectorResult.artefacts[]` with:
- `filename`
- `contentType`
- `content` (Buffer or string)
- `type` (should align with Prisma enum; default `json`)

2) Worker uploads the content to object storage.

3) Worker writes an `Artefact` row in Postgres with:
- bucket/key/uri
- sha256 hash
- sizeBytes
- runId/jobId linkage

Collectors do not talk directly to MinIO/S3.

---

## Download flow (API)

The API provides two download endpoints:

### Global download
- `GET /artefacts/:artefactId/download`

Looks up the artefact and returns a presigned URL.

### Run-scoped download (backwards compatible)
- `GET /runs/:runId/artefacts/:artefactId/download`

Same behaviour, additionally enforces the artefact belongs to the specified run.

### TTL
Presigned URLs use a short TTL, controlled by:

- `ARTEFACT_URL_TTL_SECONDS` (defaults to 300 seconds)
- clamped to a safe range (30–3600 seconds)

The response also includes an `expiresAt` timestamp for UI convenience.

---

## Integrity and traceability

### Hashing
Artefacts are hashed (sha256) during upload.

This provides:
- lightweight integrity verification
- stable change detection (future de-duplication if desired)

### Job linkage
If an artefact is produced by a specific job, it should include `jobId`.
This enables:
- “job output” views in the portal
- auditing what produced a file
- targeted cleanup if a job is re-run

---

## Conventions

### Artefact types
Prefer explicit types matching the Prisma enum:
- `json` for structured exports
- other types only when added intentionally (via migration + doc update)

### Filenames
Filenames should:
- be deterministic (avoid timestamps unless required)
- use kebab-case
- not include secrets or tenant identifiers beyond run/job structure

Good:
- `enterprise-app-permissions.json`
- `users.json`

Avoid:
- `540186da-...-export.json`
- `permissions-2026-01-09T...json`

### Content types
Use accurate content types:
- `application/json`
- `text/csv`

---

## Security-by-design notes

- The worker is the only process that uploads to object storage.
- The API never streams artefact bodies.
- Presigned URL TTLs are short and bounded.
- Download responses set `Content-Disposition: attachment` with filename sanitisation.
- Object storage credentials are held by the API and worker via environment variables; scope should be restricted to the artefacts bucket only (future hardening: dedicated users/policies per component).

---
