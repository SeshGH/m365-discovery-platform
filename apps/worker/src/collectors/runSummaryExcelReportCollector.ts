// apps/worker/src/collectors/runSummaryExcelReportCollector.ts

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

  // aws-sdk v3 in some runtimes provides a web-stream-ish body with helper methods
  if (typeof body.transformToByteArray === "function") {
    const arr = await body.transformToByteArray();
    return Buffer.from(arr);
  }

  // Fallback: Uint8Array / ArrayBuffer-ish
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body?.buffer instanceof ArrayBuffer) return Buffer.from(body.buffer);

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

// -------------------------
// Styling helpers (quick-win polish)
// -------------------------
const ARGB = {
  border: "FFE5E7EB",
  headerFill: "FFF3F4F6",
  mutedFill: "FFF9FAFB",
  okFill: "FFECFDF5",
  okText: "FF065F46",
  warnFill: "FFFFFBEB",
  warnText: "FF92400E",
  badFill: "FFFEF2F2",
  badText: "FF991B1B"
} as const;

function thinBorder() {
  return {
    top: { style: "thin" as const, color: { argb: ARGB.border } },
    left: { style: "thin" as const, color: { argb: ARGB.border } },
    bottom: { style: "thin" as const, color: { argb: ARGB.border } },
    right: { style: "thin" as const, color: { argb: ARGB.border } }
  };
}

function applyHeaderRowStyle(ws: ExcelJS.Worksheet, headerRowNumber = 1) {
  const row = ws.getRow(headerRowNumber);
  row.font = { bold: true };
  row.alignment = { vertical: "middle", wrapText: true };
  row.height = 18;

  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB.headerFill } };
    cell.border = thinBorder();
  });
}

function applyGridBorders(ws: ExcelJS.Worksheet, fromRow = 1) {
  const lastRow = ws.rowCount;
  const lastCol = ws.columnCount;
  for (let r = fromRow; r <= lastRow; r++) {
    const row = ws.getRow(r);
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      // only border within used columns
      if (colNumber <= lastCol) cell.border = thinBorder();
    });
  }
}

function freezeTopRowAndFilter(ws: ExcelJS.Worksheet) {
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const lastCol = ws.columnCount;
  if (lastCol <= 0) return;

  const lastColLetter = ws.getColumn(lastCol).letter;
  ws.autoFilter = `A1:${lastColLetter}1`;
}

function applyDefaultRowAlignment(ws: ExcelJS.Worksheet) {
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // Keep header tighter
    if (rowNumber === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
  });
}

function applyBasicTableLook(ws: ExcelJS.Worksheet) {
  applyHeaderRowStyle(ws, 1);
  freezeTopRowAndFilter(ws);
  applyDefaultRowAlignment(ws);
  applyGridBorders(ws, 1);
}

function applyKeyValueLook(ws: ExcelJS.Worksheet) {
  // still uses header row ("field","value","notes" etc)
  applyHeaderRowStyle(ws, 1);
  ws.views = [{ state: "frozen", ySplit: 1 }];
  applyDefaultRowAlignment(ws);
  applyGridBorders(ws, 1);

  // Emphasise "field" column
  const fieldCol = ws.getColumn(1);
  fieldCol.font = { bold: true };

  // Gentle zebra on data rows for readability
  for (let r = 2; r <= ws.rowCount; r++) {
    if (r % 2 === 0) {
      const row = ws.getRow(r);
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (!cell.fill) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB.mutedFill } };
        }
      });
    }
  }
}

function setCellPill(cell: ExcelJS.Cell, kind: "ok" | "warn" | "bad") {
  const map = {
    ok: { fill: ARGB.okFill, font: ARGB.okText },
    warn: { fill: ARGB.warnFill, font: ARGB.warnText },
    bad: { fill: ARGB.badFill, font: ARGB.badText }
  } as const;

  const c = map[kind];
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.fill } };
  cell.font = { bold: true, color: { argb: c.font } };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
}

function findRowByField(ws: ExcelJS.Worksheet, fieldValue: string): ExcelJS.Row | null {
  for (let r = 2; r <= ws.rowCount; r++) {
    const v = ws.getRow(r).getCell(1).value;
    if (String(v ?? "") === fieldValue) return ws.getRow(r);
  }
  return null;
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
    riskyApps?: number;
  };
  apps?: Array<{
    appId?: string;
    displayName?: string;
    servicePrincipalId?: string;
    applicationPermissions?: string[];
    delegatedPermissions?: string[];
    risky?: string[];
    accountEnabled?: boolean;
  }>;
};

type ExchangeMailboxesInventoryJson = {
  generatedAt?: string;
  profile?: "safe" | "full";
  tenant?: {
    tenantGuid?: string;
    primaryDomain?: string;
    displayName?: string;
  };
  summary?: {
    totalMailboxes?: number;
    byState?: {
      enabled?: number;
      disabled?: number;
    };
    byRecipientType?: Record<string, number>;
    sizeBuckets?: {
      over50GB?: number;
      over100GB?: number;
    };
    archive?: {
      enabled?: number;
      disabled?: number;
    };
    litigationHold?: {
      enabled?: number;
      disabled?: number;
    };
  };
  mailboxes?: Array<{
    displayName?: string;
    userPrincipalName?: string;
    recipientTypeDetails?: string;
    accountEnabled?: boolean;
    mailboxSizeGB?: number;
    archiveEnabled?: boolean;
    litigationHoldEnabled?: boolean;
  }>;
};

type NormalizedExoSummary = {
  totalMailboxes: number | null;
  enabled: number | null;
  disabled: number | null;
  over50GB: number | null;
  archiveEnabled: number | null;
  litigationHoldEnabled: number | null;
  truncated: boolean | null;
};

function normalizeExoSummary(exoJson: any): NormalizedExoSummary {
  const s = exoJson?.summary ?? {};
  const mailboxes: any[] = Array.isArray(exoJson?.mailboxes) ? exoJson.mailboxes : [];

  const totalMailboxes =
    typeof s.totalMailboxes === "number"
      ? s.totalMailboxes
      : mailboxes.length
        ? mailboxes.length
        : null;

  const enabled =
    typeof s.byState?.enabled === "number"
      ? s.byState.enabled
      : mailboxes.length
        ? mailboxes.filter((m) => m?.accountEnabled === true).length
        : null;

  const disabled =
    typeof s.byState?.disabled === "number"
      ? s.byState.disabled
      : mailboxes.length
        ? mailboxes.filter((m) => m?.accountEnabled === false).length
        : null;

  const over50GB =
    typeof s.sizeBuckets?.over50GB === "number"
      ? s.sizeBuckets.over50GB
      : mailboxes.length
        ? mailboxes.filter((m) => typeof m?.mailboxSizeGB === "number" && m.mailboxSizeGB > 50).length
        : null;

  const archiveEnabled =
    typeof s.archive?.enabled === "number"
      ? s.archive.enabled
      : mailboxes.length
        ? mailboxes.filter((m) => m?.archiveEnabled === true).length
        : null;

  const litigationHoldEnabled =
    typeof s.litigationHold?.enabled === "number"
      ? s.litigationHold.enabled
      : mailboxes.length
        ? mailboxes.filter((m) => m?.litigationHoldEnabled === true).length
        : null;

  const truncated = typeof s.truncated === "boolean" ? s.truncated : null;

  return {
    totalMailboxes,
    enabled,
    disabled,
    over50GB,
    archiveEnabled,
    litigationHoldEnabled,
    truncated
  };
}

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

  policies?: Array<{
    id?: string;
    displayName?: string;
    state?: string;
    targetsAllUsers?: boolean;
    excludesUsers?: boolean;
    hasMfaGrantControl?: boolean;
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
    // Pick specific JSON artefacts (by filename) if present
    // -------------------------
    const pickArtefactByFilename = (filenames: string[]) => {
      for (const fn of filenames) {
        const a = artefacts.find((x) => String(x.key ?? "").endsWith("/" + fn));
        if (a) return { artefact: a, filename: fn };
      }
      return { artefact: null as any, filename: filenames[0] ?? "" };
    };

    // Profile-aware artefact selection
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

    const caCandidates = ["conditional-access-policies.safe.json"];

    const exoCandidates =
  run.dataProfile === "full"
    ? [
        "exchange-mailboxes-inventory.full.json",
        "exchange-mailboxes-inventory.safe.json",
        "exchange-mailboxes-inventory.json"
      ]
    : ["exchange-mailboxes-inventory.json", "exchange-mailboxes-inventory.safe.json"];

    const { artefact: usersArtefact, filename: usersArtefactName } = pickArtefactByFilename(usersCandidates);
    const { artefact: eapArtefact, filename: eapArtefactName } = pickArtefactByFilename(eapCandidates);
    const { artefact: caArtefact, filename: caArtefactName } = pickArtefactByFilename(caCandidates);
    const { artefact: exoArtefact, filename: exoArtefactName } = pickArtefactByFilename(exoCandidates);

    // -------------------------
    // Attempt S3 downloads (graceful degradation)
    // -------------------------
    let s3: S3Client | null = null;
    let s3InitError: string | null = null;

    const shouldAttemptS3 =
      Boolean(usersArtefact) || Boolean(eapArtefact) || Boolean(caArtefact) || Boolean(exoArtefact);

    if (shouldAttemptS3) {
      try {
        s3 = createS3ClientOrThrow();
      } catch (e: any) {
        s3InitError = e?.message ? String(e.message) : String(e);
        s3 = null;
      }
    }

    let usersJson: UsersInventoryJson | null = null;
    let usersJsonError: string | null = null;

    if (usersArtefact) {
      if (!s3) {
        usersJsonError = s3InitError ?? "S3 client unavailable";
      } else {
        try {
          const text = await downloadArtefactText({ s3, bucket: usersArtefact.bucket, key: usersArtefact.key });
          const parsed = tryParseJson<UsersInventoryJson>(text);
          if (parsed.ok) usersJson = parsed.value;
          else usersJsonError = parsed.error;
        } catch (e: any) {
          usersJsonError = e?.message ? String(e.message) : String(e);
        }
      }
    }

    let eapJson: EnterpriseAppPermissionsJson | null = null;
    let eapJsonError: string | null = null;

    if (eapArtefact) {
      if (!s3) {
        eapJsonError = s3InitError ?? "S3 client unavailable";
      } else {
        try {
          const text = await downloadArtefactText({ s3, bucket: eapArtefact.bucket, key: eapArtefact.key });
          const parsed = tryParseJson<EnterpriseAppPermissionsJson>(text);
          if (parsed.ok) eapJson = parsed.value;
          else eapJsonError = parsed.error;
        } catch (e: any) {
          eapJsonError = e?.message ? String(e.message) : String(e);
        }
      }
    }

    let caJson: ConditionalAccessPoliciesSafeJson | null = null;
    let caJsonError: string | null = null;

    if (caArtefact) {
      if (!s3) {
        caJsonError = s3InitError ?? "S3 client unavailable";
      } else {
        try {
          const text = await downloadArtefactText({ s3, bucket: caArtefact.bucket, key: caArtefact.key });
          const parsed = tryParseJson<ConditionalAccessPoliciesSafeJson>(text);
          if (parsed.ok) caJson = parsed.value;
          else caJsonError = parsed.error;
        } catch (e: any) {
          caJsonError = e?.message ? String(e.message) : String(e);
        }
      }
    }

    let exoJson: ExchangeMailboxesInventoryJson | null = null;
let exoJsonError: string | null = null;

if (exoArtefact) {
  if (!s3) {
    exoJsonError = s3InitError ?? "S3 client unavailable";
  } else {
    try {
      const text = await downloadArtefactText({
        s3,
        bucket: exoArtefact.bucket,
        key: exoArtefact.key
      });
      const parsed = tryParseJson<ExchangeMailboxesInventoryJson>(text);
      if (parsed.ok) exoJson = parsed.value;
      else exoJsonError = parsed.error;
    } catch (e: any) {
      exoJsonError = e?.message ? String(e.message) : String(e);
    }
  }
}


    const usersSummary = usersJson ? normalizeUsersSummary(usersJson) : null;
    const eapSummary = eapJson ? normalizeEapSummary(eapJson) : null;
    const caSummary = caJson ? normalizeCaSummary(caJson) : null;
    const exoSummary = exoJson ? normalizeExoSummary(exoJson) : null;

    // Pull Directory Roles observed checks
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
    // Sheet 1: Run Summary (key/value)
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

      if (shouldAttemptS3 && s3InitError) {
        ws.addRow({ field: "s3.status", value: "unavailable" });
        ws.addRow({ field: "s3.error", value: s3InitError });
      }

      if (usersSummary) {
        ws.addRow({ field: "users.total", value: usersSummary.totalUsers });
        ws.addRow({ field: "users.guest", value: usersSummary.guestUsers ?? "" });
      } else if (usersJsonError) {
        ws.addRow({ field: "users.sourceError", value: usersJsonError });
      }

      if (eapSummary) {
        ws.addRow({ field: "eap.totalEnterpriseApps", value: eapSummary.totalEnterpriseApps });
        ws.addRow({ field: "eap.riskyApps", value: eapSummary.riskyApps ?? "" });
      } else if (eapJsonError) {
        ws.addRow({ field: "eap.sourceError", value: eapJsonError });
      }

      if (caSummary) {
        ws.addRow({ field: "ca.totalPolicies", value: caSummary.totalPolicies ?? "" });
        ws.addRow({ field: "ca.permissionDenied", value: caSummary.permissionDenied ?? "" });
        ws.addRow({ field: "ca.truncated", value: caSummary.truncated ?? "" });
      } else if (caJsonError) {
        ws.addRow({ field: "ca.sourceError", value: caJsonError });
      }

      if (exoSummary) {
        ws.addRow({ field: "exo.totalMailboxes", value: exoSummary.totalMailboxes ?? "" });
        ws.addRow({ field: "exo.enabled", value: exoSummary.enabled ?? "" });
        ws.addRow({ field: "exo.disabled", value: exoSummary.disabled ?? "" });
        ws.addRow({ field: "exo.over50GB", value: exoSummary.over50GB ?? "" });
        ws.addRow({ field: "exo.archiveEnabled", value: exoSummary.archiveEnabled ?? "" });
        ws.addRow({ field: "exo.litigationHoldEnabled", value: exoSummary.litigationHoldEnabled ?? "" });
        ws.addRow({ field: "exo.truncated", value: exoSummary.truncated ?? "" });
      } else if (exoJsonError) {
        ws.addRow({ field: "exo.sourceError", value: exoJsonError });
      }

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

      applyKeyValueLook(ws);

      // Make derivedStatus stand out
      const dsRow = findRowByField(ws, "derivedStatus");
      if (dsRow) {
        const c = dsRow.getCell(2);
        const s = String(c.value ?? "");
        if (s === "succeeded") setCellPill(c, "ok");
        else if (s === "failed") setCellPill(c, "bad");
        else setCellPill(c, "warn");
      }
    }

    // -------------------------
    // Sheet 2: Artefacts (kept lightweight)
    // -------------------------
    {
      const ws = wb.addWorksheet(safeSheetName("Artefacts"));

      ws.columns = [
        { header: "type", key: "type", width: 14 },
        { header: "bucket", key: "bucket", width: 16 },
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

      applyBasicTableLook(ws);
    }

    // -------------------------
    // Sheet 3: Users (Summary)
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
          notes: `Unable to load ${usersArtefactName}: ${usersJsonError}`
        });
      } else {
        ws.addRow({ field: "generatedAt", value: usersJson?.generatedAt ?? "", notes: "" });
        ws.addRow({ field: "totalUsers", value: usersSummary?.totalUsers ?? "n/a", notes: "" });
        ws.addRow({ field: "enabledUsers", value: usersSummary?.enabledUsers ?? "n/a", notes: "" });
        ws.addRow({ field: "disabledUsers", value: usersSummary?.disabledUsers ?? "n/a", notes: "" });
        ws.addRow({ field: "memberUsers", value: usersSummary?.memberUsers ?? "n/a", notes: "" });
        ws.addRow({ field: "guestUsers", value: usersSummary?.guestUsers ?? "n/a", notes: "" });
      }

      applyKeyValueLook(ws);

      const statusRow = findRowByField(ws, "status");
      if (statusRow) {
        const v = String(statusRow.getCell(2).value ?? "");
        if (v === "error") setCellPill(statusRow.getCell(2), "bad");
        else if (v === "not-available") setCellPill(statusRow.getCell(2), "warn");
        else setCellPill(statusRow.getCell(2), "ok");
      }
    }

    // -------------------------
    // Sheet 4: Users (Full)  (FULL profile only)
    // -------------------------
    {
      const ws = wb.addWorksheet(safeSheetName("Users (Full)"));

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

        applyKeyValueLook(ws);

        const statusRow = findRowByField(ws, "status");
        if (statusRow) setCellPill(statusRow.getCell(2), "warn");
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

        applyKeyValueLook(ws);

        const statusRow = findRowByField(ws, "status");
        if (statusRow) setCellPill(statusRow.getCell(2), "warn");
      } else if (usersJsonError) {
        ws.columns = [
          { header: "field", key: "field", width: 38 },
          { header: "value", key: "value", width: 28 },
          { header: "notes", key: "notes", width: 80 }
        ];

        ws.addRow({
          field: "status",
          value: "error",
          notes: `Unable to load ${usersArtefactName}: ${usersJsonError}`
        });

        applyKeyValueLook(ws);

        const statusRow = findRowByField(ws, "status");
        if (statusRow) setCellPill(statusRow.getCell(2), "bad");
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

        applyBasicTableLook(ws);

        // Highlight accountEnabled false
        const enabledCol = 6; // accountEnabled
        for (let r = 2; r <= ws.rowCount; r++) {
          const cell = ws.getRow(r).getCell(enabledCol);
          const v = String(cell.value ?? "").toLowerCase();
          if (v === "true") setCellPill(cell, "ok");
          else if (v === "false") setCellPill(cell, "bad");
        }
      }
    }

    // -------------------------
    // Sheet 5: Enterprise Apps (Permissions)
    // -------------------------
    {
      const ws = wb.addWorksheet(safeSheetName("Enterprise Apps (Perms)"));

      ws.columns = [
        { header: "displayName", key: "displayName", width: 44 },
        { header: "appId", key: "appId", width: 36 },
        { header: "accountEnabled", key: "accountEnabled", width: 14 },
        { header: "applicationPermissions", key: "applicationPermissions", width: 24 },
        { header: "delegatedPermissions", key: "delegatedPermissions", width: 24 },
        { header: "riskyPermissions", key: "riskyPermissions", width: 16 },
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
          riskyPermissions: `Unable to load ${eapArtefactName}: ${eapJsonError}`,
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

      applyBasicTableLook(ws);

      // riskFlag pill
      const riskFlagCol = 7;
      for (let r = 2; r <= ws.rowCount; r++) {
        const cell = ws.getRow(r).getCell(riskFlagCol);
        const v = String(cell.value ?? "").toUpperCase();
        if (v === "YES") setCellPill(cell, "bad");
        else if (v === "NO") setCellPill(cell, "ok");
      }
    }

    // -------------------------
    // Sheet 6: Conditional Access (Summary + Top Policies)
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
          notes: `Unable to load ${caArtefactName}: ${caJsonError}`
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
          const headerRowIndex = ws.rowCount + 1;
          ws.addRow({ field: "displayName", value: "state", notes: "targetsAllUsers | hasMfaGrantControl | grantControlTypes | sessionControls" });

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

      applyKeyValueLook(ws);

      const statusRow = findRowByField(ws, "status");
      if (statusRow) {
        const v = String(statusRow.getCell(2).value ?? "");
        if (v === "ok") setCellPill(statusRow.getCell(2), "ok");
        else if (v === "truncated") setCellPill(statusRow.getCell(2), "warn");
        else if (v === "permission-denied" || v === "error") setCellPill(statusRow.getCell(2), "bad");
        else setCellPill(statusRow.getCell(2), "warn");
      }
    }

    // -------------------------
    // Sheet 7: Directory Roles (Observed)
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

      // -------------------------
// Sheet 8: Exchange Mailboxes (Summary)
// -------------------------
{
  const ws = wb.addWorksheet(safeSheetName("Exchange Mailboxes (Summary)"));

  ws.columns = [
    { header: "field", key: "field", width: 40 },
    { header: "value", key: "value", width: 24 },
    { header: "notes", key: "notes", width: 100 }
  ];

  if (!exoArtefact) {
    ws.addRow({
      field: "status",
      value: "not-available",
      notes: "Exchange mailboxes artefact was not present in this run."
    });
  } else if (exoJsonError) {
    ws.addRow({
      field: "status",
      value: "error",
      notes: `Unable to load Exchange mailboxes artefact: ${exoJsonError}`
    });
  } else if (!exoSummary) {
    ws.addRow({
      field: "status",
      value: "empty",
      notes: "Exchange mailboxes artefact was present but no summary could be derived."
    });
  } else {
    ws.addRow({ field: "generatedAt", value: exoJson?.generatedAt ?? "", notes: "" });
    ws.addRow({ field: "dataProfile", value: exoJson?.profile ?? "", notes: "" });

    ws.addRow({ field: "totalMailboxes", value: exoSummary.totalMailboxes, notes: "" });
    ws.addRow({ field: "enabledMailboxes", value: exoSummary.enabledMailboxes ?? "n/a", notes: "" });
    ws.addRow({ field: "disabledMailboxes", value: exoSummary.disabledMailboxes ?? "n/a", notes: "" });

    ws.addRow({
      field: "mailboxesOver50GB",
      value: exoSummary.mailboxesOver50GB ?? "n/a",
      notes: "Used for Exchange Online Plan 2 sizing conversations."
    });

    ws.addRow({
      field: "sharedMailboxes",
      value: exoSummary.sharedMailboxes ?? "n/a",
      notes: ""
    });

    ws.addRow({
      field: "roomAndEquipmentMailboxes",
      value: exoSummary.roomAndEquipmentMailboxes ?? "n/a",
      notes: ""
    });

    ws.addRow({
      field: "truncated",
      value: String(exoSummary.truncated ?? ""),
      notes: exoSummary.truncated ? "Mailbox enumeration was truncated (demo or guardrail limit)." : ""
    });
  }
}

// -------------------------
// Sheet 9: Exchange Mailboxes (Inventory)
// -------------------------
{
  const ws = wb.addWorksheet(safeSheetName("Exchange Mailboxes"));

  ws.columns = [
    { header: "displayName", key: "displayName", width: 32 },
    { header: "userPrincipalName", key: "userPrincipalName", width: 36 },
    { header: "mailboxType", key: "mailboxType", width: 18 },
    { header: "recipientTypeDetails", key: "recipientTypeDetails", width: 26 },
    { header: "totalItemSizeGB", key: "totalItemSizeGB", width: 18 },
    { header: "isOver50GB", key: "isOver50GB", width: 14 },
    { header: "accountEnabled", key: "accountEnabled", width: 14 }
  ];

  if (!exoArtefact) {
    ws.addRow({
      displayName: "status",
      userPrincipalName: "not-available",
      mailboxType: "",
      recipientTypeDetails: "",
      totalItemSizeGB: "",
      isOver50GB: "",
      accountEnabled: ""
    });
  } else if (exoJsonError) {
    ws.addRow({
      displayName: "status",
      userPrincipalName: "error",
      mailboxType: "",
      recipientTypeDetails: "",
      totalItemSizeGB: `Unable to load artefact: ${exoJsonError}`,
      isOver50GB: "",
      accountEnabled: ""
    });
  } else {
    const mailboxes: any[] = Array.isArray(exoJson?.mailboxes)
      ? exoJson!.mailboxes
      : [];

    if (!mailboxes.length) {
      ws.addRow({
        displayName: "status",
        userPrincipalName: "empty",
        mailboxType: "",
        recipientTypeDetails: "",
        totalItemSizeGB: "",
        isOver50GB: "",
        accountEnabled: "No mailboxes[] present in artefact."
      });
    } else {
      for (const m of mailboxes.slice(0, 500)) {
        const sizeGb =
          typeof m?.totalItemSizeGB === "number"
            ? m.totalItemSizeGB
            : null;

        ws.addRow({
          displayName: String(m?.displayName ?? ""),
          userPrincipalName: String(m?.userPrincipalName ?? ""),
          mailboxType: String(m?.mailboxType ?? ""),
          recipientTypeDetails: String(m?.recipientTypeDetails ?? ""),
          totalItemSizeGB: sizeGb ?? "",
          isOver50GB: sizeGb !== null ? (sizeGb > 50 ? "YES" : "NO") : "",
          accountEnabled:
            typeof m?.accountEnabled === "boolean"
              ? String(m.accountEnabled)
              : ""
        });
      }

      if (mailboxes.length > 500) {
        ws.addRow({
          displayName: "note",
          userPrincipalName: "",
          mailboxType: "",
          recipientTypeDetails: "",
          totalItemSizeGB: "",
          isOver50GB: "",
          accountEnabled: `Only first 500 mailboxes shown (total in artefact: ${mailboxes.length}).`
        });
      }
    }
  }
}


      applyKeyValueLook(ws);

      // Make completeness.isComplete (if present) stand out
      const completeRow = findRowByField(ws, "completeness.isComplete");
      if (completeRow) {
        const v = String(completeRow.getCell(2).value ?? "").toLowerCase();
        if (v === "true") setCellPill(completeRow.getCell(2), "ok");
        else if (v === "false") setCellPill(completeRow.getCell(2), "warn");
      }
    }

    const buf = await wb.xlsx.writeBuffer();
    const content = Buffer.isBuffer(buf) ? buf : Buffer.from(buf as any);

    return {
      id: "report.runSummary.xlsx",
      status: "ok",
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
          content
        }
      ]
    };
  }
};
