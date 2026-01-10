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

- **[Developer Workflow](./dev-workflow.md)**  
  How development is performed on this platform: command hygiene, documentation-first habits, incremental change discipline, and version-control expectations.  
  This document defines *how we work*, not just *what we build*.

---

## Features

- **[Tenant Auth (Connection Test)](./tenant-auth.md)**  
  Worker-driven app-only Microsoft Graph connectivity test that updates `TenantAuth` state without the API calling Graph directly.

- **[Runs & Jobs](./runs-and-jobs.md)**  
  Run → Job lifecycle, locking, retries, and traceability for findings and artefacts.

- **[Artefacts](./artefacts.md)**  
  Artefact storage model, upload flow, metadata, and presigned download URLs.

---

## Planning & Coverage

- **[Discovery Coverage Roadmap](./discovery-coverage-roadmap.md)**  
  What the platform currently discovers, what is planned, and how coverage evolves over time.

- **[Scoping Model](./scoping-model.md)**  
  How raw discovery data is interpreted through a scoping lens for migrations, take-ons, and tenant-to-tenant work.

- **[Scoping Lens](./scoping-lens.md)**  
  Conceptual views used to translate findings into commercial and delivery-relevant insights.

---

## Platform Foundations

- **[Local Development](./local-development.md)**  
  How to run the API, worker, Postgres, and artefact storage locally.

- **[Security](./security.md)**  
  Threat model, trust boundaries, and security-by-design decisions.
