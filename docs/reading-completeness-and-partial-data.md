# Reading Completeness and Partial Data

This document explains how to interpret **completeness**, **permission gaps**, and **partial data** in the M365 Discovery Platform.

It is intended for:

* consultants and technical pre-sales
* delivery engineers
* reviewers and stakeholders consuming reports

The goal is to ensure partial data is understood as a **transparent discovery signal**, not a failure.

---

## Why completeness exists

The platform is designed to operate safely across:

* least-privilege tenants
* demo and proof-of-concept environments
* early take-on or acquisition scenarios

In these situations, it is common for:

* some Microsoft Graph permissions to be missing
* some APIs to be intentionally capped (demo guardrails)
* privileged surfaces (roles, CA, PIM) to be inaccessible

Rather than failing discovery, the platform records **what could and could not be observed**.

This allows discovery to proceed while making **unknowns explicit**.

---

## Core principle

> **Incomplete data is still valuable — as long as it is clearly labelled.**

Completeness is therefore treated as **first-class evidence**, not an error.

---

## How completeness is represented

Completeness is surfaced consistently via **observed checks** and artefact metadata.

### Common fields

Across collectors, you may see:

| Field              | Meaning                                                   |
| ------------------ | --------------------------------------------------------- |
| `isComplete`       | Whether core evidence for this domain was fully collected |
| `truncated`        | Whether enumeration was intentionally capped              |
| `permissionDenied` | Which data slices were blocked by missing permissions     |
| `slicesAttempted`  | Which logical parts of the collector were attempted       |
| `slicesCompleted`  | Which parts completed successfully                        |
| `notes`            | Human-readable context explaining gaps                    |

These fields are **signals**, not judgements.

---

## Permission-denied is not a failure

When Microsoft Graph returns **HTTP 403**, the platform treats this as:

* **Missing or insufficient permissions**
* **Not a runtime error**

Behavioural guarantees:

* The collector continues wherever possible
* Artefacts may still be produced
* Observed checks are still emitted
* Gaps are recorded explicitly

This supports:

* least-privilege operation
* safer demos
* early-stage discovery

---

## Impact on findings (critical rule)

Findings are **always gated by completeness**.

Rules:

* Findings MUST NOT be emitted when required evidence is incomplete
* Completeness checks are evaluated **before** any interpretation
* This prevents false negatives and misleading assurances

Examples:

* Guest users are **not** flagged if user enumeration was permission-denied
* Directory role risks are **not** inferred if role assignments are incomplete
* Conditional Access findings are **not** emitted when policies could not be fully enumerated

---

## How to explain this to customers

Suggested phrasing:

> “We were able to safely enumerate most of the tenant, but some privileged areas require additional permissions. Rather than guessing, the tool clearly marks those areas as incomplete so we can call them out explicitly.”

Key points to reinforce:

* Partial data is safer than assumptions
* Missing permissions are common in early engagements
* Completeness highlights **where deeper discovery would add value**

---

## Security posture vs take-on scoping

Completeness supports **both lenses**:

### Security posture

* Avoids false confidence
* Prevents under-reporting of risk
* Makes permission gaps explicit

### Take-on / migration scoping

* Highlights governance complexity
* Identifies unknowns and assumptions
* Supports effort and risk estimation

---

## What completeness does NOT mean

Completeness does **not** mean:

* the tenant is misconfigured
* the tool failed
* permissions were requested incorrectly

It simply means:

> “This part of the environment could not be fully observed with the permissions available.”

---

## Summary

* Completeness is an intentional discovery feature
* Permission gaps are treated as evidence
* Findings are always gated by completeness
* Partial data is clearly labelled and safe to consume

Understanding completeness allows the platform to be used confidently in:

* demos
* early engagements
* regulated or least-privilege environments

— without sacrificing correctness or trust.
