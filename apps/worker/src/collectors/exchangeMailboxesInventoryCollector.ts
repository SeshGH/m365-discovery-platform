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
  // IMPORTANT:
  // - Never output mailbox identifiers.
  // - Return counts only as JSON.
  // - Force errors to become a non-zero exit, with message to stderr.
  //
  // Note:
  // RecipientTypeDetails values we count:
  // - UserMailbox
  // - SharedMailbox
  // - RoomMailbox
  // - EquipmentMailbox
  return `
$ErrorActionPreference = "Stop"

# Ensure module is available
if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
  throw "ExchangeOnlineManagement module is not installed. Install-Module ExchangeOnlineManagement (CurrentUser) on the worker host."
}

Import-Module ExchangeOnlineManagement -ErrorAction Stop

try {
  Connect-ExchangeOnline -AppId "${params.appId}" -Organization "${params.organization}" -CertificateThumbprint "${params.certThumbprint}" -ShowBanner:$false | Out-Null

  # Inventory: no PII output, counts only
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

    # AccountDisabled is available for many mailbox objects; treat missing as $null => enabled (best effort)
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

/**
 * Exchange Online – Mailbox Inventory (v1)
 *
 * Step A (EXO-by-design):
 * - Uses Exchange Online PowerShell (app-only cert auth) to compute mailbox type + state distribution
 * - Still uses Graph reports for size buckets (for now)
 * - Emits observed checks + safe artefact
 * - No findings in v1
 */
export const exchangeMailboxesInventoryCollector: Collector = {
  id: "exchange.mailboxes.inventory",
  displayName: "Exchange Online – Mailbox Inventory",

  run: async (ctx) => {
    const dataProfile = normalizeDataProfile((ctx.run as any)?.dataProfile);

    let isComplete = true;
    let truncated = false;
    let implemented = true;

    const permissionDenied: string[] = [];
    const slicesAttempted: string[] = [];
    const slicesCompleted: string[] = [];
    const notes: string[] = [];

    // Start with nulls, fill as slices succeed
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

    // -------------------------
    // Slice: EXO mailbox inventory (type + state)
    // -------------------------
    slicesAttempted.push("mailboxes");

    try {
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

      const script = buildExoMailboxCountsScript({
        appId,
        organization,
        certThumbprint
      });

      const res = await runPwshJson<ExoMailboxCounts>({
        script,
        timeoutMs: 240_000
      });

      if (!res.ok) {
        // EXO failures are treated as completeness gaps only if they look like auth/permission problems.
        // Otherwise, treat as hard failure (throw) so job status becomes error and we can investigate.
        const stderr = (res.details.stderr ?? "").toLowerCase();

        if (
          stderr.includes("unauthorized") ||
          stderr.includes("forbidden") ||
          stderr.includes("access denied") ||
          stderr.includes("is not recognized") || // cmdlet missing due to module not loaded/role issues
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
    } catch (e: unknown) {
      // Missing env vars or other worker misconfig should fail the job.
      throw e;
    }

    // -------------------------
    // Slice: Graph mailbox usage detail (size buckets) — keep for now
    // -------------------------
    const period = "D7";
    slicesAttempted.push("mailboxUsageDetail");

    try {
      const tenantId = ctx.tenant.tenantGuid;
      const token = await getGraphAccessToken({ tenantId });

      const url = `https://graph.microsoft.com/v1.0/reports/getMailboxUsageDetail(period='${period}')`;
      const csv = await graphGetText(token, url);

      const rows = parseCsv(csv);

      const bucketCounts: Record<"under1GB" | "1to10GB" | "10to50GB" | "over50GB", number> = {
        under1GB: 0,
        "1to10GB": 0,
        "10to50GB": 0,
        over50GB: 0
      };

      let nearLimit40to50 = 0;
      let seen = 0;

      for (const r of rows) {
        const isDeleted = (r["Is Deleted"] ?? "").toLowerCase();
        if (isDeleted === "true") continue;

        const bytes = toIntOrNull(r["Storage Used (Byte)"]);
        if (bytes === null) continue;

        const gb = bytesToGb(bytes);
        bucketCounts[bucketForGb(gb)]++;

        if (gb >= 40 && gb < 50) nearLimit40to50++;

        seen++;
      }

      // Keep totalMailboxes as EXO-sourced if available; otherwise fall back to Graph-derived count.
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

    // Completeness: require both slices for “complete”
    const requiredSlices = ["mailboxes", "mailboxUsageDetail"];
    for (const s of requiredSlices) {
      if (!slicesCompleted.includes(s)) isComplete = false;
    }

    const fullExported = false;

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
        }
      ]
    });

    const safeArtefact = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
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
        }
      },
      null,
      2
    );

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
        nearLimit40to50GB: sizeBuckets["40to50GB"]
      },
      artefacts: [
        {
          type: "json" as const,
          filename: "exchange-mailboxes-inventory.safe.json",
          contentType: "application/json",
          content: safeArtefact
        }
      ]
    };
  }
};
