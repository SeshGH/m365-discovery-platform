import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Always load apps/worker/.env, regardless of where pnpm was run from
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import { getCollectorOrThrow } from "./collectors";
import { prisma } from "@acme/db";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import crypto from "node:crypto";
import type { CollectorContext, CollectorResult } from "./collectors/types";
import { normalizeCollectorResult } from "./collectors/types";

// Optional worker name for observability (no behavioural impact).
// If set, lockedBy/log prefix becomes: worker-<name>-<pid>
const WORKER_NAME_RAW = String(process.env.WORKER_NAME ?? "").trim();
const WORKER_NAME = WORKER_NAME_RAW.length > 0 ? WORKER_NAME_RAW : null;

const WORKER_ID = WORKER_NAME
  ? `worker-${WORKER_NAME}-${process.pid}`
  : `worker-${process.pid}`;

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

async function uploadArtefactToObjectStore(params: {
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

  // Predictable, partitioned object key
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
    uri: `s3://${S3_BUCKET}/${key}`,
    hash,
    sizeBytes: bytes.length
  };
}

async function pollOnce() {
  // Requeue stale running jobs (worker crashed / hung, etc.)
  const RUNNING_STALE_LOCK_MS = Number(
    process.env.RUNNING_STALE_LOCK_MS ?? 10 * 60 * 1000 // 10 mins default
  );

  const staleCutoff = new Date(Date.now() - RUNNING_STALE_LOCK_MS);

  const requeued = await prisma.job.updateMany({
    where: {
      status: "running",
      lockedAt: { lt: staleCutoff }
    },
    data: {
      status: "queued",
      lockedAt: null,
      lockedBy: null,
      lastError: "Requeued stale running job (lock timeout)"
    }
  });

  if (requeued.count > 0) {
    console.log(
      `[${WORKER_ID}] Requeued ${requeued.count} stale running job(s) (older than ${RUNNING_STALE_LOCK_MS}ms)`
    );
  }

  // Find one queued job that is not locked, and whose "ready time" (lockedAt) is due
  const job = await prisma.job.findFirst({
    where: {
      status: "queued",
      lockedBy: null,
      OR: [{ lockedAt: null }, { lockedAt: { lte: new Date() } }]
    },
    orderBy: { createdAt: "asc" },
    include: { run: { include: { tenant: true } } }
  });

  if (!job) {
    console.log(`[${WORKER_ID}] No queued jobs`);
    return;
  }

  // Attempt to lock it
  const locked = await prisma.job.updateMany({
    where: {
      id: job.id,
      status: "queued",
      lockedBy: null,
      OR: [{ lockedAt: null }, { lockedAt: { lte: new Date() } }]
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

  // NOW is the right moment to mark the run running + set startedAt once
  await prisma.run.updateMany({
    where: { id: job.runId, startedAt: null },
    data: { startedAt: new Date() }
  });

  // Ensure status is running even if startedAt already exists
  await prisma.run.updateMany({
    where: {
      id: job.runId,
      status: { in: ["queued", "running"] }
    },
    data: { status: "running" }
  });

  // Sanity re-read
  const currentJob = await prisma.job.findUnique({ where: { id: job.id } });
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
    const collector = getCollectorOrThrow(job.collectorId);

    const ctx: CollectorContext = {
      prisma,
      job,
      run: job.run,
      tenant: job.run.tenant
    };

    const rawResult: CollectorResult = await collector.run(ctx);
    const result = normalizeCollectorResult(collector.id, rawResult);

    console.log(
      `[${WORKER_ID}] Collector ${collector.id} completed with status=${result.status}`
    );

    if (Array.isArray(result.artefacts)) {
      for (const artefact of result.artefacts) {
        if (!artefact.content) continue;

        const uploaded = await uploadArtefactToObjectStore({
          runId: job.runId,
          jobId: job.id,
          filename: artefact.filename,
          contentType: artefact.contentType,
          body: artefact.content
        });

        await prisma.artefact.create({
          data: {
            runId: job.runId,
            jobId: job.id,
            type: artefact.type,
            bucket: uploaded.bucket,
            key: uploaded.key,
            uri: uploaded.uri,
            hash: uploaded.hash,
            sizeBytes: uploaded.sizeBytes
          }
        });

        console.log(
          `[${WORKER_ID}] Uploaded artefact ${artefact.filename} -> s3://${uploaded.bucket}/${uploaded.key}`
        );
      }
    }

    // Step 6: Inventory lives in artefacts; findings are reserved for signals.
    // We intentionally do NOT create per-object inventory findings here.

    // keep lockedAt as the "job started" timestamp; clear lockedBy only.
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: result.status === "error" ? "failed" : "succeeded",
        result: result as any,
        lastError:
          result.status === "error"
            ? (result.errors ?? ["Collector returned error"]).join("\n")
            : null,
        lockedBy: null
      }
    });

    // Recompute run status from all jobs (succeed only when all jobs finished successfully)
    const jobCounts = await prisma.job.groupBy({
      by: ["status"],
      where: { runId: job.runId },
      _count: { status: true }
    });

    const counts = Object.fromEntries(
      jobCounts.map((r) => [r.status, r._count.status])
    ) as Record<string, number>;

    const queued = counts["queued"] ?? 0;
    const running = counts["running"] ?? 0;
    const failed = counts["failed"] ?? 0;

    const anyPending = queued + running > 0;

    await prisma.run.update({
      where: { id: job.runId },
      data: {
        status: failed > 0 ? "failed" : anyPending ? "running" : "succeeded",
        endedAt: anyPending ? null : new Date()
      }
    });

    console.log(`[${WORKER_ID}] Job ${job.id} succeeded`);
  } catch (err: any) {
    const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? 3);
    const attemptsSoFar = job.attempts ?? 0;
    const shouldRetry = attemptsSoFar < MAX_ATTEMPTS;

    await prisma.job.update({
      where: { id: job.id },
      data: shouldRetry
        ? {
            status: "queued",
            lockedBy: null,
            lockedAt: new Date(
              Date.now() +
                Math.min(60_000, 2_000 * Math.pow(2, attemptsSoFar))
            ),
            lastError: String(err?.message ?? err)
          }
        : {
            status: "failed",
            lockedBy: null,
            lastError: String(err?.message ?? err)
          }
    });

    if (!shouldRetry) {
      await prisma.run.update({
        where: { id: job.runId },
        data: {
          status: "failed",
          endedAt: new Date()
        }
      });
    }

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
