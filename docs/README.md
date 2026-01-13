# m365-discovery-platform

The **M365 Discovery Platform** is a monorepo-based system for running controlled discovery and security/scoping assessments against Microsoft 365 tenants.

It is designed to:
- execute discovery in a **safe-by-default** manner
- separate orchestration, collection, and reporting concerns
- produce stable, contract-driven outputs suitable for automation and UI consumption

---

## High-level architecture

The platform consists of:

- **API** (Fastify, Node.js)
  - run creation and lifecycle management
  - artefact discovery and download (via presigned redirects)
- **Worker**
  - job polling and execution
  - collector execution
  - artefact upload and persistence
- **PostgreSQL** (Prisma)
  - runs, jobs, findings, artefact metadata
- **MinIO / S3-compatible storage**
  - artefact payload storage

---

## Key concepts

- **Runs** represent a single discovery execution against a tenant
- **Jobs** represent individual collector executions within a run
- **Collectors** gather data and emit:
  - **Findings** (decision-ready signals)
  - **Artefacts** (inventories, evidence, reports)
- **Reports** are terminal artefacts derived from run data

---

## Contracts and documentation

The platform treats certain outputs as **stable contracts**.

Authoritative documentation:
- **Artefact & report contracts:**  
  `docs/artefact-and-report-contracts.md`
- Collector behaviour and design rules:  
  `docs/collectors.md`
- Run and job orchestration model:  
  `docs/runs-and-jobs.md`
- Local development guide:  
  `docs/local-development.md`

Other documentation provides context and roadmap guidance but must not redefine runtime behaviour.

---

## Design principles

- one step at a time
- verify behaviour in code before documenting
- security-by-design and least privilege
- safe-by-default data handling
- explicit contracts over implicit assumptions

---

This repository reflects **current implemented behaviour**, not aspirational design.


---

## Demo-only UI

For quick local testing, the API exposes `GET /demo` which provides a minimal run launcher and live job viewer. This is **demo-only**; the long-term UI will live in a dedicated portal app.
