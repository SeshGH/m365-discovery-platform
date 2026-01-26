// apps/worker/src/collectors/exchangeMailboxesInventoryCollector.ts

import type { Collector } from "./types";
import { getGraphAccessToken, GraphHttpError } from "./graph";

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

function missingHeadersInRecords(records: Array<Record<string, string>>, headers: string[]): string[] {
  if (records.length === 0) return headers; // nothing to inspect; treat as missing
  const sample = records[0];
  return headers.filter((h) => !(h in sample));
}

/**
 * Exchange Online – Mailbox Inventory (Graph-only)
 *
 * Goal (A): mailbox sizing buckets for licensing conversations (e.g. >50GB).
 * This version is container/Linux friendly: no EXO PowerShell dependency.
 *
 * Notes:
 * - byType/byState and mailboxFeatures are not collected in Graph-only mode (kept as nulls to preserve contract surface).
 * - Completeness is gated on Graph mailboxUsageDetail only.
 */
export const exchangeMailboxesInventoryCollector: Collector = {
  id: "exchange.mailboxes.inventory",
  displayName: "Exchange Online – Mailbox Inventory",

  run: async (ctx) => {
    const dataProfile = normalizeDataProfile((ctx.run as any)?.dataProfile);
    const includeSensitive = dataProfile === "full";

    let isComplete = true;
    let truncated = false;

    // Collector is implemented; permission gaps are reported via completeness fields.
    const implemented = true;

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

    // Not collected in Graph-only mode (kept for stable output shape)
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

      // Header sanity: warn if Graph report schema changes
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
          fullRows.push(
            mapMailboxUsageDetailFullRow({
              record: r,
              period
            })
          );
        }

        seen++;
      }

      totalMailboxes = seen;

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

      // Make it explicit that EXO PowerShell-only data isn't present in this mode
      notes.push(
        "Graph-only mode: mailbox type/state and archive/litigation hold counts are not collected (null). These require an optional Windows/EXO PowerShell runner."
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

    // Completeness gating for Option A (sizing): Graph mailboxUsageDetail only
    if (!slicesCompleted.includes("mailboxUsageDetail")) isComplete = false;

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
        // Not collected in Graph-only mode:
        archiveEnabledCount: mailboxFeatures.archive.enabled,
        litigationHoldEnabledCount: mailboxFeatures.litigationHold.enabled
      },
      artefacts
    };
  }
};
