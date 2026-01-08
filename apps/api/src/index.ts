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

// ---- S3/MinIO config (fail fast) ----
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_REGION = process.env.S3_REGION ?? "us-east-1";
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY;
const S3_SECRET_KEY = process.env.S3_SECRET_KEY;
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

function safeAttachmentFilename(name: string) {
  return name.replace(/[^\w.\-() ]+/g, "_");
}

app.get("/runs/:runId/artefacts/:artefactId/download", async (req, reply) => {
  const { runId, artefactId } = req.params as {
    runId: string;
    artefactId: string;
  };

  const artefact = await prisma.artefact.findFirst({
    where: { id: artefactId, runId }
  });

  if (!artefact) {
    return reply.code(404).send({ error: "Artefact not found" });
  }

  const expiresInSecondsRaw = Number(process.env.ARTEFACT_URL_TTL_SECONDS ?? 300);
  const expiresInSeconds = Number.isFinite(expiresInSecondsRaw)
    ? Math.min(Math.max(expiresInSecondsRaw, 30), 3600)
    : 300;

  const filename = safeAttachmentFilename(
    artefact.key.split("/").pop() ?? "artefact"
  );

  const url = await getSignedUrl(
    S3,
    new GetObjectCommand({
      Bucket: artefact.bucket,
      Key: artefact.key,
      ResponseContentDisposition: `attachment; filename="${filename}"`
    }),
    { expiresIn: expiresInSeconds }
  );

  return {
    url,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString()
  };
});

// --------------------
// Create Run + Job
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

  // 2) Create run + 3) create queued job (Run has `job` singular in your schema)
  const run = await prisma.run.create({
    data: {
      tenantId: tenant.id,
      status: "queued",
      triggeredBy: input.triggeredBy,
      modulesEnabled: input.modulesEnabled,
      job: { create: { status: "queued" } }
    },
    include: { job: true, tenant: true }
  });

  return reply.status(201).send({
    runId: run.id,
    jobId: run.job?.id,
    tenantId: tenant.id
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
    include: {
      tenant: true,
      job: true,
      _count: { select: { findings: true, artefacts: true } }
    }
  });

  return runs.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    triggeredBy: r.triggeredBy,
    modulesEnabled: r.modulesEnabled,
    tenant: {
      id: r.tenant.id,
      tenantGuid: r.tenant.tenantGuid,
      primaryDomain: r.tenant.primaryDomain,
      displayName: r.tenant.displayName
    },
    counts: {
      jobs: r.job ? 1 : 0,
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
    include: {
      tenant: true,
      job: true,
      _count: { select: { findings: true, artefacts: true } }
    }
  });

  if (!run) return reply.code(404).send({ error: "Run not found" });

  return {
    id: run.id,
    createdAt: run.createdAt,
    triggeredBy: run.triggeredBy,
    modulesEnabled: run.modulesEnabled,
    tenant: {
      id: run.tenant.id,
      tenantGuid: run.tenant.tenantGuid,
      primaryDomain: run.tenant.primaryDomain,
      displayName: run.tenant.displayName
    },
    counts: {
      jobs: run.job ? 1 : 0,
      findings: run._count.findings,
      artefacts: run._count.artefacts
    }
  };
});

// List jobs for a run (your schema is 1:1 run->job, but we can still return an array for UI convenience)
app.get("/runs/:runId/jobs", async (req, reply) => {
  const { runId } = req.params as { runId: string };

  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: { job: true }
  });

  if (!run) return reply.code(404).send({ error: "Run not found" });

  return run.job ? [run.job] : [];
});

// List findings for a run
app.get("/runs/:runId/findings", async (req, reply) => {
  const { runId } = req.params as { runId: string };

  const run = await prisma.run.findUnique({ where: { id: runId } });
  if (!run) return reply.code(404).send({ error: "Run not found" });

  const findings = await prisma.finding.findMany({
    where: { runId },
    orderBy: [{ severity: "asc" }, { createdAt: "asc" }]
  });

  return findings;
});

// List artefacts for a run (includes bucket/key)
app.get("/runs/:runId/artefacts", async (req, reply) => {
  const { runId } = req.params as { runId: string };

  const run = await prisma.run.findUnique({ where: { id: runId } });
  if (!run) return reply.code(404).send({ error: "Run not found" });

  const artefacts = await prisma.artefact.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" }
  });

  return artefacts;
});

const port = Number(process.env.PORT ?? 8080);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
