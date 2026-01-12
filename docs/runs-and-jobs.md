# Runs & Jobs

The platform uses a **Run → Jobs (1:N)** model to execute discovery modules asynchronously and capture traceable outputs.

A **Run** represents a single execution request for a tenant.  
A **Job** represents one unit of work within a run (typically one collector).

Runs exist to produce:
- **Findings** (decision-ready signals)
- **Artefacts** (evidence, raw data exports, reports)

How findings are classified and prioritised is defined in the platform **Findings Model**:
- **[`docs/findings-model.md`](./findings-model.md)**

This design supports:
- parallelism (multiple jobs per run)
- retries (job-level attempts)
- traceability (findings/artefacts link back to job and run)
- separation of concerns (API enqueues; worker executes)

---

## Canonical state vs derived views (important)

The platform deliberately distinguishes **canonical stored state** from **derived views**.

| Concept | Source of truth |
|------|----------------|
| Run lifecycle | `Run` table (`status`, `startedAt`, `endedAt`) |
| Job execution | `Job` table |
| Findings | `Finding` table |
| Artefacts | `Artefact` table + object storage |
| Reports (CSV/XLSX) | **Derived artefacts** |

Reports are **never** treated as primary state.  
They are generated views over existing findings, artefacts, and jobs.

---

## Data model overview

### Run

A Run records:
- `tenantId` (internal tenant FK)
- `status` (`queued` → `running` → `succeeded` / `failed`)
- `triggeredBy` (audit metadata)
- `modulesEnabled` (requested modules)
- `startedAt` / `endedAt` (execution window)

A Run is considered:
- **queued**: created, jobs queued, none executing yet
- **running**: at least one job has been picked up
- **succeeded**: all jobs completed successfully
- **failed**: at least one job failed (even if others succeeded)

> Note  
> UIs may present an “overall status” derived from jobs,  
> but `Run.status` remains the canonical database state.

---

### Job

A Job records:
- `runId`
- `collectorId` (stable identifier, e.g. `entra.users`)
- `payload` (JSON; includes tenant context and module key)
- `status` (`queued` → `running` → `succeeded` / `failed`)
- `attempts` (incremented per pickup)
- `lastError` (latest error, if any)
- `lockedBy` / `lockedAt` (worker coordination)

Jobs can link outputs:
- Findings include `jobId` for traceability
- Artefacts include `jobId` for traceability

---

## Execution lifecycle

### 1) API enqueues a Run + Jobs

The API creates:
- a `Run` (status `queued`)
- one or more `Job` rows (status `queued`)

Each Job payload includes:
- `tenantId` (internal ID)
- `tenantGuid` (Entra tenant GUID)
- `module` (module key from request)

The API:
- does **not** execute collectors
- does **not** call Microsoft Graph

#### Report jobs are enqueued last (ordering hint only)

In the current iteration, the API enqueues **report jobs** after discovery collectors.

Current report collector IDs:
- `report.runSummary.csv`
- `report.runSummary.xlsx`

This improves demo UX, but **does not guarantee execution order**.

Execution order is always nondeterministic in a concurrent worker model.

---

### 2) Worker polls and locks one Job at a time

The worker finds an eligible job:
- `status = queued`
- `lockedBy = null`
- `lockedAt is null OR lockedAt <= now`  
  (used as a “ready time” when backoff is applied)

The worker attempts to lock the job via an atomic update:
- sets `status = running`
- sets `lockedBy = <worker-id>`
- sets `lockedAt = now`
- increments `attempts`

Only the worker that successfully updates the row proceeds.

---

### 3) Worker marks Run running

When a job is picked up, the worker:
- sets `Run.startedAt` if null
- ensures `Run.status = running`

---

### 4) Worker executes the collector

The worker resolves the collector via the registry by `collectorId` and invokes:

- `collector.run({ prisma, job, run, tenant, … })`

Collectors can:
- write findings (classified per the Findings Model)
- return artefacts for upload (worker persists them)
- return a structured summary (where implemented)

---

### 5) Worker finalises Job

On completion:
- sets `status = succeeded` or `failed`
- sets `job.result` (where implemented)
- sets `lastError` on failure
- clears `lockedBy`

`lockedAt` is retained as the “job started” timestamp for observability.

---

### 6) Worker recomputes Run status

After a job finishes, the worker recomputes run status from all jobs:

- if any job is `failed` → `Run.status = failed`
- else if any job is `queued` or `running` → `Run.status = running`
- else → `Run.status = succeeded`

When the run becomes terminal, the worker sets `Run.endedAt`.

---

## Worker model & concurrency (important)

### Multiple workers are supported by design

The platform supports **multiple worker processes running concurrently**.

Key properties:
- Job execution order is **not guaranteed**
- Jobs from the same run may execute in parallel
- Report jobs may be picked up early
- Correctness is enforced by locking and collector-level safeguards

The system must remain correct regardless of worker count.

---

### Worker identification (`lockedBy`)

Each running job records:
- `lockedBy`: worker identifier
- `lockedAt`: when execution started

For local demos, workers may set `WORKER_NAME` to improve observability.

This has **no effect on behaviour or correctness**.

---

## Retries, backoff, and stale recovery

### Retries

If a collector throws:
- attempts are incremented
- retryable errors requeue the job
- `lockedAt` is set to a future timestamp
- exponential backoff is applied

Non-retryable errors fail the job and the run.

---

### Stale job requeue

If a worker crashes or hangs:

A job is considered stale when:
- `status = running`
- `lockedAt < now - RUNNING_STALE_LOCK_MS`

Stale jobs are reset to:
- `status = queued`
- `lockedBy = null`
- `lockedAt = null`
- `lastError = "Requeued stale running job (lock timeout)"`

This guarantees forward progress.

---

## Report collectors: retry-until-complete semantics (important)

**Current iteration (demo-safe behaviour)**

Report collectors are implemented as normal worker jobs, but they must only run when **all non-report jobs in the run are terminal**.

Because:
- workers are concurrent
- execution order is nondeterministic

report jobs may be picked up **before** discovery jobs finish.

To prevent partial or misleading output, report collectors:

- explicitly check run completeness at execution time
- if non-report jobs are still pending:
  - throw a controlled error (e.g.  
    `Report not ready: X non-report job(s) still pending`)
  - the error is **retryable**
  - the job is requeued with backoff
- once the run is complete, the next retry succeeds

This behaviour:
- does **not** represent a new execution phase
- does **not** introduce new state
- exists to ensure correctness under concurrency
- is safe and intentional for demos and early UX

**Long-term direction**  
Reports remain derived views. In the future, they may be generated without worker jobs at all.

---

## Demo script: multi-worker report gating proof (PowerShell)

A repeatable demo harness is included in the repo:

- `scripts/demo/multi-worker-report-gating.ps1`

What it does:
- Starts the API and **two named workers** (A/B) in separate PowerShell windows
- Applies a local-only delay (`DEMO_DELAY_EAP_MS`) to force a race
- Triggers a run and polls jobs until terminal
- Makes report gating retries obvious (`Report not ready: ...`)

Example:

```powershell
.\scripts\demo\multi-worker-report-gating.ps1 `
  -TenantGuid "<TENANT_GUID>" `
  -PrimaryDomain "<PRIMARY_DOMAIN>" `
  -DemoDelayEapMs 15000


Tip:

If you already have API/workers running, add -StopExistingFirst to stop them via pnpm dev:stop.

## API endpoints (read-only views) ##

GET /runs

GET /runs/:runId

GET /runs/:runId/jobs

GET /runs/:runId/findings

GET /runs/:runId/artefacts

These endpoints expose stored state only.
They do not trigger execution.

## Security-by-design notes ## 

The API never executes collectors

The worker performs privileged operations

Job locking prevents double execution

Outputs are traceable to run and job

Report artefacts never become sources of truth

This model ensures correctness, auditability, and safe concurrency.