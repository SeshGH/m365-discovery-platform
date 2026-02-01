// apps/portal/src/app/api/tenants/[tenantId]/runs/route.ts
import { NextResponse } from "next/server";
import { backendFetchJson } from "@/lib/backend";

/**
 * BFF: tenant-scoped runs
 *
 * GET:
 * - backend currently exposes GET /runs (global latest 50).
 * - BFF filters to tenantId for tenant-first UX.
 *
 * POST:
 * - create a run for this tenant (portal-triggered)
 * - backend create-run requires: tenantGuid, primaryDomain, triggeredBy
 * - modulesEnabled MUST be an object (not an array) per backend validation
 */

const DEFAULT_MODULE_KEYS = [
  "entra.users",
  "entra.conditionalAccess.policies",
  "entra.directoryRoles.assignments",
  "entra.enterpriseApps.permissions",
  "exchange.mailboxes.inventory"
] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toModulesEnabledObject(keys: readonly string[]): Record<string, boolean> {
  return keys.reduce<Record<string, boolean>>((acc, k) => {
    acc[k] = true;
    return acc;
  }, {});
}

function readStringPath(obj: unknown, path: readonly string[]): string | null {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isRecord(cur)) return null;
    cur = cur[key];
  }
  return typeof cur === "string" && cur.trim().length > 0 ? cur : null;
}

function readArray(obj: unknown, key: string): unknown[] | null {
  if (!isRecord(obj)) return null;
  const v = obj[key];
  return Array.isArray(v) ? v : null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;

  const rawRuns: unknown = await backendFetchJson<unknown>(`/runs`);
  const runs = Array.isArray(rawRuns) ? rawRuns.filter((r) => isRecord(r)) : [];

  const filtered = runs.filter((r) => readStringPath(r, ["tenant", "id"]) === tenantId);

  return NextResponse.json(filtered);
}

export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;

  // Accept { dataProfile: "safe" | "full" }
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const rawProfile = isRecord(body) && typeof body.dataProfile === "string" ? body.dataProfile : "safe";
  const dataProfile = String(rawProfile).toLowerCase() === "full" ? "full" : "safe";

  // Reuse backend tenant auth endpoint (known-good from tenant page)
  const tenantAuth: unknown = await backendFetchJson<unknown>(`/tenants/${tenantId}/auth`);

  const tenantGuid = readStringPath(tenantAuth, ["tenant", "tenantGuid"]);
  const primaryDomain = readStringPath(tenantAuth, ["tenant", "primaryDomain"]);

  if (!tenantGuid || !primaryDomain) {
    return NextResponse.json(
      { error: "Tenant auth did not include tenantGuid/primaryDomain (cannot create run)" },
      { status: 400 }
    );
  }

  const modulesEnabled = toModulesEnabledObject(DEFAULT_MODULE_KEYS);

  const created: unknown = await backendFetchJson<unknown>(`/runs`, {
    method: "POST",
    body: {
      tenantGuid,
      primaryDomain,
      triggeredBy: "portal",
      dataProfile,
      modulesEnabled
    }
  });

  const runId =
    readStringPath(created, ["runId"]) ??
    readStringPath(created, ["id"]) ??
    readStringPath(created, ["run", "id"]);

  const jobIdsFromTop = readArray(created, "jobIds");
  const jobsArray = readArray(created, "jobs");

  const jobIds =
    (jobIdsFromTop ?? [])
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => String(x)) ?? [];

  const jobIdsFromJobs =
    (jobsArray ?? [])
      .map((j) => readStringPath(j, ["id"]))
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0) ?? [];

  const finalJobIds = jobIds.length > 0 ? jobIds : jobIdsFromJobs;

  return NextResponse.json({ runId, jobIds: finalJobIds, tenantId, dataProfile, modulesEnabled }, { status: 201 });
}
