// apps/portal/src/app/api/tenants/[tenantId]/runs/route.ts
import { NextResponse } from "next/server";
import { backendFetchJson } from "@/lib/backend";

/**
 * TEMPORARY: backend currently exposes GET /runs (global latest 50).
 * BFF filters to tenantId for tenant-first UX.
 * This is presentation-only and will be replaced by a backend tenant-scoped endpoint later.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;

  const runs = await backendFetchJson<any[]>(`/runs`);
  const filtered = runs.filter((r) => r?.tenant?.id === tenantId);

  return NextResponse.json(filtered);
}
