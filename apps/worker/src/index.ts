import "dotenv/config";

import { prisma } from "@acme/db";
import { entraUsersCollector } from "@acme/collectors";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import crypto from "node:crypto";

const WORKER_ID = `worker-${process.pid}`;
const POLL_MS = Number(process.env.POLL_MS ?? 2000);

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
    `[${WORKER_ID}] Missing S3 config env vars. Required: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY`
  );
}

const S3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT, // e.g. http://localhost:9000
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY
  },
  forcePathStyle: S3_FORCE_PATH_STYLE
});

async function uploadArtefactToMinio(params: {
  runId: string;
  jobId: string;
  filename: string;
  contentType: string;
  body: string | Buffer;
}) {
  const bytes = Buffer.isBuffer(params.body)
    ? params.body
    : Buffer.from(params.body, "utf8");

  const hash = crypto.createHash("sha256").update(bytes).digest("hex");

  // Keep it predictable + partitioned by run
  const key = `runs/${params.runId}/jobs/${params.jobId}/${params.filename}`;

  await S3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: params.contentType
    })
  );

  return {
    bucket: S3_BUCKET,
    key,
    // Keep uri as a convenience / debugging string (optional but nice)
    uri: `s3://${S3_BUCKET}/${key}`,
    hash,
    sizeBytes: bytes.length
  };
}

async function pollOnce() {
  // Find one queued job (include run + tenant so we can build collector ctx)
  const job = await prisma.job.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
    include: { run: { include: { tenant: true } } }
  });

  if (!job) {
    console.log(`[${WORKER_ID}] No queued jobs`);
    return;
  }

  // Attempt to "lock" it (simple approach for now)
  const locked = await prisma.job.updateMany({
    where: {
      id: job.id,
      status: "queued",
      lockedAt: null
    },
    data: {
      status: "running",
      lockedAt: new Date(),
      lockedBy: WORKER_ID,
      attempts: { increment: 1 }
    }
  });

  if (locked.count !== 1) {
    console.log(`[${WORKER_ID}] Job ${job.id} was taken by another worker`);
    return;
  }

  // Re-read the job from the DB after locking
  const currentJob = await prisma.job.findUnique({
    where: { id: job.id }
  });

  if (
    !currentJob ||
    currentJob.status !== "running" ||
    currentJob.lockedBy !== WORKER_ID
  ) {
    console.log(`[${WORKER_ID}] Job ${job.id} is no longer runnable`);
    return;
  }

  console.log(`[${WORKER_ID}] Picked up job ${job.id} (runId=${job.runId})`);

  try {
    // Build collector context from the joined job/run/tenant
    const ctx = {
      runId: job.runId,
      tenantId: job.run.tenantId,
      tenantGuid: job.run.tenant.tenantGuid,
      primaryDomain: job.run.tenant.primaryDomain,
      triggeredBy: job.run.triggeredBy,
      modulesEnabled: job.run.modulesEnabled as any
    };

    const result = await entraUsersCollector(ctx);
    console.log(`[${WORKER_ID}] Collector result: ${JSON.stringify(result)}`);

    // --- Upload artefacts (Option B) + persist metadata ---
    if (Array.isArray(result.artefacts)) {
      for (const artefact of result.artefacts) {
        if (!artefact.content) continue;

        const uploaded = await uploadArtefactToMinio({
          runId: job.runId,
          jobId: job.id,
          filename: artefact.filename,
          contentType: artefact.contentType,
          body: artefact.content
        });

        await prisma.artefact.create({
          data: {
            runId: job.runId,
            type: artefact.type,
            bucket: uploaded.bucket,
            key: uploaded.key,
            uri: uploaded.uri, // optional but handy
            hash: uploaded.hash,
            sizeBytes: uploaded.sizeBytes
          }
        });

        console.log(
          `[${WORKER_ID}] Uploaded artefact ${artefact.filename} -> s3://${uploaded.bucket}/${uploaded.key}`
        );
      }
    }

    // If this collector returned users, write them as Findings so the UI can show them nicely
    if (result.id === "entra.users" && result.status === "ok") {
      const users = (result.data as any)?.users ?? [];

      if (Array.isArray(users) && users.length > 0) {
        // Write one "info" finding per user (simple + UI-friendly)
        await prisma.finding.createMany({
          data: users.map((u: any) => ({
            runId: job.runId,
            checkId: "ENTRA_USERS_001",
            severity: "info",
            title: `User: ${
              u.displayName ?? u.userPrincipalName ?? u.id ?? "Unknown"
            }`,
            description: "User returned by Entra users collector.",
            recommendation: null,
            evidence: u,
            references: []
          }))
        });

        console.log(
          `[${WORKER_ID}] Wrote ${users.length} Findings for entra.users`
        );
      } else {
        console.log(`[${WORKER_ID}] entra.users returned no users`);
      }
    }

    // Mark job succeeded + persist the job result JSON
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: result.status === "error" ? "failed" : "succeeded",
        result: result as any,
        lastError:
          result.status === "error"
            ? Array.isArray((result as any).errors)
              ? (result as any).errors.join("\n")
              : "collector returned error"
            : null
      }
    });

    console.log(`[${WORKER_ID}] Job ${job.id} succeeded`);
  } catch (err: any) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "failed", lastError: String(err?.message ?? err) }
    });

    console.log(
      `[${WORKER_ID}] Job ${job.id} failed: ${String(err?.message ?? err)}`
    );
  }
}

async function main() {
  console.log(`[${WORKER_ID}] Worker started. Polling every ${POLL_MS}ms...`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await pollOnce();
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
