// apps/worker/src/findings/eapHighPrivFinding.ts

import type { FindingDerivation, DerivedFinding } from "./types";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

export const eapHighPrivFinding: FindingDerivation = {
  id: "entra.enterpriseApps.highPrivilegePermissions",

  emits: ["ENTRA_EAP_HIGH_PRIV_001"],

  derive({ observedChecks }): DerivedFinding[] {
    const obs = observedChecks.find((o) => o.checkId === "ENTRA_EAP_OBS_001");
    if (!obs) return [];

    const riskyApps = asNumber((obs.data as any)?.riskyApps);

    // Only emit when we have a confirmed non-zero risky app count.
    if (riskyApps === null || riskyApps <= 0) return [];

    return [
      {
        checkId: "ENTRA_EAP_HIGH_PRIV_001",
        severity: "medium",
        title: `${riskyApps} enterprise app${riskyApps === 1 ? "" : "s"} with high-privilege Graph permissions`,
        recommendation:
          "One or more enterprise applications hold high-privilege Microsoft Graph permissions (such as Directory.ReadWrite.All, User.ReadWrite.All, or RoleManagement.ReadWrite.Directory). Validate with the customer that each application's permissions are justified by a documented business requirement, that application ownership and credential hygiene (certificates/secrets rotation) are confirmed, and that any unused permissions are removed."
      }
    ];
  }
};
