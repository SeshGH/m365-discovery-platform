import type { Collector } from "./types";
import ExcelJS from "exceljs";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { assertReportReadyOrThrow, deriveRunStatus } from "./reportUtils";
import { Readable } from "node:stream";

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

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[report.runSummary.xlsx] Missing env var: ${name}`);
  return v;
}

async function streamToBuffer(body: any): Promise<Buffer> {
  if (!body) return Buffer.from("");
  if (Buffer.isBuffer(body)) return body;

  // AWS SDK v3 in Node often returns a Readable stream
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  // Fallback: try common shapes
  if (typeof body.transformToByteArray === "function") {
    const arr = await body.transformToByteArray();
    return Buffer.from(arr);
  }

  throw new Error("[report.runSummary.xlsx] Unsupported S3 body type");
}

function createS3ClientOrThrow(): S3Client {
  const endpoint = requireEnv("S3_ENDPOINT");
  const accessKeyId = requireEnv("S3_ACCESS_KEY");
  const secretAccessKey = requireEnv("S3_SECRET_KEY");

  const region = process.env.S3_REGION ?? "us-east-1";
  const forcePathStyle =
    String(process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() === "true";

  return new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle
  });
}

async function downloadArtefactText(params: {
  s3: S3Client;
  bucket: string;
  key: string;
}): Promise<string> {
  const res = await params.s3.send(
    new GetObjectCommand({
      Bucket: params.bucket,
      Key: params.key
    })
  );

  const buf = await streamToBuffer(res.Body as any);
  return buf.toString("utf8");
}

function tryParseJson<T>(text: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

type UsersInventoryJson = {
  generatedAt?: string;
  tenant?: {
    tenantGuid?: string;
    primaryDomain?: string;
    displayName?: string | null;
  };
  summary?: {
    totalUsers?: number;
    enabledUsers?: number;
    disabledUsers?: number;
  };
  signInActivity?: {
    available?: boolean;
    inactiveDaysThreshold?: number;
    enabledUsersNoSuccessfulSignInSinceThreshold?: number | null;
    enabledUsersNoSuccessfulSignInSinceThresholdPct?: number | null;
  };
};

type EnterpriseAppPermissionsJson = {
  generatedAt?: string;
  tenant?: {
    tenantGuid?: string;
    primaryDomain?: string;
    displayName?: string | null;
  };
  summary?: {
    totalEnterpriseApps?: number;
    scannedApps?: number;
    riskyApps?: number;
    truncated?: boolean;
    maxApps?: number;
    concurrency?: number;
  };
  apps?: Array<{
    id: string;
    displayName?: string | null;
    appId?: string | null;
    accountEnabled?: boolean | null;
    applicationPermissions?: string[];
    delegatedPermissions?: string[];
    risky?: string[];
  }>;
};

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

    // -------------------------
    // Load specific JSON artefacts (if present)
    // -------------------------
    const s3 = createS3ClientOrThrow();

    const usersArtefact = artefacts.find((a) => a.key.endsWith("/users-inventory.json"));
    const eapArtefact = artefacts.find((a) =>
      a.key.endsWith("/enterprise-app-permissions.json")
    );

    let usersJson: UsersInventoryJson | null = null;
    let usersJsonError: string | null = null;

    if (usersArtefact) {
      const text = await downloadArtefactText({
        s3,
        bucket: usersArtefact.bucket,
        key: usersArtefact.key
      });
      const parsed = tryParseJson<UsersInventoryJson>(text);
      if (parsed.ok) usersJson = parsed.value;
      else usersJsonError = parsed.error;
    }

    let eapJson: EnterpriseAppPermissionsJson | null = null;
    let eapJsonError: string | null = null;

    if (eapArtefact) {
      const text = await downloadArtefactText({
        s3,
        bucket: eapArtefact.bucket,
        key: eapArtefact.key
      });
      const parsed = tryParseJson<EnterpriseAppPermissionsJson>(text);
      if (parsed.ok) eapJson = parsed.value;
      else eapJsonError = parsed.error;
    }

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
    // Sheet 2: Executive Summary (demo-friendly)
    // -------------------------
    {
      const ws = wb.addWorksheet("Executive Summary");

      ws.columns = [
        { header: "Metric", key: "metric", width: 40 },
        { header: "Value", key: "value", width: 30 },
        { header: "Notes", key: "notes", width: 80 }
      ];

      const totalUsers = usersJson?.summary?.totalUsers ?? "";
      const enabledUsers = usersJson?.summary?.enabledUsers ?? "";
      const disabledUsers = usersJson?.summary?.disabledUsers ?? "";

      const totalEnterpriseApps = eapJson?.summary?.totalEnterpriseApps ?? "";
      const scannedApps = eapJson?.summary?.scannedApps ?? "";
      const riskyApps = eapJson?.summary?.riskyApps ?? "";
      const truncated = eapJson?.summary?.truncated ?? "";

      const signInAvailable = usersJson?.signInActivity?.available;
      const signInNote =
        signInAvailable === true
          ? "Sign-in activity enrichment available."
          : signInAvailable === false
            ? "Sign-in activity enrichment not available (permission/endpoint may be missing)."
            : "No users artefact present.";

      ws.addRow({
        metric: "Run status",
        value: derivedStatus,
        notes: ""
      });
      ws.addRow({
        metric: "Findings (total)",
        value: findings.length,
        notes: `Critical=${sevCounts.critical}, High=${sevCounts.high}, Medium=${sevCounts.medium}, Low=${sevCounts.low}, Info=${sevCounts.info}`
      });

      ws.addRow({
        metric: "Users (total / enabled / disabled)",
        value:
          totalUsers === ""
            ? ""
            : `${totalUsers} / ${enabledUsers} / ${disabledUsers}`,
        notes: usersJsonError ? `Users artefact parse error: ${usersJsonError}` : signInNote
      });

      ws.addRow({
        metric: "Enterprise apps (total / scanned / risky)",
        value:
          totalEnterpriseApps === ""
            ? ""
            : `${totalEnterpriseApps} / ${scannedApps} / ${riskyApps}`,
        notes:
          eapJsonError
            ? `Enterprise apps artefact parse error: ${eapJsonError}`
            : truncated === true
              ? "Scan truncated (ENTAPP_MAX_APPS limit). Results may be incomplete."
              : ""
      });

      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      ws.autoFilter = "A1:C1";
    }

    // -------------------------
    // Sheet 3: Users (Summary)
    // -------------------------
    {
      const ws = wb.addWorksheet("Users (Summary)");

      ws.columns = [
        { header: "field", key: "field", width: 38 },
        { header: "value", key: "value", width: 28 },
        { header: "notes", key: "notes", width: 80 }
      ];

      if (!usersArtefact) {
        ws.addRow({
          field: "status",
          value: "not-available",
          notes: "users-inventory.json artefact was not present in this run."
        });
      } else if (usersJsonError) {
        ws.addRow({
          field: "status",
          value: "error",
          notes: `Failed to parse users-inventory.json: ${usersJsonError}`
        });
      } else {
        ws.addRow({ field: "generatedAt", value: usersJson?.generatedAt ?? "", notes: "" });
        ws.addRow({
          field: "totalUsers",
          value: usersJson?.summary?.totalUsers ?? "",
          notes: ""
        });
        ws.addRow({
          field: "enabledUsers",
          value: usersJson?.summary?.enabledUsers ?? "",
          notes: ""
        });
        ws.addRow({
          field: "disabledUsers",
          value: usersJson?.summary?.disabledUsers ?? "",
          notes: ""
        });

        const signIn = usersJson?.signInActivity;
        ws.addRow({
          field: "signInActivity.available",
          value: signIn?.available ?? "",
          notes:
            signIn?.available === false
              ? "Enrichment not available (optional permission/endpoint)."
              : ""
        });
        ws.addRow({
          field: "signInActivity.inactiveDaysThreshold",
          value: signIn?.inactiveDaysThreshold ?? "",
          notes: ""
        });
        ws.addRow({
          field: "enabledUsersNoSuccessfulSignInSinceThreshold",
          value: signIn?.enabledUsersNoSuccessfulSignInSinceThreshold ?? "",
          notes: ""
        });
        ws.addRow({
          field: "enabledUsersNoSuccessfulSignInSinceThresholdPct",
          value: signIn?.enabledUsersNoSuccessfulSignInSinceThresholdPct ?? "",
          notes: ""
        });
      }

      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      ws.autoFilter = "A1:C1";
    }

    // -------------------------
    // Sheet 4: Enterprise Apps (Permissions)
    // -------------------------
    {
      const ws = wb.addWorksheet(safeSheetName("Enterprise Apps (Permissions)"));

      ws.columns = [
        { header: "displayName", key: "displayName", width: 40 },
        { header: "appId", key: "appId", width: 38 },
        { header: "accountEnabled", key: "accountEnabled", width: 14 },
        { header: "applicationPermissions", key: "applicationPermissions", width: 55 },
        { header: "delegatedPermissions", key: "delegatedPermissions", width: 55 },
        { header: "riskyPermissions", key: "riskyPermissions", width: 40 },
        { header: "riskFlag", key: "riskFlag", width: 10 }
      ];

      if (!eapArtefact) {
        ws.addRow({
          displayName: "status",
          appId: "not-available",
          accountEnabled: "",
          applicationPermissions: "",
          delegatedPermissions: "",
          riskyPermissions: "",
          riskFlag: "n/a"
        });
      } else if (eapJsonError) {
        ws.addRow({
          displayName: "status",
          appId: "error",
          accountEnabled: "",
          applicationPermissions: "",
          delegatedPermissions: "",
          riskyPermissions: `Failed to parse enterprise-app-permissions.json: ${eapJsonError}`,
          riskFlag: "n/a"
        });
      } else {
        const apps = eapJson?.apps ?? [];
        for (const app of apps) {
          const appPerms = (app.applicationPermissions ?? []).join(", ");
          const delPerms = (app.delegatedPermissions ?? []).join(", ");
          const risky = (app.risky ?? []).join(", ");
          const riskFlag = (app.risky ?? []).length > 0 ? "YES" : "NO";

          ws.addRow({
            displayName: app.displayName ?? "",
            appId: app.appId ?? "",
            accountEnabled: app.accountEnabled ?? "",
            applicationPermissions: appPerms,
            delegatedPermissions: delPerms,
            riskyPermissions: risky,
            riskFlag
          });
        }

        // Add a small footer row if scan was truncated
        if (eapJson?.summary?.truncated === true) {
          ws.addRow({});
          ws.addRow({
            displayName: "NOTE",
            appId: "",
            accountEnabled: "",
            applicationPermissions: "",
            delegatedPermissions: "",
            riskyPermissions: "",
            riskFlag: ""
          });
          ws.addRow({
            displayName: "Scan truncated",
            appId: "",
            accountEnabled: "",
            applicationPermissions: "",
            delegatedPermissions: "",
            riskyPermissions: "",
            riskFlag: "ENTAPP_MAX_APPS limit"
          });
        }
      }

      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      ws.autoFilter = "A1:G1";
    }

    // -------------------------
    // Sheet 5: Findings
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
    // Sheet 6: Jobs
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
    // Sheet 7: Artefacts (index)
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
        artefacts: artefacts.length,
        parsed: {
          usersInventory: Boolean(usersArtefact && !usersJsonError),
          enterpriseAppPermissions: Boolean(eapArtefact && !eapJsonError)
        }
      },
      artefacts: [
        {
          type: "raw",
          filename: "run-summary.xlsx",
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          content: Buffer.from(buffer)
        }
      ]
    };
  }
};
