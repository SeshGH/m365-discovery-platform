type TokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
};

function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

async function readTextSafe(res: Response) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

export async function getClientCredentialsToken(params: {
  tenantGuid: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(
    params.tenantGuid
  )}/oauth2/v2.0/token`;

  const body = new URLSearchParams();
  body.set("client_id", params.clientId);
  body.set("client_secret", params.clientSecret);
  body.set("grant_type", "client_credentials");
  body.set("scope", "https://graph.microsoft.com/.default");

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });

  const text = await readTextSafe(res);

  if (!res.ok) {
    throw new Error(`Token request failed (${res.status}): ${truncate(text, 800)}`);
  }

  let json: TokenResponse;
  try {
    json = JSON.parse(text) as TokenResponse;
  } catch {
    throw new Error(`Token response was not JSON: ${truncate(text, 800)}`);
  }

  const token = typeof json.access_token === "string" ? json.access_token : null;
  if (!token) {
    throw new Error(`Token response missing access_token: ${truncate(text, 800)}`);
  }

  return token;
}

export async function graphGetJsonWithClientCredentials<T>(params: {
  tenantGuid: string;
  clientId: string;
  clientSecret: string;
  path: string; // e.g. "/v1.0/organization?$select=id,displayName"
}): Promise<T> {
  const token = await getClientCredentialsToken({
    tenantGuid: params.tenantGuid,
    clientId: params.clientId,
    clientSecret: params.clientSecret
  });

  const url = `https://graph.microsoft.com${params.path.startsWith("/") ? "" : "/"}${
    params.path
  }`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json"
    }
  });

  const text = await readTextSafe(res);

  if (!res.ok) {
    throw new Error(`Graph GET failed (${res.status}): ${truncate(text, 1200)}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Graph response was not JSON: ${truncate(text, 1200)}`);
  }
}
