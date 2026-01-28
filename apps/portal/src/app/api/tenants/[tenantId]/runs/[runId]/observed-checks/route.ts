// apps/portal/src/app/api/tenants/[tenantId]/runs/[runId]/observed-checks/route.ts
import { NextResponse } from "next/server";
import {
  assertRunBelongsToTenant,
  backendFetchJson,
  isNotFoundError,
  toNotFoundResponse
} from "@/lib/backend";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ tenantId: string; runId: string }> }
) {
  try {
    const params = await ctx.params;
    await assertRunBelongsToTenant(params);
    const data = await backendFetchJson(`/runs/${params.runId}/observed-checks`);
    return NextResponse.json(data);
  } catch (err) {
    if (isNotFoundError(err)) return toNotFoundResponse();
    throw err;
  }
}
