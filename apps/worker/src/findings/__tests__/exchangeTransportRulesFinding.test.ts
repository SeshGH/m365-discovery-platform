// apps/worker/src/findings/__tests__/exchangeTransportRulesFinding.test.ts

import { describe, it, expect } from "vitest";
import { exchangeTransportRulesFinding } from "../exchangeTransportRulesFinding";
import type { ObservedCheckLike } from "../types";

function obs(checkId: string, data: unknown): ObservedCheckLike {
  return { checkId, data };
}

// Baseline OBS representing a complete, clean scan with no forwarding rules.
// Tests override individual fields as needed.
function healthyObs(overrides: Record<string, unknown> = {}): ObservedCheckLike {
  return obs("EXO_TRANSPORT_OBS_001", {
    isComplete: true,
    permissionDenied: false,
    truncated: false,
    errorCode: null,
    errorMessage: null,
    totalRules: 5,
    enabledRulesCount: 3,
    rulesWithExternalForwardingCount: 0,
    forwardingRuleNames: [],
    tenantPrimaryDomain: "contoso.com",
    ...overrides
  });
}

describe("exchangeTransportRulesFinding", () => {
  // --- Guard: absent OBS ---

  it("emits no findings when EXO_TRANSPORT_OBS_001 is absent", () => {
    const findings = exchangeTransportRulesFinding.derive({ observedChecks: [] });
    expect(findings).toHaveLength(0);
  });

  // --- Guard: unreliable data ---

  it("emits no findings when permissionDenied is true", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [
        healthyObs({ permissionDenied: true, rulesWithExternalForwardingCount: 2 })
      ]
    });
    expect(findings).toHaveLength(0);
  });

  it("emits no findings when truncated is true", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [healthyObs({ truncated: true, rulesWithExternalForwardingCount: 2 })]
    });
    expect(findings).toHaveLength(0);
  });

  // --- Guard: no external forwarding rules ---

  it("emits no findings when rulesWithExternalForwardingCount is 0", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [healthyObs({ rulesWithExternalForwardingCount: 0 })]
    });
    expect(findings).toHaveLength(0);
  });

  // --- EXO_TRANSPORT_001: external forwarding detected ---

  it("emits EXO_TRANSPORT_001 at high severity when external forwarding rules are present", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [
        healthyObs({
          rulesWithExternalForwardingCount: 1,
          forwardingRuleNames: ["Forward to partner"]
        })
      ]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_001");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("high");
  });

  it("includes rule count in the finding title", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [healthyObs({ rulesWithExternalForwardingCount: 3 })]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_001");
    expect(f!.title).toMatch(/3/);
  });

  it("uses singular 'rule' in title when count is 1", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [healthyObs({ rulesWithExternalForwardingCount: 1 })]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_001");
    expect(f!.title).toMatch(/1 mail flow rule\b/);
  });

  it("uses plural 'rules' in title when count is greater than 1", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [healthyObs({ rulesWithExternalForwardingCount: 2 })]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_001");
    expect(f!.title).toMatch(/2 mail flow rules\b/);
  });

  it("includes references with observedChecks array", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [healthyObs({ rulesWithExternalForwardingCount: 1 })]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_001");
    expect(f!.references).toBeDefined();
    const refs = f!.references as any;
    expect(Array.isArray(refs.observedChecks)).toBe(true);
    expect(refs.observedChecks).toContain("EXO_TRANSPORT_OBS_001");
  });

  it("includes forwarding rule names in references when available", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [
        healthyObs({
          rulesWithExternalForwardingCount: 1,
          forwardingRuleNames: ["Suspicious Forward Rule"]
        })
      ]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_001");
    const refs = f!.references as any;
    expect(refs.forwardingRuleNames).toContain("Suspicious Forward Rule");
  });

  it("caps forwarding rule names in references at 10 entries", () => {
    const manyNames = Array.from({ length: 15 }, (_, i) => `Rule ${i + 1}`);
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [
        healthyObs({
          rulesWithExternalForwardingCount: 15,
          forwardingRuleNames: manyNames
        })
      ]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_001");
    const refs = f!.references as any;
    expect((refs.forwardingRuleNames as unknown[]).length).toBeLessThanOrEqual(10);
  });

  it("emits no findings for a healthy posture (complete scan, no forwarding rules)", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [healthyObs()]
    });
    expect(findings).toHaveLength(0);
  });
});
