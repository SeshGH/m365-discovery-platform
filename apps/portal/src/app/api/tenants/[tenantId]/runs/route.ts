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

function toModulesEnabledObject(keys: readonly string[]): Record<string, boolean> {
  return keys.reduce<Record<string, boolean>>((acc, k) => {
    acc[k] = true;
    return acc;
  }, {});
}

export async function GET(_req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;

  const runs = await backendFetchJson<any[]>(`/runs`);
  const filtered = runs.filter((r) => r?.tenant?.id === tenantId);

  return NextResponse.json(filtered);
}

export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;

  // Accept { dataProfile: "safe" | "full" }
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const rawProfile = String(body?.dataProfile ?? "safe").toLowerCase();
  const dataProfile = rawProfile === "full" ? "full" : "safe";

  // Reuse backend tenant auth endpoint (known-good from tenant page)
  const tenantAuth = await backendFetchJson<any>(`/tenants/${tenantId}/auth`);

  const tenantGuid = tenantAuth?.tenant?.tenantGuid;
  const primaryDomain = tenantAuth?.tenant?.primaryDomain;

  if (!tenantGuid || !primaryDomain) {
    return NextResponse.json(
      { error: "Tenant auth did not include tenantGuid/primaryDomain (cannot create run)" },
      { status: 400 }
    );
  }

  const modulesEnabled = toModulesEnabledObject(DEFAULT_MODULE_KEYS);

  const created = await backendFetchJson<any>(`/runs`, {
    method: "POST",
    body: {
      tenantGuid,
      primaryDomain,
      triggeredBy: "portal",
      dataProfile,
      modulesEnabled
    }
  });

  const runId = created?.runId ?? created?.id ?? created?.run?.id;
  const jobIds = created?.jobIds ?? created?.jobs?.map((j: any) => j?.id).filter(Boolean) ?? [];

  return NextResponse.json(
    { runId, jobIds, tenantId, dataProfile, modulesEnabled },
    { status: 201 }
  );
}
