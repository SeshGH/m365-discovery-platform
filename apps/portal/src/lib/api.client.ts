// apps/portal/src/lib/api.client.ts
/**
 * Client-safe API helpers for the Portal UI.
 *
 * IMPORTANT:
 * - Do NOT import `server-only`, `next/headers`, or any server-only Next APIs here.
 * - Client code should call the Portal BFF routes under /api/*
 */

export type RunItem = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  triggeredBy: string | null;
  modulesEnabled: unknown;
  dataProfile: string;
  tenant?: {
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

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [k: string]: JsonValue };

type BffFetchInit = Omit<RequestInit, "body"> & {
  /** JSON body convenience for client calls */
  jsonBody?: JsonValue;
};

async function bffFetch<T>(path: string, init?: BffFetchInit): Promise<T> {
  const hasJsonBody = init?.jsonBody !== undefined;

  const res = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(hasJsonBody ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {})
    },
    body: hasJsonBody ? JSON.stringify(init?.jsonBody) : undefined
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[portal-client] BFF error ${res.status} ${res.statusText} for ${path}${text ? ` :: ${text}` : ""}`);
  }

  return (await res.json()) as T;
}

export async function listTenantRuns(tenantId: string): Promise<RunItem[]> {
  return bffFetch<RunItem[]>(`/api/tenants/${encodeURIComponent(tenantId)}/runs`);
}
