# Local Development

This document describes how to run the platform locally for development and testing.

For **development discipline, command hygiene, and workflow expectations**, see:
- `docs/dev-workflow.md`

Repo root (Windows):
- `C:\Dev\M365 discovery tool\m365-discovery-platform`

The platform is a monorepo with:
- API (Fastify) on `http://localhost:8080`
- Worker (polling jobs) executing collectors
- Postgres + MinIO via docker compose

---

## Prerequisites

- Node.js + pnpm
- Docker Desktop (Linux containers)
- Ports available:
  - API: `8080`
  - Postgres: `5432`
  - MinIO: `9000`
  - MinIO Console: `9001`

---

## Environment files

The API and worker load environment variables from their own `.env` files using absolute path resolution:

- API: `apps/api/.env`
- Worker: `apps/worker/.env`

Keep secrets out of git.

---

## Start dependencies (Postgres + MinIO)

From repo root:

    docker compose up -d

Expected:
- Postgres available on `localhost:5432`
- MinIO available on `http://localhost:9000`
- MinIO console available on `http://localhost:9001`

Bucket:
- `artefacts`

---

## Database and Prisma

Schema location:
- `packages/db/prisma/schema.prisma`

Migrations:
- `packages/db/prisma/migrations`

Generate Prisma client:

    pnpm --filter @acme/db prisma generate

If you add migrations:

    pnpm --filter @acme/db prisma migrate dev

---

## Start the API

From repo root:

    pnpm dev:api

Health check:

    Invoke-RestMethod "http://localhost:8080/health"

---

## Start the worker

From repo root:

    pnpm dev:worker

---

## Smoke test: create a run

    $r = Invoke-RestMethod -Method Post "http://localhost:8080/runs" `
      -ContentType "application/json" `
      -Body (@{
        tenantGuid = "540186da-1f21-4f9b-9d40-e74273d4eead"
        primaryDomain = "example.onmicrosoft.com"
        displayName = ""
        triggeredBy = "ps-test"
        modulesEnabled = @{ entraUsers = $true; enterpriseAppPermissions = $true }
      } | ConvertTo-Json)

View jobs:

    Invoke-RestMethod "http://localhost:8080/runs/$($r.runId)/jobs"

---

## Tenant auth test

    Invoke-RestMethod "http://localhost:8080/tenants/by-guid/<GUID>/auth"
    Invoke-RestMethod -Method Post "http://localhost:8080/tenants/by-guid/<GUID>/auth/test"

---

## Clean reset (local only)

    docker compose down -v
    docker compose up -d
