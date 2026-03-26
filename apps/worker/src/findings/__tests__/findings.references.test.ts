import { describe, it, expect } from "vitest";
import { spoSharingFinding } from "../spoSharingFinding";
import { eapHighPrivFinding } from "../eapHighPrivFinding";
import { exoMailboxLicensingFinding } from "../exoMailboxLicensingFinding";
import { mdmComplianceFinding } from "../mdmComplianceFinding";
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

describe("derived findings include references.observedChecks", () => {
  describe("spoSharingFinding", () => {
    it("includes references.observedChecks when anonymous sharing is enabled", () => {
      const findings = spoSharingFinding.derive({
        observedChecks: [
          obs("SPO_ADMIN_OBS_001", { sharingCapability: "externalUserAndGuestSharing" })
        ]
      });
      expect(findings).toHaveLength(1);
      assertReferences(findings[0].references);
    });

    it("includes references.observedChecks when external user sharing is enabled", () => {
      const findings = spoSharingFinding.derive({
        observedChecks: [
          obs("SPO_ADMIN_OBS_001", { sharingCapability: "externalUserSharingOnly" })
        ]
      });
      expect(findings).toHaveLength(1);
      assertReferences(findings[0].references);
    });

    it("emits no findings when sharing is disabled", () => {
      const findings = spoSharingFinding.derive({
        observedChecks: [obs("SPO_ADMIN_OBS_001", { sharingCapability: "disabled" })]
      });
      expect(findings).toHaveLength(0);
    });
  });

  describe("eapHighPrivFinding", () => {
    it("includes references.observedChecks when risky apps are present", () => {
      const findings = eapHighPrivFinding.derive({
        observedChecks: [obs("ENTRA_EAP_OBS_001", { riskyApps: 3 })]
      });
      expect(findings).toHaveLength(1);
      assertReferences(findings[0].references);
    });

    it("emits no findings when risky app count is zero and scan is not truncated", () => {
      const findings = eapHighPrivFinding.derive({
        observedChecks: [obs("ENTRA_EAP_OBS_001", { riskyApps: 0, truncated: false })]
      });
      expect(findings).toHaveLength(0);
    });

    it("emits ENTRA_EAP_COVERAGE_001 with references.observedChecks when scan is truncated", () => {
      const findings = eapHighPrivFinding.derive({
        observedChecks: [obs("ENTRA_EAP_OBS_001", { riskyApps: 0, truncated: true, maxApps: 100, scannedApps: 100 })]
      });
      const coverage = findings.find((f) => f.checkId === "ENTRA_EAP_COVERAGE_001");
      expect(coverage).toBeDefined();
      assertReferences(coverage!.references);
    });

    it("emits both ENTRA_EAP_HIGH_PRIV_001 and ENTRA_EAP_COVERAGE_001 when truncated and risky apps found", () => {
      const findings = eapHighPrivFinding.derive({
        observedChecks: [obs("ENTRA_EAP_OBS_001", { riskyApps: 2, truncated: true, maxApps: 100, scannedApps: 100 })]
      });
      expect(findings.some((f) => f.checkId === "ENTRA_EAP_HIGH_PRIV_001")).toBe(true);
      expect(findings.some((f) => f.checkId === "ENTRA_EAP_COVERAGE_001")).toBe(true);
    });
  });

  describe("exoMailboxLicensingFinding", () => {
    it("includes references.observedChecks when mailboxes are near the 50GB limit", () => {
      const findings = exoMailboxLicensingFinding.derive({
        observedChecks: [
          obs("EXO_MAILBOXES_OBS_001", { sizeBuckets: { "40to50GB": 2, over50GB: 0 } }),
          obs("EXO_MAILBOXES_OBS_010", {})
        ]
      });
      expect(findings).toHaveLength(1);
      assertReferences(findings[0].references);
    });

    it("includes references.observedChecks when mailboxes exceed 50GB", () => {
      const findings = exoMailboxLicensingFinding.derive({
        observedChecks: [
          obs("EXO_MAILBOXES_OBS_001", { sizeBuckets: { "40to50GB": 0, over50GB: 4 } }),
          obs("EXO_MAILBOXES_OBS_010", {})
        ]
      });
      expect(findings).toHaveLength(1);
      assertReferences(findings[0].references);
    });

    it("emits no findings when all mailboxes are under threshold", () => {
      const findings = exoMailboxLicensingFinding.derive({
        observedChecks: [
          obs("EXO_MAILBOXES_OBS_001", { sizeBuckets: { "40to50GB": 0, over50GB: 0 } }),
          obs("EXO_MAILBOXES_OBS_010", { nearLimit40to50GB: 0, over50GB: 0 })
        ]
      });
      expect(findings).toHaveLength(0);
    });
  });

  describe("mdmComplianceFinding", () => {
    it("includes references.observedChecks when non-compliant devices are present", () => {
      const findings = mdmComplianceFinding.derive({
        observedChecks: [obs("MDM_DEVICES_OBS_001", { counts: { noncompliant: 5 } })]
      });
      expect(findings).toHaveLength(1);
      assertReferences(findings[0].references);
    });

    it("emits no findings when all devices are compliant", () => {
      const findings = mdmComplianceFinding.derive({
        observedChecks: [obs("MDM_DEVICES_OBS_001", { counts: { noncompliant: 0 } })]
      });
      expect(findings).toHaveLength(0);
    });
  });
});
