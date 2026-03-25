// apps/worker/src/collectors/runSummaryCsvReportCollector.ts
import type { Collector } from "./types";
import { assertReportReadyOrThrow, deriveRunStatus } from "./reportUtils";

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

export const runSummaryCsvReportCollector: Collector = {
  id: "report.runSummary.csv",
  displayName: "Run Summary CSV",
  async run(ctx) {
    // Gate report generation until all NON-report jobs are terminal.
    // By the time this gate passes, deriveAndPersistFindingsForRun has already been
    // called by the core run pipeline (apps/worker/src/index.ts) — findings are ready.
    await assertReportReadyOrThrow({ prisma: ctx.prisma, runId: ctx.run.id });

    const run = await ctx.prisma.run.findUnique({
      where: { id: ctx.run.id },
      include: {
        tenant: true,
        jobs: true,
        findings: true,
        observedChecks: true,
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
    const observedChecks = run.observedChecks ?? [];
    const artefacts = run.artefacts ?? [];

    // Findings are derived by the core pipeline before report collectors run.
    // Read them directly from the database — no re-derivation needed here.
    const findings = (await ctx.prisma.finding.findMany({
      where: { runId: run.id }
    })) as any[];

    const derivedStatus = deriveRunStatus(jobs);
    const generatedAt = new Date().toISOString();
    const dataProfile = (run.dataProfile ?? "safe") as string;

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
      "dataProfile",
      "runStatus",
      "runCreatedAt",
      "runStartedAt",
      "runEndedAt",
      "jobsTotal",
      "findingsTotal",
      "observedChecksTotal",
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
        dataProfile,
        derivedStatus,
        run.createdAt?.toISOString?.() ?? String(run.createdAt),
        run.startedAt ? run.startedAt.toISOString() : "",
        run.endedAt ? run.endedAt.toISOString() : "",
        jobs.length,
        findings.length,
        observedChecks.length,
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
          dataProfile,
          derivedStatus,
          run.createdAt?.toISOString?.() ?? String(run.createdAt),
          run.startedAt ? run.startedAt.toISOString() : "",
          run.endedAt ? run.endedAt.toISOString() : "",
          jobs.length,
          findings.length,
          observedChecks.length,
          artefacts.length,
          sevCounts.critical,
          sevCounts.high,
          sevCounts.medium,
          sevCounts.low,
          sevCounts.info,
          sevCounts.unknown,
          f.id ?? "",
          f.checkId ?? "",
          f.ruleId ?? "",
          (f as any).category ?? "",
          f.severity ?? "",
          (f as any).confidence ?? "",
          (f as any).status ?? "",
          (f as any).score ?? "",
          f.title ?? "",
          f.jobId ?? "",
          f.createdAt ? new Date(f.createdAt).toISOString() : "",
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
          dataProfile,
          derivedStatus,
          run.createdAt?.toISOString?.() ?? String(run.createdAt),
          run.startedAt ? run.startedAt.toISOString() : "",
          run.endedAt ? run.endedAt.toISOString() : "",
          jobs.length,
          findings.length,
          observedChecks.length,
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
