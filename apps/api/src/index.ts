import dotenv from "dotenv";

import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import { getDemoHtml } from "./demoPage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Always load apps/api/.env, regardless of where pnpm was run from
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import Fastify from "fastify";
import cors from "@fastify/cors";
import { CreateRunSchema } from "@acme/core";
import { prisma } from "@acme/db";

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// DEMO-ONLY UI page (moved out of this file)
import registerDemoPage from "./demoPage.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// Allow PowerShell POSTs that default to application/x-www-form-urlencoded with no meaningful body
app.addContentTypeParser(
  "application/x-www-form-urlencoded",
  { parseAs: "string" },
  (_req, _body, done) => done(null, {})
);

// --------------------
// Portal-minted internal token auth (Slice 1) + Org scoping (Slice 2)
// --------------------

const INTERNAL_JWT_ISSUER = "m365-discovery-portal";
const INTERNAL_JWT_AUDIENCE = "m365-discovery-api";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[api] Missing env var: ${name}`);
  return v;
}

function base64urlToBuffer(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

function safeJsonParse<T>(buf: Buffer): T | null {
  try {
    return JSON.parse(buf.toString("utf8")) as T;
  } catch {
    return null;
  }
}

function signHs256(data: string, secret: string): Buffer {
  return crypto.createHmac("sha256", secret).update(data).digest();
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

type InternalClaims = {
  iss?: string;
  aud?: string;
  sub?: string;
  org_id?: string;
  roles?: unknown;
  tenant_mode?: "all" | "list";
  tenant_ids?: unknown;
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
};

function verifyInternalJwt(
  token: string,
  secret: string
): { ok: true; claims: InternalClaims } | { ok: false } {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false };

  const [encodedHeader, encodedPayload, encodedSig] = parts;
  const headerBuf = base64urlToBuffer(encodedHeader);
  const payloadBuf = base64urlToBuffer(encodedPayload);
  const sigBuf = base64urlToBuffer(encodedSig);

  const header = safeJsonParse<{ alg?: string; typ?: string }>(headerBuf);
  const claims = safeJsonParse<InternalClaims>(payloadBuf);
  if (!header || !claims) return { ok: false };

  if (header.alg !== "HS256") return { ok: false };

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSig = signHs256(signingInput, secret);
  if (!timingSafeEqual(sigBuf, expectedSig)) return { ok: false };

  // Standard claim checks
  if (claims.iss !== INTERNAL_JWT_ISSUER) return { ok: false };
  if (claims.aud !== INTERNAL_JWT_AUDIENCE) return { ok: false };

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.nbf === "number" && now < claims.nbf) return { ok: false };
  if (typeof claims.exp === "number" && now >= claims.exp) return { ok: false };
  if (typeof claims.exp !== "number") return { ok: false }; // require exp

  if (typeof claims.org_id !== "string" || !claims.org_id.trim()) return { ok: false };
  if (typeof claims.sub !== "string" || !claims.sub.trim()) return { ok: false };

  return { ok: true, claims };
}

declare module "fastify" {
  interface FastifyRequest {
    portalAuth?: {
      orgId: string;
      sub: string;
      roles: string[];
      tenantMode: "all" | "list";
      tenantIds: string[];
      jti?: string;
    };
  }
}

const INTERNAL_JWT_SECRET = requireEnv("PORTAL_INTERNAL_JWT_SECRET");

app.addHook("onRequest", async (req, reply) => {
  // Allow CORS preflight
  if (req.method === "OPTIONS") return;

  // Public endpoints
  const pathOnly = (req.url ?? "").split("?")[0];
  if (pathOnly === "/health" || pathOnly === "/demo") return;

  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== "string") {
    return reply.code(401).send({ error: "Missing Authorization header" });
  }

  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return reply.code(401).send({ error: "Invalid Authorization header" });
  }

  const token = m[1]?.trim();
  if (!token) {
    return reply.code(401).send({ error: "Missing bearer token" });
  }

  const verified = verifyInternalJwt(token, INTERNAL_JWT_SECRET);
  if (!verified.ok) {
    return reply.code(401).send({ error: "Invalid token" });
  }

  const claims = verified.claims;

  // Normalize roles / tenant claims (Slice 2 uses orgId only for now)
  const roles = Array.isArray(claims.roles) ? claims.roles.filter((r) => typeof r === "string") : [];
  const tenantMode: "all" | "list" = claims.tenant_mode === "list" ? "list" : "all";
  const tenantIds =
    tenantMode === "list" && Array.isArray(claims.tenant_ids)
      ? claims.tenant_ids.filter((t) => typeof t === "string")
      : [];

  req.portalAuth = {
    orgId: String(claims.org_id),
    sub: String(claims.sub),
    roles,
    tenantMode,
    tenantIds,
    jti: typeof claims.jti === "string" ? claims.jti : undefined
  };
});

// --------------------
// Org scoping helpers (Slice 2)
// --------------------

function requirePortalAuth(req: any) {
  if (!req.portalAuth?.orgId) {
    // Should not happen because onRequest enforces token, but keep fail-closed.
    throw new Error("Missing portal auth context");
  }
  return req.portalAuth as {
    orgId: string;
    sub: string;
    roles: string[];
    tenantMode: "all" | "list";
    tenantIds: string[];
    jti?: string;
  };
}

async function assertTenantInOrg(params: { tenantId: string; orgId: string }): Promise<boolean> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: params.tenantId, orgId: params.orgId },
    select: { id: true }
  });
  return Boolean(tenant);
}

async function assertTenantGuidInOrg(params: {
  tenantGuid: string;
  orgId: string;
}): Promise<{ id: string } | null> {
  return prisma.tenant.findFirst({
    where: { tenantGuid: params.tenantGuid, orgId: params.orgId },
    select: { id: true }
  });
}

async function assertRunInOrg(params: { runId: string; orgId: string }) {
  return prisma.run.findFirst({
    where: { id: params.runId, tenant: { orgId: params.orgId } },
    select: { id: true, tenantId: true }
  });
}

// --------------------
// Module -> Collector mapping
// --------------------
// IMPORTANT:
// modulesEnabled keys may be:
// - legacy module keys from the demo UI (entraUsers, enterpriseAppPermissions, ...)
// - canonical collector IDs (entra.users, entra.enterpriseApps.permissions, ...)
// We accept BOTH to avoid drift between UI and API.
const MODULE_TO_COLLECTOR_ID: Record<string, string> = {
  // Legacy keys (demo UI / earlier contract)
  entraUsers: "entra.users",
  enterpriseAppPermissions: "entra.enterpriseApps.permissions",
  conditionalAccessPolicies: "entra.conditionalAccess.policies",
  directoryRolesAssignments: "entra.directoryRoles.assignments",

  // New legacy key for demo UI (Exchange)
  exchangeMailboxesInventory: "exchange.mailboxes.inventory",

  // Canonical keys (preferred stable contract)
  "entra.users": "entra.users",
  "entra.enterpriseApps.permissions": "entra.enterpriseApps.permissions",
  "entra.conditionalAccess.policies": "entra.conditionalAccess.policies",
  "entra.directoryRoles.assignments": "entra.directoryRoles.assignments",
  "exchange.mailboxes.inventory": "exchange.mailboxes.inventory"
};

// Legacy run summary collectors (CSV/XLSX) are deprecated and no longer scheduled by default.
// Portal-derived report snapshots (PDF/HTML) will replace these exports.
const RUN_REPORT_COLLECTOR_IDS = [] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type JobSpec = {
  collectorId: string;
  module: string;
};

/**
 * modulesEnabled is an object of boolean flags, e.g:
 * { entraUsers: true, enterpriseAppPermissions: false }
 * OR
 * { "entra.users": true, "entra.enterpriseApps.permissions": true }
 *
 * This returns JobSpecs (collectorId + module key). Payload is added later once we know tenantId/tenantGuid.
 */
function resolveCollectorJobs(modulesEnabled: unknown): JobSpec[] {
  // Default behaviour: at least one job
  const fallback: JobSpec[] = [{ collectorId: "entra.users", module: "entra.users" }];

  if (!isPlainObject(modulesEnabled)) return fallback;

  const jobs: JobSpec[] = [];

  for (const [moduleKey, enabled] of Object.entries(modulesEnabled)) {
    if (enabled !== true) continue;

    const collectorId = MODULE_TO_COLLECTOR_ID[moduleKey];
    if (!collectorId) continue;

    jobs.push({
      collectorId,
      module: moduleKey
    });
  }

  return jobs.length > 0 ? jobs : fallback;
}

// ---- S3/MinIO config (fail fast) ----
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_REGION = process.env.S3_REGION ?? "us-east-1";
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY;
const S3_SECRET_KEY = process.env.S3_SECRET_KEY;
const S3_BUCKET = process.env.S3_BUCKET ?? "artefacts";
const S3_FORCE_PATH_STYLE =
  String(process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() === "true";

if (!S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
  throw new Error(
    `[api] Missing S3 config env vars. Required: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY`
  );
}

const S3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY
  },
  forcePathStyle: S3_FORCE_PATH_STYLE
});

app.get("/health", async () => ({ ok: true }));

/**
 * DEMO-ONLY UI
 * This is intentionally in the API for quick local testing.
 * Long-term UI will live in a dedicated portal app.
 */
app.get("/demo", async (_req, reply) => {
  reply.type("text/html").send(getDemoHtml());
});

function safeAttachmentFilename(name: string) {
  return name.replace(/[^\w.\-() ]+/g, "_");
}

function resolveArtefactTtlSeconds() {
  const expiresInSecondsRaw = Number(process.env.ARTEFACT_URL_TTL_SECONDS ?? 300);
  const expiresInSeconds = Number.isFinite(expiresInSecondsRaw)
    ? Math.min(Math.max(expiresInSecondsRaw, 30), 3600)
    : 300;
  return expiresInSeconds;
}

async function presignArtefactDownload(params: { bucket: string; key: string }) {
  const expiresInSeconds = resolveArtefactTtlSeconds();

  const filename = safeAttachmentFilename(params.key.split("/").pop() ?? "artefact");

  const url = await getSignedUrl(
    S3,
    new GetObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      ResponseContentDisposition: `attachment; filename="${filename}"`
    }),
    { expiresIn: expiresInSeconds }
  );

  return {
    url,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString()
  };
}

// --------------------
// Artefact download (GLOBAL)  [Slice 2: org scoped]
// GET /artefacts/:artefactId/download
// --------------------
app.get("/artefacts/:artefactId/download", async (req, reply) => {
  const auth = requirePortalAuth(req);
  const { artefactId } = req.params as { artefactId: string };

  const artefact = await prisma.artefact.findFirst({
    where: {
      id: artefactId,
      run: { tenant: { orgId: auth.orgId } }
    }
  });

  if (!artefact) {
    return reply.code(404).send({ error: "Artefact not found" });
  }

  const { url, expiresAt } = await presignArtefactDownload({
    bucket: artefact.bucket,
    key: artefact.key
  });

  reply.header("X-Download-Expires-At", expiresAt); // optional
  return reply.redirect(302, url);
});

// --------------------
// Artefact download (run-scoped) - keep for backwards compatibility  [Slice 2: org scoped]
// GET /runs/:runId/artefacts/:artefactId/download
// --------------------
app.get("/runs/:runId/artefacts/:artefactId/download", async (req, reply) => {
  const auth = requirePortalAuth(req);
  const { runId, artefactId } = req.params as { runId: string; artefactId: string };

  // Ensure run is in-org (fail-closed)
  const run = await assertRunInOrg({ runId, orgId: auth.orgId });
  if (!run) return reply.code(404).send({ error: "Run not found" });

  const artefact = await prisma.artefact.findFirst({
    where: {
      id: artefactId,
      runId,
      run: { tenant: { orgId: auth.orgId } }
    }
  });

  if (!artefact) {
    return reply.code(404).send({ error: "Artefact not found" });
  }

  const { url, expiresAt } = await presignArtefactDownload({
    bucket: artefact.bucket,
    key: artefact.key
  });

  reply.header("X-Download-Expires-At", expiresAt); // optional
  return reply.redirect(302, url);
});

// --------------------
// Tenants - list / lookup for portal UX  [Slice 2: org scoped]
// GET /tenants?tenantGuid=...&primaryDomain=...&q=...&take=...
// --------------------
app.get("/tenants", async (req) => {
  const auth = requirePortalAuth(req);

  const query = (req.query ?? {}) as {
    tenantGuid?: string;
    primaryDomain?: string;
    q?: string;
    take?: string | number;
  };

  const takeRaw =
    typeof query.take === "string"
      ? Number(query.take)
      : typeof query.take === "number"
        ? query.take
        : 50;

  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(takeRaw, 1), 200) : 50;

  const tenantGuid = typeof query.tenantGuid === "string" ? query.tenantGuid.trim() : "";
  const primaryDomain = typeof query.primaryDomain === "string" ? query.primaryDomain.trim() : "";
  const q = typeof query.q === "string" ? query.q.trim() : "";

  // Slice 2: always scope tenants by orgId
  const where: any = { orgId: auth.orgId };

  if (tenantGuid) where.tenantGuid = tenantGuid;
  if (primaryDomain) where.primaryDomain = primaryDomain;

  if (q) {
    where.OR = [
      { primaryDomain: { contains: q, mode: "insensitive" } },
      { displayName: { contains: q, mode: "insensitive" } }
    ];
  }

  const tenants = await prisma.tenant.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      tenantGuid: true,
      primaryDomain: true,
      displayName: true,
      createdAt: true,
      updatedAt: true,
      auth: {
        select: {
          status: true,
          lastError: true,
          consentedAt: true,
          updatedAt: true
        }
      }
    }
  });

  return tenants.map((t) => ({
    id: t.id,
    tenantGuid: t.tenantGuid,
    primaryDomain: t.primaryDomain,
    displayName: t.displayName,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    auth: t.auth
      ? {
          status: t.auth.status,
          consentedAt: t.auth.consentedAt,
          lastError: t.auth.lastError,
          updatedAt: t.auth.updatedAt
        }
      : null
  }));
});

// --------------------
// TenantAuth  [Slice 2: org scoped]
// --------------------

function mapTenantAuthResponse(tenant: {
  id: string;
  tenantGuid: string;
  primaryDomain: string;
  displayName: string | null;
  auth: null | {
    tenantId: string;
    mode: unknown;
    status: unknown;
    lastError: string | null;
    consentedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
}) {
  return {
    tenant: {
      id: tenant.id,
      tenantGuid: tenant.tenantGuid,
      primaryDomain: tenant.primaryDomain,
      displayName: tenant.displayName
    },
    auth: tenant.auth ?? null
  };
}

// GET /tenants/:tenantId/auth
app.get("/tenants/:tenantId/auth", async (req, reply) => {
  const auth = requirePortalAuth(req);
  const { tenantId } = req.params as { tenantId: string };

  const ok = await assertTenantInOrg({ tenantId, orgId: auth.orgId });
  if (!ok) return reply.code(404).send({ error: "Tenant not found" });

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      tenantGuid: true,
      primaryDomain: true,
      displayName: true,
      auth: {
        select: {
          tenantId: true,
          mode: true,
          status: true,
          lastError: true,
          consentedAt: true,
          createdAt: true,
          updatedAt: true
        }
      }
    }
  });

  if (!tenant) return reply.code(404).send({ error: "Tenant not found" });

  return mapTenantAuthResponse(tenant);
});

// POST /tenants/:tenantId/auth/test
app.post("/tenants/:tenantId/auth/test", async (req, reply) => {
  const auth = requirePortalAuth(req);
  const { tenantId } = req.params as { tenantId: string };

  const ok = await assertTenantInOrg({ tenantId, orgId: auth.orgId });
  if (!ok) return reply.code(404).send({ error: "Tenant not found" });

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true }
  });

  if (!tenant) return reply.code(404).send({ error: "Tenant not found" });

  const run = await prisma.run.create({
    data: {
      tenantId,
      status: "queued",
      triggeredBy: "auth-test",
      modulesEnabled: { authTest: true },
      dataProfile: "safe"
    }
  });

  const job = await prisma.job.create({
    data: {
      runId: run.id,
      status: "queued",
      collectorId: "entra.auth.test",
      payload: { tenantId }
    }
  });

  return reply.code(202).send({
    runId: run.id,
    jobId: job.id
  });
});

// GET /tenants/by-guid/:tenantGuid/auth  [Slice 2: org scoped]
app.get("/tenants/by-guid/:tenantGuid/auth", async (req, reply) => {
  const auth = requirePortalAuth(req);
  const { tenantGuid } = req.params as { tenantGuid: string };

  const inOrg = await assertTenantGuidInOrg({ tenantGuid, orgId: auth.orgId });
  if (!inOrg) return reply.code(404).send({ error: "Tenant not found" });

  const tenant = await prisma.tenant.findUnique({
    where: { tenantGuid },
    select: {
      id: true,
      tenantGuid: true,
      primaryDomain: true,
      displayName: true,
      auth: {
        select: {
          tenantId: true,
          mode: true,
          status: true,
          lastError: true,
          consentedAt: true,
          createdAt: true,
          updatedAt: true
        }
      }
    }
  });

  if (!tenant) return reply.code(404).send({ error: "Tenant not found" });

  return mapTenantAuthResponse(tenant);
});

// POST /tenants/by-guid/:tenantGuid/auth/test  [Slice 2: org scoped]
app.post("/tenants/by-guid/:tenantGuid/auth/test", async (req, reply) => {
  const auth = requirePortalAuth(req);
  const { tenantGuid } = req.params as { tenantGuid: string };

  const inOrg = await assertTenantGuidInOrg({ tenantGuid, orgId: auth.orgId });
  if (!inOrg) return reply.code(404).send({ error: "Tenant not found" });

  const tenant = await prisma.tenant.findUnique({
    where: { tenantGuid },
    select: { id: true }
  });

  if (!tenant) return reply.code(404).send({ error: "Tenant not found" });

  const run = await prisma.run.create({
    data: {
      tenantId: tenant.id,
      status: "queued",
      triggeredBy: "auth-test",
      modulesEnabled: { authTest: true },
      dataProfile: "safe"
    }
  });

  const job = await prisma.job.create({
    data: {
      runId: run.id,
      status: "queued",
      collectorId: "entra.auth.test",
      payload: { tenantId: tenant.id }
    }
  });

  return reply.code(202).send({
    runId: run.id,
    jobId: job.id,
    tenantId: tenant.id
  });
});

// --------------------
// Create Run + Jobs  [Slice 2: org scoped tenant ownership]
// --------------------
app.post("/runs", async (request, reply) => {
  const auth = requirePortalAuth(request);

  const parsed = CreateRunSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.status(400).send({
      error: "Invalid request",
      details: parsed.error.flatten()
    });
  }

  const input = parsed.data;

  const dataProfile = input.dataProfile === "full" ? "full" : "safe";

  // Slice 2: prevent cross-org tenantGuid reuse (hide existence across orgs)
  const existing = await prisma.tenant.findUnique({
    where: { tenantGuid: input.tenantGuid },
    select: { id: true, orgId: true }
  });

  if (existing?.orgId && existing.orgId !== auth.orgId) {
    return reply.code(404).send({ error: "Tenant not found" });
  }

  // 1) Upsert tenant (create includes orgId; update does NOT change orgId)
  const tenant = await prisma.tenant.upsert({
    where: { tenantGuid: input.tenantGuid },
    update: {
      primaryDomain: input.primaryDomain,
      displayName: input.displayName ?? undefined
    },
    create: {
      tenantGuid: input.tenantGuid,
      primaryDomain: input.primaryDomain,
      displayName: input.displayName,
      orgId: auth.orgId
    }
  });

  // If tenant exists but orgId is NULL (legacy row), adopt it into this org (dev/backfill safety)
  if (!tenant.orgId) {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { orgId: auth.orgId }
    });
  }

  // 2) Create run
  const run = await prisma.run.create({
    data: {
      tenantId: tenant.id,
      status: "queued",
      triggeredBy: input.triggeredBy,
      modulesEnabled: input.modulesEnabled,
      dataProfile
    }
  });

  // 3) Create queued jobs based on modulesEnabled -> collectorIds
  const jobSpecs = resolveCollectorJobs(input.modulesEnabled);

  const createdJobs = await prisma.$transaction(
    jobSpecs.map((spec) =>
      prisma.job.create({
        data: {
          runId: run.id,
          status: "queued",
          collectorId: spec.collectorId,
          payload: {
            tenantId: tenant.id,
            tenantGuid: tenant.tenantGuid,
            module: spec.module,
            dataProfile
          }
        }
      })
    )
  );

  // Legacy report collectors are no longer scheduled by default.
  const reportJobs: { id: string }[] = [];

  return reply.status(201).send({
    runId: run.id,
    jobIds: [...createdJobs.map((j) => j.id), ...reportJobs.map((j) => j.id)],
    tenantId: tenant.id,
    dataProfile
  });
});

// --------------------
// Read-only endpoints  [Slice 2: org scoped]
// --------------------

// List runs (latest first) + use _count for perf
app.get("/runs", async (req) => {
  const auth = requirePortalAuth(req);

  const runs = await prisma.run.findMany({
    where: { tenant: { orgId: auth.orgId } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      startedAt: true,
      endedAt: true,
      triggeredBy: true,
      modulesEnabled: true,
      dataProfile: true,
      tenant: {
        select: {
          id: true,
          tenantGuid: true,
          primaryDomain: true,
          displayName: true
        }
      },
      _count: {
        select: {
          jobs: true,
          findings: true,
          artefacts: true
        }
      }
    }
  });

  return runs.map((r) => ({
    id: r.id,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    triggeredBy: r.triggeredBy,
    modulesEnabled: r.modulesEnabled,
    dataProfile: r.dataProfile ?? "safe",
    tenant: r.tenant,
    counts: {
      jobs: r._count.jobs,
      findings: r._count.findings,
      artefacts: r._count.artefacts
    }
  }));
});

// Get a single run (with tenant + counts)
app.get("/runs/:runId", async (req, reply) => {
  const auth = requirePortalAuth(req);
  const { runId } = req.params as { runId: string };

  const run = await prisma.run.findFirst({
    where: { id: runId, tenant: { orgId: auth.orgId } },
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      startedAt: true,
      endedAt: true,
      triggeredBy: true,
      modulesEnabled: true,
      dataProfile: true,
      tenant: {
        select: {
          id: true,
          tenantGuid: true,
          primaryDomain: true,
          displayName: true
        }
      },
      _count: {
        select: {
          jobs: true,
          findings: true,
          artefacts: true
        }
      }
    }
  });

  if (!run) return reply.code(404).send({ error: "Run not found" });

  return {
    id: run.id,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    triggeredBy: run.triggeredBy,
    modulesEnabled: run.modulesEnabled,
    dataProfile: run.dataProfile ?? "safe",
    tenant: run.tenant,
    counts: {
      jobs: r._count.jobs,
      findings: r._count.findings,
      artefacts: r._count.artefacts
    }
  };
});

function isTerminalJobStatus(status: unknown): boolean {
  return status === "succeeded" || status === "failed";
}

// List jobs for a run (real 1:N now)
app.get("/runs/:runId/jobs", async (req, reply) => {
  const auth = requirePortalAuth(req);
  const { runId } = req.params as { runId: string };

  const run = await assertRunInOrg({ runId, orgId: auth.orgId });
  if (!run) return reply.code(404).send({ error: "Run not found" });

  const jobs = await prisma.job.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      runId: true,
      status: true,
      attempts: true,
      lockedAt: true,
      lockedBy: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
      collectorId: true,
      payload: true,
      _count: {
        select: {
          findings: true,
          artefacts: true
        }
      }
    }
  });

  return jobs.map((j) => ({
    id: j.id,
    runId: j.runId,
    status: j.status,
    attempts: j.attempts,
    lockedAt: j.lockedAt,
    lockedBy: j.lockedBy,
    lastError: j.lastError,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    startedAt: j.lockedAt ?? null,
    endedAt: isTerminalJobStatus(j.status) ? j.updatedAt : null,
    collectorId: j.collectorId,
    payload: j.payload,
    counts: {
      findings: j._count.findings,
      artefacts: j._count.artefacts
    }
  }));
});

// List findings for a run
app.get("/runs/:runId/findings", async (req, reply) => {
  const auth = requirePortalAuth(req);
  const { runId } = req.params as { runId: string };

  const run = await assertRunInOrg({ runId, orgId: auth.orgId });
  if (!run) return reply.code(404).send({ error: "Run not found" });

  const findings = await prisma.finding.findMany({
    where: { runId },
    orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      runId: true,
      jobId: true,
      checkId: true,
      severity: true,
      title: true,
      description: true,
      recommendation: true,
      evidence: true,
      references: true,
      createdAt: true
    }
  });

  return findings;
});

// --------------------
// GET /runs/:runId/observed-checks
// --------------------
app.get("/runs/:runId/observed-checks", async (req, reply) => {
  const auth = requirePortalAuth(req);
  const { runId } = req.params as { runId: string };

  const run = await assertRunInOrg({ runId, orgId: auth.orgId });
  if (!run) return reply.code(404).send({ error: "Run not found" });

  const observed = await prisma.observedCheck.findMany({
    where: { runId },
    orderBy: { observedAt: "asc" }
  });

  return observed;
});

// --------------------
// GET /observed-checks/:observedId  (GLOBAL detail)  [Slice 2: org scoped]
// --------------------
app.get("/observed-checks/:observedId", async (req, reply) => {
  const auth = requirePortalAuth(req);
  const { observedId } = req.params as { observedId: string };

  const observed = await prisma.observedCheck.findFirst({
    where: { id: observedId, run: { tenant: { orgId: auth.orgId } } }
  });

  if (!observed) return reply.code(404).send({ error: "Observed check not found" });

  return observed;
});

// --------------------
// GET /runs/:runId/observed-checks/:observedId  (run-scoped detail)
// --------------------
app.get("/runs/:runId/observed-checks/:observedId", async (req, reply) => {
  const auth = requirePortalAuth(req);
  const { runId, observedId } = req.params as { runId: string; observedId: string };

  const run = await assertRunInOrg({ runId, orgId: auth.orgId });
  if (!run) return reply.code(404).send({ error: "Run not found" });

  // Fail-closed: observed check must belong to the run
  const observed = await prisma.observedCheck.findFirst({
    where: { id: observedId, runId, run: { tenant: { orgId: auth.orgId } } }
  });

  if (!observed) return reply.code(404).send({ error: "Observed check not found for run" });

  return observed;
});

// List artefacts for a run (includes bucket/key + jobId)
app.get("/runs/:runId/artefacts", async (req, reply) => {
  const auth = requirePortalAuth(req);
  const { runId } = req.params as { runId: string };

  const run = await assertRunInOrg({ runId, orgId: auth.orgId });
  if (!run) return reply.code(404).send({ error: "Run not found" });

  const artefacts = await prisma.artefact.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      runId: true,
      jobId: true,
      type: true,
      uri: true,
      bucket: true,
      key: true,
      hash: true,
      sizeBytes: true,
      createdAt: true
    }
  });

  return artefacts;
});

const port = Number(process.env.PORT ?? 8080);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
