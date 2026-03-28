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
import { deriveAndPersistFindingsForRun } from "./findings";
import { deriveSecondaryObservedChecksForRun } from "./derivedObservedChecks";

const WORKER_NAME = process.env.WORKER_NAME?.trim();
const WORKER_ID = WORKER_NAME ? `worker-${WORKER_NAME}-${process.pid}` : `worker-${process.pid}`;
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
  const bytes = Buffer.isBuffer(params.body) ? params.body : Buffer.from(params.body, "utf8");

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

function isReportNotReadyError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "");
  return msg.startsWith("Report not ready:");
}

function isReportCollectorId(collectorId: string): boolean {
  return collectorId.startsWith("report.");
}

function ms(n: number): string {
  if (!Number.isFinite(n)) return `${n}ms`;
  if (n < 1000) return `${n}ms`;
  return `${(n / 1000).toFixed(2)}s`;
}

function computeBackoffMs(attemptsSoFar: number): number {
  // IMPORTANT: keep this logic identical to existing behaviour
  return Math.min(60_000, 2_000 * Math.pow(2, Math.max(0, attemptsSoFar - 1)));
}

/**
 * Derive and persist findings for a run once all non-report collector jobs are terminal.
 * Called after each non-report job reaches a terminal state.
 * Safe to call multiple times — deriveAndPersistFindingsForRun is idempotent (delete-then-insert).
 * Non-fatal: a derivation failure must never fail or requeue the triggering collector job.
 */
async function maybeDeriveFindingsForRun(runId: string): Promise<void> {
  // Only proceed if every non-report job for this run is now terminal.
  const pendingCount = await prisma.job.count({
    where: {
      runId,
      collectorId: { not: { startsWith: "report." } },
      status: { notIn: ["succeeded", "failed"] }
    }
  });

  if (pendingCount > 0) return;

  try {
    // Stage 1: derive secondary observed checks from artefact content.
    // Must run BEFORE findings derivation so derived OBS are available.
    const secondaryResult = await deriveSecondaryObservedChecksForRun({
      prisma,
      runId,
      s3: S3,
      bucket: S3_BUCKET
    });
    if (secondaryResult.derived.length > 0) {
      console.log(
        `[${WORKER_ID}] Secondary OBS derived: run=${runId} checkIds=${secondaryResult.derived.join(",")}`
      );
    }
  } catch (err: any) {
    // Secondary OBS derivation must never fail or requeue a collector job.
    console.warn(
      `[${WORKER_ID}] Secondary OBS derivation failed (non-fatal): run=${runId} error=${String(err?.message ?? err)}`
    );
  }

  try {
    // Stage 2: derive findings from all observed checks (including derived OBS).
    const result = await deriveAndPersistFindingsForRun({ prisma, runId });
    console.log(
      `[${WORKER_ID}] Findings derived: run=${runId} deleted=${result.deletedOwned} inserted=${result.inserted}`
    );
  } catch (err: any) {
    // Findings derivation must never fail or requeue a collector job.
    console.warn(
      `[${WORKER_ID}] Findings derivation failed (non-fatal): run=${runId} error=${String(err?.message ?? err)}`
    );
  }
}

async function pollOnce() {
  const pollStartedAt = Date.now();

  // Requeue stale running jobs (worker crashed / hung, etc.)
  const RUNNING_STALE_LOCK_MS = Number(process.env.RUNNING_STALE_LOCK_MS ?? 10 * 60 * 1000); // 10 mins default
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
      `[${WORKER_ID}] Requeued ${requeued.count} stale running job(s) (cutoff=${staleCutoff.toISOString()}, window=${ms(
        RUNNING_STALE_LOCK_MS
      )})`
    );
  }

  // Find one queued NON-report job first (so reports don't run early)
  const baseWhere = {
    status: "queued" as const,
    lockedBy: null as any,
    OR: [{ lockedAt: null }, { lockedAt: { lte: new Date() } }]
  };

  let job =
    (await prisma.job.findFirst({
      where: {
        ...baseWhere,
        collectorId: { not: { startsWith: "report." } }
      },
      orderBy: { createdAt: "asc" },
      include: { run: { include: { tenant: true } } }
    })) ??
    (await prisma.job.findFirst({
      where: baseWhere,
      orderBy: { createdAt: "asc" },
      include: { run: { include: { tenant: true } } }
    }));

  if (!job) {
    console.log(`[${WORKER_ID}] No queued jobs (poll=${ms(Date.now() - pollStartedAt)})`);
    return;
  }

  const isReport = isReportCollectorId(job.collectorId);

  // Attempt to lock it (atomic)
  // IMPORTANT: report jobs should not increment attempts (so "not ready" never burns retries)
  const lockData: any = {
    status: "running",
    lockedAt: new Date(),
    lockedBy: WORKER_ID
  };

  if (!isReport) {
    lockData.attempts = { increment: 1 };
  }

  console.log(
    `[${WORKER_ID}] Lock attempt: job=${job.id} run=${job.runId} collector=${job.collectorId} report=${isReport}`
  );

  const locked = await prisma.job.updateMany({
    where: {
      id: job.id,
      status: "queued",
      lockedBy: null,
      OR: [{ lockedAt: null }, { lockedAt: { lte: new Date() } }]
    },
    data: lockData
  });

  if (locked.count !== 1) {
    console.log(
      `[${WORKER_ID}] Lock lost: job=${job.id} (another worker took it) (poll=${ms(Date.now() - pollStartedAt)})`
    );
    return;
  }

  // Re-read the job AFTER locking so retry logic is accurate
  const lockedJob = await prisma.job.findUnique({
    where: { id: job.id },
    include: { run: { include: { tenant: true } } }
  });

  if (!lockedJob) {
    console.log(`[${WORKER_ID}] Job ${job.id} disappeared after locking`);
    return;
  }

  // NOW is the right moment to mark the run running + set startedAt once
  await prisma.run.updateMany({
    where: { id: lockedJob.runId, startedAt: null },
    data: { startedAt: new Date() }
  });

  // Ensure status is running even if startedAt already exists
  await prisma.run.updateMany({
    where: {
      id: lockedJob.runId,
      status: { in: ["queued", "running"] }
    },
    data: { status: "running" }
  });

  // Sanity
  if (lockedJob.status !== "running" || lockedJob.lockedBy !== WORKER_ID) {
    console.log(
      `[${WORKER_ID}] Job not runnable after lock: job=${lockedJob.id} status=${lockedJob.status} lockedBy=${lockedJob.lockedBy}`
    );
    return;
  }

  const jobStartedAt = Date.now();
  const attemptsSoFar = Number(lockedJob.attempts ?? 0);

  console.log(
    `[${WORKER_ID}] Picked up: job=${lockedJob.id} run=${lockedJob.runId} collector=${lockedJob.collectorId} attempts=${attemptsSoFar} report=${isReport}`
  );

  try {
    const collector = getCollectorOrThrow(lockedJob.collectorId);

    const ctx: CollectorContext = {
      prisma,
      job: lockedJob as any,
      run: lockedJob.run as any,
      tenant: (lockedJob.run as any).tenant
    };

    const rawResult: CollectorResult = await collector.run(ctx);
    const result = normalizeCollectorResult(collector.id, rawResult);

    console.log(
      `[${WORKER_ID}] Collector complete: job=${lockedJob.id} collector=${collector.id} status=${result.status} duration=${ms(
        Date.now() - jobStartedAt
      )}`
    );

    if (Array.isArray(result.artefacts)) {
      for (const artefact of result.artefacts) {
        if (!artefact.content) continue;

        const uploaded = await uploadArtefactToObjectStore({
          runId: lockedJob.runId,
          jobId: lockedJob.id,
          filename: artefact.filename,
          contentType: artefact.contentType,
          body: artefact.content
        });

        await prisma.artefact.create({
          data: {
            runId: lockedJob.runId,
            jobId: lockedJob.id,
            type: artefact.type,
            bucket: uploaded.bucket,
            key: uploaded.key,
            uri: uploaded.uri,
            hash: uploaded.hash,
            sizeBytes: uploaded.sizeBytes
          }
        });

        console.log(
          `[${WORKER_ID}] Artefact uploaded: job=${lockedJob.id} file=${artefact.filename} bytes=${uploaded.sizeBytes} key=${uploaded.key}`
        );
      }
    }

    await prisma.job.update({
      where: { id: lockedJob.id },
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

    // Recompute run status from all jobs
    const jobCounts = await prisma.job.groupBy({
      by: ["status"],
      where: { runId: lockedJob.runId },
      _count: { status: true }
    });

    const counts = Object.fromEntries(jobCounts.map((r) => [r.status, r._count.status])) as Record<
      string,
      number
    >;

    const queued = counts["queued"] ?? 0;
    const running = counts["running"] ?? 0;
    const failed = counts["failed"] ?? 0;

    const anyPending = queued + running > 0;

    const nextRunStatus = failed > 0 ? "failed" : anyPending ? "running" : "succeeded";

    await prisma.run.update({
      where: { id: lockedJob.runId },
      data: {
        status: nextRunStatus,
        endedAt: anyPending ? null : new Date()
      }
    });

    console.log(
      `[${WORKER_ID}] Job finalised: job=${lockedJob.id} status=succeeded run=${lockedJob.runId} runStatus=${nextRunStatus} counts=${JSON.stringify(
        { queued, running, failed }
      )} totalDuration=${ms(Date.now() - jobStartedAt)}`
    );

    // Derive findings once all non-report collectors are terminal.
    // Non-fatal — must not affect the current job's outcome.
    if (!isReport) {
      await maybeDeriveFindingsForRun(lockedJob.runId);
    }
  } catch (err: any) {
    // IMPORTANT:
    // - "Report not ready" should never count as a real failure
    // - attempts should be read from the DB post-lock (lockedJob.attempts)
    const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? 3);

    const reportNotReady = isReportNotReadyError(err);
    const shouldRetry = reportNotReady ? true : attemptsSoFar < MAX_ATTEMPTS;

    const errMsg = String(err?.message ?? err);

    if (shouldRetry) {
      const delayMs = computeBackoffMs(attemptsSoFar);
      const readyAt = new Date(Date.now() + delayMs);

      await prisma.job.update({
        where: { id: lockedJob.id },
        data: {
          status: "queued",
          lockedBy: null,
          lockedAt: readyAt,
          lastError: errMsg
        }
      });

      console.log(
        `[${WORKER_ID}] Job requeued: job=${lockedJob.id} run=${lockedJob.runId} collector=${lockedJob.collectorId} reason=${
          reportNotReady ? "report-not-ready" : "retryable-error"
        } attempts=${attemptsSoFar}/${MAX_ATTEMPTS} backoff=${ms(delayMs)} readyAt=${readyAt.toISOString()} error=${errMsg}`
      );
    } else {
      await prisma.job.update({
        where: { id: lockedJob.id },
        data: {
          status: "failed",
          lockedBy: null,
          lastError: errMsg
        }
      });

      await prisma.run.update({
        where: { id: lockedJob.runId },
        data: {
          status: "failed",
          endedAt: new Date()
        }
      });

      console.log(
        `[${WORKER_ID}] Job failed terminal: job=${lockedJob.id} run=${lockedJob.runId} collector=${lockedJob.collectorId} attempts=${attemptsSoFar}/${MAX_ATTEMPTS} duration=${ms(
          Date.now() - jobStartedAt
        )} error=${errMsg}`
      );

      // Derive findings even when a job fails terminally — other collectors may have
      // produced valid observed checks and their signals should still be surfaced.
      // Non-fatal — must not affect the run's terminal state.
      if (!isReport) {
        await maybeDeriveFindingsForRun(lockedJob.runId);
      }
    }
  }
}

async function main() {
  console.log(
    `[${WORKER_ID}] Worker started. Polling every ${POLL_MS}ms... (bucket=${S3_BUCKET}, endpoint=${S3_ENDPOINT})`
  );

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
