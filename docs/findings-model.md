# Findings Model

This document defines the **standard model** for Findings produced by collectors in the M365 Discovery Platform.

A Finding is an **interpreted signal** (risk, gap, misconfiguration, governance issue, or meaningful scoping complexity driver).
It is **not** an inventory record.

Observed checks are related but separate: they capture **facts without judgement**. See `docs/findings-observed-checks.md`.

---

## Findings are signals, not inventory

Examples of **inventory (not findings)**:

* “User exists”
* “Mailbox exists”
* “100 SharePoint sites exist”

These belong in **artefacts** (inventories/exports), with **summary counts** used by scoping/reporting.

Examples of **signals (good findings)**:

* “Enterprise app has high-privilege Graph permissions”
* “Audit retention too low to support investigation”
* “Privileged roles assigned to daily-use accounts”
* “Guest users present with no lifecycle controls”
* “Scan truncated; results may be incomplete” (data completeness signal, often demo-only)

This rule keeps Findings decision-ready and prevents the UI/report from becoming noise as coverage grows.

---

## Data model and contract

The platform persists Findings in Postgres via Prisma (`Finding` model in `packages/db/prisma/schema.prisma`).

There are **two important shapes** to understand:

1. **Persisted shape (DB contract):** what we store.
2. **API shape (v1 contract):** what endpoints currently return.

### Persisted fields (DB)

Persisted fields are intended to be stable over time.

* `id` — primary key
* `runId` — owning run
* `jobId` — producing job (nullable)
* `checkId` — stable identifier for the check/signal (**contract**)
* `ruleId` — optional mapping to a future rule engine (nullable)

Classification / lifecycle (stored today; not all are surfaced by the v1 API yet):

* `category` — broad area (see Category)
* `severity` — impact ladder (see Severity)
* `confidence` — credibility ladder (see Confidence)
* `status` — lifecycle state (see Status)
* `score` — optional numeric score for sorting/trending

Human-readable fields:

* `title` — short summary
* `description` — what was detected and why it matters
* `recommendation` — suggested next action/remediation (nullable)

Supporting context:

* `evidence` — small JSON supporting details (must not be a large payload)
* `references` — optional JSON list of links/notes for further reading

Timestamps:

* `createdAt`
* `updatedAt`

**Rule:** Findings must remain **small and readable**. Large evidence and inventories belong in artefacts.

### API fields (v1)

Current run-scoped endpoints intentionally return a **minimal** finding payload suitable for UI and reports.

As of today, `GET /runs/:runId/findings` returns (subset):

* `id`, `runId`, `jobId`
* `checkId`, `severity`
* `title`, `description`, `recommendation`
* `evidence`, `references`
* `createdAt`

Category / confidence / status / score are **stored** but are not currently guaranteed to be present in v1 API responses.

---

## Stable check IDs (contract)

`checkId` values are treated as stable contracts.

Rules:

* A `checkId` must **never change meaning** once shipped.
* Prefer predictable, namespaced IDs.

Current implemented examples:

* `ENTRA_USERS_001` — guest users present
* `ENTRA_EAP_001` — high-privilege Graph permissions detected
* `ENTRA_EAP_002` — scan truncated (results may be incomplete)

Recommended format:

* `{DOMAIN}_{AREA}_{NNN}` (e.g. `ENTRA_EAP_003`)

The authoritative list of implemented finding IDs lives in `docs/findings-registry.md`.

---

## Severity (contract)

Severity answers:

> “If ignored, how bad could this realistically be?”

Severity is **impact-based** (not confidence).

Supported ladder:

* `info` — worth knowing; no meaningful risk on its own
* `low` — minor weakness / defence-in-depth improvement
* `medium` — legitimate concern; should be planned and addressed
* `high` — serious exposure if abused; prioritise remediation
* `critical` — direct compromise path or tenant-wide high-impact risk
* `unknown` — only if impact cannot be determined (should be rare)

Guidance:

* Avoid overusing `unknown`.
* Do not encode inventory as `info` findings long-term; use artefacts + summaries instead.

---

## Category (stored)

Category is used for grouping/filtering and long-term coverage tracking.

Suggested set (keep stable and not overly granular):

* `identity`
* `access`
* `application_permissions`
* `tenant_configuration`
* `audit_and_logging`
* `data_protection`
* `device_management`
* `other`

Note: “data completeness” style signals (e.g. truncation) currently map to `other` in the schema. If we want a dedicated category later, that must be a deliberate schema + documentation change.

---

## Confidence (stored)

Confidence answers:

> “How sure are we that this is actually a problem?”

* `high` — direct, authoritative evidence
* `medium` — reasonable inference with good evidence but some assumptions
* `low` — heuristic / incomplete telemetry / higher false-positive risk

Guidance:

* Do not inflate confidence to justify severity.
* A `critical` finding can be low confidence if evidence is incomplete (treat carefully in UI/reporting).

---

## Status (stored)

Status is the lifecycle state for operational tracking over time:

* `open`
* `acknowledged`
* `resolved`
* `false_positive`

Status records human/operational decisions; it must not change the underlying evidence.

---

## Score (stored, optional)

Severity is designed for humans. A numeric score supports sorting and trending.

If we introduce a standard scoring mapping, it must be:

* simple
* explainable
* documented

Until then, treat `score` as optional and do not assume it exists.

---

## Writing good findings

Collectors should aim to produce findings that are:

* **Clear** (human-readable title)
* **Evidence-based** (include key supporting details)
* **Actionable** (recommendation where appropriate)
* **Non-invasive** (avoid leaking sensitive data into findings)

A good mental model:

* Severity = how much it’s on fire
* Evidence = why we think it’s on fire
* Recommendation = what to do about it
