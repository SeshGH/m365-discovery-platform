import { prisma } from "@acme/db";
import { runHelloCollector } from "@acme/collectors";

const WORKER_ID = `worker-${process.pid}`;
const POLL_MS = Number(process.env.POLL_MS ?? 2000);

async function pollOnce() {
  // Find one queued job
  const job = await prisma.job.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" }
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

  if (!currentJob || currentJob.status !== "running" || currentJob.lockedBy !== WORKER_ID) {
    console.log(`[${WORKER_ID}] Job ${job.id} is no longer runnable`);
    return;
  }

  console.log(`[${WORKER_ID}] Picked up job ${job.id} (runId=${job.runId})`);

  try {
    // Run a stub collector (we'll replace this with Cloud Geezer later)
    const result = await runHelloCollector();
    console.log(`[${WORKER_ID}] Collector result: ${JSON.stringify(result)}`);

    // Create a stub "Finding" to prove the findings pipeline end-to-end
    await prisma.finding.create({
      data: {
        runId: job.runId,
        checkId: "HELLO_001",
        severity: "info",
        title: "Hello collector ran",
        description: "Stub finding created by worker to prove findings pipeline.",
        recommendation: "Replace this stub with real checks (Graph / Entra config).",
        evidence: result as any,
        references: [{ name: "Internal stub", url: "https://example.com" }] as any
      }
    });

    // Mark job succeeded + persist the job result JSON
    await prisma.job.update({
  where: { id: job.id },
  data: {
    status: result.status === "error" ? "failed" : "succeeded",
    result: result as any,
    lastError: result.status === "error"
      ? (Array.isArray((result as any).errors) ? (result as any).errors.join("\n") : "collector returned error")
      : null
  }
});

    console.log(`[${WORKER_ID}] Job ${job.id} succeeded`);
  } catch (err: any) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "failed", lastError: String(err?.message ?? err) }
    });

    console.log(`[${WORKER_ID}] Job ${job.id} failed: ${String(err?.message ?? err)}`);
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
