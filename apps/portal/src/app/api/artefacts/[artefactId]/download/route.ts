// apps/portal/src/app/api/artefacts/[artefactId]/download/route.ts
import "server-only";
import { redirect } from "next/navigation";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[portal] Missing env var: ${name}`);
  return v;
}

const API_BASE = requireEnv("PORTAL_API_BASE_URL").replace(/\/+$/, "");

export async function GET(
  _req: Request,
  { params }: { params: { artefactId: string } }
) {
  const res = await fetch(`${API_BASE}/artefacts/${params.artefactId}/download`, {
    redirect: "manual",
    cache: "no-store"
  });

  // Fastify should return 302 with Location -> presigned URL
  if (res.status === 302 || res.status === 301 || res.status === 303 || res.status === 307 || res.status === 308) {
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
