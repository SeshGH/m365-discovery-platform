// apps/worker/src/findings/__tests__/exchangeConnectorsFinding.test.ts

import { describe, it, expect } from "vitest";
import { exchangeConnectorsFinding } from "../exchangeConnectorsFinding";
import type { ObservedCheckLike } from "../types";

function obs(checkId: string, data: unknown): ObservedCheckLike {
  return { checkId, data };
}

// Baseline OBS representing a complete, clean scan with no detected issues.
// Tests override individual fields as needed via the overrides argument.
function healthyObs(overrides: Record<string, unknown> = {}): ObservedCheckLike {
  return obs("EXO_CONNECTOR_OBS_001", {
    isComplete: true,
    permissionDenied: false,
    truncated: false,
    errorCode: null,
    errorMessage: null,
    totalInboundConnectors: 2,
    enabledInboundConnectorsCount: 2,
    permissiveInboundConnectorsCount: 0,
    permissiveInboundConnectorNames: [],
    ...overrides
  });
}

describe("exchangeConnectorsFinding", () => {
  // ── Guard: absent OBS ────────────────────────────────────────────────────

  it("emits no findings when EXO_CONNECTOR_OBS_001 is absent", () => {
    const findings = exchangeConnectorsFinding.derive({ observedChecks: [] });
    expect(findings).toHaveLength(0);
  });

  it("ignores unrelated observed checks", () => {
    const findings = exchangeConnectorsFinding.derive({
      observedChecks: [obs("EXO_TRANSPORT_OBS_001", { isComplete: true, permissiveInboundConnectorsCount: 5 })]
    });
    expect(findings).toHaveLength(0);
  });

  // ── Guard: unreliable data ───────────────────────────────────────────────

  it("emits no findings when permissionDenied is true", () => {
    const findings = exchangeConnectorsFinding.derive({
      observedChecks: [
        healthyObs({ permissionDenied: true, permissiveInboundConnectorsCount: 3 })
      ]
    });
    expect(findings).toHaveLength(0);
  });

  it("emits no findings when truncated is true", () => {
    const findings = exchangeConnectorsFinding.derive({
      observedChecks: [
        healthyObs({ truncated: true, permissiveInboundConnectorsCount: 3 })
      ]
    });
    expect(findings).toHaveLength(0);
  });

  // ── EXO_CONNECTOR_001: permissive inbound connector ──────────────────────

  it("emits no EXO_CONNECTOR_001 when permissiveInboundConnectorsCount is 0", () => {
    const findings = exchangeConnectorsFinding.derive({
      observedChecks: [healthyObs({ permissiveInboundConnectorsCount: 0 })]
    });
    expect(findings.find((x) => x.checkId === "EXO_CONNECTOR_001")).toBeUndefined();
  });

  it("emits EXO_CONNECTOR_001 when permissiveInboundConnectorsCount > 0", () => {
    const findings = exchangeConnectorsFinding.derive({
      observedChecks: [
        healthyObs({
          permissiveInboundConnectorsCount: 1,
          permissiveInboundConnectorNames: ["On-Prem Relay"]
        })
      ]
    });
    expect(findings.find((x) => x.checkId === "EXO_CONNECTOR_001")).toBeDefined();
  });

  it("emits EXO_CONNECTOR_001 at medium severity", () => {
    const findings = exchangeConnectorsFinding.derive({
      observedChecks: [healthyObs({ permissiveInboundConnectorsCount: 1 })]
    });
    const f = findings.find((x) => x.checkId === "EXO_CONNECTOR_001");
    expect(f!.severity).toBe("medium");
  });

  it("uses singular form in title when count is 1", () => {
    const findings = exchangeConnectorsFinding.derive({
      observedChecks: [healthyObs({ permissiveInboundConnectorsCount: 1 })]
    });
    const f = findings.find((x) => x.checkId === "EXO_CONNECTOR_001");
    // "1 inbound mail connector accepts"
    expect(f!.title).toMatch(/^1 inbound mail connector accepts/);
  });

  it("uses plural form in title when count > 1", () => {
    const findings = exchangeConnectorsFinding.derive({
      observedChecks: [healthyObs({ permissiveInboundConnectorsCount: 3 })]
    });
    const f = findings.find((x) => x.checkId === "EXO_CONNECTOR_001");
    // "3 inbound mail connectors accept"
    expect(f!.title).toMatch(/^3 inbound mail connectors accept\b/);
  });

  it("includes connector names in references", () => {
    const findings = exchangeConnectorsFinding.derive({
      observedChecks: [
        healthyObs({
          permissiveInboundConnectorsCount: 1,
          permissiveInboundConnectorNames: ["Contoso On-Prem"]
        })
      ]
    });
    const f = findings.find((x) => x.checkId === "EXO_CONNECTOR_001");
    expect((f!.references as any).permissiveInboundConnectorNames).toContain("Contoso On-Prem");
  });

  it("caps connector names in references at 10", () => {
    const manyNames = Array.from({ length: 15 }, (_, i) => `Connector ${i + 1}`);
    const findings = exchangeConnectorsFinding.derive({
      observedChecks: [
        healthyObs({
          permissiveInboundConnectorsCount: 15,
          permissiveInboundConnectorNames: manyNames
        })
      ]
    });
    const f = findings.find((x) => x.checkId === "EXO_CONNECTOR_001");
    expect((f!.references as any).permissiveInboundConnectorNames.length).toBeLessThanOrEqual(10);
  });

  it("includes the count in references", () => {
    const findings = exchangeConnectorsFinding.derive({
      observedChecks: [healthyObs({ permissiveInboundConnectorsCount: 2 })]
    });
    const f = findings.find((x) => x.checkId === "EXO_CONNECTOR_001");
    expect((f!.references as any).permissiveInboundConnectorsCount).toBe(2);
  });

  it("includes observedChecks in references", () => {
    const findings = exchangeConnectorsFinding.derive({
      observedChecks: [healthyObs({ permissiveInboundConnectorsCount: 1 })]
    });
    const f = findings.find((x) => x.checkId === "EXO_CONNECTOR_001");
    expect((f!.references as any).observedChecks).toContain("EXO_CONNECTOR_OBS_001");
  });

  it("emits no EXO_CONNECTOR_001 when permissionDenied is true even with count > 0", () => {
    const findings = exchangeConnectorsFinding.derive({
      observedChecks: [
        healthyObs({ permissionDenied: true, permissiveInboundConnectorsCount: 2 })
      ]
    });
    expect(findings.find((x) => x.checkId === "EXO_CONNECTOR_001")).toBeUndefined();
  });

  it("emits no EXO_CONNECTOR_001 when truncated is true even with count > 0", () => {
    const findings = exchangeConnectorsFinding.derive({
      observedChecks: [
        healthyObs({ truncated: true, permissiveInboundConnectorsCount: 2 })
      ]
    });
    expect(findings.find((x) => x.checkId === "EXO_CONNECTOR_001")).toBeUndefined();
  });

  // ── Healthy baseline ─────────────────────────────────────────────────────

  it("emits no findings for a healthy posture (complete scan, no permissive connectors)", () => {
    const findings = exchangeConnectorsFinding.derive({
      observedChecks: [healthyObs()]
    });
    expect(findings).toHaveLength(0);
  });
});
