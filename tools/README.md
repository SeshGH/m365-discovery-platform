# tools

Internal maintenance / one-off scripts for the M365 Discovery Platform.

These scripts are **not** part of the API or worker runtime and should be run manually by engineers with appropriate access.

## run-status-backfill.js

Backfills `Run.status`, `Run.startedAt`, and `Run.endedAt` based on related `Job` rows.

### When to use
- After importing/migrating data
- If earlier versions of the worker didn’t correctly set run status/timestamps
- After fixing a bug and you need to reconcile historical run state

### How it works
Executes a single SQL `UPDATE` against the `Run` table:
- `status` derived from presence of `Job.status` values (failed > running > queued > succeeded)
- `startedAt` set from earliest `Job.lockedAt` if missing
- `endedAt` set from latest `Job.updatedAt` if no queued/running jobs exist

### Safety
- Intended for **trusted/local** execution only.
- Uses `prisma.$executeRawUnsafe` and must never be exposed to untrusted input.

### Run it
From the repo root (with the usual DB env vars configured for Prisma):

```bash
node tools/run-status-backfill.js
