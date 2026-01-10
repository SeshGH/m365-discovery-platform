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

export async function getGraphAccessToken(params: {
  tenantId: string;
}): Promise<string> {
  const clientId = requireEnv("GRAPH_CLIENT_ID");
  const clientSecret = requireEnv("GRAPH_CLIENT_SECRET");

  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("grant_type", "client_credentials");
  body.set("scope", "https://graph.microsoft.com/.default");

  const res = await fetch(
    `https://login.microsoftonline.com/${params.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `[collectors] Failed to get Graph token (${res.status}): ${text}`
    );
  }

  const json = (await res.json()) as TokenResponse;
  if (!json.access_token) throw new Error("[collectors] No access_token returned");
  return json.access_token;
}

export async function graphGet<T>(
  token: string,
  url: string
): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[collectors] Graph GET failed (${res.status}) ${url}: ${text}`);
  }

  return (await res.json()) as T;
}

export async function graphGetAllPages<TItem>(
  token: string,
  url: string
): Promise<TItem[]> {
  type Page<T> = { value: T[]; "@odata.nextLink"?: string };

  const items: TItem[] = [];
  let next: string | undefined = url;

  while (next) {
    const page = await graphGet<Page<TItem>>(token, next);
    items.push(...(page.value ?? []));
    next = page["@odata.nextLink"];
  }

  return items;
}
