# Tenant Auth (Connection Test)

This platform stores tenant authorisation state in `TenantAuth` and validates connectivity using a worker-side job.

The API **does not** call Microsoft Graph directly. Instead, it enqueues an auth-test job and the worker performs a lightweight app-only Graph call.

## Data model

- `Tenant` is the primary tenant record (includes `tenantGuid`, `primaryDomain`, optional `displayName`)
- `TenantAuth` is a 1:1 record with `Tenant` (`TenantToAuth` relation)
  - `status`: `connected` | `error`
  - `lastError`: error string (cleared on success)
  - `consentedAt`: timestamp set when an auth test succeeds

## How auth testing works

1. API enqueues a job with `collectorId: "entra.auth.test"`
2. Worker runs the collector:
   - requests an app-only token via client credentials for the tenant’s Entra ID (`tenantGuid`)
   - performs a lightweight Graph call:
     - `GET /v1.0/organization?$select=id,displayName`
3. Worker updates `TenantAuth`:
   - on success:
     - `status = "connected"`
     - `lastError = null`
     - `consentedAt = now`
   - on failure:
     - `status = "error"`
     - `lastError = <message>`

## Required worker environment variables

The worker needs an Entra ID app registration capable of app-only Graph calls for the target tenant(s):

- `GRAPH_CLIENT_ID`
- `GRAPH_CLIENT_SECRET`

The Graph scopes used are `https://graph.microsoft.com/.default` (app-only).

## API endpoints

### Tenant list / lookup

- `GET /tenants`
  - Optional query params:
    - `tenantGuid=...` (exact)
    - `primaryDomain=...` (exact)
    - `q=...` (contains match against `primaryDomain` and `displayName`)
    - `take=...` (default 50, max 200)

Returns minimal tenant fields plus a summary auth object if present.

### TenantAuth by internal tenant id

- `GET /tenants/:tenantId/auth`
  - Returns `{ tenant, auth }` where `auth` may be `null`

- `POST /tenants/:tenantId/auth/test`
  - Enqueues a dedicated `Run` + one `Job` (`entra.auth.test`)
  - Returns `{ runId, jobId }`

### TenantAuth by tenant GUID (Entra tenant ID)

- `GET /tenants/by-guid/:tenantGuid/auth`
  - Returns `{ tenant, auth }`

- `POST /tenants/by-guid/:tenantGuid/auth/test`
  - Enqueues a dedicated `Run` + one `Job` (`entra.auth.test`)
  - Returns `{ runId, jobId, tenantId }`

## PowerShell testing

### List tenants and see auth summary

```powershell
Invoke-RestMethod "http://localhost:8080/tenants"
Invoke-RestMethod "http://localhost:8080/tenants?q=onmicrosoft"
