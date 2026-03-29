// apps/portal/src/app/api/tenants/[tenantId]/runs/[runId]/findings/derive/route.ts
import { NextResponse } from "next/server";
import {
  assertRunBelongsToTenant,
  backendFetchJson,
  isNotFoundError,
  toNotFoundResponse
} from "@/lib/backend";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ tenantId: string; runId: string }> }
) {
  try {
    const params = await ctx.params;
    await assertRunBelongsToTenant(params);
    const data = await backendFetchJson(`/runs/${params.runId}/findings/derive`, {
      method: "POST"
    });
    return NextResponse.json(data);
  } catch (err) {
    if (isNotFoundError(err)) return toNotFoundResponse();
    throw err;
  }
}
