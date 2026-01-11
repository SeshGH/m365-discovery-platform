import type { Collector } from "./types";

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Escape if it contains comma, quote, or newline
  if (/[,"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsvLine(values: unknown[]): string {
  return values.map(csvEscape).join(",");
}

function isTerminalJobStatus(status: string): boolean {
  return status === "succeeded" || status === "failed";
}

function isReportCollectorId(collectorId: string): boolean {
  return collectorId.startsWith("report.");
}

function deriveRunStatus(
  jobs: { status: string }[]
): "queued" | "running" | "succeeded" | "failed" {
  if (jobs.some((j) => j.status === "failed")) return "failed";
  if (jobs.length > 0 && jobs.every((j) => j.status === "succeeded")) return "succeeded";
  if (jobs.some((j) => j.status === "running")) return "running";
  if (jobs.some((j) => j.status === "queued")) return "queued";
  return "running";
}

export const runSummaryCsvReportCollector: Collector = {
  id: "report.runSummary.csv",
  displayName: "Run Summary CSV",
  async run(ctx) {
    const run = await ctx.prisma.run.findUnique({
      where: { id: ctx.run.id },
      include: {
        tenant: true,
        jobs: true,
        findings: true,
        artefacts: true
      }
    });

    if (!run) {
      return {
        id: "report.runSummary.csv",
        status: "error",
        errors: ["Run not found while generating report"]
      };
    }

    const jobs = run.jobs ?? [];

    // Gate report generation until all NON-report jobs are terminal.
    // This prevents misleading "running" summaries if the report job is picked up early.
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

    const findings = run.findings ?? [];
    const artefacts = run.artefacts ?? [];

    const derivedStatus = deriveRunStatus(jobs);
    const generatedAt = new Date().toISOString();

    const sevCounts = {
      critical: findings.filter((f) => f.severity === "critical").length,
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
      info: findings.filter((f) => f.severity === "info").length,
      unknown: findings.filter((f) => f.severity === "unknown").length
    };

    const header = [
      "rowType",
      "generatedAt",
      "runId",
      "tenantGuid",
      "primaryDomain",
      "tenantDisplayName",
      "runStatus",
      "runCreatedAt",
      "runStartedAt",
      "runEndedAt",
      "jobsTotal",
      "findingsTotal",
      "artefactsTotal",
      "sevCritical",
      "sevHigh",
      "sevMedium",
      "sevLow",
      "sevInfo",
      "sevUnknown",
      "findingId",
      "checkId",
      "ruleId",
      "category",
      "severity",
      "confidence",
      "status",
      "score",
      "title",
      "jobId",
      "createdAt",
      "collectorId",
      "jobStatus",
      "attempts",
      "jobStartedAt",
      "jobEndedAt",
      "lastError"
    ];

    const lines: string[] = [];
    lines.push(toCsvLine(header));

    // RUN row
    lines.push(
      toCsvLine([
        "run",
        generatedAt,
        run.id,
        run.tenant.tenantGuid,
        run.tenant.primaryDomain,
        run.tenant.displayName ?? "",
        derivedStatus,
        run.createdAt?.toISOString?.() ?? String(run.createdAt),
        run.startedAt ? run.startedAt.toISOString() : "",
        run.endedAt ? run.endedAt.toISOString() : "",
        jobs.length,
        findings.length,
        artefacts.length,
        sevCounts.critical,
        sevCounts.high,
        sevCounts.medium,
        sevCounts.low,
        sevCounts.info,
        sevCounts.unknown,
        "", "", "", "", "", "", "", "", "", "", "", // finding cols
        "", "", "", "", "", "" // job cols
      ])
    );

    // FINDING rows
    for (const f of findings) {
      lines.push(
        toCsvLine([
          "finding",
          generatedAt,
          run.id,
          run.tenant.tenantGuid,
          run.tenant.primaryDomain,
          run.tenant.displayName ?? "",
          derivedStatus,
          run.createdAt?.toISOString?.() ?? String(run.createdAt),
          run.startedAt ? run.startedAt.toISOString() : "",
          run.endedAt ? run.endedAt.toISOString() : "",
          jobs.length,
          findings.length,
          artefacts.length,
          sevCounts.critical,
          sevCounts.high,
          sevCounts.medium,
          sevCounts.low,
          sevCounts.info,
          sevCounts.unknown,
          f.id,
          f.checkId,
          f.ruleId ?? "",
          (f as any).category ?? "",
          f.severity,
          (f as any).confidence ?? "",
          (f as any).status ?? "",
          (f as any).score ?? "",
          f.title,
          f.jobId ?? "",
          f.createdAt ? f.createdAt.toISOString() : "",
          "", "", "", "", "", "" // job cols
        ])
      );
    }

    // JOB rows
    for (const j of jobs) {
      lines.push(
        toCsvLine([
          "job",
          generatedAt,
          run.id,
          run.tenant.tenantGuid,
          run.tenant.primaryDomain,
          run.tenant.displayName ?? "",
          derivedStatus,
          run.createdAt?.toISOString?.() ?? String(run.createdAt),
          run.startedAt ? run.startedAt.toISOString() : "",
          run.endedAt ? run.endedAt.toISOString() : "",
          jobs.length,
          findings.length,
          artefacts.length,
          sevCounts.critical,
          sevCounts.high,
          sevCounts.medium,
          sevCounts.low,
          sevCounts.info,
          sevCounts.unknown,
          "", "", "", "", "", "", "", "", "", "", "", // finding cols
          j.collectorId,
          j.status,
          j.attempts,
          j.lockedAt ? j.lockedAt.toISOString() : "",
          (j.status === "succeeded" || j.status === "failed") && j.updatedAt
            ? j.updatedAt.toISOString()
            : "",
          j.lastError ?? ""
        ])
      );
    }

    const csv = lines.join("\n") + "\n";

    return {
      id: "report.runSummary.csv",
      status: "ok",
      summary: {
        rows: 1 + findings.length + jobs.length,
        findings: findings.length,
        jobs: jobs.length
      },
      artefacts: [
        {
          type: "csv",
          filename: "run-summary.csv",
          contentType: "text/csv",
          content: csv
        }
      ]
    };
  }
};
