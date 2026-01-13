import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// Allow PowerShell POSTs that default to application/x-www-form-urlencoded with no meaningful body
app.addContentTypeParser(
  "application/x-www-form-urlencoded",
  { parseAs: "string" },
  (_req, _body, done) => done(null, {})
);

// --------------------
// Module -> Collector mapping
// --------------------
// IMPORTANT: The keys here must match CreateRunSchema input.modulesEnabled keys
const MODULE_TO_COLLECTOR_ID: Record<string, string> = {
  entraUsers: "entra.users",
  enterpriseAppPermissions: "entra.enterpriseApps.permissions"
};

// Always enqueue these report jobs at the end of a run
const RUN_REPORT_COLLECTOR_IDS = [
  "report.runSummary.csv",
  "report.runSummary.xlsx"
] as const;

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
 *
 * This returns JobSpecs (collectorId + module key). Payload is added later once we know tenantId/tenantGuid.
 */
function resolveCollectorJobs(modulesEnabled: unknown): JobSpec[] {
  // Default behaviour: at least one job
  const fallback: JobSpec[] = [{ collectorId: "entra.users", module: "entraUsers" }];

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

app.get("/demo", async (_req, reply) => {
  reply.type("text/html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>M365 Discovery Platform - Demo</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 24px; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 16px; max-width: 900px; }
    label { display:block; margin-top: 12px; font-weight: 600; }
    input, select { width: 100%; padding: 10px; margin-top: 6px; border: 1px solid #ccc; border-radius: 8px; }
    .row { display:flex; gap: 12px; }
    .row > div { flex: 1; }
    button { margin-top: 16px; padding: 10px 14px; border: 0; border-radius: 8px; cursor: pointer; }
    pre { background: #0b1020; color: #d6e7ff; padding: 12px; border-radius: 10px; overflow:auto; }
    .muted { color: #555; font-size: 0.95em; }
    .pill { display:inline-block; padding: 2px 8px; border-radius: 999px; background:#f2f2f2; margin-left: 6px; }
    a { color: #0b5bd3; }
  </style>
</head>
<body>
  <div class="card">
    <h2>M365 Discovery Platform <span class="pill">demo</span></h2>
    <div class="muted">Creates a run and then lets you pull jobs/findings/artefacts via the API.</div>

    <div class="row">
      <div>
        <label>tenantGuid</label>
        <input id="tenantGuid" value="00000000-0000-0000-0000-000000000000" />
      </div>
      <div>
        <label>primaryDomain</label>
        <input id="primaryDomain" value="example.onmicrosoft.com" />
      </div>
    </div>

    <div class="row">
      <div>
        <label>dataProfile</label>
        <select id="dataProfile">
          <option value="safe" selected>safe</option>
          <option value="full">full</option>
        </select>
      </div>
      <div>
        <label>modulesEnabled</label>
        <div style="margin-top: 6px;">
          <label style="font-weight:500;"><input type="checkbox" id="entraUsers" checked /> entraUsers</label>
          <label style="font-weight:500;"><input type="checkbox" id="enterpriseAppPermissions" checked /> enterpriseAppPermissions</label>
        </div>
      </div>
    </div>

    <button id="createRun">Create run</button>

    <div id="links" style="margin-top: 16px;"></div>
    <pre id="out">{ "status": "ready" }</pre>
  </div>

<script>
  const out = (obj) => {
    document.getElementById("out").textContent =
      typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  };

  const mkLink = (href, text) => \`<div><a href="\${href}" target="_blank" rel="noreferrer">\${text}</a></div>\`;

  document.getElementById("createRun").addEventListener("click", async () => {
    const tenantGuid = document.getElementById("tenantGuid").value.trim();
    const primaryDomain = document.getElementById("primaryDomain").value.trim();
    const dataProfile = document.getElementById("dataProfile").value;
    const entraUsers = document.getElementById("entraUsers").checked;
    const enterpriseAppPermissions = document.getElementById("enterpriseAppPermissions").checked;

    const payload = {
      tenantGuid,
      primaryDomain,
      triggeredBy: "demo",
      dataProfile,
      modulesEnabled: {
        entraUsers,
        enterpriseAppPermissions
      }
    };

    out({ creating: true, payload });

    const res = await fetch("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    out({ status: res.status, response: json });

    const runId = json.runId;
    if (!runId) return;

    document.getElementById("links").innerHTML = [
      mkLink(\`/runs/\${runId}\`, \`GET /runs/\${runId}\`),
      mkLink(\`/runs/\${runId}/jobs\`, \`GET /runs/\${runId}/jobs\`),
      mkLink(\`/runs/\${runId}/findings\`, \`GET /runs/\${runId}/findings\`),
      mkLink(\`/runs/\${runId}/artefacts\`, \`GET /runs/\${runId}/artefacts\`)
    ].join("");
  });
</script>
</body>
</html>`);
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
// Artefact download (GLOBAL)
// GET /artefacts/:artefactId/download
// --------------------
app.get("/artefacts/:artefactId/download", async (req, reply) => {
  const { artefactId } = req.params as { artefactId: string };

  const artefact = await prisma.artefact.findUnique({
    where: { id: artefactId }
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
// Artefact download (run-scoped) — keep for backwards compatibility
// GET /runs/:runId/artefacts/:artefactId/download
// --------------------
app.get("/runs/:runId/artefacts/:artefactId/download", async (req, reply) => {
  const { runId, artefactId } = req.params as { runId: string; artefactId: string };

  const artefact = await prisma.artefact.findFirst({
    where: { id: artefactId, runId }
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
// Tenants — list / lookup for portal UX
// GET /tenants?tenantGuid=...&primaryDomain=...&q=...&take=...
// --------------------
app.get("/tenants", async (req) => {
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
  const primaryDomain =
    typeof query.primaryDomain === "string" ? query.primaryDomain.trim() : "";
  const q = typeof query.q === "string" ? query.q.trim() : "";

  const where: any = {};

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
// TenantAuth
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
  const { tenantId } = req.params as { tenantId: string };

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
  const { tenantId } = req.params as { tenantId: string };

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

// GET /tenants/by-guid/:tenantGuid/auth
app.get("/tenants/by-guid/:tenantGuid/auth", async (req, reply) => {
  const { tenantGuid } = req.params as { tenantGuid: string };

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

// POST /tenants/by-guid/:tenantGuid/auth/test
app.post("/tenants/by-guid/:tenantGuid/auth/test", async (req, reply) => {
  const { tenantGuid } = req.params as { tenantGuid: string };

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
// Create Run + Jobs
// --------------------
app.post("/runs", async (request, reply) => {
  const parsed = CreateRunSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.status(400).send({
      error: "Invalid request",
      details: parsed.error.flatten()
    });
  }

  const input = parsed.data;

  const dataProfile = input.dataProfile === "full" ? "full" : "safe";

  // 1) Upsert tenant
  const tenant = await prisma.tenant.upsert({
    where: { tenantGuid: input.tenantGuid },
    update: {
      primaryDomain: input.primaryDomain,
      displayName: input.displayName ?? undefined
    },
    create: {
      tenantGuid: input.tenantGuid,
      primaryDomain: input.primaryDomain,
      displayName: input.displayName
    }
  });

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

  // Always enqueue report jobs LAST (so they naturally run after module collectors)
  const reportJobs = await prisma.$transaction(
    RUN_REPORT_COLLECTOR_IDS.map((collectorId) =>
      prisma.job.create({
        data: {
          runId: run.id,
          status: "queued",
          collectorId,
          payload: {
            tenantId: tenant.id,
            tenantGuid: tenant.tenantGuid,
            module: "runReport",
            dataProfile
          }
        }
      })
    )
  );

  return reply.status(201).send({
    runId: run.id,
    jobIds: [...createdJobs.map((j) => j.id), ...reportJobs.map((j) => j.id)],
    tenantId: tenant.id,
    dataProfile
  });
});

// --------------------
// Read-only endpoints
// --------------------

// List runs (latest first) + use _count for perf
app.get("/runs", async () => {
  const runs = await prisma.run.findMany({
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
  const { runId } = req.params as { runId: string };

  const run = await prisma.run.findUnique({
    where: { id: runId },
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
      jobs: run._count.jobs,
      findings: run._count.findings,
      artefacts: run._count.artefacts
    }
  };
});

function isTerminalJobStatus(status: unknown): boolean {
  return status === "succeeded" || status === "failed";
}

// List jobs for a run (real 1:N now)
app.get("/runs/:runId/jobs", async (req, reply) => {
  const { runId } = req.params as { runId: string };

  const runExists = await prisma.run.findUnique({
    where: { id: runId },
    select: { id: true }
  });

  if (!runExists) return reply.code(404).send({ error: "Run not found" });

  const jobs = await prisma.job.findMany({
    where: { runId },
    orderBy: { createdAt: "desc" },
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
  const { runId } = req.params as { runId: string };

  const runExists = await prisma.run.findUnique({
    where: { id: runId },
    select: { id: true }
  });
  if (!runExists) return reply.code(404).send({ error: "Run not found" });

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

// List artefacts for a run (includes bucket/key + jobId)
app.get("/runs/:runId/artefacts", async (req, reply) => {
  const { runId } = req.params as { runId: string };

  const runExists = await prisma.run.findUnique({
    where: { id: runId },
    select: { id: true }
  });
  if (!runExists) return reply.code(404).send({ error: "Run not found" });

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
