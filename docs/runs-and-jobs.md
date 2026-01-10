# Runs & Jobs

The platform uses a **Run → Jobs (1:N)** model to execute discovery modules asynchronously and capture traceable outputs.

A **Run** represents a single execution request for a tenant.
A **Job** represents one unit of work within a run (typically one collector).

Runs exist to produce:
- **classified Findings** (the primary decision-making output)
- supporting **Artefacts** (evidence, raw data, reports)

How findings are classified and prioritised is defined in the platform **Findings Model**:
- **[`docs/findings-model.md`](./findings-model.md)**

This design supports:
- parallelism (multiple jobs per run)
- retries (job-level attempts)
- traceability (findings/artefacts can link back to the job)
- separation of concerns (API enqueues; worker executes)

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

### Job
A Job records:
- `runId`
- `collectorId` (stable identifier, e.g. `entra.users`)
- `payload` (JSON; includes tenant context and module key)
- `status` (`queued` → `running` → `succeeded` / `failed`)
- `attempts` (incremented per pickup)
- `lastError` (latest error, if any)
- `lockedBy` / `lockedAt` (worker coordination)

Jobs can optionally link outputs:
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

### 2) Worker polls and locks one Job at a time
The worker finds an eligible job:
- `status = queued`
- `lockedBy = null`
- `lockedAt is null OR lockedAt <= now`

The worker then attempts to lock the job via an atomic update:
- sets `status = running`
- sets `lockedBy = <worker-id>`
- sets `lockedAt = now`
- increments `attempts`

Only the worker that successfully updates the row proceeds.

### 3) Worker marks Run running
When a job is picked up:
- sets `Run.startedAt` if null
- ensures `Run.status = running`

### 4) Worker executes the collector
The worker resolves the collector via the registry by `collectorId` and invokes:

- `collector.run({ prisma, job, run, tenant })`

Collectors can:
- write findings (classified per the Findings Model)
- return artefacts for upload (worker persists them)
- return a structured result (saved to `job.result`)

### 5) Worker finalises Job
On completion:
- sets `status = succeeded` or `failed`
- sets `job.result`
- sets `lastError` on failure
- clears `lockedBy`

`lockedAt` is retained as the “job started” timestamp for observability.

### 6) Worker recomputes Run status
After a job finishes, the worker recomputes run status from all jobs:
- if any job is `failed` → `Run.status = failed`
- else if any job is `queued` or `running` → `Run.status = running`
- else → `Run.status = succeeded`

When the run becomes terminal (`failed` or `succeeded`), the worker sets `Run.endedAt`.

---

## Retries and backoff

If a collector throws:
- the worker compares `attempts` against `MAX_ATTEMPTS` (default 3)
- if retryable:
  - job returns to `queued`
  - `lockedAt` is set to a future timestamp (ready time) using exponential backoff
- if not retryable:
  - job becomes `failed`
  - run becomes `failed` and `endedAt` is set

---

## Stale job requeue

To handle crashed/hung workers, the worker requeues stale running jobs:

- `status = running`
- `lockedAt < now - RUNNING_STALE_LOCK_MS` (default 10 minutes)

These jobs are set back to:
- `status = queued`
- `lockedBy = null`
- `lockedAt = null`
- `lastError = "Requeued stale running job (lock timeout)"`

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

The findings returned by these endpoints are classified according to the **Findings Model**, ensuring consistent interpretation across runs and collectors.

The jobs endpoint includes:
- `startedAt` (derived from `lockedAt`)
- `endedAt` (derived from `updatedAt` once terminal)

---

## Security-by-design notes

- The API creates records and returns views; it does not execute collectors.
- The worker performs privileged operations (Graph access, artefact uploads).
- Job locking prevents concurrent execution of the same job by multiple workers.
- Outputs (findings/artefacts) are traceable to a run and optionally a job.
- Classification logic is documented centrally to avoid inconsistent or ad-hoc risk interpretation.
