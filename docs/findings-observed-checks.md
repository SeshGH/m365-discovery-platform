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
* `category` – broad classification (identity, apps, security, etc.)
* `subject` – what the check applies to (user, app, tenant, policy)
* `result` – machine-readable outcome
* `evidence` – supporting values or counts
* `dataProfile` – `safe` or `full`

Checks MUST NOT:

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

## Initial observed checks

### Entra Users

| checkId                      | Description           | Evidence        |
| ---------------------------- | --------------------- | --------------- |
| `entra.users.total`          | Total number of users | count           |
| `entra.users.enabled`        | Enabled users         | count           |
| `entra.users.disabled`       | Disabled users        | count           |
| `entra.users.guests.present` | Guest users present   | boolean + count |

### Enterprise Applications

| checkId                                    | Description                | Evidence        |
| ------------------------------------------ | -------------------------- | --------------- |
| `entra.enterpriseApps.total`               | Total enterprise apps      | count           |
| `entra.enterpriseApps.scanned`             | Apps scanned by collector  | count           |
| `entra.enterpriseApps.permissions.present` | App permissions detected   | boolean         |
| `entra.enterpriseApps.risky.present`       | Risky permissions detected | boolean + count |

---

## Relationship to findings

Findings:

* may reference one or more observed checks
* apply severity and guidance
* may differ by tenant context or scoping lens

Example:

> Finding: *High-risk delegated permissions detected*
>
> References:
>
> * `entra.enterpriseApps.risky.present`
> * `entra.enterpriseApps.permissions.present`

---

## Collector responsibilities

Collectors MUST:

* emit observed checks consistently
* include raw counts even when zero
* respect `dataProfile` boundaries

Collectors MUST NOT:

* infer risk level
* suppress checks due to perceived insignificance

---

## Future extensions

This registry intentionally supports:

* scoring engines
* compliance mappings
* UI visualisation layers
* customer-specific interpretation rules

Observed checks are the **stable foundation** for all of the above.
