# Local Development

This document describes how to run the M365 Discovery Platform locally for development and testing on **Windows + PowerShell**.

Repo root (example):
- `C:\Dev\M365 discovery tool\m365-discovery-platform`

The platform is a monorepo with:
- **API** (Fastify) on `http://localhost:8080`
- **Worker** (polls queued jobs, executes collectors)
- **Postgres + MinIO (S3)** via `docker compose`

---

## Prerequisites

- Node.js + `pnpm`
- Docker Desktop (Linux containers)
- Ports available:
  - API: `8080`
  - Postgres: `5432`
  - MinIO (S3): `9000`
  - MinIO Console: `9001`

---

## Environment files

### Docker Compose env file

`docker-compose.yml` reads secrets from an `.env.docker` file supplied on the CLI:

```powershell
copy docker.env.example .env.docker
# edit .env.docker — set MINIO_ROOT_USER, MINIO_ROOT_PASSWORD, and other secrets
docker compose --env-file .env.docker up --build
```

`.env.docker` is gitignored. `docker.env.example` is the committed template — copy it and fill in real values.

If you run `docker compose up -d` without `--env-file`, compose falls back to the in-file defaults (suitable for throwaway local testing only — MinIO will start with `dev-minio-user` / `dev-minio-password`).

### API and worker local env files

When running the API and worker **outside Docker** (i.e. `pnpm dev:api` / `pnpm dev:worker`),
each service loads its own `.env` file:

- API: `apps/api/.env`
- Worker: `apps/worker/.env`

These files are gitignored. Minimum required content for local dev:

**`apps/api/.env`**
```
DATABASE_URL=postgresql://app:app@localhost:5432/m365discovery
PORTAL_INTERNAL_JWT_SECRET=dev-secret-change-me-in-production
PORTAL_DEV_ORG_ID=dev-org
S3_ENDPOINT=http://localhost:9000
S3_PUBLIC_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=dev-minio-user
S3_SECRET_KEY=dev-minio-password-change-me
S3_BUCKET=artefacts
S3_FORCE_PATH_STYLE=true
S3_REGION=us-east-1
```

**`apps/worker/.env`**
```
DATABASE_URL=postgresql://app:app@localhost:5432/m365discovery
GRAPH_CLIENT_ID=<your-graph-client-id>
GRAPH_CLIENT_SECRET=<your-graph-client-secret>
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=dev-minio-user
S3_SECRET_KEY=dev-minio-password-change-me
S3_BUCKET=artefacts
S3_FORCE_PATH_STYLE=true
S3_REGION=us-east-1
```

The `S3_ACCESS_KEY` / `S3_SECRET_KEY` values must match `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`
from your `.env.docker` (or the compose defaults if running without `--env-file`).

Keep secrets out of git.

---

## Start dependencies (Postgres + MinIO)

From repo root:

```powershell
docker compose --env-file .env.docker up -d
docker compose ps
```

Or without an env file (uses compose defaults — throwaway local only):

```powershell
docker compose up -d
```

Expected:
- Postgres listening on `localhost:5432`
- MinIO listening on `http://localhost:9000` (console `http://localhost:9001`)

Quick connectivity check:

```powershell
Test-NetConnection -ComputerName localhost -Port 5432 | Out-String -Width 300
Test-NetConnection -ComputerName localhost -Port 9000 | Out-String -Width 300
```

If you see an error like `open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`, Docker Desktop isn't running (or is set to Windows containers). Start Docker Desktop and ensure it is using Linux containers.

---

## Run the API

From repo root:

```powershell
pnpm -C apps/api dev
```

Health check:

```powershell
Invoke-RestMethod "http://localhost:8080/health" | Out-String -Width 300
```

### Demo-only UI (API hosted)

For quick local testing only (not long-term architecture), the API exposes:

- `GET http://localhost:8080/demo`

This page lets you:
- create a run (`POST /runs`)
- view run + jobs live (polls `GET /runs/:runId` + `GET /runs/:runId/jobs`)
- jump to findings + artefacts endpoints

**Note:** long-term UI will live in a dedicated portal app. The `/demo` page is intentionally "demo-only".

---

## Run the Worker

From repo root:

```powershell
$env:WORKER_NAME="A"
pnpm -C apps/worker dev
```

The worker polls queued jobs and executes collectors. If the worker cannot reach Postgres, you'll see a Prisma error like:

- `Can't reach database server at localhost:5432`

Fix by starting Docker dependencies (`docker compose up -d`) and restarting the worker.

---

## Create a run (PowerShell)

Example: **safe** run using the CDX demo tenant (used for local testing):

```powershell
Invoke-RestMethod -Method Post "http://localhost:8080/runs" `
  -ContentType "application/json" `
  -Body (@{
    tenantGuid     = "540186da-1f21-4f9b-9d40-e74273d4eead"
    primaryDomain  = "M365x44853766.onmicrosoft.com"
    displayName    = "CDX Demo Tenant"
    triggeredBy    = "portal-demo"
    dataProfile    = "safe"   # optional (defaults to safe)
    modulesEnabled = @{ entraUsers = $true }
  } | ConvertTo-Json -Depth 6) | Out-String -Width 300
```

Notes:
- `dataProfile` is **hardened**: only `"full"` is treated as full; anything else becomes `"safe"`.
- `modulesEnabled` controls which module collectors get queued. Report collectors are always appended at the end of the run.

---

## Inspect run, jobs, findings, artefacts

```powershell
$runId = "<RUN_ID>"

Invoke-RestMethod "http://localhost:8080/runs/$runId" | Out-String -Width 300
Invoke-RestMethod "http://localhost:8080/runs/$runId/jobs" | Out-String -Width 300
Invoke-RestMethod "http://localhost:8080/runs/$runId/findings" | Out-String -Width 300
Invoke-RestMethod "http://localhost:8080/runs/$runId/artefacts" | Out-String -Width 300
```

---

## Download artefacts

Artefact download endpoints:
- `GET /artefacts/:artefactId/download` (global)
- `GET /runs/:runId/artefacts/:artefactId/download` (backwards compatible)

These endpoints return a **302 redirect** to a short-lived **presigned MinIO URL** (with an `X-Download-Expires-At` header).

PowerShell example (follow redirect and write to disk):

```powershell
$artefactId = "<ARTEFACT_ID>"
Invoke-WebRequest "http://localhost:8080/artefacts/$artefactId/download" `
  -MaximumRedirection 10 `
  -OutFile .\downloaded-artefact
```

If you want to keep the filename/type, prefer saving to the correct extension (e.g. `.xlsx`, `.csv`) based on the artefact record (`type`, `key`).

### Local dev-only downloads

If you use a fixed filename like `downloaded-artefact`, it is safe to ignore locally. The repo `.gitignore` includes:

- `downloaded-artefact`

---

## MinIO Console (optional)

MinIO Console:
- `http://localhost:9001`

Log in with the credentials from your `.env.docker` (`MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`).
If running without `--env-file`, the compose defaults are `dev-minio-user` / `dev-minio-password`.

Bucket (default):
- `artefacts`

The API presigns downloads from MinIO; clients do not need MinIO credentials.

---

## Stop dependencies

```powershell
docker compose down
```
