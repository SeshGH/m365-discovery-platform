// apps/worker/src/collectors/exchangeMailboxesInventoryCollector.ts

import type { Collector } from "./types";
import { getGraphAccessToken, GraphHttpError } from "./graph";

/* ---------- helpers ---------- */

type ObservedCheckInput = {
  checkId: string;
  data: unknown;
  references?: unknown;
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
    where: { runId, jobId: jobId ?? null, checkId: { in: checkIds } }
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

/* ---------- CSV parsing + utils ---------- */

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
      bodyText: text.slice(0, 2000)
    });
  }

  return text;
}

/* ---------- collector ---------- */

export const exchangeMailboxesInventoryCollector: Collector = {
  id: "exchange.mailboxes.inventory",
  displayName: "Exchange Online – Mailbox Inventory",

  async run(ctx) {
    const dataProfile = normalizeDataProfile((ctx.run as any)?.dataProfile);

    let isComplete = true;
    let truncated = false;

    const permissionDenied: string[] = [];
    const slicesAttempted: string[] = [];
    const slicesCompleted: string[] = [];
    const notes: string[] = [];

    let totalMailboxes: number | null = null;

    const sizeBuckets = {
      under1GB: null as number | null,
      "1to10GB": null as number | null,
      "10to50GB": null as number | null,
      "40to50GB": null as number | null,
      over50GB: null as number | null
    };

    slicesAttempted.push("mailboxUsageDetail");

    try {
      const token = await getGraphAccessToken({ tenantId: ctx.tenant.tenantGuid });

      const periods = ["D7", "D30"];
      let csv: string | null = null;
      let usedPeriod: string | null = null;

      for (const p of periods) {
        try {
          csv = await graphGetText(
            token,
            `https://graph.microsoft.com/v1.0/reports/getMailboxUsageDetail(period='${p}')`
          );
          usedPeriod = p;
          break;
        } catch (e) {
          if (e instanceof GraphHttpError && (e.status === 400 || e.status === 404)) {
            continue;
          }
          throw e;
        }
      }

      if (!csv || !usedPeriod) {
        isComplete = false;
        notes.push(
          "Microsoft Graph mailbox usage detail report is unavailable for this tenant (400/404 invalid parameters or no data). This often occurs when Exchange reporting has not been generated yet, the tenant has no mailboxes, or reporting is still initializing."
        );
      } else {
        const rows = parseCsv(csv);

        let seen = 0;
        let nearLimit40to50 = 0;
        const bucketCounts = { under1GB: 0, "1to10GB": 0, "10to50GB": 0, over50GB: 0 };

        for (const r of rows) {
          const bytes = toIntOrNull(r["Storage Used (Byte)"]);
          if (bytes === null) continue;

          const gb = bytesToGb(bytes);
          bucketCounts[bucketForGb(gb)]++;
          if (gb >= 40 && gb < 50) nearLimit40to50++;
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
          `Mailbox size buckets derived from Microsoft Graph mailbox usage report (${usedPeriod}).`
        );
      }
    } catch (e) {
      if (e instanceof GraphHttpError && e.status === 403) {
        isComplete = false;
        permissionDenied.push("microsoft.graph/reports:getMailboxUsageDetail");
        notes.push("Missing Graph Reports permissions (403).");
      } else {
        isComplete = false;
        truncated = true;
        notes.push("Mailbox usage detail collection failed unexpectedly.");
      }
    }

    /* ---------- Derived licensing signal ---------- */

    const nearLimit = sizeBuckets["40to50GB"] ?? 0;
    const overLimit = sizeBuckets.over50GB ?? 0;

    let licensingSignal: "none" | "advisory" | "pressure" = "none";
    if (overLimit > 0) licensingSignal = "pressure";
    else if (nearLimit > 0) licensingSignal = "advisory";

    const confidence =
      isComplete === false
        ? "low"
        : "medium"; // Graph-only is never high confidence

    /* ---------- persist observed checks ---------- */

    await recordObservedChecks({
      prisma: ctx.prisma,
      runId: ctx.run.id,
      jobId: ctx.job?.id ?? null,
      collectorId: exchangeMailboxesInventoryCollector.id,
      checks: [
        {
          checkId: "EXO_MAILBOXES_OBS_001",
          data: {
            totalMailboxes,
            sizeBuckets,
            dataProfile,
            isComplete,
            truncated,
            permissionDenied,
            slicesAttempted,
            slicesCompleted,
            notes
          }
        },
        {
          checkId: "EXO_MAILBOXES_OBS_010",
          data: {
            signal: licensingSignal,
            nearLimit40to50GB: nearLimit,
            over50GB: overLimit,
            totalMailboxes,
            confidence,
            notes: [
              "Mailboxes approaching or exceeding 50GB detected.",
              "Signal is derived from Microsoft Graph mailbox usage reports.",
              "Graph data may lag real-time usage; treat as advisory unless validated via EXO PowerShell."
            ].filter(Boolean)
          }
        }
      ]
    });
    
return {
  id: exchangeMailboxesInventoryCollector.id,
  status: "ok",
  summary: {
    totalMailboxes,
    nearLimit40to50GB: nearLimit,
    over50GB: overLimit,
    licensingSignal,
    confidence,
    isComplete
  },
  artefacts: []
};

  }
};
