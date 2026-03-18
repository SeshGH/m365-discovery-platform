// apps/worker/src/collectors/sharepointSitesInventoryCollector.ts

import type { Collector } from "./types";
import { getGraphAccessToken, graphGetAllPages, GraphHttpError } from "./graph";

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

function isGraph403(e: unknown): boolean {
  return e instanceof GraphHttpError && e.status === 403;
}

/* ---------- CSV parsing (reused pattern from EXO collector) ---------- */

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

/* ---------- Graph models (minimal) ---------- */

type GraphSite = {
  id: string;
  displayName?: string | null;
  webUrl?: string | null;
  isPersonalSite?: boolean | null;
  root?: unknown | null;
};

/* ---------- collector ---------- */

export const sharepointSitesInventoryCollector: Collector = {
  id: "sharepoint.sites.inventory",
  displayName: "SharePoint Online – Sites Inventory",

  async run(ctx) {
    const dataProfile = normalizeDataProfile((ctx.run as any)?.dataProfile);
    const includeSensitive = dataProfile === "full";

    // Completeness tracking
    let isComplete = true;
    let truncated = false;

    const permissionDenied: string[] = [];
    const slicesAttempted: string[] = [];
    const slicesCompleted: string[] = [];
    const notes: string[] = [];

    // Site inventory (safe counts always attempt first)
    slicesAttempted.push("sites:list");

    let sites: GraphSite[] = [];
    try {
      const token = await getGraphAccessToken({ tenantId: ctx.tenant.tenantGuid });

      // NOTE: search=* is the broad tenant-wide discovery pattern for sites.
      // We keep fields minimal; per-site details are only exported under full profile.
      sites = await graphGetAllPages<GraphSite>(
        token,
        "https://graph.microsoft.com/v1.0/sites?search=*&$select=id,displayName,webUrl,isPersonalSite,root"
      );

      slicesCompleted.push("sites:list");
    } catch (e: unknown) {
      if (isGraph403(e)) {
        isComplete = false;
        permissionDenied.push("microsoft.graph/sites:list");
        notes.push(
          "Graph returned 403 when listing SharePoint sites. This is treated as a data completeness gap (missing Sites.Read.All app permission/admin consent), not a hard failure."
        );
        sites = [];
      } else {
        isComplete = false;
        notes.push("SharePoint site enumeration failed unexpectedly.");
        sites = [];
      }
    }

    // Counts (null when truly unknown; otherwise numeric)
    const sitesTotal: number | null = isComplete || sites.length > 0 ? sites.length : null;
    const sitesRoot: number | null =
      sitesTotal === null ? null : sites.filter((s) => s.root !== undefined && s.root !== null).length;
    const sitesNonRoot: number | null =
      sitesTotal === null || sitesRoot === null ? null : sitesTotal - sitesRoot;

    // Personal sites (OneDrive) best-effort based on isPersonalSite flag
    const personalOneDrive: number | null =
      sitesTotal === null ? null : sites.filter((s) => s.isPersonalSite === true).length;

    // Storage usage summary (Graph reports) – optional
    slicesAttempted.push("reports:getSharePointSiteUsageDetail");

    let storageIsComplete = true;
    let storageTruncated = false;
    const storagePermissionDenied: string[] = [];
    const storageNotes: string[] = [];
    let periodUsed: string | null = null;

    let sitesInReport: number | null = null;
    let storageUsedBytesTotal: number | null = null;
    let storageUsedGbTotal: number | null = null;

    try {
      const token = await getGraphAccessToken({ tenantId: ctx.tenant.tenantGuid });

      const periods = ["D7", "D30"];
      let csv: string | null = null;

      for (const p of periods) {
        try {
          csv = await graphGetText(
            token,
            `https://graph.microsoft.com/v1.0/reports/getSharePointSiteUsageDetail(period='${p}')`
          );
          periodUsed = p;
          break;
        } catch (e) {
          if (e instanceof GraphHttpError && (e.status === 400 || e.status === 404)) {
            continue;
          }
          throw e;
        }
      }

      if (!csv || !periodUsed) {
        storageIsComplete = false;
        storageNotes.push(
          "Microsoft Graph SharePoint site usage detail report is unavailable for this tenant (400/404 invalid parameters or no data). This can occur when reporting has not been generated yet or is still initializing."
        );
      } else {
        const rows = parseCsv(csv);

        let seen = 0;
        let totalBytes = 0;

        // Column names in reports can vary slightly; we attempt a couple of likely candidates.
        const colBytesCandidates = ["Storage Used (Byte)", "Storage Used (Bytes)"];

        for (const r of rows) {
          let bytes: number | null = null;
          for (const col of colBytesCandidates) {
            const v = toIntOrNull(r[col]);
            if (typeof v === "number") {
              bytes = v;
              break;
            }
          }

          if (bytes === null) continue;

          totalBytes += bytes;
          seen++;
        }

        sitesInReport = seen;
        storageUsedBytesTotal = totalBytes;
        storageUsedGbTotal = bytesToGb(totalBytes);

        slicesCompleted.push("reports:getSharePointSiteUsageDetail");
        storageNotes.push(
          `Storage usage derived from Microsoft Graph SharePoint site usage report (${periodUsed}).`
        );
      }
    } catch (e) {
      if (e instanceof GraphHttpError && e.status === 403) {
        storageIsComplete = false;
        storagePermissionDenied.push("microsoft.graph/reports:getSharePointSiteUsageDetail");
        storageNotes.push("Missing Graph Reports permissions (403).");
      } else {
        storageIsComplete = false;
        storageTruncated = true;
        storageNotes.push("SharePoint site usage report collection failed unexpectedly.");
      }
    }

    // If storage slice incomplete, overall collection is still "ok" but completeness reflects gaps.
    if (!storageIsComplete) {
      isComplete = false;
      if (storageTruncated) truncated = true;
      permissionDenied.push(...storagePermissionDenied);
      notes.push(...storageNotes);
    }

    // Template breakdown: explicitly deferred (best-effort placeholder)
    const byTemplateBestEffort = {
      available: false,
      reason:
        "Site template breakdown is not collected in this initial conservative scope (requires additional per-site calls and/or beta endpoints)."
    };

    /* ---------- persist observed checks ---------- */

    await recordObservedChecks({
      prisma: ctx.prisma,
      runId: ctx.run.id,
      jobId: ctx.job?.id ?? null,
      collectorId: sharepointSitesInventoryCollector.id,
      checks: [
        {
          checkId: "SPO_SITES_OBS_001",
          data: {
            dataProfile,
            isComplete,
            truncated,
            permissionDenied,
            slicesAttempted,
            slicesCompleted,
            notes,

            counts: {
              sitesTotal,
              sitesRoot,
              sitesNonRoot
            },

            byClassification: {
              personalOneDrive
            },

            byTemplateBestEffort
          }
        },
        {
          checkId: "SPO_SITES_OBS_010",
          data: {
            isComplete: storageIsComplete,
            truncated: storageTruncated,
            permissionDenied: storagePermissionDenied,
            notes: storageNotes,
            periodUsed,
            storage: {
              sitesInReport,
              storageUsedBytesTotal,
              storageUsedGbTotal
            }
          }
        }
      ]
    });

    /* ---------- artefacts ---------- */

    const safeArtefactObj = {
      generatedAt: new Date().toISOString(),
      profile: "safe",
      tenant: {
        tenantGuid: ctx.tenant.tenantGuid,
        primaryDomain: ctx.tenant.primaryDomain,
        displayName: ctx.tenant.displayName
      },
      completeness: {
        isComplete,
        truncated,
        permissionDenied,
        slicesAttempted,
        slicesCompleted,
        notes
      },
      summary: {
        counts: {
          sitesTotal,
          sitesRoot,
          sitesNonRoot
        },
        byClassification: {
          personalOneDrive
        },
        byTemplateBestEffort
      },
      storage: {
        isComplete: storageIsComplete,
        truncated: storageTruncated,
        permissionDenied: storagePermissionDenied,
        notes: storageNotes,
        periodUsed,
        sitesInReport,
        storageUsedBytesTotal,
        storageUsedGbTotal
      }
    };

    const safeFilename = includeSensitive
      ? "sharepoint-sites-inventory.safe.json"
      : "sharepoint-sites-inventory.json";

    const safeArtefact = JSON.stringify(safeArtefactObj, null, 2);

    const fullArtefactObj =
      includeSensitive && (sitesTotal !== null || sites.length > 0)
        ? {
            generatedAt: new Date().toISOString(),
            profile: "full",
            tenant: {
              tenantGuid: ctx.tenant.tenantGuid,
              primaryDomain: ctx.tenant.primaryDomain,
              displayName: ctx.tenant.displayName
            },
            completeness: {
              isComplete,
              truncated,
              permissionDenied,
              slicesAttempted,
              slicesCompleted,
              notes
            },
            sites: sites.map((s) => ({
              id: s.id,
              displayName: s.displayName ?? "",
              webUrl: s.webUrl ?? "",
              isPersonalSite: s.isPersonalSite ?? null,
              isRoot: s.root !== undefined && s.root !== null
            }))
          }
        : null;

    const fullArtefact =
      includeSensitive && fullArtefactObj ? JSON.stringify(fullArtefactObj, null, 2) : null;

    return {
      id: sharepointSitesInventoryCollector.id,
      status: "ok",
      summary: {
        dataProfile,
        isComplete,
        truncated,
        sitesTotal,
        personalOneDrive,
        storageIsComplete,
        periodUsed
      },
      artefacts: [
        {
          type: "json" as const,
          filename: safeFilename,
          contentType: "application/json",
          content: safeArtefact
        },
        ...(includeSensitive && fullArtefact
          ? [
              {
                type: "json" as const,
                filename: "sharepoint-sites-inventory.full.json",
                contentType: "application/json",
                content: fullArtefact
              }
            ]
          : [])
      ]
    };
  }
};
