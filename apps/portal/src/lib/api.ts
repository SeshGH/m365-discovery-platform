// apps/portal/src/lib/api.ts
import "server-only";
import { headers } from "next/headers";

/**
 * Portal data access MUST go through the portal BFF (/api/*),
 * not directly to the backend Fastify API.
 *
 * In Next.js 16, headers() is async. In server components, fetch() requires absolute URLs.
 * We derive the portal origin from request headers (forwarded headers preferred).
 */

async function getPortalOriginFromHeaders(): Promise<string> {
  const h = await headers();

  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host");

  if (!host) {
    throw new Error("[portal] Unable to determine portal origin (missing Host headers).");
  }

  return `${proto}://${host}`;
}

async function bffFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const origin = await getPortalOriginFromHeaders();
  const url = path.startsWith("http")
    ? path
    : `${origin}${path.startsWith("/") ? path : `/${path}`}`;

  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `[portal] BFF error ${res.status} ${res.statusText} for ${path}${text ? ` :: ${text}` : ""}`
    );
  }

  return (await res.json()) as T;
}

/** -----------------------------
 *  Types (match BFF responses)
 *  ----------------------------*/

export type TenantListItem = {
  id: string;
  tenantGuid: string;
  primaryDomain: string;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
  auth: null | {
    status: string;
    consentedAt: string | null;
    lastError: string | null;
    updatedAt: string;
  };
};

export type TenantAuthResponse = {
  tenant: {
    id: string;
    tenantGuid: string;
    primaryDomain: string;
    displayName: string | null;
  };
  auth: null | {
    tenantId: string;
    mode: unknown;
    status: unknown;
    lastError: string | null;
    consentedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
};

export type RunListItem = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  triggeredBy: string | null;
  modulesEnabled: unknown;
  dataProfile: string;
  tenant: {
    id: string;
    tenantGuid: string;
    primaryDomain: string;
    displayName: string | null;
  };
  counts: {
    jobs: number;
    findings: number;
    artefacts: number;
  };
};

export type RunDetail = RunListItem;

export type JobListItem = {
  id: string;
  runId: string;
  status: string;
  attempts: number;
  lockedAt: string | null;
  lockedBy: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  collectorId: string;
  payload: unknown;
  counts: {
    findings: number;
    artefacts: number;
  };
};

export type FindingItem = {
  id: string;
  runId: string;
  jobId: string | null;
  checkId: string;
  severity: string;
  title: string;
  description: string;
  recommendation: string | null;
  evidence: unknown;
  references: unknown;
  createdAt: string;
};

export type ObservedCheckItem = {
  id: string;
  runId: string;
  jobId: string | null;
  checkId: string;
  collectorId: string;
  observedAt: string;
  data: unknown;
  ruleId: string | null;
  references: unknown;
};

export type ArtefactItem = {
  id: string;
  runId: string;
  jobId: string | null;
  type: string;
  uri: string | null;
  bucket: string;
  key: string;
  hash: string | null;
  sizeBytes: number | null;
  createdAt: string;
};

/** -----------------------------
 *  BFF calls
 *  ----------------------------*/

export async function listTenants(params?: {
  q?: string;
  tenantGuid?: string;
  primaryDomain?: string;
  take?: number;
}): Promise<TenantListItem[]> {
  const q = new URLSearchParams();
  if (params?.q) q.set("q", params.q);
  if (params?.tenantGuid) q.set("tenantGuid", params.tenantGuid);
  if (params?.primaryDomain) q.set("primaryDomain", params.primaryDomain);
  if (typeof params?.take === "number") q.set("take", String(params.take));

  const qs = q.toString();
  return bffFetch<TenantListItem[]>(`/api/tenants${qs ? `?${qs}` : ""}`);
}

export async function getTenantAuth(tenantId: string): Promise<TenantAuthResponse> {
  return bffFetch<TenantAuthResponse>(`/api/tenants/${tenantId}/auth`);
}

export async function listTenantRuns(tenantId: string): Promise<RunListItem[]> {
  return bffFetch<RunListItem[]>(`/api/tenants/${tenantId}/runs`);
}

export async function getRun(tenantId: string, runId: string): Promise<RunDetail> {
  return bffFetch<RunDetail>(`/api/tenants/${tenantId}/runs/${runId}`);
}

export async function listRunJobs(tenantId: string, runId: string): Promise<JobListItem[]> {
  return bffFetch<JobListItem[]>(`/api/tenants/${tenantId}/runs/${runId}/jobs`);
}

export async function listRunArtefacts(tenantId: string, runId: string): Promise<ArtefactItem[]> {
  return bffFetch<ArtefactItem[]>(`/api/tenants/${tenantId}/runs/${runId}/artefacts`);
}

export async function listRunObservedChecks(
  tenantId: string,
  runId: string
): Promise<ObservedCheckItem[]> {
  return bffFetch<ObservedCheckItem[]>(
    `/api/tenants/${tenantId}/runs/${runId}/observed-checks`
  );
}

export async function listRunFindings(tenantId: string, runId: string): Promise<FindingItem[]> {
  return bffFetch<FindingItem[]>(`/api/tenants/${tenantId}/runs/${runId}/findings`);
}

export async function getRunObservedCheck(
  tenantId: string,
  runId: string,
  observedId: string
): Promise<ObservedCheckItem> {
  return bffFetch<ObservedCheckItem>(
    `/api/tenants/${tenantId}/runs/${runId}/observed-checks/${observedId}`
  );
}
