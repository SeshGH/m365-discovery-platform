// apps/portal/src/lib/backend.ts
import "server-only";
import { NextResponse } from "next/server";
import crypto from "node:crypto";

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

// --------------------
// Internal portal -> API auth token (Slice 1: dev identity)
// --------------------

const INTERNAL_JWT_ISSUER = "m365-discovery-portal";
const INTERNAL_JWT_AUDIENCE = "m365-discovery-api";

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signHs256(data: string, secret: string): string {
  return base64url(crypto.createHmac("sha256", secret).update(data).digest());
}

/**
 * TEMPORARY (Slice 1): Dev identity is sourced from env vars.
 * Long-term: this will be derived from the Entra-authenticated portal session + membership.
 */
function getDevIdentity() {
  const orgId = requireEnv("PORTAL_DEV_ORG_ID");
  const userId = process.env.PORTAL_DEV_USER_ID ?? "dev-user";

  // Keep small and stable. Future: real roles + tenant list.
  const roles = ["owner"];
  const tenant_mode: "all" = "all";

  return { orgId, userId, roles, tenant_mode };
}

function mintInternalApiToken(): string {
  const secret = requireEnv("PORTAL_INTERNAL_JWT_SECRET");
  const now = Math.floor(Date.now() / 1000);

  const { orgId, userId, roles, tenant_mode } = getDevIdentity();

  const header = {
    alg: "HS256",
    typ: "JWT"
  };

  const payload: Record<string, unknown> = {
    iss: INTERNAL_JWT_ISSUER,
    aud: INTERNAL_JWT_AUDIENCE,
    sub: userId,
    org_id: orgId,
    roles,
    tenant_mode,
    iat: now,
    nbf: now - 5,
    exp: now + 10 * 60, // 10 minutes
    jti: crypto.randomUUID()
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const sig = signHs256(signingInput, secret);

  return `${signingInput}.${sig}`;
}

// --------------------
// Backend fetch helpers
// --------------------

export async function backendFetch(path: string, opts: BackendFetchOptions = {}) {
  const url = toUrl(path);

  const headers: Record<string, string> = {
    ...(opts.headers ?? {})
  };

  // Attach internal auth token (server-only)
  // IMPORTANT: do not overwrite an explicit Authorization header if caller supplied one.
  if (!headers.authorization && !headers.Authorization) {
    headers.authorization = `Bearer ${mintInternalApiToken()}`;
  }

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
      `[portal] Backend request failed: ${res.status} ${res.statusText} ${path}${
        text ? ` :: ${text}` : ""
      }`
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
