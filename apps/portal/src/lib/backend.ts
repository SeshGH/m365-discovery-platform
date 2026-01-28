// apps/portal/src/lib/backend.ts
import "server-only";
import { NextResponse } from "next/server";

export type BackendFetchOptions = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  // If true, we ask fetch not to follow redirects so we can pass them through.
  redirect?: RequestRedirect;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[portal] Missing env var: ${name}`);
  return v;
}

/**
 * Prefer PORTAL_API_BASE_URL (existing portal convention),
 * but allow BACKEND_API_BASE_URL as a fallback (older/newer scaffolds).
 */
function getApiBaseUrl(): string {
  const raw =
    process.env.PORTAL_API_BASE_URL ??
    process.env.BACKEND_API_BASE_URL ??
    null;

  if (!raw) {
    // Fail with a clear message
    throw new Error(
      "[portal] Missing API base URL env var. Set PORTAL_API_BASE_URL (preferred) or BACKEND_API_BASE_URL."
    );
  }

  return raw.replace(/\/+$/, "");
}

function toUrl(path: string): string {
  const base = getApiBaseUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

export async function backendFetch(path: string, opts: BackendFetchOptions = {}) {
  const url = toUrl(path);

  const headers: Record<string, string> = {
    ...(opts.headers ?? {})
  };

  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["content-type"] = headers["content-type"] ?? "application/json";
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body,
    redirect: opts.redirect ?? "follow",
    cache: "no-store"
  });

  return res;
}

export async function backendFetchJson<T>(path: string, opts: BackendFetchOptions = {}): Promise<T> {
  const res = await backendFetch(path, opts);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `[portal] Backend request failed: ${res.status} ${res.statusText} ${path}${text ? ` :: ${text}` : ""}`
    );
  }

  return (await res.json()) as T;
}

/**
 * Fail-closed guard: verifies that a run belongs to the tenant.
 * Returns the run object (as provided by backend) for convenience.
 */
export async function assertRunBelongsToTenant(params: {
  tenantId: string;
  runId: string;
}): Promise<any> {
  const run = await backendFetchJson<any>(`/runs/${params.runId}`);

  const runTenantId: string | undefined = run?.tenant?.id;
  if (!runTenantId || runTenantId !== params.tenantId) {
    throw notFoundError();
  }

  return run;
}

export function notFoundError(): Error {
  const err = new Error("NOT_FOUND");
  (err as any).code = "NOT_FOUND";
  return err;
}

export function isNotFoundError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as any).code === "NOT_FOUND";
}

export function toNotFoundResponse() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
