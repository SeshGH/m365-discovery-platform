// apps/portal/src/lib/api.ts
import "server-only";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[portal] Missing env var: ${name}`);
  return v;
}

const API_BASE = requireEnv("PORTAL_API_BASE_URL").replace(/\/+$/, "");

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
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
      `[portal] API error ${res.status} ${res.statusText} for ${path}${text ? ` :: ${text}` : ""}`
    );
  }

  return (await res.json()) as T;
}

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
  return apiFetch<TenantListItem[]>(`/tenants${qs ? `?${qs}` : ""}`);
}

export async function getTenantAuth(tenantId: string): Promise<TenantAuthResponse> {
  return apiFetch<TenantAuthResponse>(`/tenants/${tenantId}/auth`);
}

export async function listRuns(): Promise<RunListItem[]> {
  return apiFetch<RunListItem[]>(`/runs`);
}
