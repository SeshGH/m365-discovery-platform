# Runs & Jobs

The platform uses a **Run â†’ Jobs (1:N)** model to execute discovery modules asynchronously and capture traceable outputs.

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

## Data model overview

### Run

A Run records:
- `tenantId` (internal tenant FK)
- `status` (`queued` â†’ `running` â†’ `succeeded` / `failed`)
- `triggeredBy` (audit metadata)
- `modulesEnabled` (requested modules)
- `startedAt` / `endedAt` (execution window)

A Run is considered:
- **queued**: created, jobs queued, none executing yet
- **running**: at least one job has been picked up
- **succeeded**: all jobs completed successfully
- **failed**: at least one job failed (even if others succeeded)

> Note: For demo/reporting we often derive an â€œoverall statusâ€ from job states.  
> `run.status` remains the canonical DB state.

### Job

A Job records:
- `runId`
- `collectorId` (stable identifier, e.g. `entra.users`)
- `payload` (JSON; includes tenant context and module key)
- `status` (`queued` â†’ `running` â†’ `succeeded` / `failed`)
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

The API does not execute collectors and does not call Microsoft Graph.

#### Report jobs are enqueued last

In the current iteration, the API also enqueues one or more **report jobs** after the module collectors. This ensures reports naturally run after collectors have produced findings and artefacts.

Current report collector IDs:
- `report.runSummary.csv`
- `report.runSummary.xlsx`

These are implemented as normal worker collectors and produce report artefacts (CSV/XLSX).

---

### 2) Worker polls and locks one Job at a time

The worker finds an eligible job:
- `status = queued`
- `lockedBy = null`
- `lockedAt is null OR lockedAt <= now` (used as â€œready timeâ€ when backoff is applied)

The worker attempts to lock the job via an atomic update:
- sets `status = running`
- sets `lockedBy = <worker-id>`
- sets `lockedAt = now`
- increments `attempts`

Only the worker that successfully updates the row proceeds.

### 3) Worker marks Run running

When a job is picked up, the worker:
- sets `Run.startedAt` if null
- ensures `Run.status = running`

### 4) Worker executes the collector

The worker resolves the collector via the registry by `collectorId` and invokes:

- `collector.run({ prisma, job, run, tenant, â€¦ })`

Collectors can:
- write findings (classified per the Findings Model)
- return artefacts for upload (worker persists them)
- return a structured result summary (persisted to the job result, if used)

### 5) Worker finalises Job

On completion:
- sets `status = succeeded` or `failed`
- sets `job.result` (where implemented)
- sets `lastError` on failure
- clears `lockedBy`

`lockedAt` is retained as the â€œjob startedâ€ timestamp for observability.

### 6) Worker recomputes Run status

After a job finishes, the worker recomputes run status from all jobs:
- if any job is `failed` â†’ `Run.status = failed`
- else if any job is `queued` or `running` â†’ `Run.status = running`
- else â†’ `Run.status = succeeded`

When the run becomes terminal (`failed` or `succeeded`), the worker sets `Run.endedAt`.

---

## Worker model & concurrency (important)

### Multiple workers are supported by design

The platform supports **multiple worker processes running concurrently**.

Key points:
- Job execution order is **not guaranteed**
- Multiple jobs from the same run may execute in parallel
- Report jobs may be picked up before other jobs *attempt* to run
- Correctness is enforced by job locking and collector-level safeguards

The system must always be correct regardless of worker count or execution order.

### Worker identification (`lockedBy`)

Each running job records:
- `lockedBy`: the worker identifier that currently owns the job
- `lockedAt`: when the job was started

For local development and demos, workers may optionally set a human-readable name via `WORKER_NAME`.

Example worker IDs:
- `worker-A-48444`
- `worker-B-49328`

This improves observability only â€” it has **no effect on job behaviour or correctness**.

---

## Local demo: running multiple workers (PowerShell)

### Start two workers with names

Open **two terminals**.

**Terminal A:**

```powershell
$env:WORKER_NAME = "A"
pnpm -C apps/worker dev
```

**Terminal B:**

```powershell
$env:WORKER_NAME = "B"
pnpm -C apps/worker dev
```

You should see logs like:
- `[worker-A-12345] Worker started. Polling every 2000ms...`
- `[worker-B-67890] Worker started. Polling every 2000ms...`

The numeric suffix is the process ID and will differ per run.

---

## Inspect jobs and see worker ownership (PowerShell-safe)

```powershell
# Set explicitly to avoid stale values in the current session
$runId = "<PASTE_RUN_ID_HERE>"
$jobs = $null

$jobs = Invoke-RestMethod "http://localhost:8080/runs/$runId/jobs" -ErrorAction Stop

($jobs | ForEach-Object { $_ } |
  Select-Object collectorId, status, lockedBy |
  ConvertTo-Json -Depth 4) | Out-String -Width 300
```

Example output:

```json
[
  { "collectorId": "entra.users", "status": "running", "lockedBy": "worker-A-48444" },
  { "collectorId": "entra.enterpriseApps.permissions", "status": "running", "lockedBy": "worker-B-49328" }
]
```

This confirms:
- multiple workers are active
- each job is owned by exactly one worker
- concurrency is observable via `lockedBy`

---

## Retries and backoff

If a collector throws:

- the worker compares `attempts` against `MAX_ATTEMPTS` (default `3`)
- if retryable:
  - the job returns to `queued`
  - `lockedAt` is set to a future timestamp (used as a ready time)
  - exponential backoff is applied
- if not retryable:
  - the job becomes `failed`
  - the run becomes `failed`
  - `Run.endedAt` is set

This ensures transient failures do not immediately fail a run.

---

## Stale job requeue

To handle crashed or hung workers, each worker requeues stale running jobs.

A job is considered stale when:
- `status = running`
- `lockedAt < now - RUNNING_STALE_LOCK_MS` (default: 10 minutes)

Stale jobs are reset to:
- `status = queued`
- `lockedBy = null`
- `lockedAt = null`
- `lastError = "Requeued stale running job (lock timeout)"`

This guarantees forward progress even if a worker exits unexpectedly.

---

## API endpoints

### Create run
- `POST /runs`

Returns:
- `runId`
- `jobIds[]`
- `tenantId`

### Read-only run endpoints
- `GET /runs`
- `GET /runs/:runId`
- `GET /runs/:runId/jobs`
- `GET /runs/:runId/findings`
- `GET /runs/:runId/artefacts`

The findings returned by these endpoints are classified according to the **Findings Model**.

The jobs endpoint includes:
- `startedAt` (derived from `lockedAt`)
- `endedAt` (derived from `updatedAt` once terminal)

---

## Security-by-design notes

- The API creates records and returns views; it does not execute collectors.
- The worker performs privileged operations (Graph access, artefact uploads).
- Job locking prevents concurrent execution of the same job by multiple workers.
- Outputs (findings and artefacts) are traceable to a run and optionally a job.
- Classification logic is documented centrally to avoid inconsistent or ad-hoc interpretation.
