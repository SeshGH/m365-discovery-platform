// apps/portal/src/lib/backend.ts
import "server-only";
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";

export type BackendFetchOptions = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  redirect?: RequestRedirect;
};

const INTERNAL_JWT_ISSUER = "m365-discovery-portal";
const INTERNAL_JWT_AUDIENCE = "m365-discovery-api";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[portal] Missing env var: ${name}`);
  return v;
}

function getApiBaseUrl(): string {
  const raw = process.env.PORTAL_API_BASE_URL ?? process.env.BACKEND_API_BASE_URL ?? null;
  if (!raw) {
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

/**
 * Portal-minted internal token (dev-only for now).
 * MUST match API verifier expectations:
 * - iss: "m365-discovery-portal"
 * - aud: "m365-discovery-api"
 * - org is conveyed as claims.org_id (NOT orgId)
 */
function mintPortalInternalJwt(): string {
  const secret = requireEnv("PORTAL_INTERNAL_JWT_SECRET");
  const orgId = requireEnv("PORTAL_DEV_ORG_ID");
  const userId = process.env.PORTAL_DEV_USER_ID ?? "dev-user";

  // API currently reads orgId from claims.org_id
  const payload = {
    org_id: orgId,
    // optional but useful for future audit trails
    sub: userId
  };

  return jwt.sign(payload, secret, {
    algorithm: "HS256",
    expiresIn: "10m",
    issuer: INTERNAL_JWT_ISSUER,
    audience: INTERNAL_JWT_AUDIENCE
  });
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

export async function backendFetch(path: string, opts: BackendFetchOptions = {}) {
  const url = toUrl(path);

  const headers: Record<string, string> = {
    authorization: `Bearer ${mintPortalInternalJwt()}`,
    ...(opts.headers ?? {})
  };

  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["content-type"] = headers["content-type"] ?? "application/json";
    body = JSON.stringify(opts.body);
  }

  return fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body,
    redirect: opts.redirect ?? "follow",
    cache: "no-store"
  });
}

export async function backendFetchJson<T>(path: string, opts: BackendFetchOptions = {}): Promise<T> {
  const res = await backendFetch(path, opts);

  if (res.status === 404) throw notFoundError();

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
  if (!runTenantId || runTenantId !== params.tenantId) throw notFoundError();

  return run;
}
