// apps/worker/src/derivedObservedChecks/__tests__/derivedObservedChecks.test.ts
//
// Unit tests for the pure `evaluateCaArtefact` function.
//
// `evaluateCaArtefact` receives a pre-validated slice of CA policy objects.
// The orchestration layer (deriveSecondaryObservedChecksForRun) is responsible
// for completeness guards (no artefact, S3 error, bad JSON, permissionDenied,
// truncated → do not emit).  This file tests only the policy evaluation logic.

import { describe, it, expect } from "vitest";
import { evaluateCaArtefact } from "../index";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal safe-profile policy shape. */
function policy(overrides: {
  state?: string;
  mfa?: boolean;
  targetsAllUsers?: boolean;
  builtInControls?: string[];
}) {
  return {
    state: overrides.state ?? "enabled",
    conditions: {
      users: {
        targetsAllUsers: overrides.targetsAllUsers ?? false
      }
    },
    grantControls: {
      builtInControls: overrides.builtInControls ?? (overrides.mfa ? ["mfa"] : [])
    }
  };
}

// ── Empty / missing policies ───────────────────────────────────────────────────

describe("evaluateCaArtefact — empty policies", () => {
  it("returns all false for an empty array", () => {
    const result = evaluateCaArtefact([]);
    expect(result).toEqual({
      hasAnyEnabledPolicy: false,
      hasAnyMfaPolicy: false,
      hasEnabledMfaForAllUsers: false
    });
  });
});

// ── hasAnyEnabledPolicy ───────────────────────────────────────────────────────

describe("evaluateCaArtefact — hasAnyEnabledPolicy", () => {
  it("is false when all policies are disabled", () => {
    const result = evaluateCaArtefact([
      policy({ state: "disabled" }),
      policy({ state: "disabled" })
    ]);
    expect(result.hasAnyEnabledPolicy).toBe(false);
  });

  it("is false when all policies are reportOnly", () => {
    const result = evaluateCaArtefact([policy({ state: "reportOnly" })]);
    expect(result.hasAnyEnabledPolicy).toBe(false);
  });

  it("is true when at least one policy is enabled", () => {
    const result = evaluateCaArtefact([
      policy({ state: "disabled" }),
      policy({ state: "enabled" })
    ]);
    expect(result.hasAnyEnabledPolicy).toBe(true);
  });
});

// ── hasAnyMfaPolicy ───────────────────────────────────────────────────────────

describe("evaluateCaArtefact — hasAnyMfaPolicy", () => {
  it("is false when no policies have mfa in builtInControls", () => {
    const result = evaluateCaArtefact([policy({ state: "enabled", mfa: false })]);
    expect(result.hasAnyMfaPolicy).toBe(false);
  });

  it("is true when a disabled policy has mfa", () => {
    const result = evaluateCaArtefact([policy({ state: "disabled", mfa: true })]);
    expect(result.hasAnyMfaPolicy).toBe(true);
  });

  it("is true when a reportOnly policy has mfa", () => {
    const result = evaluateCaArtefact([policy({ state: "reportOnly", mfa: true })]);
    expect(result.hasAnyMfaPolicy).toBe(true);
  });

  it("is true when an enabled policy has mfa", () => {
    const result = evaluateCaArtefact([policy({ state: "enabled", mfa: true })]);
    expect(result.hasAnyMfaPolicy).toBe(true);
  });

  it("is case-insensitive for 'mfa' control string", () => {
    const result = evaluateCaArtefact([
      policy({ state: "enabled", builtInControls: ["MFA"] })
    ]);
    expect(result.hasAnyMfaPolicy).toBe(true);
  });

  it("matches 'mfa' among other controls", () => {
    const result = evaluateCaArtefact([
      policy({ state: "enabled", builtInControls: ["compliantDevice", "mfa"] })
    ]);
    expect(result.hasAnyMfaPolicy).toBe(true);
  });
});

// ── hasEnabledMfaForAllUsers ───────────────────────────────────────────────────

describe("evaluateCaArtefact — hasEnabledMfaForAllUsers", () => {
  it("is false for empty policy list", () => {
    expect(evaluateCaArtefact([]).hasEnabledMfaForAllUsers).toBe(false);
  });

  it("is false when mfa policy is disabled-state only", () => {
    const result = evaluateCaArtefact([
      policy({ state: "disabled", mfa: true, targetsAllUsers: true })
    ]);
    expect(result.hasEnabledMfaForAllUsers).toBe(false);
  });

  it("is false when mfa policy is reportOnly-state only", () => {
    const result = evaluateCaArtefact([
      policy({ state: "reportOnly", mfa: true, targetsAllUsers: true })
    ]);
    expect(result.hasEnabledMfaForAllUsers).toBe(false);
  });

  it("is false when policy is enabled+mfa but does NOT target all users", () => {
    const result = evaluateCaArtefact([
      policy({ state: "enabled", mfa: true, targetsAllUsers: false })
    ]);
    expect(result.hasEnabledMfaForAllUsers).toBe(false);
  });

  it("is false when policy is enabled+allUsers but has no mfa grant control", () => {
    const result = evaluateCaArtefact([
      policy({ state: "enabled", mfa: false, targetsAllUsers: true })
    ]);
    expect(result.hasEnabledMfaForAllUsers).toBe(false);
  });

  it("is true when policy is enabled+mfa+allUsers", () => {
    const result = evaluateCaArtefact([
      policy({ state: "enabled", mfa: true, targetsAllUsers: true })
    ]);
    expect(result.hasEnabledMfaForAllUsers).toBe(true);
  });

  it("is true when at least one qualifying policy exists among others", () => {
    const result = evaluateCaArtefact([
      policy({ state: "disabled", mfa: true, targetsAllUsers: true }),
      policy({ state: "enabled", mfa: false, targetsAllUsers: true }),
      policy({ state: "enabled", mfa: true, targetsAllUsers: false }),
      policy({ state: "enabled", mfa: true, targetsAllUsers: true }) // qualifies
    ]);
    expect(result.hasEnabledMfaForAllUsers).toBe(true);
  });

  it("is case-insensitive for 'mfa' control string", () => {
    const result = evaluateCaArtefact([
      policy({ state: "enabled", builtInControls: ["MFA"], targetsAllUsers: true })
    ]);
    expect(result.hasEnabledMfaForAllUsers).toBe(true);
  });
});

// ── Composite scenarios ────────────────────────────────────────────────────────

describe("evaluateCaArtefact — composite scenarios", () => {
  it("tenant with no CA policies at all", () => {
    expect(evaluateCaArtefact([])).toEqual({
      hasAnyEnabledPolicy: false,
      hasAnyMfaPolicy: false,
      hasEnabledMfaForAllUsers: false
    });
  });

  it("healthy: enabled MFA policy targeting all users", () => {
    const result = evaluateCaArtefact([
      policy({ state: "enabled", mfa: true, targetsAllUsers: true })
    ]);
    expect(result).toEqual({
      hasAnyEnabledPolicy: true,
      hasAnyMfaPolicy: true,
      hasEnabledMfaForAllUsers: true
    });
  });

  it("mfa policy is report-only — hasAnyMfaPolicy true, hasEnabledMfaForAllUsers false", () => {
    const result = evaluateCaArtefact([
      policy({ state: "reportOnly", mfa: true, targetsAllUsers: true }),
      policy({ state: "enabled", mfa: false, targetsAllUsers: true })
    ]);
    expect(result.hasAnyMfaPolicy).toBe(true);
    expect(result.hasAnyEnabledPolicy).toBe(true);
    expect(result.hasEnabledMfaForAllUsers).toBe(false);
  });

  it("mfa policy exists but targets a subset of users", () => {
    const result = evaluateCaArtefact([
      policy({ state: "enabled", mfa: true, targetsAllUsers: false })
    ]);
    expect(result.hasAnyMfaPolicy).toBe(true);
    expect(result.hasEnabledMfaForAllUsers).toBe(false);
  });
});
