// apps/worker/src/collectors/reportUtils.ts

export function isTerminalJobStatus(status: string): boolean {
  return status === "succeeded" || status === "failed";
}

export function isReportCollectorId(collectorId: string): boolean {
  return collectorId.startsWith("report.");
}

export function deriveRunStatus(
  jobs: { status: string }[]
): "queued" | "running" | "succeeded" | "failed" {
  if (jobs.some((j) => j.status === "failed")) return "failed";
  if (jobs.length > 0 && jobs.every((j) => j.status === "succeeded")) return "succeeded";
  if (jobs.some((j) => j.status === "running")) return "running";
  // queued or mixed queued/succeeded
  return "queued";
}

/**
 * Report collectors must not run until all *non-report* jobs are in a terminal state.
 * This avoids generating partial summaries when report jobs are picked up early in a concurrent worker model.
 *
 * Throws an Error if any non-report jobs are still pending (queued/running/etc).
 */
export async function assertReportReadyOrThrow(args: {
  prisma: any;
  runId: string;
}): Promise<void> {
  const { prisma, runId } = args;

  const jobs = await prisma.job.findMany({
    where: { runId },
    select: { status: true, collectorId: true }
  });

  const pendingNonReportJobs = jobs.filter(
    (j: { status: string; collectorId: string }) =>
      !isReportCollectorId(j.collectorId) && !isTerminalJobStatus(j.status)
  );

  if (pendingNonReportJobs.length > 0) {
    const counts = pendingNonReportJobs.reduce<Record<string, number>>((acc, j) => {
      acc[j.status] = (acc[j.status] ?? 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");

    throw new Error(
      `Report not ready: ${pendingNonReportJobs.length} non-report job(s) still pending (${summary}).`
    );
  }
}
