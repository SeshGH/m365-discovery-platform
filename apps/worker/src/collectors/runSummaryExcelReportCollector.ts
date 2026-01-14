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
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function createS3ClientOrThrow(): S3Client {
  const endpoint = requireEnv("S3_ENDPOINT");
  const region = process.env.S3_REGION ?? "us-east-1";
  const accessKeyId = requireEnv("S3_ACCESS_KEY");
  const secretAccessKey = requireEnv("S3_SECRET_KEY");

  return new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey }
  });
}

async function readStreamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function getObjectBytes(args: {
  s3: S3Client;
  bucket: string;
  key: string;
}): Promise<Buffer> {
  const { s3, bucket, key } = args;
  const resp = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key
    })
  );

  const body: any = resp.Body;
  if (!body) return Buffer.from("");

  if (Buffer.isBuffer(body)) return body;

  if (body instanceof Readable) {
    return await readStreamToBuffer(body);
  }

  if (typeof body.transformToByteArray === "function") {
    const arr = await body.transformToByteArray();
    return Buffer.from(arr);
  }

  throw new Error("Unsupported S3 Body type");
}

async function downloadArtefactText(args: {
  s3: S3Client;
  bucket: string;
  key: string;
}): Promise<string> {
  const buf = await getObjectBytes(args);
  return buf.toString("utf-8");
}

function tryParseJson<T>(
  text: string
): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (e: any) {
    return { ok: false, error: e?.message ? String(e.message) : String(e) };
  }
}

type UsersInventoryJson = {
  generatedAt?: string;
  profile?: "safe" | "full";
  tenant?: {
    tenantGuid?: string;
    primaryDomain?: string;
    displayName?: string;
  };
  summary?: {
    totalUsers?: number;
    enabledUsers?: number;
    disabledUsers?: number;
    memberUsers?: number;
    guestUsers?: number;
  };
  users?: Array<{
    id?: string;
    userPrincipalName?: string;
    displayName?: string;
    mail?: string;
    accountEnabled?: boolean;
    userType?: string;
    createdDateTime?: string;
  }>;
};

type EnterpriseAppPermissionsJson = {
  generatedAt?: string;
  profile?: "safe" | "full";
  tenant?: {
    tenantGuid?: string;
    primaryDomain?: string;
    displayName?: string;
  };
  summary?: {
    totalEnterpriseApps?: number;
    scannedEnterpriseApps?: number;
    truncated?: boolean;
    maxApps?: number;
  };
  apps?: Array<{
    appId?: string;
    displayName?: string;
    servicePrincipalId?: string;
    // Note: this matches the existing report collector’s expected shape
    applicationPermissions?: string[];
    delegatedPermissions?: string[];
    risky?: string[];
    accountEnabled?: boolean;
  }>;
};

export const runSummaryExcelReportCollector: Collector = {
  id: "report.runSummary.xlsx",
  async run(ctx) {
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

    if (!run) throw new Error(`Run not found: ${ctx.run.id}`);

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

    const pickArtefactByFilename = (filenames: string[]) => {
      for (const fn of filenames) {
        const a = artefacts.find((x) => x.key.endsWith("/" + fn));
        if (a) return { artefact: a, filename: fn };
      }
      return { artefact: null as any, filename: filenames[0] ?? "" };
    };

    // Profile-aware artefact selection:
    // - safe runs typically produce legacy filenames (no suffix)
    // - full runs may produce profile-suffixed variants; prefer .full where applicable
    const usersCandidates =
      run.dataProfile === "full"
        ? ["users-inventory.full.json", "users-inventory.safe.json", "users-inventory.json"]
        : ["users-inventory.json", "users-inventory.safe.json"];

    const eapCandidates =
      run.dataProfile === "full"
        ? [
            "enterprise-app-permissions.full.json",
            "enterprise-app-permissions.safe.json",
            "enterprise-app-permissions.json"
          ]
        : ["enterprise-app-permissions.json", "enterprise-app-permissions.safe.json"];

    const { artefact: usersArtefact, filename: usersArtefactName } =
      pickArtefactByFilename(usersCandidates);
    const { artefact: eapArtefact, filename: eapArtefactName } =
      pickArtefactByFilename(eapCandidates);

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
      const ws = wb.addWorksheet(safeSheetName("Run Summary"));

      ws.columns = [
        { header: "field", key: "field", width: 38 },
        { header: "value", key: "value", width: 80 }
      ];

      ws.addRow({ field: "runId", value: run.id });
      ws.addRow({ field: "tenantGuid", value: run.tenant.tenantGuid });
      ws.addRow({ field: "primaryDomain", value: run.tenant.primaryDomain });
      ws.addRow({ field: "tenantDisplayName", value: run.tenant.displayName ?? "" });
      ws.addRow({ field: "dataProfile", value: run.dataProfile ?? "safe" });
      ws.addRow({ field: "derivedStatus", value: derivedStatus });
      ws.addRow({ field: "createdAt", value: iso(run.createdAt) });
      ws.addRow({ field: "startedAt", value: iso(run.startedAt) });
      ws.addRow({ field: "endedAt", value: iso(run.endedAt) });

      ws.addRow({ field: "jobs", value: jobs.length });
      ws.addRow({ field: "findings", value: findings.length });
      ws.addRow({ field: "artefacts", value: artefacts.length });

      ws.addRow({ field: "findings.critical", value: sevCounts.critical });
      ws.addRow({ field: "findings.high", value: sevCounts.high });
      ws.addRow({ field: "findings.medium", value: sevCounts.medium });
      ws.addRow({ field: "findings.low", value: sevCounts.low });
      ws.addRow({ field: "findings.info", value: sevCounts.info });
      ws.addRow({ field: "findings.unknown", value: sevCounts.unknown });
    }

    // -------------------------
    // Sheet 2: Jobs
    // -------------------------
    {
      const ws = wb.addWorksheet(safeSheetName("Jobs"));

      ws.columns = [
        { header: "collectorId", key: "collectorId", width: 34 },
        { header: "status", key: "status", width: 12 },
        { header: "attempts", key: "attempts", width: 10 },
        { header: "startedAt", key: "startedAt", width: 26 },
        { header: "endedAt", key: "endedAt", width: 26 },
        { header: "lockedBy", key: "lockedBy", width: 22 },
        { header: "lockedAt", key: "lockedAt", width: 26 },
        { header: "lastError", key: "lastError", width: 80 }
      ];

      for (const j of jobs) {
        ws.addRow({
          collectorId: j.collectorId,
          status: j.status,
          attempts: j.attempts,
          startedAt: iso(j.startedAt),
          endedAt: iso(j.endedAt),
          lockedBy: j.lockedBy ?? "",
          lockedAt: iso(j.lockedAt),
          lastError: j.lastError ?? ""
        });
      }
    }

    // -------------------------
    // Sheet 3: Findings
    // -------------------------
    {
      const ws = wb.addWorksheet(safeSheetName("Findings"));

      ws.columns = [
        { header: "checkId", key: "checkId", width: 22 },
        { header: "severity", key: "severity", width: 12 },
        { header: "title", key: "title", width: 44 },
        { header: "description", key: "description", width: 90 },
        { header: "resource", key: "resource", width: 60 },
        { header: "details", key: "details", width: 90 }
      ];

      for (const f of findings) {
        ws.addRow({
          checkId: f.checkId,
          severity: f.severity,
          title: f.title,
          description: f.description,
          resource: f.resource,
          details: f.details
        });
      }
    }

    // -------------------------
    // Sheet 4: Artefacts
    // -------------------------
    {
      const ws = wb.addWorksheet(safeSheetName("Artefacts"));

      ws.columns = [
        { header: "type", key: "type", width: 12 },
        { header: "bucket", key: "bucket", width: 12 },
        { header: "key", key: "key", width: 90 },
        { header: "sizeBytes", key: "sizeBytes", width: 12 },
        { header: "hash", key: "hash", width: 70 },
        { header: "createdAt", key: "createdAt", width: 26 }
      ];

      for (const a of artefacts) {
        ws.addRow({
          type: a.type,
          bucket: a.bucket,
          key: a.key,
          sizeBytes: a.sizeBytes,
          hash: a.hash,
          createdAt: iso(a.createdAt)
        });
      }
    }

    // -------------------------
    // Sheet 5: Users (Summary)
    // -------------------------
    {
      const ws = wb.addWorksheet(safeSheetName("Users (Summary)"));

      ws.columns = [
        { header: "field", key: "field", width: 38 },
        { header: "value", key: "value", width: 28 },
        { header: "notes", key: "notes", width: 80 }
      ];

      if (!usersArtefact) {
        ws.addRow({
          field: "status",
          value: "not-available",
          notes: `${usersArtefactName} artefact was not present in this run.`
        });
      } else if (usersJsonError) {
        ws.addRow({
          field: "status",
          value: "error",
          notes: `Failed to parse ${usersArtefactName}: ${usersJsonError}`
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
        ws.addRow({
          field: "memberUsers",
          value: usersJson?.summary?.memberUsers ?? "",
          notes: ""
        });
        ws.addRow({
          field: "guestUsers",
          value: usersJson?.summary?.guestUsers ?? "",
          notes: ""
        });
      }
    }

    // -------------------------
    // Sheet 6: Enterprise Apps (Permissions)
    // -------------------------
    {
      const ws = wb.addWorksheet(safeSheetName("Enterprise Apps (Perms)"));

      ws.columns = [
        { header: "displayName", key: "displayName", width: 44 },
        { header: "appId", key: "appId", width: 36 },
        { header: "accountEnabled", key: "accountEnabled", width: 14 },
        { header: "applicationPermissions", key: "applicationPermissions", width: 60 },
        { header: "delegatedPermissions", key: "delegatedPermissions", width: 60 },
        { header: "riskyPermissions", key: "riskyPermissions", width: 80 },
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
          riskyPermissions: `Failed to parse ${eapArtefactName}: ${eapJsonError}`,
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
      }
    }

    const buf = await wb.xlsx.writeBuffer();

    return {
      summary: {
        generatedAt: new Date().toISOString(),
        runId: run.id,
        derivedStatus,
        rows: {
          jobs: jobs.length,
          findings: findings.length,
          artefacts: artefacts.length
        }
      },
      artefacts: [
        {
          type: "raw",
          filename: "run-summary.xlsx",
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          content: Buffer.from(buf)
        }
      ]
    };
  }
};
