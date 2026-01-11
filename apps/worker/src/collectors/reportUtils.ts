// apps/worker/src/collectors/reportUtils.ts
import type { PrismaClient } from "@acme/db";

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
  if (jobs.some((j) => j.status === "queued")) return "queued";
  return "running";
}

/**
 * Gate report generation until all NON-report jobs are terminal.
 * This prevents misleading "running" summaries if the report job is picked up early.
 */
export async function assertReportReadyOrThrow(params: {
  prisma: PrismaClient;
  runId: string;
}) {
  const jobs = await params.prisma.job.findMany({
    where: { runId: params.runId },
    select: { collectorId: true, status: true }
  });

  const nonReportJobs = jobs.filter((j) => !isReportCollectorId(j.collectorId));
  const pendingNonReportJobs = nonReportJobs.filter((j) => !isTerminalJobStatus(j.status));

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
