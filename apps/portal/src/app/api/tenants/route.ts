// apps/portal/src/app/api/tenants/route.ts
import { NextResponse } from "next/server";
import { backendFetch, backendFetchJson } from "@/lib/backend";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  // Pass-through supported query params from the Fastify API:
  // tenantGuid, primaryDomain, q, take
  const params = new URLSearchParams();

  const q = url.searchParams.get("q");
  const take = url.searchParams.get("take");
  const tenantGuid = url.searchParams.get("tenantGuid");
  const primaryDomain = url.searchParams.get("primaryDomain");

  if (q) params.set("q", q);
  if (take) params.set("take", take);
  if (tenantGuid) params.set("tenantGuid", tenantGuid);
  if (primaryDomain) params.set("primaryDomain", primaryDomain);

  const qs = params.toString();

  const raw: unknown = await backendFetchJson<unknown>(`/tenants${qs ? `?${qs}` : ""}`);

  // The API returns an array of tenant objects; fail-closed to [] if unexpected.
  const data = Array.isArray(raw) ? raw.filter((t) => isRecord(t)) : [];

  return NextResponse.json(data);
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Forward to Fastify; preserve status codes (201, 400, 409).
  const res = await backendFetch("/tenants", { method: "POST", body });
  const data: unknown = await res.json().catch(() => null);
  return NextResponse.json(data ?? {}, { status: res.status });
}
