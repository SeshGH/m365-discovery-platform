# Collector Hardening Checklist

This checklist defines the **minimum hardening standards** for all collectors in the M365 Discovery Platform.

It exists to ensure:

* predictable behaviour across collectors
* safe-by-default data handling
* consistent artefact contracts
* resilience against partial failures
* long-term maintainability as the collector surface grows

This document applies to **all new collectors** and should be reviewed when modifying existing ones.

---

## 1. Collector Identity & Registration

* Each collector must have a **stable, unique collector ID** and be explicitly registered with the worker runtime.

  Collector IDs are treated as **long-lived contracts** and must not be renamed casually, as they appear in:

  * job records
  * run history
  * reports
  * demos and documentation

* Collectors must be discoverable and runnable without implicit side-effects or hidden configuration.

---

## 2. Data Profile Handling (Safe vs Full)

* Collectors must explicitly respect the run’s `dataProfile` (`safe` or `full`).

  * **Safe** runs must limit scope, depth, or sensitive fields.
  * **Full** runs may expand scope but must remain bounded and predictable.

* Where output differs, artefacts should either:

  * use profile-specific filenames (`*.safe.json`, `*.full.json`), or
  * follow documented legacy conventions.

* Profile handling must be **explicit**, not inferred.

---

## 3. External API & Graph Access

* Collectors that call Microsoft Graph or external APIs must:

  * handle pagination correctly
  * respect throttling and retry guidance
  * avoid unbounded fan-out or recursion

* Authentication, permissions, and API assumptions must be compatible with:

  * CDX demo tenants
  * least-privilege app registrations

* Graph usage must be observable and debuggable.

---

## 4. Error Handling & Resilience

* Collectors must fail **cleanly and observably**.

* Expected failure modes (permissions, missing data, API errors) should:

  * mark the job as `failed`
  * record a meaningful `lastError`
  * not crash the worker process

* Retries must be intentional and finite.

---

## 5. Artefact Generation

* Collectors may emit one or more artefacts.

* Each artefact must:

  * have a clear purpose
  * be deterministic for a given input
  * be serialisable and downloadable via the API

* Artefacts are first-class outputs and must not be treated as incidental debug data.

---

## 6. Artefact Contracts

* Artefact filenames, keys, and JSON structures are **contracts**, not implementation details.

* Changes to:

  * filenames
  * JSON shape
  * summary semantics

  must be:

  * deliberate
  * documented
  * compatible with reporting and demo flows

* Reports and downstream consumers rely on these contracts.

---

## 7. Findings (Optional but Encouraged)

* Collectors may emit **findings** when they identify notable conditions.

* Findings should:

  * represent security, risk, or configuration observations
  * have a clear severity and message
  * be deduplicatable across runs where possible

* Collectors that do not produce findings should do so intentionally.

---

## 8. Observed Checks (Preferred Pattern)

* Where applicable, collectors should prefer **observed checks** over hard pass/fail logic.

* Observed checks:

  * record what was seen, not what “should” be
  * support later interpretation and scoring
  * decouple data collection from policy judgement

* This pattern enables safer demos and richer reporting.

---

## 9. Reporting Compatibility

* Collectors must be compatible with:

  * `run-summary.csv` (legacy, minimal)
  * `run-summary.xlsx` (primary reporting artefact)

* If required artefacts are missing or unparsable:

  * reports must still generate
  * gaps must be clearly annotated (not silently ignored)

* Reports must never crash due to a single collector.

---

## 10. Demo & UX Compatibility

* Collectors must be demo-friendly.

* A complete collector flow should be demonstrable via:

  * the demo portal UI
  * observable job progress
  * visible artefacts and reports

* PowerShell or direct API usage may exist for validation, but **UI-first demo flows are the default**.

---

## 11. Documentation

* Every collector must be documented with:

  * purpose and scope
  * artefacts produced
  * findings or observed checks emitted
  * safe vs full behaviour differences

* Documentation must reflect **current behaviour**, not future intent.

---

## 12. Git Hygiene

* Collector changes must follow disciplined Git practices:

  * small, focused commits
  * descriptive commit messages
  * no demo artefacts or local files committed

* Collectors are infrastructure code and should be treated accordingly.

---

## Definition of Done (Collector)

A collector is considered **done** when:

* it passes this checklist
* it runs cleanly in `safe` and `full` profiles
* it produces valid artefacts
* it integrates with reports
* it is documented

Anything less is considered **experimental**.
