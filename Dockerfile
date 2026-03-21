# Dockerfile — root of the pnpm monorepo
# Used by: api, worker, portal (each service uses a different `command` in docker-compose.yml)
# This is a dev/demo image — not optimised for production.

FROM node:22-slim

# ── pnpm ──────────────────────────────────────────────────────────────────────
# Node 22 ships with corepack 0.28+, which bundles pnpm 9.x as a compressed
# tarball inside the corepack package — no network download required.
# COREPACK_ENABLE_STRICT=0 allows the bundled pnpm 9.x to be used in place of
# the exact version pinned in package.json ("packageManager":"pnpm@9.0.0"),
# which would otherwise force corepack to download that specific version.
ENV COREPACK_ENABLE_STRICT=0
RUN corepack enable

# ── System dependencies (Prisma needs openssl) ────────────────────────────────
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Dependency layer (cached unless manifests change) ─────────────────────────
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

COPY apps/api/package.json       ./apps/api/
COPY apps/worker/package.json    ./apps/worker/
COPY apps/portal/package.json    ./apps/portal/
COPY apps/web/package.json       ./apps/web/

COPY packages/core/package.json       ./packages/core/
COPY packages/db/package.json         ./packages/db/
COPY packages/collectors/package.json ./packages/collectors/

RUN pnpm install --frozen-lockfile

# ── Source ────────────────────────────────────────────────────────────────────
COPY . .

# ── Prisma client (generated from packages/db/prisma/schema.prisma) ───────────
RUN node_modules/.bin/prisma generate --schema packages/db/prisma/schema.prisma

# Ports exposed by each service (documentation only; docker-compose maps them)
EXPOSE 8080 3000
