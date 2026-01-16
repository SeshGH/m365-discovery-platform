# Observed Checks

Observed checks capture **raw, factual observations** made during a discovery run.

They are intentionally **non-judgemental** and **severity-free**.
Observed checks are the foundation from which findings may later be derived.

---

## What an Observed Check IS

An observed check:

* Captures a **measured fact** or state
* Is produced directly by a collector
* Is stored even when nothing is “wrong”
* May be empty or zero-valued
* Is safe to render in UI and reports
* Can be repeated across runs for comparison

Examples:

* Total number of users
* Number of risky enterprise apps
* Whether a dataset was truncated
* Whether a collector ran in `safe` or `full` profile

---

## What an Observed Check is NOT

Observed checks must **never**:

* Assign severity
* Contain recommendations
* Declare something “bad”, “misconfigured”, or “non-compliant”
* Replace findings
* Encode business logic or policy judgement

If interpretation is required → it belongs in a **Finding**.

---

## Observed Check Record Shape

Each observed check stored in the database has the following shape:

| Field         | Description                                    |
| ------------- | ---------------------------------------------- |
| `id`          | Unique ID                                      |
| `runId`       | Run that produced the observation              |
| `jobId`       | Job that emitted the observation               |
| `collectorId` | Collector that captured the fact               |
| `checkId`     | Stable identifier for this observation         |
| `ruleId`      | Optional rule identifier (reserved for future) |
| `observedAt`  | Timestamp when the fact was captured           |
| `data`        | JSON payload containing raw facts              |
| `references`  | Optional array of reference objects            |

---

## `checkId` Naming Convention

Observed check IDs must follow this pattern:

```
<SCOPE>_<AREA>_OBS_<NNN>
```

Examples:

* `ENTRA_USERS_OBS_001`
* `ENTRA_EAP_OBS_001`
* `INTUNE_DEVICES_OBS_002`

Rules:

* IDs are **stable contracts**
* Never reuse an ID for a different meaning
* Never change the meaning of an existing ID
* New checks must increment the numeric suffix

---

## `data` Payload Rules

The `data` field:

* Must be valid JSON
* Should contain **primitive values or simple objects**
* Must not exceed reasonable size limits
* Must not contain secrets or credentials

Good example:

```json
{
  "totalUsers": 36,
  "guestUsers": 0,
  "profile": "full",
  "truncated": false
}
```

Bad example:

```json
{
  "severity": "high",
  "recommendation": "Disable this setting",
  "policyDecision": true
}
```

---

## Relationship to Findings

Observed checks may be:

* Referenced by findings
* Aggregated across runs
* Compared historically
* Used to derive trends

But they **do not imply** a finding on their own.

Example:

* Observed: `riskyApps = 1`
* Finding: “Risky enterprise application permissions detected”

---

## Demo vs Long-Term Behaviour

Observed checks are:

* Always recorded in demo runs
* Always visible in the demo UI
* Always included in Excel reports

Long-term:

* They will be first-class citizens in the portal UI
* They may power dashboards and trend views
* Findings may be re-derived without re-running collectors

---

## Summary

Observed checks are:

* Facts, not opinions
* Stable, not ad-hoc
* Safe, not sensitive
* Foundational, not optional
