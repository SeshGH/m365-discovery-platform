// apps/portal/src/app/api/artefacts/[artefactId]/download/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { backendFetch } from "@/lib/backend";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ artefactId: string }> }
) {
  const { artefactId } = await ctx.params;

  const res = await backendFetch(`/artefacts/${encodeURIComponent(artefactId)}/download`, {
    redirect: "manual"
  });

  // Fastify should return 30x with Location -> presigned URL
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    if (!location) {
      return new Response("Missing redirect location", { status: 502 });
    }
    return NextResponse.redirect(location, { status: res.status });
  }

  // If API returned an error body, pass it through
  const text = await res.text().catch(() => "");
  return new Response(text || "Unexpected response from API", {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "text/plain"
    }
  });
}
