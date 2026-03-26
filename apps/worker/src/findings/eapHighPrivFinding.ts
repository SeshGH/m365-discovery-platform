// apps/worker/src/findings/eapHighPrivFinding.ts

import type { FindingDerivation, DerivedFinding } from "./types";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

export const eapHighPrivFinding: FindingDerivation = {
  id: "entra.enterpriseApps.highPrivilegePermissions",

  emits: ["ENTRA_EAP_HIGH_PRIV_001", "ENTRA_EAP_COVERAGE_001"],

  derive({ observedChecks }): DerivedFinding[] {
    const obs = observedChecks.find((o) => o.checkId === "ENTRA_EAP_OBS_001");
    if (!obs) return [];

    const findings: DerivedFinding[] = [];

    const riskyApps = asNumber((obs.data as any)?.riskyApps);

    // High-privilege permissions signal.
    if (riskyApps !== null && riskyApps > 0) {
      findings.push({
        checkId: "ENTRA_EAP_HIGH_PRIV_001",
        severity: "medium",
        title: `${riskyApps} enterprise app${riskyApps === 1 ? "" : "s"} with high-privilege Graph permissions`,
        recommendation:
          "One or more enterprise applications hold high-privilege Microsoft Graph permissions (such as Directory.ReadWrite.All, User.ReadWrite.All, or RoleManagement.ReadWrite.Directory). Validate with the customer that each application's permissions are justified by a documented business requirement, that application ownership and credential hygiene (certificates/secrets rotation) are confirmed, and that any unused permissions are removed.",
        references: {
          observedChecks: ["ENTRA_EAP_OBS_001"]
        }
      });
    }

    // Coverage completeness signal: scan was capped before all apps were reviewed.
    // Without this, a run with no ENTRA_EAP_HIGH_PRIV_001 could be misread as "all apps clean."
    const truncated = (obs.data as any)?.truncated === true;
    if (truncated) {
      const maxApps = asNumber((obs.data as any)?.maxApps);
      const scannedApps = asNumber((obs.data as any)?.scannedApps);
      const capLabel = maxApps !== null ? ` at ${maxApps} apps` : "";
      const scannedLabel = scannedApps !== null ? ` (${scannedApps} reviewed)` : "";
      findings.push({
        checkId: "ENTRA_EAP_COVERAGE_001",
        severity: "info",
        title: `Enterprise app permission review incomplete — scan capped${capLabel}${scannedLabel}`,
        recommendation:
          `The enterprise application scan was limited${capLabel} by configured guardrails. Permission review findings from this run are indicative only and may not reflect the full tenant application estate. Increase the scan cap or run a full-profile scan to achieve complete review coverage before drawing conclusions about the tenant's application permission posture.`,
        references: {
          observedChecks: ["ENTRA_EAP_OBS_001"]
        }
      });
    }

    return findings;
  }
};
