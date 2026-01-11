import type { Collector } from "./types";
import ExcelJS from "exceljs";
import { assertReportReadyOrThrow, deriveRunStatus } from "./reportUtils";

function safeSheetName(name: string): string {
  // Excel sheet name constraints: max 31 chars; cannot contain: : \ / ? * [ ]
  const cleaned = name.replace(/[:\\\/\?\*\[\]]/g, " ").trim();
  return (cleaned.length > 0 ? cleaned : "Sheet").slice(0, 31);
}

function iso(v: unknown): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export const runSummaryExcelReportCollector: Collector = {
  id: "report.runSummary.xlsx",
  displayName: "Run Summary Excel (XLSX)",
  async run(ctx) {
    // Gate report generation until all NON-report jobs are terminal.
    await assertReportReadyOrThrow({ prisma: ctx.prisma, runId: ctx.run.id });

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
        id: "report.runSummary.xlsx",
        status: "error",
        errors: ["Run not found while generating XLSX report"]
      };
    }

    const jobs = run.jobs ?? [];
    const derivedStatus = deriveRunStatus(jobs);

    const findings = run.findings ?? [];
    const artefacts = run.artefacts ?? [];

    const sevCounts = {
      critical: findings.filter((f) => f.severity === "critical").length,
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
      info: findings.filter((f) => f.severity === "info").length,
      unknown: findings.filter((f) => f.severity === "unknown").length
    };

    const wb = new ExcelJS.Workbook();
    wb.creator = "m365-discovery-platform";
    wb.created = new Date();
    wb.modified = new Date();

    // -------------------------
    // Sheet 1: Run Summary
    // -------------------------
    {
      const ws = wb.addWorksheet("Run Summary");

      ws.columns = [
        { header: "Field", key: "field", width: 28 },
        { header: "Value", key: "value", width: 80 }
      ];

      const rows: Array<[string, string | number]> = [
        ["generatedAt", new Date().toISOString()],
        ["runId", run.id],
        ["runStatus", derivedStatus],
        ["runCreatedAt", iso(run.createdAt)],
        ["runStartedAt", iso(run.startedAt)],
        ["runEndedAt", iso(run.endedAt)],
        ["tenantGuid", run.tenant.tenantGuid],
        ["primaryDomain", run.tenant.primaryDomain],
        ["tenantDisplayName", run.tenant.displayName ?? ""],
        ["jobsTotal", jobs.length],
        ["findingsTotal", findings.length],
        ["artefactsTotal", artefacts.length],
        ["sevCritical", sevCounts.critical],
        ["sevHigh", sevCounts.high],
        ["sevMedium", sevCounts.medium],
        ["sevLow", sevCounts.low],
        ["sevInfo", sevCounts.info],
        ["sevUnknown", sevCounts.unknown]
      ];

      for (const [field, value] of rows) {
        ws.addRow({ field, value });
      }

      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
    }

    // -------------------------
    // Sheet 2: Findings
    // -------------------------
    {
      const ws = wb.addWorksheet("Findings");

      ws.columns = [
        { header: "checkId", key: "checkId", width: 18 },
        { header: "severity", key: "severity", width: 10 },
        { header: "category", key: "category", width: 22 },
        { header: "title", key: "title", width: 80 },
        { header: "jobId", key: "jobId", width: 26 },
        { header: "createdAt", key: "createdAt", width: 24 }
      ];

      for (const f of findings) {
        ws.addRow({
          checkId: f.checkId,
          severity: f.severity,
          category: (f as any).category ?? "",
          title: f.title,
          jobId: f.jobId ?? "",
          createdAt: f.createdAt ? f.createdAt.toISOString() : ""
        });
      }

      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      ws.autoFilter = "A1:F1";
    }

    // -------------------------
    // Sheet 3: Jobs
    // -------------------------
    {
      const ws = wb.addWorksheet("Jobs");

      ws.columns = [
        { header: "collectorId", key: "collectorId", width: 30 },
        { header: "status", key: "status", width: 12 },
        { header: "attempts", key: "attempts", width: 10 },
        { header: "startedAt", key: "startedAt", width: 24 },
        { header: "endedAt", key: "endedAt", width: 24 },
        { header: "lastError", key: "lastError", width: 80 }
      ];

      for (const j of jobs) {
        ws.addRow({
          collectorId: j.collectorId,
          status: j.status,
          attempts: j.attempts,
          startedAt: j.lockedAt ? j.lockedAt.toISOString() : "",
          endedAt:
            (j.status === "succeeded" || j.status === "failed") && j.updatedAt
              ? j.updatedAt.toISOString()
              : "",
          lastError: j.lastError ?? ""
        });
      }

      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      ws.autoFilter = "A1:F1";
    }

    // -------------------------
    // Sheet 4+: Artefacts (index)
    // -------------------------
    {
      const ws = wb.addWorksheet("Artefacts");

      ws.columns = [
        { header: "type", key: "type", width: 10 },
        { header: "key", key: "key", width: 90 },
        { header: "sizeBytes", key: "sizeBytes", width: 12 },
        { header: "hash", key: "hash", width: 70 },
        { header: "createdAt", key: "createdAt", width: 24 }
      ];

      for (const a of artefacts) {
        ws.addRow({
          type: a.type,
          key: a.key,
          sizeBytes: a.sizeBytes ?? "",
          hash: a.hash ?? "",
          createdAt: a.createdAt ? a.createdAt.toISOString() : ""
        });
      }

      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      ws.autoFilter = "A1:E1";
    }

    // Optional: Add a “Per Collector” artefact listing sheet (nice for demo)
    {
      const ws = wb.addWorksheet("Artefacts by Job");
      ws.columns = [
        { header: "jobId", key: "jobId", width: 28 },
        { header: "type", key: "type", width: 10 },
        { header: "key", key: "key", width: 90 }
      ];

      for (const a of artefacts) {
        ws.addRow({
          jobId: a.jobId ?? "",
          type: a.type,
          key: a.key
        });
      }

      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      ws.autoFilter = "A1:C1";
    }

    // Build workbook bytes
    const buffer = await wb.xlsx.writeBuffer();

    return {
      id: "report.runSummary.xlsx",
      status: "ok",
      summary: {
        sheets: wb.worksheets.length,
        findings: findings.length,
        jobs: jobs.length,
        artefacts: artefacts.length
      },
      artefacts: [
        {
          type: "raw",
          filename: "run-summary.xlsx",
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          content: Buffer.from(buffer)
        }
      ]
    };
  }
};
