# Local Development

This document describes how to run the platform locally for development and testing.

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

```powershell
docker compose up -d
