// apps/worker/src/findings/__tests__/entraConditionalAccessFinding.test.ts

import { describe, it, expect } from "vitest";
import { entraConditionalAccessFinding } from "../entraConditionalAccessFinding";
import type { ObservedCheckLike } from "../types";

function obs(checkId: string, data: unknown): ObservedCheckLike {
  return { checkId, data };
}

function assertReferences(refs: unknown): void {
  expect(refs).toBeDefined();
  expect(refs).toHaveProperty("observedChecks");
  const ids = (refs as { observedChecks: unknown }).observedChecks;
  expect(Array.isArray(ids)).toBe(true);
  expect((ids as unknown[]).length).toBeGreaterThan(0);
}

// Baseline OBS shape representing a healthy, complete CA posture.
// Tests override individual fields as needed.
function healthyObs(overrides: Record<string, unknown> = {}): ObservedCheckLike {
  return obs("ENTRA_CA_OBS_001", {
    enabledPolicies: 3,
    reportOnlyPolicies: 0,
    disabledPolicies: 1,
    totalPolicies: 4,
    policiesWithMfaGrantControl: 2,
    hasLegacyAuthPolicyDetected: true,
    policiesExcludingUsersCount: 0,
    permissionDenied: false,
    truncated: false,
    ...overrides
  });
}

// ENTRA_CA_DERIVED_001 OBS shape.
// Baseline: enabled policies present, MFA policy exists, but NOT all-users-enabled (triggers ENTRA_CA_005).
function caDerivedObs(overrides: Record<string, unknown> = {}): ObservedCheckLike {
  return obs("ENTRA_CA_DERIVED_001", {
    hasAnyEnabledPolicy: true,
    hasAnyMfaPolicy: false,
    hasEnabledMfaForAllUsers: false,
    ...overrides
  });
}

describe("entraConditionalAccessFinding", () => {
  // ── Guard: absent OBS ───────────────────────────────────────────────────────

  it("emits no findings when ENTRA_CA_OBS_001 is absent", () => {
    const findings = entraConditionalAccessFinding.derive({ observedChecks: [] });
    expect(findings).toHaveLength(0);
  });

  // ── Guard: unreliable data ──────────────────────────────────────────────────

  it("emits no findings when permissionDenied is true", () => {
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [healthyObs({ permissionDenied: true, policiesWithMfaGrantControl: 0 })]
    });
    expect(findings).toHaveLength(0);
  });

  it("emits no findings when truncated is true", () => {
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [healthyObs({ truncated: true, policiesWithMfaGrantControl: 0 })]
    });
    expect(findings).toHaveLength(0);
  });

  // ── Guard: no enabled policies (ENTRA_CA_001 territory) ────────────────────

  it("emits no findings when enabledPolicies is 0 (ENTRA_CA_001 covers this)", () => {
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [
        healthyObs({
          enabledPolicies: 0,
          policiesWithMfaGrantControl: 0,
          hasLegacyAuthPolicyDetected: false,
          policiesExcludingUsersCount: 5
        }),
        caDerivedObs()
      ]
    });
    expect(findings).toHaveLength(0);
  });

  // ── ENTRA_CA_002: No MFA grant control ─────────────────────────────────────

  it("emits ENTRA_CA_002 at medium severity when no policy enforces MFA", () => {
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [healthyObs({ policiesWithMfaGrantControl: 0 })]
    });
    const f = findings.find((x) => x.checkId === "ENTRA_CA_002");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("medium");
    assertReferences(f!.references);
  });

  it("does not emit ENTRA_CA_002 when at least one policy enforces MFA", () => {
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [healthyObs({ policiesWithMfaGrantControl: 1 })]
    });
    expect(findings.some((x) => x.checkId === "ENTRA_CA_002")).toBe(false);
  });

  // ── ENTRA_CA_003: Legacy authentication not blocked ─────────────────────────

  it("emits ENTRA_CA_003 at medium severity when no legacy auth block detected", () => {
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [healthyObs({ hasLegacyAuthPolicyDetected: false })]
    });
    const f = findings.find((x) => x.checkId === "ENTRA_CA_003");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("medium");
    assertReferences(f!.references);
  });

  it("does not emit ENTRA_CA_003 when a legacy auth block is detected", () => {
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [healthyObs({ hasLegacyAuthPolicyDetected: true })]
    });
    expect(findings.some((x) => x.checkId === "ENTRA_CA_003")).toBe(false);
  });

  // ── ENTRA_CA_004: User exclusions present ───────────────────────────────────

  it("emits ENTRA_CA_004 at low severity when user exclusions are present", () => {
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [healthyObs({ policiesExcludingUsersCount: 3 })]
    });
    const f = findings.find((x) => x.checkId === "ENTRA_CA_004");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("low");
    assertReferences(f!.references);
  });

  it("includes exclusion count in ENTRA_CA_004 title", () => {
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [healthyObs({ policiesExcludingUsersCount: 5 })]
    });
    const f = findings.find((x) => x.checkId === "ENTRA_CA_004");
    expect(f).toBeDefined();
    expect(f!.title).toMatch(/5/);
  });

  it("uses singular 'exclusion' in title when count is 1", () => {
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [healthyObs({ policiesExcludingUsersCount: 1 })]
    });
    const f = findings.find((x) => x.checkId === "ENTRA_CA_004");
    expect(f).toBeDefined();
    expect(f!.title).toMatch(/1 exclusion\b/);
  });

  it("does not emit ENTRA_CA_004 when no user exclusions are present", () => {
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [healthyObs({ policiesExcludingUsersCount: 0 })]
    });
    expect(findings.some((x) => x.checkId === "ENTRA_CA_004")).toBe(false);
  });

  // ── Healthy baseline (ENTRA_CA_002/003/004): no findings ───────────────────

  it("emits no findings for a healthy CA posture (MFA present, legacy blocked, no exclusions)", () => {
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [healthyObs()]
    });
    expect(findings).toHaveLength(0);
  });

  // ── Multiple findings co-emitted ────────────────────────────────────────────

  it("emits ENTRA_CA_002, ENTRA_CA_003, and ENTRA_CA_004 together when all gaps are present", () => {
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [
        healthyObs({
          policiesWithMfaGrantControl: 0,
          hasLegacyAuthPolicyDetected: false,
          policiesExcludingUsersCount: 4
        })
      ]
    });
    expect(findings.some((x) => x.checkId === "ENTRA_CA_002")).toBe(true);
    expect(findings.some((x) => x.checkId === "ENTRA_CA_003")).toBe(true);
    expect(findings.some((x) => x.checkId === "ENTRA_CA_004")).toBe(true);
  });

  // ── ENTRA_CA_005: No enabled all-users MFA policy ──────────────────────────

  it("does not emit ENTRA_CA_005 when ENTRA_CA_DERIVED_001 is absent", () => {
    // ENTRA_CA_OBS_001 present and complete, but derived OBS not present.
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [healthyObs()]
    });
    expect(findings.some((x) => x.checkId === "ENTRA_CA_005")).toBe(false);
  });

  it("does not emit ENTRA_CA_005 when hasAnyEnabledPolicy is false", () => {
    // No enabled policies → ENTRA_CA_001 territory; derived OBS present but guard fails.
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [
        healthyObs({ enabledPolicies: 1 }), // keep OBS-001 valid (enabledPolicies > 0)
        caDerivedObs({ hasAnyEnabledPolicy: false, hasEnabledMfaForAllUsers: false })
      ]
    });
    expect(findings.some((x) => x.checkId === "ENTRA_CA_005")).toBe(false);
  });

  it("does not emit ENTRA_CA_005 when hasEnabledMfaForAllUsers is true", () => {
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [
        healthyObs(),
        caDerivedObs({ hasAnyEnabledPolicy: true, hasEnabledMfaForAllUsers: true })
      ]
    });
    expect(findings.some((x) => x.checkId === "ENTRA_CA_005")).toBe(false);
  });

  it("emits ENTRA_CA_005 when hasAnyEnabledPolicy is true and hasEnabledMfaForAllUsers is false", () => {
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [healthyObs(), caDerivedObs()]
    });
    const f = findings.find((x) => x.checkId === "ENTRA_CA_005");
    expect(f).toBeDefined();
  });

  it("emits ENTRA_CA_005 at medium severity", () => {
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [healthyObs(), caDerivedObs()]
    });
    const f = findings.find((x) => x.checkId === "ENTRA_CA_005");
    expect(f!.severity).toBe("medium");
  });

  it("references ENTRA_CA_DERIVED_001 in ENTRA_CA_005", () => {
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [healthyObs(), caDerivedObs()]
    });
    const f = findings.find((x) => x.checkId === "ENTRA_CA_005");
    const refs = f!.references as any;
    expect(refs.observedChecks).toContain("ENTRA_CA_DERIVED_001");
  });

  it("includes hasAnyEnabledPolicy, hasAnyMfaPolicy, hasEnabledMfaForAllUsers in references", () => {
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [
        healthyObs(),
        caDerivedObs({ hasAnyEnabledPolicy: true, hasAnyMfaPolicy: true, hasEnabledMfaForAllUsers: false })
      ]
    });
    const f = findings.find((x) => x.checkId === "ENTRA_CA_005");
    const refs = f!.references as any;
    expect(refs.hasAnyEnabledPolicy).toBe(true);
    expect(refs.hasAnyMfaPolicy).toBe(true);
    expect(refs.hasEnabledMfaForAllUsers).toBe(false);
  });

  it("fires ENTRA_CA_005 when MFA policies exist (hasAnyMfaPolicy true) but none is enabled+all-users", () => {
    // This is the key differentiated case: MFA policies exist in some form,
    // but none satisfies the enabled+all-users+MFA intersection.
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [
        // OBS-001: policiesWithMfaGrantControl > 0 means ENTRA_CA_002 does NOT fire
        healthyObs({ policiesWithMfaGrantControl: 2 }),
        caDerivedObs({ hasAnyEnabledPolicy: true, hasAnyMfaPolicy: true, hasEnabledMfaForAllUsers: false })
      ]
    });
    expect(findings.some((x) => x.checkId === "ENTRA_CA_002")).toBe(false);
    expect(findings.some((x) => x.checkId === "ENTRA_CA_005")).toBe(true);
  });

  it("ENTRA_CA_002 and ENTRA_CA_005 can co-emit when no MFA policy exists at all", () => {
    // ENTRA_CA_002: policiesWithMfaGrantControl === 0
    // ENTRA_CA_005: hasEnabledMfaForAllUsers === false
    // Both describe a complete absence of MFA CA, from different evidence perspectives.
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [
        healthyObs({ policiesWithMfaGrantControl: 0 }),
        caDerivedObs({ hasAnyEnabledPolicy: true, hasAnyMfaPolicy: false, hasEnabledMfaForAllUsers: false })
      ]
    });
    expect(findings.some((x) => x.checkId === "ENTRA_CA_002")).toBe(true);
    expect(findings.some((x) => x.checkId === "ENTRA_CA_005")).toBe(true);
  });

  it("does not emit ENTRA_CA_005 when ENTRA_CA_OBS_001 is absent (early return)", () => {
    // If OBS-001 is absent the derivation returns early; no CA findings fire.
    const findings = entraConditionalAccessFinding.derive({
      observedChecks: [caDerivedObs()]
    });
    expect(findings).toHaveLength(0);
  });
});
