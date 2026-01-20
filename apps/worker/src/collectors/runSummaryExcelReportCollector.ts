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

async function getObjectBytes(args: { s3: S3Client; bucket: string; key: string }): Promise<Buffer> {
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

async function downloadArtefactText(args: { s3: S3Client; bucket: string; key: string }): Promise<string> {
  const buf = await getObjectBytes(args);
  return buf.toString("utf-8");
}

function tryParseJson<T>(text: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (e: any) {
    return { ok: false, error: e?.message ? String(e.message) : String(e) };
  }
}

// Keep JSON cells readable and bounded
function safeJsonCell(v: unknown, maxLen = 1200): string {
  try {
    const s = JSON.stringify(v ?? null);
    if (s.length > maxLen) return s.slice(0, maxLen) + "...";
    return s;
  } catch {
    return "";
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
    // Note: this matches the existing report collector's expected shape
    applicationPermissions?: string[];
    delegatedPermissions?: string[];
    risky?: string[];
    accountEnabled?: boolean;
  }>;
};

type ConditionalAccessPoliciesSafeJson = {
  generatedAt?: string;
  profile?: "safe" | "full";
  tenant?: {
    tenantGuid?: string;
    primaryDomain?: string;
    displayName?: string;
  };
  summary?: {
    totalPolicies?: number;
    enabledPolicies?: number;
    reportOnlyPolicies?: number;
    disabledPolicies?: number;
    policiesTargetingAllUsers?: number;
    policiesWithMfaGrantControl?: number;
    policiesExcludingUsersCount?: number;
    hasLegacyAuthPolicyDetected?: boolean;
    namedLocationsCount?: number;
    truncated?: boolean;
    permissionDenied?: boolean;
    maxPolicies?: number | null;
  };
  error?: unknown;

  // Safe artefact may optionally include a policy list (without membership identifiers).
  policies?: Array<{
    id?: string;
    displayName?: string;
    state?: string;

    // The safe collector may include derived booleans. If absent, we attempt light inference.
    targetsAllUsers?: boolean;
    excludesUsers?: boolean;
    hasMfaGrantControl?: boolean;

    // We keep these as unknown and only derive safe fields for the report.
    conditions?: unknown;
    grantControls?: unknown;
    sessionControls?: unknown;

    hasSessionControls?: boolean;
  }>;
};

type NormalizedUsersSummary = {
  totalUsers: number;
  enabledUsers: number | null;
  disabledUsers: number | null;
  memberUsers: number | null;
  guestUsers: number | null;
};

function normalizeUsersSummary(usersJson: any): NormalizedUsersSummary {
  const summary = usersJson?.summary ?? {};
  const users: any[] = Array.isArray(usersJson?.users) ? usersJson.users : [];

  const totalUsers = typeof summary.totalUsers === "number" ? summary.totalUsers : users.length;

  const guestUsers =
    typeof summary.guestUsers === "number"
      ? summary.guestUsers
      : users.filter((u) => String(u?.userType).toLowerCase() === "guest").length;

  const memberUsers =
    typeof summary.memberUsers === "number"
      ? summary.memberUsers
      : users.length
        ? users.filter((u) => String(u?.userType).toLowerCase() !== "guest").length
        : null;

  const enabledUsers =
    typeof summary.enabledUsers === "number"
      ? summary.enabledUsers
      : users.length
        ? users.filter((u) => u?.accountEnabled === true).length
        : null;

  const disabledUsers =
    typeof summary.disabledUsers === "number"
      ? summary.disabledUsers
      : users.length
        ? users.filter((u) => u?.accountEnabled === false).length
        : null;

  return { totalUsers, enabledUsers, disabledUsers, memberUsers, guestUsers };
}

type NormalizedEapSummary = {
  totalEnterpriseApps: number;
  scannedApps: number | null;
  riskyApps: number | null;
  truncated: boolean | null;
  maxApps: number | null;
};

function normalizeEapSummary(eapJson: any): NormalizedEapSummary {
  const summary = eapJson?.summary ?? {};
  const apps: any[] = Array.isArray(eapJson?.apps) ? eapJson.apps : [];

  const totalEnterpriseApps =
    typeof summary.totalEnterpriseApps === "number" ? summary.totalEnterpriseApps : apps.length;

  const scannedApps =
    typeof summary.scannedApps === "number" ? summary.scannedApps : apps.length ? apps.length : null;

  const riskyApps =
    typeof summary.riskyApps === "number"
      ? summary.riskyApps
      : apps.length
        ? apps.filter((a) => Array.isArray(a?.risky) && a.risky.length > 0).length
        : null;

  const truncated = typeof summary.truncated === "boolean" ? summary.truncated : null;
  const maxApps = typeof summary.maxApps === "number" ? summary.maxApps : null;

  return { totalEnterpriseApps, scannedApps, riskyApps, truncated, maxApps };
}

type NormalizedCaSummary = {
  totalPolicies: number | null;
  enabledPolicies: number | null;
  reportOnlyPolicies: number | null;
  disabledPolicies: number | null;
  policiesTargetingAllUsers: number | null;
  policiesWithMfaGrantControl: number | null;
  policiesExcludingUsersCount: number | null;
  hasLegacyAuthPolicyDetected: boolean | null;
  namedLocationsCount: number | null;
  truncated: boolean | null;
  permissionDenied: boolean | null;
  maxPolicies: number | null;
};

function normalizeCaSummary(caJson: any): NormalizedCaSummary {
  const s = caJson?.summary ?? {};
  const policies: any[] = Array.isArray(caJson?.policies) ? caJson.policies : [];

  const totalPolicies =
    typeof s.totalPolicies === "number" ? s.totalPolicies : policies.length ? policies.length : null;

  const enabledPolicies = typeof s.enabledPolicies === "number" ? s.enabledPolicies : null;
  const reportOnlyPolicies = typeof s.reportOnlyPolicies === "number" ? s.reportOnlyPolicies : null;
  const disabledPolicies = typeof s.disabledPolicies === "number" ? s.disabledPolicies : null;

  const policiesTargetingAllUsers =
    typeof s.policiesTargetingAllUsers === "number" ? s.policiesTargetingAllUsers : null;

  const policiesWithMfaGrantControl =
    typeof s.policiesWithMfaGrantControl === "number" ? s.policiesWithMfaGrantControl : null;

  const policiesExcludingUsersCount =
    typeof s.policiesExcludingUsersCount === "number" ? s.policiesExcludingUsersCount : null;

  const hasLegacyAuthPolicyDetected =
    typeof s.hasLegacyAuthPolicyDetected === "boolean" ? s.hasLegacyAuthPolicyDetected : null;

  const namedLocationsCount = typeof s.namedLocationsCount === "number" ? s.namedLocationsCount : null;

  const truncated = typeof s.truncated === "boolean" ? s.truncated : null;
  const permissionDenied = typeof s.permissionDenied === "boolean" ? s.permissionDenied : null;

  const maxPolicies = typeof s.maxPolicies === "number" ? s.maxPolicies : null;

  return {
    totalPolicies,
    enabledPolicies,
    reportOnlyPolicies,
    disabledPolicies,
    policiesTargetingAllUsers,
    policiesWithMfaGrantControl,
    policiesExcludingUsersCount,
    hasLegacyAuthPolicyDetected,
    namedLocationsCount,
    truncated,
    permissionDenied,
    maxPolicies
  };
}

function deriveCaTargetsAllUsers(policy: any): boolean | null {
  if (!policy || typeof policy !== "object") return null;

  if (typeof policy.targetsAllUsers === "boolean") return policy.targetsAllUsers;

  const includeUsers = (policy?.conditions as any)?.users?.includeUsers;
  if (Array.isArray(includeUsers)) {
    const asStrings = includeUsers.map((x) => String(x).toLowerCase());
    if (asStrings.includes("all")) return true;
  }

  // Not enough info in safe artefact to infer reliably
  return null;
}

function deriveCaHasMfaGrantControl(policy: any): boolean | null {
  if (!policy || typeof policy !== "object") return null;

  if (typeof policy.hasMfaGrantControl === "boolean") return policy.hasMfaGrantControl;

  const builtInControls = (policy?.grantControls as any)?.builtInControls;
  if (Array.isArray(builtInControls)) {
    const lower = builtInControls.map((x) => String(x).toLowerCase());
    if (lower.includes("mfa")) return true;
  }

  return null;
}

function deriveCaGrantControlTypes(policy: any): string {
  const builtInControls = (policy?.grantControls as any)?.builtInControls;
  if (Array.isArray(builtInControls)) {
    const cleaned = builtInControls.map((x) => String(x)).filter(Boolean);
    return cleaned.join(", ");
  }
  return "";
}

function deriveCaSessionControlsPresent(policy: any): boolean | null {
  if (!policy || typeof policy !== "object") return null;

  if (typeof policy.hasSessionControls === "boolean") return policy.hasSessionControls;

  const sc = policy?.sessionControls;
  if (sc && typeof sc === "object") {
    // Avoid dumping details; just indicate presence of any keys
    return Object.keys(sc as any).length > 0;
  }
  return null;
}

// -------------------------
// Directory Roles Observed Checks helpers
// -------------------------
const DIRROLES_CHECK_IDS = [
  "ENTRA_DIRROLES_OBS_001",
  "ENTRA_DIRROLES_OBS_002",
  "ENTRA_DIRROLES_OBS_003",
  "ENTRA_DIRROLES_OBS_004",
  "ENTRA_DIRROLES_OBS_005"
] as const;

type DirRolesObs001 = {
  roleDefinitionsCount: number;
  rolesWithAnyActiveAssignmentCount: number;
  activeAssignmentsCount: number;
  dataProfile: "safe" | "full";
  truncated: boolean;
};

type DirRolesObs002 = {
  user: number;
  group: number;
  servicePrincipal: number;
  unknown: number;
  dataProfile: "safe" | "full";
  truncated: boolean;
};

type DirRolesObs003 = {
  present: boolean;
  assignmentsCount: number;
  dataProfile: "safe" | "full";
  truncated: boolean;
};

type DirRolesObs004 = {
  attempted: boolean;
  succeeded: boolean;
  eligibleAssignmentsCount?: number;
  dataProfile: "safe" | "full";
  truncated: boolean;
};

type DirRolesObs005 = {
  isComplete: boolean;
  truncated: boolean;
  permissionDenied: string[];
  slicesAttempted: string[];
  slicesCompleted: string[];
  notes: string[];
  dataProfile: "safe" | "full";
};

function isKnownDirRolesCheckId(id: string): id is typeof DIRROLES_CHECK_IDS[number] {
  return (DIRROLES_CHECK_IDS as readonly string[]).includes(id);
}

function pickObservedByCheckId(observedChecks: any[], checkId: string): any | null {
  const found = observedChecks.find((o) => String(o?.checkId ?? "") === checkId);
  return found ?? null;
}

export const runSummaryExcelReportCollector: Collector = {
  id: "report.runSummary.xlsx",
  displayName: "Run Summary (Excel)",
  async run(ctx) {
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

    if (!run) throw new Error(`Run not found: ${ctx.run.id}`);

    const jobs = run.jobs ?? [];
    const derivedStatus = deriveRunStatus(jobs);

    const findings = run.findings ?? [];
    const observedChecks = run.observedChecks ?? [];
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

    // Conditional Access: report must only consume safe-compatible artefacts
    const caCandidates = ["conditional-access-policies.safe.json"];

    const { artefact: usersArtefact, filename: usersArtefactName } = pickArtefactByFilename(usersCandidates);
    const { artefact: eapArtefact, filename: eapArtefactName } = pickArtefactByFilename(eapCandidates);
    const { artefact: caArtefact, filename: caArtefactName } = pickArtefactByFilename(caCandidates);

    let usersJson: UsersInventoryJson | null = null;
    let usersJsonError: string | null = null;

    if (usersArtefact) {
      const text = await downloadArtefactText({ s3, bucket: usersArtefact.bucket, key: usersArtefact.key });
      const parsed = tryParseJson<UsersInventoryJson>(text);
      if (parsed.ok) usersJson = parsed.value;
      else usersJsonError = parsed.error;
    }

    let eapJson: EnterpriseAppPermissionsJson | null = null;
    let eapJsonError: string | null = null;

    if (eapArtefact) {
      const text = await downloadArtefactText({ s3, bucket: eapArtefact.bucket, key: eapArtefact.key });
      const parsed = tryParseJson<EnterpriseAppPermissionsJson>(text);
      if (parsed.ok) eapJson = parsed.value;
      else eapJsonError = parsed.error;
    }

    let caJson: ConditionalAccessPoliciesSafeJson | null = null;
    let caJsonError: string | null = null;

    if (caArtefact) {
      const text = await downloadArtefactText({ s3, bucket: caArtefact.bucket, key: caArtefact.key });
      const parsed = tryParseJson<ConditionalAccessPoliciesSafeJson>(text);
      if (parsed.ok) caJson = parsed.value;
      else caJsonError = parsed.error;
    }

    const usersSummary = usersJson ? normalizeUsersSummary(usersJson) : null;
    const eapSummary = eapJson ? normalizeEapSummary(eapJson) : null;
    const caSummary = caJson ? normalizeCaSummary(caJson) : null;

    // Pull Directory Roles observed checks (do not assume artefact exists yet)
    const dirRolesChecks = observedChecks
      .map((o: any) => ({ ...o, checkId: String(o?.checkId ?? "") }))
      .filter((o: any) => isKnownDirRolesCheckId(o.checkId));

    const dr001 = pickObservedByCheckId(dirRolesChecks as any[], "ENTRA_DIRROLES_OBS_001") as any | null;
    const dr005 = pickObservedByCheckId(dirRolesChecks as any[], "ENTRA_DIRROLES_OBS_005") as any | null;

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
      ws.addRow({ field: "observedChecks", value: observedChecks.length });
      ws.addRow({ field: "artefacts", value: artefacts.length });

      ws.addRow({ field: "findings.critical", value: sevCounts.critical });
      ws.addRow({ field: "findings.high", value: sevCounts.high });
      ws.addRow({ field: "findings.medium", value: sevCounts.medium });
      ws.addRow({ field: "findings.low", value: sevCounts.low });
      ws.addRow({ field: "findings.info", value: sevCounts.info });
      ws.addRow({ field: "findings.unknown", value: sevCounts.unknown });

      // Optional: surface artefact parsing summaries (handy for debugging)
      if (usersSummary) {
        ws.addRow({ field: "users.total", value: usersSummary.totalUsers });
        ws.addRow({ field: "users.guest", value: usersSummary.guestUsers ?? "" });
      } else if (usersJsonError) {
        ws.addRow({ field: "users.parseError", value: usersJsonError });
      }

      if (eapSummary) {
        ws.addRow({ field: "eap.totalEnterpriseApps", value: eapSummary.totalEnterpriseApps });
        ws.addRow({ field: "eap.riskyApps", value: eapSummary.riskyApps ?? "" });
      } else if (eapJsonError) {
        ws.addRow({ field: "eap.parseError", value: eapJsonError });
      }

      if (caSummary) {
        ws.addRow({ field: "ca.totalPolicies", value: caSummary.totalPolicies ?? "" });
        ws.addRow({ field: "ca.permissionDenied", value: caSummary.permissionDenied ?? "" });
        ws.addRow({ field: "ca.truncated", value: caSummary.truncated ?? "" });
      } else if (caJsonError) {
        ws.addRow({ field: "ca.parseError", value: caJsonError });
      }

      // Directory roles: small summary signal (observed-check based)
      if (dr001 && dr001.data && typeof dr001.data === "object") {
        const d = dr001.data as DirRolesObs001;
        ws.addRow({ field: "dirRoles.roleDefinitionsCount", value: d.roleDefinitionsCount ?? "" });
        ws.addRow({ field: "dirRoles.activeAssignmentsCount", value: d.activeAssignmentsCount ?? "" });
        ws.addRow({ field: "dirRoles.truncated", value: String(d.truncated ?? "") });
      } else {
        ws.addRow({ field: "dirRoles.status", value: "not-available" });
      }

      if (dr005 && dr005.data && typeof dr005.data === "object") {
        const d = dr005.data as DirRolesObs005;
        ws.addRow({ field: "dirRoles.isComplete", value: String(d.isComplete ?? "") });
      }
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
          startedAt: iso((j as any).startedAt ?? j.lockedAt),
          endedAt: iso((j as any).endedAt),
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
        { header: "recommendation", key: "recommendation", width: 90 },
        { header: "evidence", key: "evidence", width: 90 },
        { header: "references", key: "references", width: 70 },
        { header: "createdAt", key: "createdAt", width: 26 }
      ];

      for (const f of findings) {
        ws.addRow({
          checkId: f.checkId,
          severity: f.severity,
          title: f.title,
          description: f.description,
          recommendation: (f as any).recommendation ?? "",
          evidence: safeJsonCell((f as any).evidence, 1800),
          references: safeJsonCell((f as any).references, 1200),
          createdAt: iso(f.createdAt)
        });
      }

      if (!findings.length) {
        ws.addRow({
          checkId: "status",
          severity: "empty",
          title: "",
          description: "No findings for this run.",
          recommendation: "",
          evidence: "",
          references: "",
          createdAt: ""
        });
      }
    }

    // -------------------------
    // Sheet 4: Observed Checks
    // -------------------------
    {
      const ws = wb.addWorksheet(safeSheetName("Observed Checks"));

      ws.columns = [
        { header: "observedAt", key: "observedAt", width: 26 },
        { header: "checkId", key: "checkId", width: 28 },
        { header: "collectorId", key: "collectorId", width: 34 },
        { header: "jobId", key: "jobId", width: 28 },
        { header: "ruleId", key: "ruleId", width: 22 },
        { header: "data", key: "data", width: 110 },
        { header: "references", key: "references", width: 90 }
      ];

      const sorted = [...observedChecks].sort((a: any, b: any) => {
        const ta = new Date(a?.observedAt ?? 0).getTime();
        const tb = new Date(b?.observedAt ?? 0).getTime();
        return ta - tb;
      });

      for (const o of sorted as any[]) {
        ws.addRow({
          observedAt: iso(o.observedAt),
          checkId: String(o.checkId ?? ""),
          collectorId: String(o.collectorId ?? ""),
          jobId: String(o.jobId ?? ""),
          ruleId: String(o.ruleId ?? ""),
          data: safeJsonCell(o.data, 2400),
          references: safeJsonCell(o.references, 1200)
        });
      }

      if (!sorted.length) {
        ws.addRow({
          observedAt: "",
          checkId: "status",
          collectorId: "empty",
          jobId: "",
          ruleId: "",
          data: "No observed checks for this run.",
          references: ""
        });
      }
    }

    // -------------------------
    // Sheet 5: Artefacts
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

      if (!artefacts.length) {
        ws.addRow({
          type: "status",
          bucket: "empty",
          key: "No artefacts for this run.",
          sizeBytes: "",
          hash: "",
          createdAt: ""
        });
      }
    }

    // -------------------------
    // Sheet 6: Users (Summary)
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
        ws.addRow({ field: "totalUsers", value: usersSummary?.totalUsers ?? "n/a", notes: "" });
        ws.addRow({ field: "enabledUsers", value: usersSummary?.enabledUsers ?? "n/a", notes: "" });
        ws.addRow({ field: "disabledUsers", value: usersSummary?.disabledUsers ?? "n/a", notes: "" });
        ws.addRow({ field: "memberUsers", value: usersSummary?.memberUsers ?? "n/a", notes: "" });
        ws.addRow({ field: "guestUsers", value: usersSummary?.guestUsers ?? "n/a", notes: "" });
      }
    }

    // -------------------------
    // Sheet 6b: Users (Full)  (FULL profile only)
    // -------------------------
    {
      const ws = wb.addWorksheet(safeSheetName("Users (Full)"));

      // This sheet is intentionally PII-bearing and only emitted for full profile runs.
      if (run.dataProfile !== "full") {
        ws.columns = [
          { header: "field", key: "field", width: 38 },
          { header: "value", key: "value", width: 28 },
          { header: "notes", key: "notes", width: 80 }
        ];

        ws.addRow({
          field: "status",
          value: "not-available",
          notes: "Users (Full) is only generated when dataProfile is 'full'."
        });
      } else if (!usersArtefact) {
        ws.columns = [
          { header: "field", key: "field", width: 38 },
          { header: "value", key: "value", width: 28 },
          { header: "notes", key: "notes", width: 80 }
        ];

        ws.addRow({
          field: "status",
          value: "not-available",
          notes: `${usersArtefactName} artefact was not present in this run.`
        });
      } else if (usersJsonError) {
        ws.columns = [
          { header: "field", key: "field", width: 38 },
          { header: "value", key: "value", width: 28 },
          { header: "notes", key: "notes", width: 80 }
        ];

        ws.addRow({
          field: "status",
          value: "error",
          notes: `Failed to parse ${usersArtefactName}: ${usersJsonError}`
        });
      } else {
        ws.columns = [
          { header: "id", key: "id", width: 38 },
          { header: "displayName", key: "displayName", width: 28 },
          { header: "userPrincipalName", key: "userPrincipalName", width: 36 },
          { header: "mail", key: "mail", width: 30 },
          { header: "userType", key: "userType", width: 12 },
          { header: "accountEnabled", key: "accountEnabled", width: 14 },
          { header: "createdDateTime", key: "createdDateTime", width: 22 }
        ];

        const users: any[] = Array.isArray((usersJson as any)?.users) ? (usersJson as any).users : [];

        if (!users.length) {
          ws.addRow({
            id: "status",
            displayName: "empty",
            userPrincipalName: "",
            mail: "",
            userType: "",
            accountEnabled: "",
            createdDateTime: `No users[] were present in ${usersArtefactName}`
          });
        } else {
          for (const u of users) {
            ws.addRow({
              id: String(u?.id ?? ""),
              displayName: String(u?.displayName ?? ""),
              userPrincipalName: String(u?.userPrincipalName ?? ""),
              mail: String(u?.mail ?? ""),
              userType: String(u?.userType ?? ""),
              accountEnabled: u?.accountEnabled === true ? "true" : (u?.accountEnabled === false ? "false" : ""),
              createdDateTime: String(u?.createdDateTime ?? "")
            });
          }
        }
      }
    }

    // -------------------------
    // Sheet 7: Enterprise Apps (Permissions)
    // -------------------------
    {
      const ws = wb.addWorksheet(safeSheetName("Enterprise Apps (Perms)"));

      ws.columns = [
        { header: "displayName", key: "displayName", width: 44 },
        { header: "appId", key: "appId", width: 36 },
        { header: "accountEnabled", key: "accountEnabled", width: 14 },
        { header: "applicationPermissions", key: "applicationPermissions", width: 24 }, // count
        { header: "delegatedPermissions", key: "delegatedPermissions", width: 24 }, // count
        { header: "riskyPermissions", key: "riskyPermissions", width: 16 }, // count
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
        const apps: any[] = Array.isArray(eapJson?.apps) ? eapJson.apps : [];

        for (const app of apps) {
          const appPermCount = Array.isArray(app?.applicationPermissions) ? app.applicationPermissions.length : 0;
          const delPermCount = Array.isArray(app?.delegatedPermissions) ? app.delegatedPermissions.length : 0;
          const riskyCount = Array.isArray(app?.risky) ? app.risky.length : 0;

          ws.addRow({
            displayName: app?.displayName ?? "",
            appId: app?.appId ?? "",
            accountEnabled: String(app?.accountEnabled ?? ""),
            applicationPermissions: String(appPermCount),
            delegatedPermissions: String(delPermCount),
            riskyPermissions: String(riskyCount),
            riskFlag: riskyCount > 0 ? "YES" : "NO"
          });
        }

        if (!apps.length) {
          ws.addRow({
            displayName: "status",
            appId: "empty",
            accountEnabled: "",
            applicationPermissions: "",
            delegatedPermissions: "",
            riskyPermissions: "No apps[] present in parsed JSON.",
            riskFlag: "n/a"
          });
        }
      }
    }

    // -------------------------
    // Sheet 8: Conditional Access (Summary + Top Policies)
    // -------------------------
    {
      const ws = wb.addWorksheet(safeSheetName("Conditional Access"));

      ws.columns = [
        { header: "field", key: "field", width: 42 },
        { header: "value", key: "value", width: 22 },
        { header: "notes", key: "notes", width: 100 }
      ];

      if (!caArtefact) {
        ws.addRow({
          field: "status",
          value: "not-available",
          notes: `${caArtefactName} artefact was not present in this run.`
        });
      } else if (caJsonError) {
        ws.addRow({
          field: "status",
          value: "error",
          notes: `Failed to parse ${caArtefactName}: ${caJsonError}`
        });
      } else {
        const permissionDenied = caSummary?.permissionDenied === true;
        const truncated = caSummary?.truncated === true;

        const statusNote = permissionDenied
          ? "Permission denied reading Conditional Access policies (missing Graph scopes). This is a data completeness signal, not a policy judgement."
          : truncated
            ? "Conditional Access policy enumeration was truncated (demo guardrails / API limits). Counts reflect only the collected subset."
            : "Conditional Access policies were collected successfully.";

        ws.addRow({
          field: "status",
          value: permissionDenied ? "permission-denied" : (truncated ? "truncated" : "ok"),
          notes: statusNote
        });

        ws.addRow({ field: "generatedAt", value: caJson?.generatedAt ?? "", notes: "" });
        ws.addRow({
          field: "artefact",
          value: caArtefactName,
          notes: "Report consumes safe-compatible artefact only; full artefacts are never implicitly loaded."
        });

        ws.addRow({ field: "totalPolicies", value: caSummary?.totalPolicies ?? "n/a", notes: "" });
        ws.addRow({ field: "enabledPolicies", value: caSummary?.enabledPolicies ?? "n/a", notes: "" });
        ws.addRow({ field: "reportOnlyPolicies", value: caSummary?.reportOnlyPolicies ?? "n/a", notes: "" });
        ws.addRow({ field: "disabledPolicies", value: caSummary?.disabledPolicies ?? "n/a", notes: "" });

        ws.addRow({ field: "policiesTargetingAllUsers", value: caSummary?.policiesTargetingAllUsers ?? "n/a", notes: "" });
        ws.addRow({ field: "policiesWithMfaGrantControl", value: caSummary?.policiesWithMfaGrantControl ?? "n/a", notes: "" });
        ws.addRow({
          field: "policiesExcludingUsersCount",
          value: caSummary?.policiesExcludingUsersCount ?? "n/a",
          notes: "Count of excludeUsers entries across the collected policies (safe summary)."
        });
        ws.addRow({ field: "hasLegacyAuthPolicyDetected", value: caSummary?.hasLegacyAuthPolicyDetected ?? "n/a", notes: "" });

        ws.addRow({
          field: "namedLocationsCount",
          value: caSummary?.namedLocationsCount ?? "n/a",
          notes: "Named locations are not enumerated in this collector yet (placeholder factual value)."
        });

        ws.addRow({ field: "truncated", value: String(caSummary?.truncated ?? ""), notes: "" });
        ws.addRow({ field: "permissionDenied", value: String(caSummary?.permissionDenied ?? ""), notes: "" });
        ws.addRow({ field: "maxPolicies", value: caSummary?.maxPolicies ?? "", notes: "If set, indicates demo/performance cap applied by CA_MAX_POLICIES." });

        if (caJson?.error) {
          ws.addRow({ field: "error", value: "present", notes: safeJsonCell(caJson.error, 2400) });
        }

        // --- Top policies table (safe-friendly) ---
        // We only render this if safe artefact includes a policies[] list (no membership identifiers).
        ws.addRow({ field: "", value: "", notes: "" });
        ws.addRow({
          field: "topPolicies",
          value: "",
          notes: "Table below is derived from the safe artefact. It intentionally avoids listing include/exclude membership identifiers."
        });

        const policies: any[] = Array.isArray((caJson as any)?.policies) ? ((caJson as any).policies as any[]) : [];

        if (!policies.length) {
          ws.addRow({
            field: "status",
            value: "no-policies-list",
            notes: "No policies[] list was present in the safe artefact. Summary counts above are still authoritative for this lens."
          });
        } else {
          // Add a second table underneath with its own headers
          const headerRowIndex = ws.rowCount + 1;
          ws.addRow({ field: "displayName", value: "state", notes: "targetsAllUsers | hasMfaGrantControl | grantControlTypes | sessionControls" });

          // Bold the header row for readability
          const headerRow = ws.getRow(headerRowIndex);
          headerRow.font = { bold: true };

          for (const p of policies.slice(0, 50)) {
            const displayName = String(p?.displayName ?? "");
            const state = String(p?.state ?? "");
            const targetsAllUsers = deriveCaTargetsAllUsers(p);
            const hasMfa = deriveCaHasMfaGrantControl(p);
            const grantTypes = deriveCaGrantControlTypes(p);
            const sessionPresent = deriveCaSessionControlsPresent(p);

            const notesParts: string[] = [];
            notesParts.push(`targetsAllUsers=${targetsAllUsers === null ? "n/a" : String(targetsAllUsers)}`);
            notesParts.push(`hasMfaGrantControl=${hasMfa === null ? "n/a" : String(hasMfa)}`);
            if (grantTypes) notesParts.push(`grantControlTypes=${grantTypes}`);
            notesParts.push(`sessionControls=${sessionPresent === null ? "n/a" : String(sessionPresent)}`);

            ws.addRow({
              field: displayName,
              value: state,
              notes: notesParts.join(" | ")
            });
          }

          if (policies.length > 50) {
            ws.addRow({
              field: "note",
              value: "truncated-table",
              notes: `Only the first 50 policies are shown in this table for readability (policies in artefact: ${policies.length}).`
            });
          }
        }
      }
    }

    // -------------------------
    // Sheet 9: Directory Roles (Observed)
    // -------------------------
    {
      const ws = wb.addWorksheet(safeSheetName("Directory Roles"));

      ws.columns = [
        { header: "field", key: "field", width: 42 },
        { header: "value", key: "value", width: 24 },
        { header: "notes", key: "notes", width: 110 }
      ];

      if (!dirRolesChecks.length) {
        ws.addRow({
          field: "status",
          value: "not-available",
          notes:
            "No Directory Roles observed checks were recorded in this run. This usually means the module was not enabled, the collector did not run, or evidence could not be collected."
        });
      } else {
        const o1 = pickObservedByCheckId(dirRolesChecks as any[], "ENTRA_DIRROLES_OBS_001");
        const o2 = pickObservedByCheckId(dirRolesChecks as any[], "ENTRA_DIRROLES_OBS_002");
        const o3 = pickObservedByCheckId(dirRolesChecks as any[], "ENTRA_DIRROLES_OBS_003");
        const o4 = pickObservedByCheckId(dirRolesChecks as any[], "ENTRA_DIRROLES_OBS_004");
        const o5 = pickObservedByCheckId(dirRolesChecks as any[], "ENTRA_DIRROLES_OBS_005");

        ws.addRow({
          field: "source",
          value: "observedChecks",
          notes: "This sheet is derived from observed checks (not findings). It is safe to render and does not imply judgement."
        });

        // OBS_005: completeness first (data quality / demo signals)
        if (o5 && o5.data && typeof o5.data === "object") {
          const d = o5.data as DirRolesObs005;
          ws.addRow({ field: "completeness.isComplete", value: String(d.isComplete ?? ""), notes: "" });
          ws.addRow({ field: "completeness.truncated", value: String(d.truncated ?? ""), notes: "" });
          ws.addRow({
            field: "completeness.permissionDenied",
            value: Array.isArray(d.permissionDenied) ? String(d.permissionDenied.length) : "",
            notes: Array.isArray(d.permissionDenied) && d.permissionDenied.length ? d.permissionDenied.join(", ") : ""
          });
          ws.addRow({
            field: "completeness.slicesAttempted",
            value: Array.isArray(d.slicesAttempted) ? String(d.slicesAttempted.length) : "",
            notes: Array.isArray(d.slicesAttempted) && d.slicesAttempted.length ? d.slicesAttempted.join(", ") : ""
          });
          ws.addRow({
            field: "completeness.slicesCompleted",
            value: Array.isArray(d.slicesCompleted) ? String(d.slicesCompleted.length) : "",
            notes: Array.isArray(d.slicesCompleted) && d.slicesCompleted.length ? d.slicesCompleted.join(", ") : ""
          });
          ws.addRow({
            field: "completeness.notes",
            value: Array.isArray(d.notes) ? String(d.notes.length) : "",
            notes: Array.isArray(d.notes) && d.notes.length ? d.notes.join(" | ") : ""
          });
        } else {
          ws.addRow({
            field: "completeness",
            value: "missing",
            notes: "ENTRA_DIRROLES_OBS_005 was not present."
          });
        }

        ws.addRow({ field: "", value: "", notes: "" });

        // OBS_001: inventory summary
        if (o1 && o1.data && typeof o1.data === "object") {
          const d = o1.data as DirRolesObs001;
          ws.addRow({ field: "inventory.roleDefinitionsCount", value: String(d.roleDefinitionsCount ?? ""), notes: "" });
          ws.addRow({
            field: "inventory.rolesWithAnyActiveAssignmentCount",
            value: String(d.rolesWithAnyActiveAssignmentCount ?? ""),
            notes: ""
          });
          ws.addRow({ field: "inventory.activeAssignmentsCount", value: String(d.activeAssignmentsCount ?? ""), notes: "" });
          ws.addRow({ field: "inventory.truncated", value: String(d.truncated ?? ""), notes: "" });
          ws.addRow({ field: "inventory.dataProfile", value: String(d.dataProfile ?? ""), notes: "" });
        } else {
          ws.addRow({
            field: "inventory",
            value: "missing",
            notes: "ENTRA_DIRROLES_OBS_001 was not present."
          });
        }

        ws.addRow({ field: "", value: "", notes: "" });

        // OBS_002: principal type distribution
        if (o2 && o2.data && typeof o2.data === "object") {
          const d = o2.data as DirRolesObs002;
          ws.addRow({ field: "principalTypes.user", value: String(d.user ?? ""), notes: "" });
          ws.addRow({ field: "principalTypes.group", value: String(d.group ?? ""), notes: "" });
          ws.addRow({ field: "principalTypes.servicePrincipal", value: String(d.servicePrincipal ?? ""), notes: "" });
          ws.addRow({ field: "principalTypes.unknown", value: String(d.unknown ?? ""), notes: "" });
          ws.addRow({ field: "principalTypes.truncated", value: String(d.truncated ?? ""), notes: "" });
        } else {
          ws.addRow({
            field: "principalTypes",
            value: "missing",
            notes: "ENTRA_DIRROLES_OBS_002 was not present."
          });
        }

        ws.addRow({ field: "", value: "", notes: "" });

        // OBS_003: group-based assignment presence
        if (o3 && o3.data && typeof o3.data === "object") {
          const d = o3.data as DirRolesObs003;
          ws.addRow({ field: "groupAssignments.present", value: String(d.present ?? ""), notes: "" });
          ws.addRow({ field: "groupAssignments.assignmentsCount", value: String(d.assignmentsCount ?? ""), notes: "" });
          ws.addRow({ field: "groupAssignments.truncated", value: String(d.truncated ?? ""), notes: "" });
        } else {
          ws.addRow({
            field: "groupAssignments",
            value: "missing",
            notes: "ENTRA_DIRROLES_OBS_003 was not present."
          });
        }

        ws.addRow({ field: "", value: "", notes: "" });

        // OBS_004: eligible/PIM signal
        if (o4 && o4.data && typeof o4.data === "object") {
          const d = o4.data as DirRolesObs004;
          ws.addRow({ field: "eligible.attempted", value: String(d.attempted ?? ""), notes: "" });
          ws.addRow({ field: "eligible.succeeded", value: String(d.succeeded ?? ""), notes: "" });
          ws.addRow({
            field: "eligible.eligibleAssignmentsCount",
            value: typeof d.eligibleAssignmentsCount === "number" ? String(d.eligibleAssignmentsCount) : "",
            notes: "Only populated when eligible assignment evidence was successfully collected."
          });
          ws.addRow({ field: "eligible.truncated", value: String(d.truncated ?? ""), notes: "" });
        } else {
          ws.addRow({
            field: "eligible",
            value: "missing",
            notes: "ENTRA_DIRROLES_OBS_004 was not present."
          });
        }

        ws.addRow({ field: "", value: "", notes: "" });

        // Raw dump (bounded) - useful during iteration
        ws.addRow({
          field: "raw.observedChecks",
          value: String(dirRolesChecks.length),
          notes: "Bounded JSON dump below (for debugging / iteration)."
        });
        ws.addRow({
          field: "raw.data",
          value: "",
          notes: safeJsonCell(
            dirRolesChecks.map((o: any) => ({
              checkId: o.checkId,
              observedAt: o.observedAt,
              collectorId: o.collectorId,
              data: o.data
            })),
            2400
          )
        });
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
          observedChecks: observedChecks.length,
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
