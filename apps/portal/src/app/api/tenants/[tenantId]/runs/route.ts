// apps/portal/src/app/api/tenants/[tenantId]/runs/route.ts
import { NextResponse } from "next/server";
import { backendFetchJson } from "@/lib/backend";

/**
 * GET /api/tenants/:tenantId/runs
 *
 * TEMPORARY:
 * Backend currently exposes GET /runs (global latest 50).
 * BFF filters to tenantId for tenant-first UX.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;

  const runs = await backendFetchJson<any[]>(`/runs`);
  const filtered = Array.isArray(runs) ? runs.filter((r) => r?.tenant?.id === tenantId) : [];

  return NextResponse.json(filtered);
}

/**
 * POST /api/tenants/:tenantId/runs
 *
 * Backend /runs POST currently expects:
 * - tenantGuid
 * - primaryDomain
 * - triggeredBy
 * - dataProfile (optional but we send)
 *
 * Backend does NOT appear to expose GET /tenants/:id (DB id), so we:
 * 1) GET /tenants (list)
 * 2) Find tenant by id === tenantId
 * 3) POST /runs using tenantGuid + primaryDomain
 */
export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;

  let body: any = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const dataProfile = body?.dataProfile === "full" ? "full" : "safe";

  // 1) Resolve tenantGuid + primaryDomain from backend list
  const tenantsResp = await backendFetchJson<any>(`/tenants`);

  const tenants: any[] = Array.isArray(tenantsResp)
    ? tenantsResp
    : Array.isArray(tenantsResp?.items)
      ? tenantsResp.items
      : Array.isArray(tenantsResp?.tenants)
        ? tenantsResp.tenants
        : [];

  const tenant = tenants.find((t) => t?.id === tenantId);

  if (!tenant) {
    return NextResponse.json(
      { error: "Tenant not found via backend /tenants list", tenantId },
      { status: 404 }
    );
  }

  const tenantGuid: string | undefined = tenant?.tenantGuid;
  const primaryDomain: string | undefined = tenant?.primaryDomain;

  if (!tenantGuid || !primaryDomain) {
    return NextResponse.json(
      { error: "Tenant record missing tenantGuid/primaryDomain", tenantId },
      { status: 500 }
    );
  }

  // 2) Create run using backend's current contract
  const run = await backendFetchJson<any>(`/runs`, {
    method: "POST",
    body: {
      tenantGuid,
      primaryDomain,
      triggeredBy: "portal",
      dataProfile
    }
  });

  return NextResponse.json(run, { status: 201 });
}
