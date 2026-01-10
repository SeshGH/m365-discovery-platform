# M365 Discovery Platform — Documentation

This directory contains **technical documentation maintained alongside development**.

The goal is to make architectural intent, security boundaries, and feature behaviour explicit so the platform remains understandable as it grows.

Documentation here is **engineering-focused**, not marketing or sales material.

---

## Conventions

- Each **meaningful feature** (stateful, security-sensitive, or cross-process) should have its own document.
- Docs should explain:
  - *Why* something exists
  - *How* it works end-to-end
  - *Where* trust boundaries are enforced
- Inline code comments are used for local detail; docs are used for system-level understanding.
- Where behaviour spans collectors, API, and worker, the **shared contract** should be documented explicitly.

---

## Core Concepts

- **[Findings Model](./findings-model.md)**  
  Canonical definition of how discovery results are classified and prioritised, including taxonomy, severity, confidence, lifecycle status, and numeric scoring.  
  This document is the **source of truth** for how findings should be interpreted by humans and downstream systems.

- **[Scoping Model](./scoping-model.md)**  
  Definition of the “scoping lens” used to reduce manual effort for migrations/take-ons: coverage awareness, inventory signals, complexity drivers, and how the summary is derived from runs/jobs/findings/artefacts.

---

## Features

- **[Tenant Auth (Connection Test)](./tenant-auth.md)**  
  Worker-driven app-only Microsoft Graph connectivity test that updates `TenantAuth` state without the API calling Graph directly.

- **[Runs & Jobs](./runs-and-jobs.md)**  
  Run → Job lifecycle, locking, retries, and traceability for findings and artefacts.

- **[Artefacts](./artefacts.md)**  
  Artefact storage model, upload flow, metadata, and presigned download URLs.

---

## Planned (as the platform evolves)

These will be added incrementally when the related functionality exists:

- **Collectors**
  - contract, registration, findings vs artefacts
- **Local Development**
  - running API, worker, Postgres, MinIO
- **Security**
  - threat model, design decisions, least-privilege rationale
