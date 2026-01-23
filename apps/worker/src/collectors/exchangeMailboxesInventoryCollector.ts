// apps/worker/src/collectors/exchangeMailboxesInventoryCollector.ts

import type { Collector } from "./types";
import { getGraphAccessToken, GraphHttpError } from "./graph";
import { runPwshJson } from "../lib/pwsh";

type ObservedCheckInput = {
  checkId: string;
  data: unknown;
  references?: unknown; // stored as Json, usually [] or [{...}]
};

async function recordObservedChecks(params: {
  prisma: any;
  runId: string;
  jobId?: string | null;
  collectorId: string;
  checks: ObservedCheckInput[];
}) {
  const { prisma, runId, jobId, collectorId, checks } = params;

  const checkIds = checks.map((c) => c.checkId);

  await prisma.observedCheck.deleteMany({
    where: {
      runId,
      jobId: jobId ?? null,
      checkId: { in: checkIds }
    }
  });

  if (checks.length === 0) return;

  await prisma.observedCheck.createMany({
    data: checks.map((c) => ({
      runId,
      jobId: jobId ?? null,
      checkId: c.checkId,
      collectorId,
      ruleId: null,
      data: (c.data ?? {}) as any,
      references: (c.references ?? []) as any
    }))
  });
}

function normalizeDataProfile(v: unknown): "safe" | "full" {
  return v === "full" ? "full" : "safe";
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) throw new Error(`[exchange.mailboxes.inventory] Missing env var: ${name}`);
  return v.trim();
}

/**
 * Very small CSV parser that supports:
 * - comma-separated values
 * - quoted fields with escaped quotes ("")
 *
 * We only need this for Graph reports CSV responses.
 */
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];

  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (ch === "\r") continue;

    if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      continue;
    }

    field += ch;
  }

  // flush last row if file doesn't end with newline
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  const out: Array<Record<string, string>> = [];

  for (let r = 1; r < rows.length; r++) {
    const values = rows[r];
    if (values.length === 0) continue;

    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      obj[key] = (values[c] ?? "").trim();
    }
    out.push(obj);
  }

  return out;
}

function toIntOrNull(v: string | undefined): number | null {
  if (!v) return null;
  const cleaned = v.replace(/,/g, "").trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function bytesToGb(bytes: number): number {
  return bytes / (1024 * 1024 * 1024);
}

function bucketForGb(gb: number): "under1GB" | "1to10GB" | "10to50GB" | "over50GB" {
  if (gb < 1) return "under1GB";
  if (gb < 10) return "1to10GB";
  if (gb < 50) return "10to50GB";
  return "over50GB";
}

async function graphGetText(token: string, url: string): Promise<string> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "text/csv"
    }
  });

  const text = await res.text().catch(() => "");

  if (!res.ok) {
    throw new GraphHttpError({
      message: `[collectors] Graph GET failed (${res.status}) url=${url}: ${text.slice(0, 2000)}`,
      status: res.status,
      url,
      requestId: res.headers.get("request-id") ?? res.headers.get("x-ms-request-id") ?? undefined,
      clientRequestId:
        res.headers.get("client-request-id") ??
        res.headers.get("x-ms-client-request-id") ??
        undefined,
      bodyText: text.slice(0, 2000)
    });
  }

  return text;
}

type ExoMailboxCounts = {
  totalMailboxes: number;
  byType: { user: number; shared: number; room: number; equipment: number };
  byState: { enabled: number; disabled: number };
};

function buildExoMailboxCountsScript(params: { appId: string; organization: string; certThumbprint: string }) {
  return `
$ErrorActionPreference = "Stop"

if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
  throw "ExchangeOnlineManagement module is not installed. Install-Module ExchangeOnlineManagement (CurrentUser) on the worker host."
}

Import-Module ExchangeOnlineManagement -ErrorAction Stop

try {
  Connect-ExchangeOnline -AppId "${params.appId}" -Organization "${params.organization}" -CertificateThumbprint "${params.certThumbprint}" -ShowBanner:$false | Out-Null

  $mbxs = Get-EXOMailbox -ResultSize Unlimited -Properties RecipientTypeDetails,AccountDisabled

  $user = 0
  $shared = 0
  $room = 0
  $equipment = 0

  $enabled = 0
  $disabled = 0

  foreach ($m in $mbxs) {
    $rtd = [string]$m.RecipientTypeDetails

    switch ($rtd) {
      "UserMailbox" { $user++ }
      "SharedMailbox" { $shared++ }
      "RoomMailbox" { $room++ }
      "EquipmentMailbox" { $equipment++ }
      default { }
    }

    if ($m.PSObject.Properties.Name -contains "AccountDisabled" -and $m.AccountDisabled -eq $true) {
      $disabled++
    } else {
      $enabled++
    }
  }

  $out = [pscustomobject]@{
    totalMailboxes = [int]$mbxs.Count
    byType = [pscustomobject]@{
      user = [int]$user
      shared = [int]$shared
      room = [int]$room
      equipment = [int]$equipment
    }
    byState = [pscustomobject]@{
      enabled = [int]$enabled
      disabled = [int]$disabled
    }
  }

  $out | ConvertTo-Json -Depth 6 -Compress
}
finally {
  try { Disconnect-ExchangeOnline -Confirm:$false | Out-Null } catch { }
}
`.trim();
}

type ExoMailboxFeaturesCounts = {
  archive: { enabled: number; disabledOrNone: number; unknown: number };
  litigationHold: { enabled: number; disabled: number; unknown: number };
};

function buildExoMailboxFeaturesCountsScript(params: { appId: string; organization: string; certThumbprint: string }) {
  return `
$ErrorActionPreference = "Stop"

if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
  throw "ExchangeOnlineManagement module is not installed. Install-Module ExchangeOnlineManagement (CurrentUser) on the worker host."
}

Import-Module ExchangeOnlineManagement -ErrorAction Stop

try {
  Connect-ExchangeOnline -AppId "${params.appId}" -Organization "${params.organization}" -CertificateThumbprint "${params.certThumbprint}" -ShowBanner:$false | Out-Null

  $mbxs = Get-EXOMailbox -ResultSize Unlimited -Properties ArchiveStatus,LitigationHoldEnabled

  $archiveEnabled = 0
  $archiveDisabledOrNone = 0
  $archiveUnknown = 0

  $lhEnabled = 0
  $lhDisabled = 0
  $lhUnknown = 0

  foreach ($m in $mbxs) {
    if ($m.PSObject.Properties.Name -contains "ArchiveStatus") {
      $a = [string]$m.ArchiveStatus
      if ([string]::IsNullOrWhiteSpace($a)) {
        $archiveUnknown++
      } elseif ($a -eq "None") {
        $archiveDisabledOrNone++
      } else {
        $archiveEnabled++
      }
    } else {
      $archiveUnknown++
    }

    if ($m.PSObject.Properties.Name -contains "LitigationHoldEnabled") {
      if ($m.LitigationHoldEnabled -eq $true) {
        $lhEnabled++
      } elseif ($m.LitigationHoldEnabled -eq $false) {
        $lhDisabled++
      } else {
        $lhUnknown++
      }
    } else {
      $lhUnknown++
    }
  }

  $out = [pscustomobject]@{
    archive = [pscustomobject]@{
      enabled = [int]$archiveEnabled
      disabledOrNone = [int]$archiveDisabledOrNone
      unknown = [int]$archiveUnknown
    }
    litigationHold = [pscustomobject]@{
      enabled = [int]$lhEnabled
      disabled = [int]$lhDisabled
      unknown = [int]$lhUnknown
    }
  }

  $out | ConvertTo-Json -Depth 6 -Compress
}
finally {
  try { Disconnect-ExchangeOnline -Confirm:$false | Out-Null } catch { }
}
`.trim();
}

type MailboxUsageDetailFullRow = {
  // NOTE: These fields can be PII. Only include in FULL profile artefact.
  userPrincipalName?: string;
  displayName?: string;

  storageUsedBytes?: number | null;
  storageUsedGb?: number | null;

  isDeleted?: boolean | null;
  reportPeriod?: string; // e.g. D7
};

// Explicit allowlist (stable contract for FULL-only mailboxUsageDetail rows)
const GRAPH_MAILBOX_USAGE_HEADERS = {
  upn: "User Principal Name",
  displayName: "Display Name",
  isDeleted: "Is Deleted",
  storageUsedBytes: "Storage Used (Byte)"
} as const;

function mapMailboxUsageDetailFullRow(params: {
  record: Record<string, string>;
  period: string;
}): MailboxUsageDetailFullRow {
  const { record, period } = params;

  const bytes = toIntOrNull(record[GRAPH_MAILBOX_USAGE_HEADERS.storageUsedBytes]);
  const gb = bytes === null ? null : Math.round(bytesToGb(bytes) * 100) / 100;

  return {
    userPrincipalName: record[GRAPH_MAILBOX_USAGE_HEADERS.upn] || undefined,
    displayName: record[GRAPH_MAILBOX_USAGE_HEADERS.displayName] || undefined,
    storageUsedBytes: bytes,
    storageUsedGb: gb,
    isDeleted: false,
    reportPeriod: period
  };
}

function missingHeadersInRecords(
  records: Array<Record<string, string>>,
  headers: string[]
): string[] {
  if (records.length === 0) return headers; // nothing to inspect; treat as missing
  const sample = records[0];
  return headers.filter((h) => !(h in sample));
}

/**
 * Exchange Online – Mailbox Inventory
 *
 * Tier-2 (EXO, best-effort):
 * - Counts only (no PII): archive mailbox presence + litigation hold enabled
 * - Failure must not change overall completeness
 */
export const exchangeMailboxesInventoryCollector: Collector = {
  id: "exchange.mailboxes.inventory",
  displayName: "Exchange Online – Mailbox Inventory",

  run: async (ctx) => {
    const dataProfile = normalizeDataProfile((ctx.run as any)?.dataProfile);
    const includeSensitive = dataProfile === "full";

    let isComplete = true;
    let truncated = false;
    let implemented = true;

    const permissionDenied: string[] = [];
    const slicesAttempted: string[] = [];
    const slicesCompleted: string[] = [];
    const notes: string[] = [];

    let totalMailboxes: number | null = null;

    const sizeBuckets: Record<
      "under1GB" | "1to10GB" | "10to50GB" | "40to50GB" | "over50GB",
      number | null
    > = {
      under1GB: null,
      "1to10GB": null,
      "10to50GB": null,
      "40to50GB": null,
      over50GB: null
    };

    const byType = {
      user: null as number | null,
      shared: null as number | null,
      room: null as number | null,
      equipment: null as number | null
    };

    const byState = {
      enabled: null as number | null,
      disabled: null as number | null
    };

    const mailboxFeatures: {
      archive: { enabled: number | null; disabledOrNone: number | null; unknown: number | null };
      litigationHold: { enabled: number | null; disabled: number | null; unknown: number | null };
    } = {
      archive: { enabled: null, disabledOrNone: null, unknown: null },
      litigationHold: { enabled: null, disabled: null, unknown: null }
    };

    let mailboxUsageDetailFull: MailboxUsageDetailFullRow[] | null = null;
    const MAX_FULL_DETAIL_ROWS = Number(process.env.EXO_MAILBOXES_MAX_DETAIL_ROWS ?? 2000);

    const appId = requireEnv("EXO_APP_ID");
    const organization =
      process.env.EXO_ORGANIZATION?.trim() ||
      (typeof ctx.tenant?.primaryDomain === "string" && ctx.tenant.primaryDomain.trim().length > 0
        ? ctx.tenant.primaryDomain.trim()
        : null);

    if (!organization) {
      throw new Error(
        "[exchange.mailboxes.inventory] Missing EXO_ORGANIZATION and tenant.primaryDomain; cannot connect to Exchange Online"
      );
    }

    const certThumbprint = requireEnv("EXO_CERT_THUMBPRINT");

    // -------------------------
    // Slice: EXO mailbox inventory (type + state)
    // -------------------------
    slicesAttempted.push("mailboxes");

    {
      const script = buildExoMailboxCountsScript({ appId, organization, certThumbprint });

      const res = await runPwshJson<ExoMailboxCounts>({
        script,
        timeoutMs: 240_000
      });

      if (!res.ok) {
        const stderr = (res.details.stderr ?? "").toLowerCase();

        if (
          stderr.includes("unauthorized") ||
          stderr.includes("forbidden") ||
          stderr.includes("access denied") ||
          stderr.includes("is not recognized") ||
          stderr.includes("connect-exchangeonline")
        ) {
          isComplete = false;
          permissionDenied.push("exo:connect");
          permissionDenied.push("exo:mailboxes:list");
          notes.push(
            "Exchange Online app-only connection or mailbox enumeration failed. This is treated as a data completeness gap (missing permissions/role assignment/certificate trust), not a hard failure."
          );
          implemented = false;
        } else {
          throw new Error(
            `[exchange.mailboxes.inventory] EXO pwsh failed: ${res.error}\nstdout=${res.details.stdout}\nstderr=${res.details.stderr}`
          );
        }
      } else {
        const v = res.value;

        totalMailboxes = v.totalMailboxes;
        byType.user = v.byType.user;
        byType.shared = v.byType.shared;
        byType.room = v.byType.room;
        byType.equipment = v.byType.equipment;

        byState.enabled = v.byState.enabled;
        byState.disabled = v.byState.disabled;

        slicesCompleted.push("mailboxes");
      }
    }

    // -------------------------
    // Slice (Tier-2, best-effort): EXO mailbox features — counts only
    // -------------------------
    slicesAttempted.push("mailboxFeatures");

    {
      const script = buildExoMailboxFeaturesCountsScript({ appId, organization, certThumbprint });

      const res = await runPwshJson<ExoMailboxFeaturesCounts>({
        script,
        timeoutMs: 240_000
      });

      if (!res.ok) {
        const stderr = (res.details.stderr ?? "").toLowerCase();

        if (
          stderr.includes("unauthorized") ||
          stderr.includes("forbidden") ||
          stderr.includes("access denied") ||
          stderr.includes("is not recognized") ||
          stderr.includes("connect-exchangeonline")
        ) {
          permissionDenied.push("exo:mailboxes:features");
          notes.push(
            "Tier-2 EXO mailbox feature counts (archive/litigation hold) could not be collected. This is best-effort and does not affect overall completeness."
          );
        } else {
          throw new Error(
            `[exchange.mailboxes.inventory] EXO pwsh failed (tier2 mailboxFeatures): ${res.error}\nstdout=${res.details.stdout}\nstderr=${res.details.stderr}`
          );
        }
      } else {
        mailboxFeatures.archive.enabled = res.value.archive.enabled;
        mailboxFeatures.archive.disabledOrNone = res.value.archive.disabledOrNone;
        mailboxFeatures.archive.unknown = res.value.archive.unknown;

        mailboxFeatures.litigationHold.enabled = res.value.litigationHold.enabled;
        mailboxFeatures.litigationHold.disabled = res.value.litigationHold.disabled;
        mailboxFeatures.litigationHold.unknown = res.value.litigationHold.unknown;

        slicesCompleted.push("mailboxFeatures");
      }
    }

    // -------------------------
    // Slice: Graph mailbox usage detail (size buckets)
    // -------------------------
    const period = "D7";
    slicesAttempted.push("mailboxUsageDetail");

    try {
      const tenantId = ctx.tenant.tenantGuid;
      const token = await getGraphAccessToken({ tenantId });

      const url = `https://graph.microsoft.com/v1.0/reports/getMailboxUsageDetail(period='${period}')`;
      const csv = await graphGetText(token, url);

      const rows = parseCsv(csv);

      // Header sanity: warn if Graph report schema changes (counts-only note)
      const requiredHeaders = [
        GRAPH_MAILBOX_USAGE_HEADERS.upn,
        GRAPH_MAILBOX_USAGE_HEADERS.displayName,
        GRAPH_MAILBOX_USAGE_HEADERS.isDeleted,
        GRAPH_MAILBOX_USAGE_HEADERS.storageUsedBytes
      ];
      const missing = missingHeadersInRecords(rows, requiredHeaders);
      if (missing.length > 0) {
        notes.push(
          `Graph mailbox usage report CSV is missing expected header(s): ${missing.join(
            ", "
          )}. Collector will proceed best-effort using available columns.`
        );
      }

      const bucketCounts: Record<"under1GB" | "1to10GB" | "10to50GB" | "over50GB", number> = {
        under1GB: 0,
        "1to10GB": 0,
        "10to50GB": 0,
        over50GB: 0
      };

      let nearLimit40to50 = 0;
      let seen = 0;

      const fullRows: MailboxUsageDetailFullRow[] = [];

      for (const r of rows) {
        const isDeletedRaw = (r[GRAPH_MAILBOX_USAGE_HEADERS.isDeleted] ?? "").toLowerCase();
        const isDeleted = isDeletedRaw === "true";
        if (isDeleted) continue;

        const bytes = toIntOrNull(r[GRAPH_MAILBOX_USAGE_HEADERS.storageUsedBytes]);
        if (bytes === null) continue;

        const gb = bytesToGb(bytes);
        bucketCounts[bucketForGb(gb)]++;

        if (gb >= 40 && gb < 50) nearLimit40to50++;

        if (includeSensitive && fullRows.length < MAX_FULL_DETAIL_ROWS) {
          // FULL allowlist enforced by mapper (no accidental column leakage)
          fullRows.push(
            mapMailboxUsageDetailFullRow({
              record: r,
              period
            })
          );
        }

        seen++;
      }

      if (totalMailboxes === null) totalMailboxes = seen;

      sizeBuckets.under1GB = bucketCounts.under1GB;
      sizeBuckets["1to10GB"] = bucketCounts["1to10GB"];
      sizeBuckets["10to50GB"] = bucketCounts["10to50GB"];
      sizeBuckets["40to50GB"] = nearLimit40to50;
      sizeBuckets.over50GB = bucketCounts.over50GB;

      slicesCompleted.push("mailboxUsageDetail");

      notes.push(
        "Mailbox size buckets are derived from Microsoft Graph mailbox usage reports (CSV). This dataset may be delayed relative to real time."
      );

      if (includeSensitive) {
        mailboxUsageDetailFull = fullRows;

        if (fullRows.length >= MAX_FULL_DETAIL_ROWS) {
          truncated = true;
          notes.push(
            `Full mailbox usage detail export capped at ${MAX_FULL_DETAIL_ROWS} rows (EXO_MAILBOXES_MAX_DETAIL_ROWS).`
          );
        }
      }
    } catch (e: unknown) {
      if (e instanceof GraphHttpError && e.status === 403) {
        isComplete = false;
        permissionDenied.push("microsoft.graph/reports:getMailboxUsageDetail");
        notes.push(
          "Graph returned 403 when requesting mailbox usage detail report. This is treated as a data completeness gap (missing app permissions/admin consent), not a hard failure."
        );
      } else {
        throw e;
      }
    }

    // Completeness gating excludes Tier-2 mailboxFeatures (Option A)
    const requiredSlices = ["mailboxes", "mailboxUsageDetail"];
    for (const s of requiredSlices) {
      if (!slicesCompleted.includes(s)) isComplete = false;
    }

    const fullExported = includeSensitive;

    const summary = {
      totalMailboxes,
      byType,
      byState,
      sizeBuckets
    };

    await recordObservedChecks({
      prisma: ctx.prisma,
      runId: ctx.run.id,
      jobId: ctx.job?.id ?? null,
      collectorId: exchangeMailboxesInventoryCollector.id,
      checks: [
        {
          checkId: "EXO_MAILBOXES_OBS_001",
          data: {
            ...summary,
            dataProfile,
            fullExported,
            truncated
          },
          references: []
        },
        {
          checkId: "EXO_MAILBOXES_OBS_002",
          data: {
            isComplete,
            truncated,
            permissionDenied,
            slicesAttempted,
            slicesCompleted,
            notes,
            dataProfile
          },
          references: []
        },
        {
          checkId: "EXO_MAILBOXES_OBS_003",
          data: {
            mailboxFeatures,
            dataProfile
          },
          references: []
        }
      ]
    });

    const generatedAt = new Date().toISOString();

    const safeArtefact = JSON.stringify(
      {
        generatedAt,
        profile: "safe",
        completeness: {
          isComplete,
          truncated,
          permissionDenied,
          slicesAttempted,
          slicesCompleted,
          notes,
          implemented
        },
        summary: {
          ...summary,
          dataProfile,
          fullExported
        },
        mailboxFeatures
      },
      null,
      2
    );

    const artefacts: Array<{
      type: "json";
      filename: string;
      contentType: "application/json";
      content: string;
    }> = [
      {
        type: "json" as const,
        filename: "exchange-mailboxes-inventory.safe.json",
        contentType: "application/json",
        content: safeArtefact
      }
    ];

    if (includeSensitive) {
      const fullArtefact = JSON.stringify(
        {
          generatedAt,
          profile: "full",
          completeness: {
            isComplete,
            truncated,
            permissionDenied,
            slicesAttempted,
            slicesCompleted,
            notes,
            implemented
          },
          summary: {
            ...summary,
            dataProfile,
            fullExported
          },
          mailboxFeatures,
          mailboxUsageDetail: mailboxUsageDetailFull ?? []
        },
        null,
        2
      );

      artefacts.push({
        type: "json" as const,
        filename: "exchange-mailboxes-inventory.full.json",
        contentType: "application/json",
        content: fullArtefact
      });
    }

    return {
      id: "exchange.mailboxes.inventory",
      status: "ok",
      summary: {
        dataProfile,
        implemented,
        isComplete,
        truncated,
        fullExported,
        totalMailboxes,
        nearLimit40to50GB: sizeBuckets["40to50GB"],
        archiveEnabledCount: mailboxFeatures.archive.enabled,
        litigationHoldEnabledCount: mailboxFeatures.litigationHold.enabled
      },
      artefacts
    };
  }
};
