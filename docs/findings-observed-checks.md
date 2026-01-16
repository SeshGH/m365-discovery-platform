# Findings – Observed Checks Registry

This document defines **observed checks** produced by collectors in the M365 Discovery Platform.

Observed checks are:

* factual observations derived directly from tenant data
* non-opinionated (no prescriptive judgement)
* used as inputs into findings, reports, and future scoring

They intentionally differ from *findings*, which apply interpretation and severity.

---

## Purpose

This registry exists to:

* standardise how collectors emit observations
* ensure repeatability and consistency across collectors
* decouple data collection from risk interpretation
* support future rule engines, scoring, and UI visualisation

---

## Terminology

| Term                 | Meaning                                                                      |
| -------------------- | ---------------------------------------------------------------------------- |
| **Observed check**   | A single, named observation derived from tenant state                        |
| **Source collector** | Collector responsible for producing the observation                          |
| **Evidence**         | Raw or derived data supporting the observation                               |
| **Finding**          | A higher-level interpretation that may reference one or more observed checks |

---

## Observed check structure

Each observed check MUST include:

* `checkId` – stable, namespaced identifier
* `collectorId` – emitting collector
* `runId` – run the observation belongs to
* `jobId` – producing job (if applicable)
* `observedAt` – timestamp of observation
* `data` – machine-readable observation payload

Observed checks MAY include:

* `ruleId` – reference to a rule that may later consume this observation
* `references` – artefact links, object IDs, or URLs

Observed checks MUST NOT:

* assign severity
* make recommendations
* imply compliance or non-compliance

---

## Naming conventions

Observed checks use dot-notation:

```
<area>.<entity>.<condition>
```

Examples:

* `entra.users.total`
* `entra.users.guests.present`
* `entra.enterpriseApps.permissions.present`

Identifiers are **stable contracts**.

---

## Relationship to Findings (Critical Rule)

Observed checks and findings are **intentionally separate layers**.

### Key principle

> **Observed checks record what exists. Findings decide what it means.**

An observed check:

* captures a fact, count, state, or boolean condition
* is always emitted, even when the value is zero or false
* must remain stable and repeatable across runs

A finding:

* interprets one or more observed checks
* assigns severity, confidence, and guidance
* may change over time as interpretation logic evolves

---

### One-to-many mapping

A single observed check may:

* support **multiple findings**, or
* support **no findings at all** in some tenants

Example:

* Observed check: `entra.enterpriseApps.risky.present`
* Possible findings:

  * “High-risk delegated permissions detected”
  * “Third-party app governance required”

The observed check itself **never changes meaning**, even if findings do.

---

### No implied judgement

Observed checks must never:

* imply risk
* imply correctness or incorrectness
* embed policy assumptions

This allows:

* safer demos
* customer-specific interpretation
* future scoring and rule engines

---

## Initial observed checks

### Entra Users

| checkId                      | Description           | Data payload                          |
| ---------------------------- | --------------------- | ------------------------------------- |
| `entra.users.total`          | Total number of users | `{ count: number }`                   |
| `entra.users.enabled`        | Enabled users         | `{ count: number }`                   |
| `entra.users.disabled`       | Disabled users        | `{ count: number }`                   |
| `entra.users.guests.present` | Guest users present   | `{ present: boolean, count: number }` |

---

### Enterprise Applications

| checkId                                    | Description                | Data payload                          |
| ------------------------------------------ | -------------------------- | ------------------------------------- |
| `entra.enterpriseApps.total`               | Total enterprise apps      | `{ count: number }`                   |
| `entra.enterpriseApps.scanned`             | Apps scanned by collector  | `{ count: number }`                   |
| `entra.enterpriseApps.permissions.present` | App permissions detected   | `{ present: boolean }`                |
| `entra.enterpriseApps.risky.present`       | Risky permissions detected | `{ present: boolean, count: number }` |

---

## Collector responsibilities

Collectors MUST:

* emit observed checks consistently
* include raw counts even when zero
* respect `dataProfile` boundaries
* avoid suppressing observations due to perceived insignificance

Collectors MUST NOT:

* infer risk level
* suppress checks because a finding was not raised

---

## Reporting and UI usage

Observed checks:

* must always be safe to render
* may appear in reports even when no findings exist
* are suitable for timelines, charts, and coverage indicators

Reports and UI layers must:

* tolerate empty observed-check sets
* avoid implying judgement without a finding

---

## Future extensions

This registry intentionally supports:

* scoring engines
* compliance mappings
* UI visualisation layers
* customer-specific interpretation rules

Observed checks are the **stable foundation** for all of the above.
