# Artefacts

Artefacts are binary or structured outputs produced by collectors (e.g. JSON exports, CSV reports, XLSX workbooks) that are too large or awkward to store inline as Findings.

Artefacts are:
- uploaded by the **worker** to object storage (MinIO/S3)
- recorded in Postgres with metadata (`bucket` / `key` / `hash` / `sizeBytes`)
- retrieved via **presigned download URLs** issued by the API

This keeps the API stateless and avoids proxying large downloads through the API process.

---

## Data model

An `Artefact` row records:

- `runId` (required)
- `jobId` (optional; preferred for traceability)
- `type` (enum; e.g. `json`, `csv`, `raw`)
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

- `runs/cmk.../jobs/cmk.../enterprise-app-permissions.json`
- `runs/cmk.../jobs/cmk.../run-summary.xlsx`

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
- `type` (should align with Prisma enum)

2) Worker uploads the content to object storage.

3) Worker writes an `Artefact` row in Postgres with:
- `bucket` / `key` / `uri`
- sha256 `hash`
- `sizeBytes`
- `runId` / `jobId` linkage

Collectors do not talk directly to MinIO/S3.

---

## Download flow (API)

The API provides two download endpoints:

### Global download
- `GET /artefacts/:artefactId/download`

Looks up the artefact and responds with an **HTTP 302 redirect** to a presigned object storage URL.

### Run-scoped download (backwards compatible)
- `GET /runs/:runId/artefacts/:artefactId/download`

Same behaviour, additionally enforces the artefact belongs to the specified run.

### TTL

Presigned URLs use a short TTL, controlled by:

- `ARTEFACT_URL_TTL_SECONDS` (defaults to 300 seconds)
- clamped to a safe range (30–3600 seconds)

The API also includes an `X-Download-Expires-At` header to indicate expiry time for clients (optional convenience).

Operational note:
- Presigned URLs are intentionally short-lived; clients should request a fresh download immediately before retrieving the file.

---

## Integrity and traceability

### Hashing

Artefacts are hashed (sha256) during upload.

This provides:
- lightweight integrity verification
- stable change detection (future de-duplication if desired)

### Job linkage

Artefacts are job outputs; `jobId` provides traceability.

This enables:
- “job output” views in the portal
- auditing what produced a file
- targeted cleanup if a job is re-run

---

## Artefact sensitivity (overview)

Artefacts broadly fall into:

### Summary / safe artefacts
- aggregated or derived outputs
- minimal or no PII
- suitable for broad access and demos

Examples:
- run summary CSV/XLSX
- count-based exports

### Sensitive artefacts (explicit)
- may contain Personally Identifiable Information (PII)
- intended for detailed analysis, scoping, or migration work
- emitted only when explicitly enabled by run configuration (e.g. `dataProfile: "full"`)

Examples:
- full user inventories
- detailed app permission exports

Sensitive artefacts:
- must be clearly named
- must not silently appear
- should avoid duplication of PII into Findings

---

## Conventions (non-authoritative)

### Filenames
Filenames should:
- be deterministic (avoid timestamps unless required)
- use kebab-case
- not include secrets

Good:
- `enterprise-app-permissions.json`
- `users-inventory.json`
- `run-summary.csv`
- `run-summary.xlsx`

Avoid:
- random GUID-based names
- timestamp-heavy names unless required for uniqueness

### Content types
Use accurate content types:
- `application/json`
- `text/csv`
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

---

## Security-by-design notes

- The worker is the only process that uploads to object storage.
- The API never streams artefact bodies; it only issues presigned URLs via redirects.
- Presigned URL TTLs are short and bounded.
- Download responses set `Content-Disposition: attachment` with filename sanitisation.
- Object storage credentials are held by the API and worker via environment variables; scope should be restricted to the artefacts bucket only.


### PowerShell download example

```powershell
$artefactId = "<ARTEFACT_ID>"
Invoke-WebRequest "http://localhost:8080/artefacts/$artefactId/download" `
  -MaximumRedirection 10 `
  -OutFile .\downloaded-artefact
```
