import { describe, it, expect } from "vitest";
import { spoSharingFinding } from "../spoSharingFinding";
import { spoSitesCoverageFinding } from "../spoSitesCoverageFinding";
import { eapHighPrivFinding } from "../eapHighPrivFinding";
import { exoMailboxLicensingFinding } from "../exoMailboxLicensingFinding";
import { exoMailboxesCoverageFinding } from "../exoMailboxesCoverageFinding";
import { mdmComplianceFinding } from "../mdmComplianceFinding";
import { mdmCoverageFinding } from "../mdmCoverageFinding";
import { mdmComplianceGapFinding } from "../mdmComplianceGapFinding";
import { entraDirectoryRolesFinding } from "../entraDirectoryRolesFinding";
import type { ObservedCheckLike } from "../types";

function obs(checkId: string, data: unknown): ObservedCheckLike {
  return { checkId, data };
}

function spoAdminObs(data: Record<string, unknown>): ObservedCheckLike {
  return obs("SPO_ADMIN_OBS_001", data);
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
    // ── SPO_SHARING_001 ────────────────────────────────────────────────────

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

    // ── SPO_LEGACY_AUTH_001 ────────────────────────────────────────────────

    describe("SPO_LEGACY_AUTH_001 — legacy authentication protocols enabled", () => {
      it("emits no finding when SPO_ADMIN_OBS_001 is absent", () => {
        const findings = spoSharingFinding.derive({ observedChecks: [] });
        expect(findings.some((f) => f.checkId === "SPO_LEGACY_AUTH_001")).toBe(false);
      });

      it("emits no finding when isComplete is false (permission-denied or failure)", () => {
        const findings = spoSharingFinding.derive({
          observedChecks: [
            spoAdminObs({ isComplete: false, isLegacyAuthProtocolsEnabled: true })
          ]
        });
        expect(findings.some((f) => f.checkId === "SPO_LEGACY_AUTH_001")).toBe(false);
      });

      it("emits no finding when isLegacyAuthProtocolsEnabled is false", () => {
        const findings = spoSharingFinding.derive({
          observedChecks: [
            spoAdminObs({ isComplete: true, isLegacyAuthProtocolsEnabled: false })
          ]
        });
        expect(findings.some((f) => f.checkId === "SPO_LEGACY_AUTH_001")).toBe(false);
      });

      it("emits no finding when isLegacyAuthProtocolsEnabled is null", () => {
        const findings = spoSharingFinding.derive({
          observedChecks: [
            spoAdminObs({ isComplete: true, isLegacyAuthProtocolsEnabled: null })
          ]
        });
        expect(findings.some((f) => f.checkId === "SPO_LEGACY_AUTH_001")).toBe(false);
      });

      it("emits SPO_LEGACY_AUTH_001 when isComplete is true and isLegacyAuthProtocolsEnabled is true", () => {
        const findings = spoSharingFinding.derive({
          observedChecks: [
            spoAdminObs({ isComplete: true, isLegacyAuthProtocolsEnabled: true })
          ]
        });
        const finding = findings.find((f) => f.checkId === "SPO_LEGACY_AUTH_001");
        expect(finding).toBeDefined();
      });

      it("emits SPO_LEGACY_AUTH_001 at medium severity", () => {
        const findings = spoSharingFinding.derive({
          observedChecks: [
            spoAdminObs({ isComplete: true, isLegacyAuthProtocolsEnabled: true })
          ]
        });
        const finding = findings.find((f) => f.checkId === "SPO_LEGACY_AUTH_001");
        expect(finding?.severity).toBe("medium");
      });

      it("SPO_LEGACY_AUTH_001 includes references.observedChecks", () => {
        const findings = spoSharingFinding.derive({
          observedChecks: [
            spoAdminObs({ isComplete: true, isLegacyAuthProtocolsEnabled: true })
          ]
        });
        const finding = findings.find((f) => f.checkId === "SPO_LEGACY_AUTH_001");
        assertReferences(finding?.references);
      });

      it("co-emits SPO_LEGACY_AUTH_001 and SPO_SHARING_001 when both conditions are met", () => {
        const findings = spoSharingFinding.derive({
          observedChecks: [
            spoAdminObs({
              isComplete: true,
              sharingCapability: "externalUserAndGuestSharing",
              isLegacyAuthProtocolsEnabled: true
            })
          ]
        });
        expect(findings.some((f) => f.checkId === "SPO_SHARING_001")).toBe(true);
        expect(findings.some((f) => f.checkId === "SPO_LEGACY_AUTH_001")).toBe(true);
      });

      it("does not emit SPO_LEGACY_AUTH_001 when sharing is restricted and legacy auth is false", () => {
        const findings = spoSharingFinding.derive({
          observedChecks: [
            spoAdminObs({
              isComplete: true,
              sharingCapability: "disabled",
              isLegacyAuthProtocolsEnabled: false
            })
          ]
        });
        expect(findings).toHaveLength(0);
      });
    });
  });

  describe("spoSitesCoverageFinding", () => {
    it("emits SPO_SITES_COVERAGE_001 at medium severity with references when permission denied on sites:list", () => {
      const findings = spoSitesCoverageFinding.derive({
        observedChecks: [
          obs("SPO_SITES_OBS_001", {
            isComplete: false,
            permissionDenied: ["microsoft.graph/sites:list"]
          })
        ]
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].checkId).toBe("SPO_SITES_COVERAGE_001");
      expect(findings[0].severity).toBe("medium");
      assertReferences(findings[0].references);
    });

    it("emits SPO_SITES_COVERAGE_001 at low severity with references when incomplete but no permission denial", () => {
      const findings = spoSitesCoverageFinding.derive({
        observedChecks: [
          obs("SPO_SITES_OBS_001", {
            isComplete: false,
            permissionDenied: []
          })
        ]
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].checkId).toBe("SPO_SITES_COVERAGE_001");
      expect(findings[0].severity).toBe("low");
      assertReferences(findings[0].references);
    });

    it("emits no findings when collection is complete", () => {
      const findings = spoSitesCoverageFinding.derive({
        observedChecks: [
          obs("SPO_SITES_OBS_001", {
            isComplete: true,
            permissionDenied: []
          })
        ]
      });
      expect(findings).toHaveLength(0);
    });

    it("emits no findings when SPO_SITES_OBS_001 is absent", () => {
      const findings = spoSitesCoverageFinding.derive({ observedChecks: [] });
      expect(findings).toHaveLength(0);
    });

    // SPO_SITES_COVERAGE_002 — storage report unavailable
    it("emits SPO_SITES_COVERAGE_002 with references when reporting permissions denied", () => {
      const findings = spoSitesCoverageFinding.derive({
        observedChecks: [
          obs("SPO_SITES_OBS_010", {
            isComplete: false,
            truncated: false,
            permissionDenied: ["microsoft.graph/reports:getSharePointSiteUsageDetail"]
          })
        ]
      });
      const coverage = findings.find((f) => f.checkId === "SPO_SITES_COVERAGE_002");
      expect(coverage).toBeDefined();
      expect(coverage!.severity).toBe("info");
      expect(coverage!.title).toMatch(/permissions missing/i);
      assertReferences(coverage!.references);
    });

    it("emits SPO_SITES_COVERAGE_002 with references when report data not yet generated", () => {
      const findings = spoSitesCoverageFinding.derive({
        observedChecks: [
          obs("SPO_SITES_OBS_010", {
            isComplete: false,
            truncated: false,
            permissionDenied: []
          })
        ]
      });
      const coverage = findings.find((f) => f.checkId === "SPO_SITES_COVERAGE_002");
      expect(coverage).toBeDefined();
      expect(coverage!.severity).toBe("info");
      expect(coverage!.title).toMatch(/not yet generated/i);
      assertReferences(coverage!.references);
    });

    it("emits SPO_SITES_COVERAGE_002 with generic title when truncated (unexpected failure)", () => {
      const findings = spoSitesCoverageFinding.derive({
        observedChecks: [
          obs("SPO_SITES_OBS_010", {
            isComplete: false,
            truncated: true,
            permissionDenied: []
          })
        ]
      });
      const coverage = findings.find((f) => f.checkId === "SPO_SITES_COVERAGE_002");
      expect(coverage).toBeDefined();
      expect(coverage!.severity).toBe("info");
      assertReferences(coverage!.references);
    });

    it("emits no SPO_SITES_COVERAGE_002 when storage report is complete", () => {
      const findings = spoSitesCoverageFinding.derive({
        observedChecks: [
          obs("SPO_SITES_OBS_010", {
            isComplete: true,
            truncated: false,
            permissionDenied: []
          })
        ]
      });
      expect(findings.some((f) => f.checkId === "SPO_SITES_COVERAGE_002")).toBe(false);
    });

    it("emits both COVERAGE_001 and COVERAGE_002 when both OBS are incomplete", () => {
      const findings = spoSitesCoverageFinding.derive({
        observedChecks: [
          obs("SPO_SITES_OBS_001", { isComplete: false, permissionDenied: [] }),
          obs("SPO_SITES_OBS_010", { isComplete: false, truncated: false, permissionDenied: [] })
        ]
      });
      expect(findings.some((f) => f.checkId === "SPO_SITES_COVERAGE_001")).toBe(true);
      expect(findings.some((f) => f.checkId === "SPO_SITES_COVERAGE_002")).toBe(true);
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

  describe("exoMailboxesCoverageFinding", () => {
    it("emits EXO_MAILBOXES_COVERAGE_001 at medium severity when reporting permissions denied", () => {
      const findings = exoMailboxesCoverageFinding.derive({
        observedChecks: [
          obs("EXO_MAILBOXES_OBS_001", {
            isComplete: false,
            truncated: false,
            permissionDenied: ["microsoft.graph/reports:getMailboxUsageDetail"]
          })
        ]
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].checkId).toBe("EXO_MAILBOXES_COVERAGE_001");
      expect(findings[0].severity).toBe("medium");
      expect(findings[0].title).toMatch(/permissions missing/i);
      assertReferences(findings[0].references);
    });

    it("emits EXO_MAILBOXES_COVERAGE_001 at info severity when report not yet generated", () => {
      const findings = exoMailboxesCoverageFinding.derive({
        observedChecks: [
          obs("EXO_MAILBOXES_OBS_001", {
            isComplete: false,
            truncated: false,
            permissionDenied: []
          })
        ]
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].checkId).toBe("EXO_MAILBOXES_COVERAGE_001");
      expect(findings[0].severity).toBe("info");
      expect(findings[0].title).toMatch(/not yet generated/i);
      assertReferences(findings[0].references);
    });

    it("emits EXO_MAILBOXES_COVERAGE_001 at low severity when truncated (unexpected failure)", () => {
      const findings = exoMailboxesCoverageFinding.derive({
        observedChecks: [
          obs("EXO_MAILBOXES_OBS_001", {
            isComplete: false,
            truncated: true,
            permissionDenied: []
          })
        ]
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].checkId).toBe("EXO_MAILBOXES_COVERAGE_001");
      expect(findings[0].severity).toBe("low");
      assertReferences(findings[0].references);
    });

    it("emits no findings when collection is complete", () => {
      const findings = exoMailboxesCoverageFinding.derive({
        observedChecks: [
          obs("EXO_MAILBOXES_OBS_001", {
            isComplete: true,
            truncated: false,
            permissionDenied: []
          })
        ]
      });
      expect(findings).toHaveLength(0);
    });

    it("emits no findings when EXO_MAILBOXES_OBS_001 is absent", () => {
      const findings = exoMailboxesCoverageFinding.derive({ observedChecks: [] });
      expect(findings).toHaveLength(0);
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

  describe("mdmCoverageFinding", () => {
    // Helpers for the two OBS this finding reads.
    function mdmObs(data: Record<string, unknown>): ObservedCheckLike {
      return obs("MDM_DEVICES_OBS_001", data);
    }
    function usersObs(data: Record<string, unknown>): ObservedCheckLike {
      return obs("ENTRA_USERS_OBS_001", data);
    }

    const completeMdmZero = { isComplete: true, counts: { total: 0 } };
    const completeUsers10 = { isComplete: true, enabledUsers: 10 };

    it("emits no finding when MDM_DEVICES_OBS_001 is absent", () => {
      const findings = mdmCoverageFinding.derive({
        observedChecks: [usersObs(completeUsers10)]
      });
      expect(findings.some((f) => f.checkId === "MDM_COVERAGE_001")).toBe(false);
    });

    it("emits no finding when ENTRA_USERS_OBS_001 is absent", () => {
      const findings = mdmCoverageFinding.derive({
        observedChecks: [mdmObs(completeMdmZero)]
      });
      expect(findings.some((f) => f.checkId === "MDM_COVERAGE_001")).toBe(false);
    });

    it("emits no finding when MDM isComplete is false (permission-denied or error)", () => {
      const findings = mdmCoverageFinding.derive({
        observedChecks: [
          mdmObs({ isComplete: false, counts: { total: 0 } }),
          usersObs(completeUsers10)
        ]
      });
      expect(findings.some((f) => f.checkId === "MDM_COVERAGE_001")).toBe(false);
    });

    it("emits no finding when users isComplete is false", () => {
      const findings = mdmCoverageFinding.derive({
        observedChecks: [
          mdmObs(completeMdmZero),
          usersObs({ isComplete: false, enabledUsers: 10 })
        ]
      });
      expect(findings.some((f) => f.checkId === "MDM_COVERAGE_001")).toBe(false);
    });

    it("emits no finding when devices are enrolled (total > 0)", () => {
      const findings = mdmCoverageFinding.derive({
        observedChecks: [
          mdmObs({ isComplete: true, counts: { total: 5 } }),
          usersObs(completeUsers10)
        ]
      });
      expect(findings.some((f) => f.checkId === "MDM_COVERAGE_001")).toBe(false);
    });

    it("emits no finding when enabledUsers is 0 (no users to protect)", () => {
      const findings = mdmCoverageFinding.derive({
        observedChecks: [
          mdmObs(completeMdmZero),
          usersObs({ isComplete: true, enabledUsers: 0 })
        ]
      });
      expect(findings.some((f) => f.checkId === "MDM_COVERAGE_001")).toBe(false);
    });

    it("emits MDM_COVERAGE_001 when no devices enrolled and enabled users exist", () => {
      const findings = mdmCoverageFinding.derive({
        observedChecks: [mdmObs(completeMdmZero), usersObs(completeUsers10)]
      });
      const finding = findings.find((f) => f.checkId === "MDM_COVERAGE_001");
      expect(finding).toBeDefined();
    });

    it("emits MDM_COVERAGE_001 at medium severity", () => {
      const findings = mdmCoverageFinding.derive({
        observedChecks: [mdmObs(completeMdmZero), usersObs(completeUsers10)]
      });
      expect(findings.find((f) => f.checkId === "MDM_COVERAGE_001")?.severity).toBe("medium");
    });

    it("includes references.observedChecks with both OBS IDs", () => {
      const findings = mdmCoverageFinding.derive({
        observedChecks: [mdmObs(completeMdmZero), usersObs(completeUsers10)]
      });
      const finding = findings.find((f) => f.checkId === "MDM_COVERAGE_001");
      assertReferences(finding?.references);
      const ids = (finding?.references as any).observedChecks as string[];
      expect(ids).toContain("MDM_DEVICES_OBS_001");
      expect(ids).toContain("ENTRA_USERS_OBS_001");
    });

    it("reads enabledUsers from counts.usersEnabled when top-level enabledUsers is absent", () => {
      const findings = mdmCoverageFinding.derive({
        observedChecks: [
          mdmObs(completeMdmZero),
          usersObs({ isComplete: true, counts: { usersEnabled: 15 } })
        ]
      });
      const finding = findings.find((f) => f.checkId === "MDM_COVERAGE_001");
      expect(finding).toBeDefined();
      expect((finding?.references as any).enabledUsers).toBe(15);
    });
  });

  describe("mdmComplianceGapFinding", () => {
    // Helper: build MDM_DEVICES_OBS_001 with full compliance count shape.
    function mdmGapObs(data: Record<string, unknown>): ObservedCheckLike {
      return obs("MDM_DEVICES_OBS_001", data);
    }

    // Represents an enrolled tenant where no device has a definitive verdict.
    const allUnknown = {
      isComplete: true,
      counts: {
        total: 4,
        compliant: 0,
        noncompliant: 0,
        unknown: 3,
        notApplicable: 1,
        inGracePeriod: 0,
        conflict: 0
      }
    };

    it("emits no finding when MDM_DEVICES_OBS_001 is absent", () => {
      const findings = mdmComplianceGapFinding.derive({ observedChecks: [] });
      expect(findings.some((f) => f.checkId === "MDM_COMPLIANCE_GAP_001")).toBe(false);
    });

    it("emits no finding when isComplete is false", () => {
      const findings = mdmComplianceGapFinding.derive({
        observedChecks: [
          mdmGapObs({ isComplete: false, counts: { total: 5, compliant: 0, noncompliant: 0 } })
        ]
      });
      expect(findings.some((f) => f.checkId === "MDM_COMPLIANCE_GAP_001")).toBe(false);
    });

    it("emits no finding when total is 0 (no enrolled devices)", () => {
      const findings = mdmComplianceGapFinding.derive({
        observedChecks: [
          mdmGapObs({
            isComplete: true,
            counts: { total: 0, compliant: 0, noncompliant: 0, unknown: 0 }
          })
        ]
      });
      expect(findings.some((f) => f.checkId === "MDM_COMPLIANCE_GAP_001")).toBe(false);
    });

    it("emits no finding when at least one device is compliant", () => {
      const findings = mdmComplianceGapFinding.derive({
        observedChecks: [
          mdmGapObs({
            isComplete: true,
            counts: { total: 3, compliant: 1, noncompliant: 0, unknown: 2 }
          })
        ]
      });
      expect(findings.some((f) => f.checkId === "MDM_COMPLIANCE_GAP_001")).toBe(false);
    });

    it("emits no finding when at least one device is noncompliant", () => {
      const findings = mdmComplianceGapFinding.derive({
        observedChecks: [
          mdmGapObs({
            isComplete: true,
            counts: { total: 3, compliant: 0, noncompliant: 2, unknown: 1 }
          })
        ]
      });
      expect(findings.some((f) => f.checkId === "MDM_COMPLIANCE_GAP_001")).toBe(false);
    });

    it("emits MDM_COMPLIANCE_GAP_001 when total > 0 and no compliant or noncompliant devices", () => {
      const findings = mdmComplianceGapFinding.derive({
        observedChecks: [mdmGapObs(allUnknown)]
      });
      const finding = findings.find((f) => f.checkId === "MDM_COMPLIANCE_GAP_001");
      expect(finding).toBeDefined();
    });

    it("emits MDM_COMPLIANCE_GAP_001 at medium severity", () => {
      const findings = mdmComplianceGapFinding.derive({
        observedChecks: [mdmGapObs(allUnknown)]
      });
      const finding = findings.find((f) => f.checkId === "MDM_COMPLIANCE_GAP_001");
      expect(finding?.severity).toBe("medium");
    });

    it("includes references.observedChecks with MDM_DEVICES_OBS_001", () => {
      const findings = mdmComplianceGapFinding.derive({
        observedChecks: [mdmGapObs(allUnknown)]
      });
      const finding = findings.find((f) => f.checkId === "MDM_COMPLIANCE_GAP_001");
      assertReferences(finding?.references);
      const ids = (finding?.references as any).observedChecks as string[];
      expect(ids).toContain("MDM_DEVICES_OBS_001");
    });

    it("includes count fields in references", () => {
      const findings = mdmComplianceGapFinding.derive({
        observedChecks: [mdmGapObs(allUnknown)]
      });
      const finding = findings.find((f) => f.checkId === "MDM_COMPLIANCE_GAP_001");
      const refs = finding?.references as any;
      expect(refs.totalEnrolledDevices).toBe(4);
      expect(refs.compliant).toBe(0);
      expect(refs.noncompliant).toBe(0);
      expect(refs.unknown).toBe(3);
    });

    it("does not emit when both compliant and noncompliant counts are positive", () => {
      const findings = mdmComplianceGapFinding.derive({
        observedChecks: [
          mdmGapObs({
            isComplete: true,
            counts: { total: 6, compliant: 3, noncompliant: 3, unknown: 0 }
          })
        ]
      });
      expect(findings.some((f) => f.checkId === "MDM_COMPLIANCE_GAP_001")).toBe(false);
    });
  });

  // ── SPO_RESHARING_001 ────────────────────────────────────────────────────

  describe("spoSharingFinding — SPO_RESHARING_001 (external users can re-share content)", () => {
    it("does not emit when SPO_ADMIN_OBS_001 is absent", () => {
      const findings = spoSharingFinding.derive({ observedChecks: [] });
      expect(findings.some((f) => f.checkId === "SPO_RESHARING_001")).toBe(false);
    });

    it("does not emit when isComplete is false", () => {
      const findings = spoSharingFinding.derive({
        observedChecks: [
          spoAdminObs({ isComplete: false, isResharingByExternalUsersEnabled: true })
        ]
      });
      expect(findings.some((f) => f.checkId === "SPO_RESHARING_001")).toBe(false);
    });

    it("does not emit when isResharingByExternalUsersEnabled is null", () => {
      const findings = spoSharingFinding.derive({
        observedChecks: [
          spoAdminObs({ isComplete: true, isResharingByExternalUsersEnabled: null })
        ]
      });
      expect(findings.some((f) => f.checkId === "SPO_RESHARING_001")).toBe(false);
    });

    it("does not emit when isResharingByExternalUsersEnabled is false", () => {
      const findings = spoSharingFinding.derive({
        observedChecks: [
          spoAdminObs({ isComplete: true, isResharingByExternalUsersEnabled: false })
        ]
      });
      expect(findings.some((f) => f.checkId === "SPO_RESHARING_001")).toBe(false);
    });

    it("emits SPO_RESHARING_001 when isComplete is true and isResharingByExternalUsersEnabled is true", () => {
      const findings = spoSharingFinding.derive({
        observedChecks: [
          spoAdminObs({ isComplete: true, isResharingByExternalUsersEnabled: true })
        ]
      });
      expect(findings.some((f) => f.checkId === "SPO_RESHARING_001")).toBe(true);
    });

    it("emits SPO_RESHARING_001 at medium severity", () => {
      const findings = spoSharingFinding.derive({
        observedChecks: [
          spoAdminObs({ isComplete: true, isResharingByExternalUsersEnabled: true })
        ]
      });
      const finding = findings.find((f) => f.checkId === "SPO_RESHARING_001");
      expect(finding?.severity).toBe("medium");
    });

    it("includes references.observedChecks with SPO_ADMIN_OBS_001", () => {
      const findings = spoSharingFinding.derive({
        observedChecks: [
          spoAdminObs({ isComplete: true, isResharingByExternalUsersEnabled: true })
        ]
      });
      const finding = findings.find((f) => f.checkId === "SPO_RESHARING_001");
      assertReferences(finding?.references);
      const ids = (finding?.references as any).observedChecks as string[];
      expect(ids).toContain("SPO_ADMIN_OBS_001");
    });

    it("co-emits SPO_RESHARING_001 and SPO_SHARING_001 when both conditions are met", () => {
      const findings = spoSharingFinding.derive({
        observedChecks: [
          spoAdminObs({
            isComplete: true,
            sharingCapability: "externalUserAndGuestSharing",
            isResharingByExternalUsersEnabled: true
          })
        ]
      });
      expect(findings.some((f) => f.checkId === "SPO_SHARING_001")).toBe(true);
      expect(findings.some((f) => f.checkId === "SPO_RESHARING_001")).toBe(true);
    });

    it("does not emit SPO_RESHARING_001 when re-sharing is disabled even if sharing is enabled", () => {
      const findings = spoSharingFinding.derive({
        observedChecks: [
          spoAdminObs({
            isComplete: true,
            sharingCapability: "externalUserAndGuestSharing",
            isResharingByExternalUsersEnabled: false
          })
        ]
      });
      expect(findings.some((f) => f.checkId === "SPO_RESHARING_001")).toBe(false);
    });
  });

  // ── ENTRA_PIM_001 ─────────────────────────────────────────────────────────

  describe("entraDirectoryRolesFinding — ENTRA_PIM_001 (no PIM-eligible assignments)", () => {
    // Helper OBS builders
    function dirRolesObs001(activeAssignmentsCount: number): ObservedCheckLike {
      return obs("ENTRA_DIRROLES_OBS_001", { activeAssignmentsCount });
    }

    function dirRolesObs004(data: Record<string, unknown>): ObservedCheckLike {
      return obs("ENTRA_DIRROLES_OBS_004", data);
    }

    function dirRolesObs005(isComplete: boolean, truncated = false): ObservedCheckLike {
      return obs("ENTRA_DIRROLES_OBS_005", { isComplete, truncated });
    }

    // Canonical "all guards pass" set of observed checks.
    const passingChecks = [
      dirRolesObs001(5),
      dirRolesObs004({ succeeded: true, eligibleAssignmentsCount: 0 }),
      dirRolesObs005(true, false)
    ];

    it("does not emit when ENTRA_DIRROLES_OBS_004 is absent (PIM slice disabled)", () => {
      const findings = entraDirectoryRolesFinding.derive({
        observedChecks: [dirRolesObs001(5), dirRolesObs005(true, false)]
      });
      expect(findings.some((f) => f.checkId === "ENTRA_PIM_001")).toBe(false);
    });

    it("does not emit when OBS_004.succeeded is false (P2 not licensed or API error)", () => {
      const findings = entraDirectoryRolesFinding.derive({
        observedChecks: [
          dirRolesObs001(5),
          dirRolesObs004({ succeeded: false }),
          dirRolesObs005(true, false)
        ]
      });
      expect(findings.some((f) => f.checkId === "ENTRA_PIM_001")).toBe(false);
    });

    it("does not emit when eligibleAssignmentsCount is undefined (API failure path)", () => {
      const findings = entraDirectoryRolesFinding.derive({
        observedChecks: [
          dirRolesObs001(5),
          dirRolesObs004({ succeeded: true }), // eligibleAssignmentsCount absent
          dirRolesObs005(true, false)
        ]
      });
      expect(findings.some((f) => f.checkId === "ENTRA_PIM_001")).toBe(false);
    });

    it("does not emit when eligibleAssignmentsCount > 0 (PIM assignments exist)", () => {
      const findings = entraDirectoryRolesFinding.derive({
        observedChecks: [
          dirRolesObs001(5),
          dirRolesObs004({ succeeded: true, eligibleAssignmentsCount: 3 }),
          dirRolesObs005(true, false)
        ]
      });
      expect(findings.some((f) => f.checkId === "ENTRA_PIM_001")).toBe(false);
    });

    it("does not emit when ENTRA_DIRROLES_OBS_005 is absent (core completeness unknown)", () => {
      const findings = entraDirectoryRolesFinding.derive({
        observedChecks: [
          dirRolesObs001(5),
          dirRolesObs004({ succeeded: true, eligibleAssignmentsCount: 0 })
        ]
      });
      expect(findings.some((f) => f.checkId === "ENTRA_PIM_001")).toBe(false);
    });

    it("does not emit when OBS_005.isComplete is false (truncated or permission-denied core slice)", () => {
      const findings = entraDirectoryRolesFinding.derive({
        observedChecks: [
          dirRolesObs001(5),
          dirRolesObs004({ succeeded: true, eligibleAssignmentsCount: 0 }),
          dirRolesObs005(false, false)
        ]
      });
      expect(findings.some((f) => f.checkId === "ENTRA_PIM_001")).toBe(false);
    });

    it("does not emit when OBS_005.truncated is true (counts unreliable)", () => {
      const findings = entraDirectoryRolesFinding.derive({
        observedChecks: [
          dirRolesObs001(5),
          dirRolesObs004({ succeeded: true, eligibleAssignmentsCount: 0 }),
          dirRolesObs005(true, true) // isComplete true but truncated
        ]
      });
      expect(findings.some((f) => f.checkId === "ENTRA_PIM_001")).toBe(false);
    });

    it("does not emit when ENTRA_DIRROLES_OBS_001 is absent", () => {
      const findings = entraDirectoryRolesFinding.derive({
        observedChecks: [
          dirRolesObs004({ succeeded: true, eligibleAssignmentsCount: 0 }),
          dirRolesObs005(true, false)
        ]
      });
      expect(findings.some((f) => f.checkId === "ENTRA_PIM_001")).toBe(false);
    });

    it("does not emit when activeAssignmentsCount is 0 (no standing assignments to protect)", () => {
      const findings = entraDirectoryRolesFinding.derive({
        observedChecks: [
          dirRolesObs001(0),
          dirRolesObs004({ succeeded: true, eligibleAssignmentsCount: 0 }),
          dirRolesObs005(true, false)
        ]
      });
      expect(findings.some((f) => f.checkId === "ENTRA_PIM_001")).toBe(false);
    });

    it("emits ENTRA_PIM_001 when all guards pass", () => {
      const findings = entraDirectoryRolesFinding.derive({ observedChecks: passingChecks });
      const finding = findings.find((f) => f.checkId === "ENTRA_PIM_001");
      expect(finding).toBeDefined();
    });

    it("emits ENTRA_PIM_001 at medium severity", () => {
      const findings = entraDirectoryRolesFinding.derive({ observedChecks: passingChecks });
      const finding = findings.find((f) => f.checkId === "ENTRA_PIM_001");
      expect(finding?.severity).toBe("medium");
    });

    it("includes references with activeAssignmentsCount, eligibleAssignmentsCount, and all three OBS IDs", () => {
      const findings = entraDirectoryRolesFinding.derive({ observedChecks: passingChecks });
      const finding = findings.find((f) => f.checkId === "ENTRA_PIM_001");
      assertReferences(finding?.references);
      const refs = finding?.references as any;
      expect(refs.activeAssignmentsCount).toBe(5);
      expect(refs.eligibleAssignmentsCount).toBe(0);
      const ids = refs.observedChecks as string[];
      expect(ids).toContain("ENTRA_DIRROLES_OBS_001");
      expect(ids).toContain("ENTRA_DIRROLES_OBS_004");
      expect(ids).toContain("ENTRA_DIRROLES_OBS_005");
    });
  });

  // ── ENTRA_GLOBAL_ADMIN_001 ────────────────────────────────────────────────

  describe("entraDirectoryRolesFinding — ENTRA_GLOBAL_ADMIN_001 (multiple Global Admins)", () => {
    function gaObs001(globalAdminCount: number): ObservedCheckLike {
      return obs("ENTRA_DIRROLES_OBS_001", { globalAdminCount, activeAssignmentsCount: globalAdminCount });
    }

    function gaObs005(isComplete: boolean, truncated = false): ObservedCheckLike {
      return obs("ENTRA_DIRROLES_OBS_005", { isComplete, truncated });
    }

    const completeObs005 = gaObs005(true, false);

    it("does not emit when ENTRA_DIRROLES_OBS_001 is absent", () => {
      const findings = entraDirectoryRolesFinding.derive({
        observedChecks: [completeObs005]
      });
      expect(findings.some((f) => f.checkId === "ENTRA_GLOBAL_ADMIN_001")).toBe(false);
    });

    it("does not emit when ENTRA_DIRROLES_OBS_005 is absent", () => {
      const findings = entraDirectoryRolesFinding.derive({
        observedChecks: [gaObs001(2)]
      });
      expect(findings.some((f) => f.checkId === "ENTRA_GLOBAL_ADMIN_001")).toBe(false);
    });

    it("does not emit when OBS_005.isComplete is false", () => {
      const findings = entraDirectoryRolesFinding.derive({
        observedChecks: [gaObs001(2), gaObs005(false)]
      });
      expect(findings.some((f) => f.checkId === "ENTRA_GLOBAL_ADMIN_001")).toBe(false);
    });

    it("does not emit when OBS_005.truncated is true", () => {
      const findings = entraDirectoryRolesFinding.derive({
        observedChecks: [gaObs001(2), gaObs005(true, true)]
      });
      expect(findings.some((f) => f.checkId === "ENTRA_GLOBAL_ADMIN_001")).toBe(false);
    });

    it("does not emit when globalAdminCount is 0", () => {
      const findings = entraDirectoryRolesFinding.derive({
        observedChecks: [gaObs001(0), completeObs005]
      });
      expect(findings.some((f) => f.checkId === "ENTRA_GLOBAL_ADMIN_001")).toBe(false);
    });

    it("does not emit when globalAdminCount is 1", () => {
      const findings = entraDirectoryRolesFinding.derive({
        observedChecks: [gaObs001(1), completeObs005]
      });
      expect(findings.some((f) => f.checkId === "ENTRA_GLOBAL_ADMIN_001")).toBe(false);
    });

    it("emits ENTRA_GLOBAL_ADMIN_001 when globalAdminCount is 2", () => {
      const findings = entraDirectoryRolesFinding.derive({
        observedChecks: [gaObs001(2), completeObs005]
      });
      expect(findings.some((f) => f.checkId === "ENTRA_GLOBAL_ADMIN_001")).toBe(true);
    });

    it("emits ENTRA_GLOBAL_ADMIN_001 at medium severity", () => {
      const findings = entraDirectoryRolesFinding.derive({
        observedChecks: [gaObs001(2), completeObs005]
      });
      const finding = findings.find((f) => f.checkId === "ENTRA_GLOBAL_ADMIN_001");
      expect(finding?.severity).toBe("medium");
    });

    it("includes references with globalAdminCount and both OBS IDs", () => {
      const findings = entraDirectoryRolesFinding.derive({
        observedChecks: [gaObs001(2), completeObs005]
      });
      const finding = findings.find((f) => f.checkId === "ENTRA_GLOBAL_ADMIN_001");
      assertReferences(finding?.references);
      const refs = finding?.references as any;
      expect(refs.globalAdminCount).toBe(2);
      const ids = refs.observedChecks as string[];
      expect(ids).toContain("ENTRA_DIRROLES_OBS_001");
      expect(ids).toContain("ENTRA_DIRROLES_OBS_005");
    });

    it("co-emits ENTRA_GLOBAL_ADMIN_001 and ENTRA_DIRROLES_010 when globalAdminCount is 3", () => {
      const findings = entraDirectoryRolesFinding.derive({
        observedChecks: [gaObs001(3), completeObs005]
      });
      expect(findings.some((f) => f.checkId === "ENTRA_GLOBAL_ADMIN_001")).toBe(true);
      expect(findings.some((f) => f.checkId === "ENTRA_DIRROLES_010")).toBe(true);
    });

    it("does not emit ENTRA_DIRROLES_010 when globalAdminCount is 2 (below 010 threshold)", () => {
      const findings = entraDirectoryRolesFinding.derive({
        observedChecks: [gaObs001(2), completeObs005]
      });
      expect(findings.some((f) => f.checkId === "ENTRA_DIRROLES_010")).toBe(false);
    });
  });

});
