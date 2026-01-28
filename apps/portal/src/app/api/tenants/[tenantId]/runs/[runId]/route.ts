// apps/portal/src/app/api/tenants/[tenantId]/runs/[runId]/route.ts
import { NextResponse } from "next/server";
import { assertRunBelongsToTenant, isNotFoundError, toNotFoundResponse } from "@/lib/backend";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ tenantId: string; runId: string }> }
) {
  try {
    const params = await ctx.params;
    const run = await assertRunBelongsToTenant(params);
    return NextResponse.json(run);
  } catch (err) {
    if (isNotFoundError(err)) return toNotFoundResponse();
    throw err;
  }
}
