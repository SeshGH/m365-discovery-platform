import type { Collector } from "./types";
import { getGraphAccessToken, GraphHttpError } from "./graph";

type ObservedCheckInput = {
  checkId: string;
  data: unknown;
  references?: unknown; // stored as Json, usually [] or [{...}]
};

/**
 * Record observed checks in an idempotent way.
 * Since ObservedCheck has no unique constraint, we enforce idempotency by:
 * - deleting existing rows for the same (runId, jobId, checkId)
 * - inserting fresh rows
 */
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
      // observedAt uses default(now()) in schema
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

/**
 * Exchange Online – Mailbox Inventory (v1)
 *
 * Step B:
 * - Uses Microsoft Graph reports to fetch mailbox usage detail (CSV)
 * - Computes size buckets (safe-by-default)
 * - Adds an extra near-limit bucket: 40–50GB (append-only; does not change existing buckets)
 * - Does NOT yet implement mailbox type breakdown (shared/room/equipment) or enabled/disabled
 * - Emits observed checks + safe artefact
 * - No findings in v1
 */
export const exchangeMailboxesInventoryCollector: Collector = {
  id: "exchange.mailboxes.inventory",
  displayName: "Exchange Online – Mailbox Inventory",

  run: async (ctx) => {
    const dataProfile = normalizeDataProfile((ctx.run as any)?.dataProfile);

    // Completeness tracking (collector-level)
    let isComplete = false; // remains false until we can populate mailbox type/state distribution too
    let implemented = true; // implemented for the mailbox usage (size) slice
    let truncated = false;

    const permissionDenied: string[] = [];
    const slicesAttempted: string[] = [];
    const slicesCompleted: string[] = [];
    const notes: string[] = [];

    const period = "D7";
    slicesAttempted.push("mailboxUsageDetail");

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

    // These remain unknown in this step.
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

        // Extra bucket for licensing decisions: 40 <= size < 50 GB
        if (gb >= 40 && gb < 50) nearLimit40to50++;

        seen++;
      }

      totalMailboxes = seen;

      sizeBuckets.under1GB = bucketCounts.under1GB;
      sizeBuckets["1to10GB"] = bucketCounts["1to10GB"];
      sizeBuckets["10to50GB"] = bucketCounts["10to50GB"];
      sizeBuckets["40to50GB"] = nearLimit40to50;
      sizeBuckets.over50GB = bucketCounts.over50GB;

      // This slice represents user mailboxes only.
      byType.user = totalMailboxes;

      slicesCompleted.push("mailboxUsageDetail");

      notes.push(
        "Mailbox size buckets are derived from Microsoft Graph mailbox usage reports (CSV). This dataset may be delayed relative to real time."
      );

      isComplete = false;
    } catch (e: unknown) {
      if (e instanceof GraphHttpError && e.status === 403) {
        permissionDenied.push("microsoft.graph/reports:getMailboxUsageDetail");
        notes.push(
          "Graph returned 403 when requesting mailbox usage detail report. This is treated as a data completeness gap (missing app permissions/admin consent), not a hard failure."
        );
        implemented = false;
        isComplete = false;
      } else {
        throw e;
      }
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
