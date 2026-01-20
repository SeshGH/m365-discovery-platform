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
  // Helps correlate Graph-side logs/errors with our calls.
  // Graph often echoes request ids in headers, but client-request-id is still useful.
  return crypto.randomUUID();
}

function truncateForLogs(input: string, max = 2000): string {
  const cleaned = input.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}…(truncated)`;
}

function pickHeader(headers: Headers, name: string): string | undefined {
  // Headers are case-insensitive, but fetch normalises access via .get().
  const v = headers.get(name);
  return v ?? undefined;
}

function extractRequestIds(headers: Headers) {
  return {
    requestId: pickHeader(headers, "request-id") ?? pickHeader(headers, "x-ms-request-id"),
    clientRequestId:
      pickHeader(headers, "client-request-id") ?? pickHeader(headers, "x-ms-client-request-id"),
    date: pickHeader(headers, "date")
  };
}

async function readErrorBody(res: Response): Promise<string> {
  // Prefer text: Graph errors are often JSON but sometimes include HTML/plain text.
  const text = await res.text().catch(() => "");
  return truncateForLogs(text);
}

/**
 * Typed error that preserves the existing human-readable message
 * but also provides machine-readable fields for collectors to interpret.
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

export async function getGraphAccessToken(params: { tenantId: string }): Promise<string> {
  const clientId = requireEnv("GRAPH_CLIENT_ID");
  const clientSecret = requireEnv("GRAPH_CLIENT_SECRET");

  const clientRequestId = makeClientRequestId();

  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("grant_type", "client_credentials");
  body.set("scope", "https://graph.microsoft.com/.default");

  const res = await fetch(
    `https://login.microsoftonline.com/${params.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "client-request-id": clientRequestId
      },
      body
    }
  );

  if (!res.ok) {
    const ids = extractRequestIds(res.headers);
    const text = await readErrorBody(res);

    // Keep message format stable (matches previous behaviour)
    const msg = `[collectors] Failed to get Graph token (${res.status}) tenant=${params.tenantId} clientRequestId=${clientRequestId} requestId=${ids.requestId ?? "n/a"}: ${text}`;

    throw new GraphHttpError({
      message: msg,
      status: res.status,
      url: `https://login.microsoftonline.com/${params.tenantId}/oauth2/v2.0/token`,
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

    // Keep message format stable (matches previous behaviour)
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
