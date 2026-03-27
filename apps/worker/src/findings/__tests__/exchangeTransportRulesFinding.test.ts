// apps/worker/src/findings/__tests__/exchangeTransportRulesFinding.test.ts

import { describe, it, expect } from "vitest";
import { exchangeTransportRulesFinding } from "../exchangeTransportRulesFinding";
import type { ObservedCheckLike } from "../types";

function obs(checkId: string, data: unknown): ObservedCheckLike {
  return { checkId, data };
}

// Baseline OBS representing a complete, clean scan with no detected issues.
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
    rulesWithSclBypassCount: 0,
    sclBypassRuleNames: [],
    rulesWithSuppressiveActionCount: 0,
    suppressiveActionRuleNames: [],
    tenantPrimaryDomain: "contoso.com",
    ...overrides
  });
}

describe("exchangeTransportRulesFinding", () => {
  // ── Guard: absent OBS ────────────────────────────────────────────────────

  it("emits no findings when EXO_TRANSPORT_OBS_001 is absent", () => {
    const findings = exchangeTransportRulesFinding.derive({ observedChecks: [] });
    expect(findings).toHaveLength(0);
  });

  // ── Guard: unreliable data ───────────────────────────────────────────────

  it("emits no findings when permissionDenied is true", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [
        healthyObs({
          permissionDenied: true,
          rulesWithExternalForwardingCount: 2,
          rulesWithSclBypassCount: 1
        })
      ]
    });
    expect(findings).toHaveLength(0);
  });

  it("emits no findings when truncated is true", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [
        healthyObs({
          truncated: true,
          rulesWithExternalForwardingCount: 2,
          rulesWithSclBypassCount: 1
        })
      ]
    });
    expect(findings).toHaveLength(0);
  });

  // ── EXO_TRANSPORT_001: external forwarding ───────────────────────────────

  it("emits no EXO_TRANSPORT_001 when rulesWithExternalForwardingCount is 0", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [healthyObs({ rulesWithExternalForwardingCount: 0 })]
    });
    expect(findings.find((x) => x.checkId === "EXO_TRANSPORT_001")).toBeUndefined();
  });

  it("emits EXO_TRANSPORT_001 at high severity when external forwarding rules are present", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [
        healthyObs({ rulesWithExternalForwardingCount: 1, forwardingRuleNames: ["Forward to partner"] })
      ]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_001");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("high");
  });

  it("uses singular 'rule' in EXO_TRANSPORT_001 title when count is 1", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [healthyObs({ rulesWithExternalForwardingCount: 1 })]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_001");
    expect(f!.title).toMatch(/1 mail flow rule\b/);
  });

  it("uses plural 'rules' in EXO_TRANSPORT_001 title when count > 1", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [healthyObs({ rulesWithExternalForwardingCount: 3 })]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_001");
    expect(f!.title).toMatch(/3 mail flow rules\b/);
  });

  it("includes rule names in EXO_TRANSPORT_001 references", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [
        healthyObs({ rulesWithExternalForwardingCount: 1, forwardingRuleNames: ["Suspect Rule"] })
      ]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_001");
    expect((f!.references as any).forwardingRuleNames).toContain("Suspect Rule");
  });

  it("caps EXO_TRANSPORT_001 rule names in references at 10", () => {
    const manyNames = Array.from({ length: 15 }, (_, i) => `Rule ${i + 1}`);
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [
        healthyObs({ rulesWithExternalForwardingCount: 15, forwardingRuleNames: manyNames })
      ]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_001");
    expect((f!.references as any).forwardingRuleNames.length).toBeLessThanOrEqual(10);
  });

  // ── EXO_TRANSPORT_002: spam filter bypass ────────────────────────────────

  it("emits no EXO_TRANSPORT_002 when rulesWithSclBypassCount is 0", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [healthyObs({ rulesWithSclBypassCount: 0 })]
    });
    expect(findings.find((x) => x.checkId === "EXO_TRANSPORT_002")).toBeUndefined();
  });

  it("emits EXO_TRANSPORT_002 at medium severity when spam bypass rules are present", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [
        healthyObs({ rulesWithSclBypassCount: 1, sclBypassRuleNames: ["Bypass Spam For Partner"] })
      ]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_002");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("medium");
  });

  it("uses singular 'rule bypasses' in EXO_TRANSPORT_002 title when count is 1", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [healthyObs({ rulesWithSclBypassCount: 1 })]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_002");
    expect(f!.title).toMatch(/1 mail flow rule bypasses/);
  });

  it("uses plural 'rules bypass' in EXO_TRANSPORT_002 title when count > 1", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [healthyObs({ rulesWithSclBypassCount: 2 })]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_002");
    expect(f!.title).toMatch(/2 mail flow rules bypass/);
  });

  it("includes bypass rule names in EXO_TRANSPORT_002 references", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [
        healthyObs({ rulesWithSclBypassCount: 1, sclBypassRuleNames: ["Phishing Bypass Rule"] })
      ]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_002");
    expect((f!.references as any).sclBypassRuleNames).toContain("Phishing Bypass Rule");
  });

  it("caps EXO_TRANSPORT_002 rule names in references at 10", () => {
    const manyNames = Array.from({ length: 15 }, (_, i) => `Bypass Rule ${i + 1}`);
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [
        healthyObs({ rulesWithSclBypassCount: 15, sclBypassRuleNames: manyNames })
      ]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_002");
    expect((f!.references as any).sclBypassRuleNames.length).toBeLessThanOrEqual(10);
  });

  it("includes observedChecks reference in EXO_TRANSPORT_002", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [healthyObs({ rulesWithSclBypassCount: 1 })]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_002");
    expect((f!.references as any).observedChecks).toContain("EXO_TRANSPORT_OBS_001");
  });

  // ── EXO_TRANSPORT_003: broad suppressive action ──────────────────────────

  it("emits no EXO_TRANSPORT_003 when rulesWithSuppressiveActionCount is 0", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [healthyObs({ rulesWithSuppressiveActionCount: 0 })]
    });
    expect(findings.find((x) => x.checkId === "EXO_TRANSPORT_003")).toBeUndefined();
  });

  it("emits EXO_TRANSPORT_003 at high severity when broad suppressive rules are present", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [
        healthyObs({
          rulesWithSuppressiveActionCount: 1,
          suppressiveActionRuleNames: ["Drop All Inbound"]
        })
      ]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_003");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("high");
  });

  it("uses singular 'rule' in EXO_TRANSPORT_003 title when count is 1", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [healthyObs({ rulesWithSuppressiveActionCount: 1 })]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_003");
    expect(f!.title).toMatch(/1 mail flow rule\b/);
  });

  it("uses plural 'rules' in EXO_TRANSPORT_003 title when count > 1", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [healthyObs({ rulesWithSuppressiveActionCount: 3 })]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_003");
    expect(f!.title).toMatch(/3 mail flow rules\b/);
  });

  it("includes rule names in EXO_TRANSPORT_003 references", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [
        healthyObs({
          rulesWithSuppressiveActionCount: 1,
          suppressiveActionRuleNames: ["Suspicious Delete Rule"]
        })
      ]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_003");
    expect((f!.references as any).suppressiveActionRuleNames).toContain("Suspicious Delete Rule");
  });

  it("caps EXO_TRANSPORT_003 rule names in references at 10", () => {
    const manyNames = Array.from({ length: 15 }, (_, i) => `Suppress Rule ${i + 1}`);
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [
        healthyObs({ rulesWithSuppressiveActionCount: 15, suppressiveActionRuleNames: manyNames })
      ]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_003");
    expect((f!.references as any).suppressiveActionRuleNames.length).toBeLessThanOrEqual(10);
  });

  it("includes observedChecks reference in EXO_TRANSPORT_003", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [healthyObs({ rulesWithSuppressiveActionCount: 1 })]
    });
    const f = findings.find((x) => x.checkId === "EXO_TRANSPORT_003");
    expect((f!.references as any).observedChecks).toContain("EXO_TRANSPORT_OBS_001");
  });

  it("emits no EXO_TRANSPORT_003 when permissionDenied is true (even with suppressive rules)", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [
        healthyObs({ permissionDenied: true, rulesWithSuppressiveActionCount: 1 })
      ]
    });
    expect(findings.find((x) => x.checkId === "EXO_TRANSPORT_003")).toBeUndefined();
  });

  it("emits no EXO_TRANSPORT_003 when truncated is true (even with suppressive rules)", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [
        healthyObs({ truncated: true, rulesWithSuppressiveActionCount: 1 })
      ]
    });
    expect(findings.find((x) => x.checkId === "EXO_TRANSPORT_003")).toBeUndefined();
  });

  // ── All three findings co-emitting ───────────────────────────────────────

  it("emits both EXO_TRANSPORT_001 and EXO_TRANSPORT_002 when both conditions are met", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [
        healthyObs({
          rulesWithExternalForwardingCount: 1,
          forwardingRuleNames: ["Forward to attacker"],
          rulesWithSclBypassCount: 2,
          sclBypassRuleNames: ["Bypass Rule A", "Bypass Rule B"]
        })
      ]
    });
    expect(findings.find((x) => x.checkId === "EXO_TRANSPORT_001")).toBeDefined();
    expect(findings.find((x) => x.checkId === "EXO_TRANSPORT_002")).toBeDefined();
  });

  it("emits all three findings when all three conditions are met", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [
        healthyObs({
          rulesWithExternalForwardingCount: 1,
          forwardingRuleNames: ["Forward to attacker"],
          rulesWithSclBypassCount: 1,
          sclBypassRuleNames: ["Bypass Spam For Partner"],
          rulesWithSuppressiveActionCount: 1,
          suppressiveActionRuleNames: ["Drop All Inbound"]
        })
      ]
    });
    expect(findings.find((x) => x.checkId === "EXO_TRANSPORT_001")).toBeDefined();
    expect(findings.find((x) => x.checkId === "EXO_TRANSPORT_002")).toBeDefined();
    expect(findings.find((x) => x.checkId === "EXO_TRANSPORT_003")).toBeDefined();
  });

  // ── Healthy baseline ─────────────────────────────────────────────────────

  it("emits no findings for a healthy posture (complete scan, no issues)", () => {
    const findings = exchangeTransportRulesFinding.derive({
      observedChecks: [healthyObs()]
    });
    expect(findings).toHaveLength(0);
  });
});
