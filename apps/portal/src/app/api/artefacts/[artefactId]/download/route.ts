// apps/portal/src/app/api/artefacts/[artefactId]/download/route.ts
import "server-only";
import { redirect } from "next/navigation";
import { backendFetch } from "@/lib/backend";

export async function GET(_req: Request, { params }: { params: { artefactId: string } }) {
  const res = await backendFetch(`/artefacts/${params.artefactId}/download`, {
    redirect: "manual"
  });

  // Fastify should return 302 with Location -> presigned URL
  if (
    res.status === 302 ||
    res.status === 301 ||
    res.status === 303 ||
    res.status === 307 ||
    res.status === 308
  ) {
    const location = res.headers.get("location");
    if (!location) {
      return new Response("Missing redirect location", { status: 502 });
    }
    redirect(location);
  }

  // If API returned JSON error, pass it through
  const text = await res.text().catch(() => "");
  return new Response(text || "Unexpected response from API", {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "text/plain"
    }
  });
}
