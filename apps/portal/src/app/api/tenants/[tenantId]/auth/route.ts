// apps/portal/src/app/api/tenants/[tenantId]/auth/route.ts
import { NextResponse } from "next/server";
import { backendFetchJson } from "@/lib/backend";

export async function GET(_req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  const data = await backendFetchJson(`/tenants/${tenantId}/auth`);
  return NextResponse.json(data);
}
