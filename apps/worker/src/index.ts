import { prisma } from "@acme/db";

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

  console.log(`[${WORKER_ID}] Picked up job ${job.id} (runId=${job.runId})`);

  try {
    // TODO: plug in real discovery here
    await new Promise((r) => setTimeout(r, 1000));

    await prisma.job.update({
      where: { id: job.id },
      data: { status: "succeeded" }
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
