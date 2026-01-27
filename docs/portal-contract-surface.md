# Portal contract surface (frontend) — M365 Discovery Portal

This document defines the **minimal contract surface** the portal consumes from the existing API, plus the **BFF boundaries** that enforce tenant isolation and prepare for Entra ID SSO.

**Scope:** Architecture + contracts only (no feature implementation).

---

## Principles

* The portal is a **consumer** of backend contracts. It must not derive new “truth”.
* Evidence hierarchy is UI structure:

  * **Artefacts** = evidence (source of truth)
  * **Observed checks** = facts
  * **Findings** = interpreted signals
  * **Reports** = human convenience only
* Tenant isolation must be **fail‑closed** in the BFF.
* Prefer **canonical collector IDs** in `modulesEnabled`.

---

## Portal API access pattern

### Browser → Portal BFF only

The browser must only call **portal** endpoints under `/api/*`.

### Portal BFF → Backend API

The BFF calls the existing backend API (Fastify) and enforces:

1. **Tenant scoping** (run belongs to tenant)
2. **Auth/session boundaries** (later Entra ID SSO)
3. **Transport hardening** (timeouts, sane errors)

---

## Canonical module keys for `modulesEnabled`

The portal must send canonical keys only:

* `entra.users`
* `entra.enterpriseApps.permissions`
* `entra.conditionalAccess.policies`
* `entra.directoryRoles.assignments`
* `exchange.mailboxes.inventory`

(Backend will continue accepting legacy keys for compatibility, but the portal should not use them.)

---

## Session contract (portal)

A minimal session shape (server-side, future Entra-ready):

* `selectedTenantId?: string`
* `user?: { id: string; displayName?: string; email?: string }`  (future)
* `allowedTenantIds?: string[]` (future)

**Note:** the browser must not be the source of truth for tenant permissioning.

---

## Contract types (minimal)

These are the **minimal** types the portal relies on. They should remain stable unless versioned.

> Implementation note: keep these in a single file like `apps/portal/src/lib/contracts.ts` or a `packages/sdk`.

### Tenant list item

```ts
export type TenantAuthSummary = {
  status: string;
  consentedAt: string | null;
  lastError: string | null;
  updatedAt: string;
};

export type TenantListItem = {
  id: string;
  tenantGuid: string;
  primaryDomain: string;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
  auth: TenantAuthSummary | null;
};
```

### Tenant auth detail

```ts
export type TenantAuthDetail = {
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
```

### Run list item / run detail

```ts
export type RunCounts = {
  jobs: number;
  findings: number;
  artefacts: number;
};

export type RunTenantRef = {
  id: string;
  tenantGuid: string;
  primaryDomain: string;
  displayName: string | null;
};

export type RunItem = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  triggeredBy: string | null;
  modulesEnabled: unknown; // JSON
  dataProfile: "safe" | "full";
  tenant: RunTenantRef;
  counts: RunCounts;
};

export type RunDetail = RunItem;
```

### Job list item

```ts
export type JobItem = {
  id: string;
  runId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  lockedAt: string | null;
  lockedBy: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  collectorId: string;
  payload: unknown; // JSON
  counts: {
    findings: number;
    artefacts: number;
  };
};
```

### Finding list item

**Important:** the current API response is a *subset* of the Prisma model.

```ts
export type FindingItem = {
  id: string;
  runId: string;
  jobId: string | null;
  checkId: string;
  severity: "critical" | "high" | "medium" | "low" | "info" | "unknown";
  title: string;
  description: string;
  recommendation: string | null;
  evidence: unknown;   // JSON
  references: unknown; // JSON (array)
  createdAt: string;
};
```

### Observed check item

```ts
export type ObservedCheckItem = {
  id: string;
  runId: string;
  jobId: string | null;
  checkId: string;
  collectorId: string;
  ruleId: string | null;
  observedAt: string;
  data: unknown;       // JSON
  references: unknown; // JSON (array)
};
```

### Artefact item

```ts
export type ArtefactItem = {
  id: string;
  runId: string;
  jobId: string | null;
  type: "zip" | "state" | "raw" | "log" | "csv" | "json";
  uri: string;
  bucket: string;
  key: string;
  hash: string | null;
  sizeBytes: number | null;
  createdAt: string;
};
```

### Create run request/response

The portal must send a body that matches `CreateRunSchema` exactly. The portal contract is:

```ts
export type CreateRunRequest = {
  tenantGuid: string;
  primaryDomain: string;
  displayName?: string | null;
  triggeredBy?: string | null;
  dataProfile?: "safe" | "full";
  modulesEnabled: Record<string, boolean>; // portal uses canonical keys
};

export type CreateRunResponse = {
  runId: string;
  jobIds: string[];
  tenantId: string;
  dataProfile: "safe" | "full";
};
```

---

## Portal BFF endpoints (stable surface)

These are the portal’s own API routes. The UI must only call these.

### Tenants

* `GET /api/tenants?q=&take=` → backend `GET /tenants`
* `GET /api/tenants/:tenantId/auth` → backend `GET /tenants/:tenantId/auth`

### Runs (tenant-first)

* `GET /api/tenants/:tenantId/runs` → backend `GET /runs` (temporary filter) **or** future backend `GET /tenants/:tenantId/runs`
* `GET /api/tenants/:tenantId/runs/:runId` → backend `GET /runs/:runId` (fail‑closed tenant check)

### Run subresources

* `GET /api/tenants/:tenantId/runs/:runId/jobs` → backend `GET /runs/:runId/jobs`
* `GET /api/tenants/:tenantId/runs/:runId/findings` → backend `GET /runs/:runId/findings`
* `GET /api/tenants/:tenantId/runs/:runId/observed-checks` → backend `GET /runs/:runId/observed-checks`
* `GET /api/tenants/:tenantId/runs/:runId/observed-checks/:observedId` → backend `GET /runs/:runId/observed-checks/:observedId`
* `GET /api/tenants/:tenantId/runs/:runId/artefacts` → backend `GET /runs/:runId/artefacts`

### Artefact downloads

* `GET /api/artefacts/:artefactId/download` → backend `GET /artefacts/:artefactId/download` (pass-through redirect)

### Run creation

* `POST /api/runs` → backend `POST /runs`

---

## Tenant isolation rules (BFF)

For any BFF route with both `tenantId` and `runId`:

1. Fetch run: backend `GET /runs/:runId`
2. Verify `run.tenant.id === tenantId`
3. If not, return `404` (fail‑closed)
4. Only then fetch the requested run subresource

This prevents cross-tenant data access even before real auth exists.

---

## Completeness & trust signalling (UI contract)

The portal must surface “trust” using **only backend-provided signals**.

Minimum initial signals (no new backend logic):

* Run status (`queued/running/succeeded/failed`)
* Job failures (`status=failed`, `lastError`)
* `dataProfile` (`safe/full`)

Future trust signals (already expected in existing contracts via observed checks/findings evidence):

* `isComplete=false`
* `permissionDenied` slices
* truncation/demo caps

The UI should treat these as **reported signals** (display), not computed judgments.

---

## Next step after this document

* Scaffold the portal with the route structure and BFF endpoints above.
* Implement a thin API client inside the portal that targets the BFF endpoints.
* Add runtime validation (optional, recommended) to catch contract drift early.
