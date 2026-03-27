// apps/worker/src/collectors/graph.ts
import crypto from "node:crypto";

type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[collectors] Missing env var: ${name}`);
  return v;
}

function makeClientRequestId(): string {
  return crypto.randomUUID();
}

function truncateForLogs(input: string, max = 2000): string {
  const cleaned = input.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}…(truncated)`;
}

function pickHeader(headers: Headers, name: string): string | undefined {
  const v = headers.get(name);
  return v ?? undefined;
}

function extractRequestIds(headers: Headers) {
  return {
    requestId: pickHeader(headers, "request-id") ?? pickHeader(headers, "x-ms-request-id"),
    clientRequestId: pickHeader(headers, "client-request-id") ?? pickHeader(headers, "x-ms-client-request-id"),
    date: pickHeader(headers, "date")
  };
}

async function readErrorBody(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return truncateForLogs(text);
}

/**
 * Typed error with machine-readable fields for collectors to interpret
 * without fragile string matching.
 */
export class GraphHttpError extends Error {
  public readonly status: number;
  public readonly url: string;
  public readonly requestId?: string;
  public readonly clientRequestId?: string;
  public readonly bodyText?: string;

  constructor(params: {
    message: string;
    status: number;
    url: string;
    requestId?: string;
    clientRequestId?: string;
    bodyText?: string;
  }) {
    super(params.message);
    this.name = "GraphHttpError";
    this.status = params.status;
    this.url = params.url;
    this.requestId = params.requestId;
    this.clientRequestId = params.clientRequestId;
    this.bodyText = params.bodyText;
  }
}

function buildUrl(pathOrUrl: string, base: string) {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${path}`;
}

/**
 * Legacy collector helper (kept): token from env GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET
 */
export async function getGraphAccessToken(params: { tenantId: string }): Promise<string> {
  const clientId = requireEnv("GRAPH_CLIENT_ID");
  const clientSecret = requireEnv("GRAPH_CLIENT_SECRET");

  const clientRequestId = makeClientRequestId();

  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("grant_type", "client_credentials");
  body.set("scope", "https://graph.microsoft.com/.default");

  const tokenUrl = `https://login.microsoftonline.com/${params.tenantId}/oauth2/v2.0/token`;

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "client-request-id": clientRequestId
    },
    body
  });

  if (!res.ok) {
    const ids = extractRequestIds(res.headers);
    const text = await readErrorBody(res);

    const msg = `[collectors] Failed to get Graph token (${res.status}) tenant=${params.tenantId} clientRequestId=${clientRequestId} requestId=${ids.requestId ?? "n/a"}: ${text}`;

    throw new GraphHttpError({
      message: msg,
      status: res.status,
      url: tokenUrl,
      requestId: ids.requestId,
      clientRequestId,
      bodyText: text
    });
  }

  const json = (await res.json()) as TokenResponse;
  if (!json.access_token) throw new Error("[collectors] No access_token returned");
  return json.access_token;
}

export async function graphGet<T>(token: string, url: string): Promise<T> {
  const clientRequestId = makeClientRequestId();

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "client-request-id": clientRequestId
    }
  });

  if (!res.ok) {
    const ids = extractRequestIds(res.headers);
    const text = await readErrorBody(res);

    const msg = `[collectors] Graph GET failed (${res.status}) url=${url} clientRequestId=${clientRequestId} requestId=${ids.requestId ?? "n/a"}: ${text}`;

    throw new GraphHttpError({
      message: msg,
      status: res.status,
      url,
      requestId: ids.requestId,
      clientRequestId,
      bodyText: text
    });
  }

  return (await res.json()) as T;
}

export async function graphGetAllPages<TItem>(token: string, url: string): Promise<TItem[]> {
  type Page<T> = { value: T[]; "@odata.nextLink"?: string };

  const items: TItem[] = [];
  let next: string | undefined = url;

  while (next) {
    const page: any = await graphGet<Page<TItem>>(token, next);
    items.push(...(page.value ?? []));
    next = page["@odata.nextLink"];
  }

  return items;
}

/**
 * Exchange Online Admin API token.
 *
 * Uses the same app registration as Graph (GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET)
 * but targets the Exchange Online resource scope instead of Graph.
 *
 * Required: app permission `Exchange.ManageAsApp` (application role) granted in
 * the target tenant, and the service principal assigned the Exchange Administrator
 * role (or a scoped Exchange management role) via the Exchange admin centre.
 */
export async function getExchangeAdminAccessToken(params: { tenantId: string }): Promise<string> {
  const clientId = requireEnv("GRAPH_CLIENT_ID");
  const clientSecret = requireEnv("GRAPH_CLIENT_SECRET");

  const clientRequestId = makeClientRequestId();

  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("grant_type", "client_credentials");
  body.set("scope", "https://outlook.office365.com/.default");

  const tokenUrl = `https://login.microsoftonline.com/${params.tenantId}/oauth2/v2.0/token`;

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "client-request-id": clientRequestId
    },
    body
  });

  if (!res.ok) {
    const ids = extractRequestIds(res.headers);
    const text = await readErrorBody(res);
    const msg = `[collectors] Failed to get Exchange Admin token (${res.status}) tenant=${params.tenantId} clientRequestId=${clientRequestId} requestId=${ids.requestId ?? "n/a"}: ${text}`;
    throw new GraphHttpError({
      message: msg,
      status: res.status,
      url: tokenUrl,
      requestId: ids.requestId,
      clientRequestId,
      bodyText: text
    });
  }

  const json = (await res.json()) as TokenResponse;
  if (!json.access_token) throw new Error("[collectors] No access_token in Exchange Admin token response");
  return json.access_token;
}

/**
 * Single JSON GET against the Exchange Online Admin REST API
 * (`https://outlook.office365.com/adminapi/beta/{tenantId}/…`).
 * Token must come from `getExchangeAdminAccessToken`.
 */
export async function exchangeAdminGet<T>(token: string, url: string): Promise<T> {
  const clientRequestId = makeClientRequestId();

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "client-request-id": clientRequestId
    }
  });

  if (!res.ok) {
    const ids = extractRequestIds(res.headers);
    const text = await readErrorBody(res);
    const msg = `[collectors] Exchange Admin GET failed (${res.status}) url=${url} clientRequestId=${clientRequestId} requestId=${ids.requestId ?? "n/a"}: ${text}`;
    throw new GraphHttpError({
      message: msg,
      status: res.status,
      url,
      requestId: ids.requestId,
      clientRequestId,
      bodyText: text
    });
  }

  return (await res.json()) as T;
}

/**
 * JSON POST against the Exchange Online Admin REST API.
 * Used primarily for the InvokeCommand endpoint, which is the only supported
 * way to invoke Exchange cmdlets (e.g. Get-TransportRule) via REST.
 * Token must come from `getExchangeAdminAccessToken`.
 */
export async function exchangeAdminPost<T>(token: string, url: string, body: unknown): Promise<T> {
  const clientRequestId = makeClientRequestId();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "client-request-id": clientRequestId
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const ids = extractRequestIds(res.headers);
    const text = await readErrorBody(res);
    const msg = `[collectors] Exchange Admin POST failed (${res.status}) url=${url} clientRequestId=${clientRequestId} requestId=${ids.requestId ?? "n/a"}: ${text}`;
    throw new GraphHttpError({
      message: msg,
      status: res.status,
      url,
      requestId: ids.requestId,
      clientRequestId,
      bodyText: text
    });
  }

  return (await res.json()) as T;
}

/**
 * Paginated GET against the Exchange Online Admin REST API.
 * Follows `@odata.nextLink` until exhausted, same as `graphGetAllPages`.
 * Note: the InvokeCommand endpoint uses POST (see exchangeAdminPost), not GET.
 * This helper is retained for direct entity-set GETs on the admin API surface.
 */
export async function exchangeAdminGetAllPages<TItem>(token: string, url: string): Promise<TItem[]> {
  type Page<T> = { value: T[]; "@odata.nextLink"?: string };

  const items: TItem[] = [];
  let next: string | undefined = url;

  while (next) {
    const page: any = await exchangeAdminGet<Page<TItem>>(token, next);
    items.push(...(page.value ?? []));
    next = page["@odata.nextLink"];
  }

  return items;
}

/**
 * Client-credentials helpers used by auth test and any future "raw graph" collectors.
 * These mirror what was in apps/worker/src/lib/graph.ts (now being removed).
 */
export async function getClientCredentialsToken(params: {
  tenantGuid: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const clientRequestId = makeClientRequestId();

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(params.tenantGuid)}/oauth2/v2.0/token`;

  const body = new URLSearchParams();
  body.set("client_id", params.clientId);
  body.set("client_secret", params.clientSecret);
  body.set("grant_type", "client_credentials");
  body.set("scope", "https://graph.microsoft.com/.default");

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "client-request-id": clientRequestId
    },
    body
  });

  const text = await res.text().catch(() => "");

  if (!res.ok) {
    const ids = extractRequestIds(res.headers);
    const msg = `[collectors] Token request failed (${res.status}) tenantGuid=${params.tenantGuid} clientRequestId=${clientRequestId} requestId=${ids.requestId ?? "n/a"}: ${truncateForLogs(text, 800)}`;

    throw new GraphHttpError({
      message: msg,
      status: res.status,
      url: tokenUrl,
      requestId: ids.requestId,
      clientRequestId,
      bodyText: truncateForLogs(text, 800)
    });
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`[collectors] Token response was not JSON: ${truncateForLogs(text, 800)}`);
  }

  const token = typeof json?.access_token === "string" ? (json.access_token as string) : null;
  if (!token) {
    throw new Error(`[collectors] Token response missing access_token: ${truncateForLogs(text, 800)}`);
  }

  return token;
}

export async function graphGetJsonWithClientCredentials<T>(params: {
  tenantGuid: string;
  clientId: string;
  clientSecret: string;
  path: string; // "/v1.0/organization?$select=id,displayName" OR absolute URL
}): Promise<T> {
  const token = await getClientCredentialsToken({
    tenantGuid: params.tenantGuid,
    clientId: params.clientId,
    clientSecret: params.clientSecret
  });

  const url = buildUrl(params.path, "https://graph.microsoft.com");

  const clientRequestId = makeClientRequestId();

  const res = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "client-request-id": clientRequestId
    }
  });

  const text = await res.text().catch(() => "");

  if (!res.ok) {
    const ids = extractRequestIds(res.headers);
    const msg = `[collectors] Graph GET failed (${res.status}) url=${url} clientRequestId=${clientRequestId} requestId=${ids.requestId ?? "n/a"}: ${truncateForLogs(text, 1200)}`;

    throw new GraphHttpError({
      message: msg,
      status: res.status,
      url,
      requestId: ids.requestId,
      clientRequestId,
      bodyText: truncateForLogs(text, 1200)
    });
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`[collectors] Graph response was not JSON: ${truncateForLogs(text, 1200)}`);
  }
}
