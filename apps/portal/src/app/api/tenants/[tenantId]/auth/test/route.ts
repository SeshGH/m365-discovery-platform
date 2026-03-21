// apps/portal/src/app/api/tenants/[tenantId]/auth/test/route.ts
// Thin proxy: forwards auth-test trigger to Fastify POST /tenants/:tenantId/auth/test.
// Used by OnboardTenantModal (client component) which cannot call backendFetch directly.
import { NextResponse } from "next/server";
import { backendFetch } from "@/lib/backend";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await ctx.params;
  const res = await backendFetch(`/tenants/${tenantId}/auth/test`, {
    method: "POST",
    body: {}
  });
  const data: unknown = await res.json().catch(() => null);
  return NextResponse.json(data ?? {}, { status: res.status });
}
