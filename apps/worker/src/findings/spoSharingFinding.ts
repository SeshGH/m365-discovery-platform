// apps/worker/src/findings/spoSharingFinding.ts

import type { FindingDerivation, DerivedFinding } from "./types";

export const spoSharingFinding: FindingDerivation = {
  id: "spo.admin.settings.sharing",

  emits: ["SPO_SHARING_001", "SPO_LEGACY_AUTH_001"],

  derive({ observedChecks }): DerivedFinding[] {
    const obs = observedChecks.find((o) => o.checkId === "SPO_ADMIN_OBS_001");
    if (!obs) return [];

    const d = obs.data as any;
    const findings: DerivedFinding[] = [];

    // ── SPO_SHARING_001: tenant sharing capability ────────────────────────────
    // The collector only sets sharingCapability when the API call succeeds.
    // A null sharingCapability therefore implies an incomplete collection;
    // no sharing finding is emitted in that case.
    const capability =
      typeof d?.sharingCapability === "string" ? (d.sharingCapability as string) : null;

    if (capability === "externalUserAndGuestSharing") {
      // Anonymous links enabled tenant-wide — notable risk surface, validate intent.
      findings.push({
        checkId: "SPO_SHARING_001",
        severity: "medium",
        title: "SharePoint tenant sharing allows anonymous links",
        recommendation:
          "The tenant-level SharePoint sharing setting is configured to allow Anyone links (anonymous sharing). Validate with the customer that this is intentional and that link-expiry policies and scope restrictions are in place.",
        references: {
          observedChecks: ["SPO_ADMIN_OBS_001"]
        }
      });
    } else if (capability === "externalUserSharingOnly") {
      // External authenticated users allowed — common configuration, flag for awareness.
      findings.push({
        checkId: "SPO_SHARING_001",
        severity: "info",
        title: "SharePoint tenant sharing allows external user invitations",
        recommendation:
          "External user invitations are enabled at the SharePoint tenant level. Validate with the customer that guest access governance and access review processes are in place.",
        references: {
          observedChecks: ["SPO_ADMIN_OBS_001"]
        }
      });
    }
    // "disabled" or "existingExternalUserSharingOnly" — no finding needed.

    // ── SPO_LEGACY_AUTH_001: legacy authentication protocols enabled ──────────
    //
    // Guard: only evaluate when the OBS indicates complete data (isComplete === true).
    // The collector sets isComplete: false on any API failure (403 or unexpected
    // error), in which case isLegacyAuthProtocolsEnabled will be null.  The
    // explicit isComplete guard is defence in depth and keeps the intent clear.
    //
    // Legacy authentication protocols (pre-modern-auth clients using basic auth
    // or forms-based auth to SharePoint) bypass Conditional Access policies
    // entirely, including any MFA enforcement.  This is a SharePoint service-level
    // setting and is independent of any CA policy that blocks legacy auth at the
    // Azure AD identity broker level (ENTRA_CA_003).  Both controls operate at
    // different layers; both can co-emit.
    if (d?.isComplete === true && d?.isLegacyAuthProtocolsEnabled === true) {
      findings.push({
        checkId: "SPO_LEGACY_AUTH_001",
        severity: "medium",
        title: "SharePoint legacy authentication protocols are enabled",
        recommendation:
          "The SharePoint tenant-level setting for legacy authentication protocols is enabled. " +
          "Legacy authentication (pre-modern-auth clients using basic auth or forms-based auth) " +
          "bypasses Conditional Access policies entirely, including any policy that enforces MFA. " +
          "Review whether legacy authentication is actively required by any client application or " +
          "integration in the tenant. If no legacy clients are in use, disable legacy auth in the " +
          "SharePoint admin settings. If legacy clients are present, identify and plan their " +
          "migration to modern authentication to reduce the bypass risk. " +
          "Note: if a Conditional Access policy blocking legacy auth protocols is already in place " +
          "(see ENTRA_CA_003), disabling this setting at the SharePoint service level provides " +
          "additional defence in depth and is still recommended.",
        references: {
          isLegacyAuthProtocolsEnabled: true,
          observedChecks: ["SPO_ADMIN_OBS_001"]
        }
      });
    }

    return findings;
  }
};
