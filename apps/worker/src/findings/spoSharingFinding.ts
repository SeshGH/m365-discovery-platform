// apps/worker/src/findings/spoSharingFinding.ts

import type { FindingDerivation, DerivedFinding } from "./types";

export const spoSharingFinding: FindingDerivation = {
  id: "spo.admin.settings.sharing",

  // 🔑 REQUIRED: declare which finding checkIds this derivation owns
  emits: ["SPO_SHARING_001"],

  derive({ observedChecks }): DerivedFinding[] {
    const obs = observedChecks.find((o) => o.checkId === "SPO_ADMIN_OBS_001");
    if (!obs) return [];

    const capability =
      typeof (obs.data as any)?.sharingCapability === "string"
        ? ((obs.data as any).sharingCapability as string)
        : null;

    if (!capability) return [];

    // Anonymous links enabled tenant-wide — notable risk surface, validate intent.
    if (capability === "externalUserAndGuestSharing") {
      return [
        {
          checkId: "SPO_SHARING_001",
          severity: "medium",
          title: "SharePoint tenant sharing allows anonymous links",
          recommendation:
            "The tenant-level SharePoint sharing setting is configured to allow Anyone links (anonymous sharing). Validate with the customer that this is intentional and that link-expiry policies and scope restrictions are in place.",
          references: {
            observedChecks: ["SPO_ADMIN_OBS_001"]
          }
        }
      ];
    }

    // External authenticated users allowed — common configuration, flag for awareness.
    if (capability === "externalUserSharingOnly") {
      return [
        {
          checkId: "SPO_SHARING_001",
          severity: "info",
          title: "SharePoint tenant sharing allows external user invitations",
          recommendation:
            "External user invitations are enabled at the SharePoint tenant level. Validate with the customer that guest access governance and access review processes are in place.",
          references: {
            observedChecks: ["SPO_ADMIN_OBS_001"]
          }
        }
      ];
    }

    // "disabled" or "existingExternalUserSharingOnly" — no finding needed.
    return [];
  }
};