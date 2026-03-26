// apps/worker/src/findings/spoSitesCoverageFinding.ts

import type { FindingDerivation, DerivedFinding } from "./types";

export const spoSitesCoverageFinding: FindingDerivation = {
  id: "spo.sites.coverage",

  emits: ["SPO_SITES_COVERAGE_001"],

  derive({ observedChecks }): DerivedFinding[] {
    const obs = observedChecks.find((o) => o.checkId === "SPO_SITES_OBS_001");
    if (!obs) return [];

    const isComplete = (obs.data as any)?.isComplete;

    // Only emit when collection was attempted but did not complete.
    if (isComplete !== false) return [];

    const permissionDenied: string[] =
      Array.isArray((obs.data as any)?.permissionDenied)
        ? (obs.data as any).permissionDenied
        : [];

    const hasPermissionGap =
      permissionDenied.some((p: string) => p.includes("sites:list"));

    if (hasPermissionGap) {
      return [
        {
          checkId: "SPO_SITES_COVERAGE_001",
          severity: "medium",
          title: "SharePoint site inventory incomplete — Sites.Read.All permission missing",
          recommendation:
            "The SharePoint site inventory could not be completed because the scanning identity was denied access to the sites list (403). Without full site enumeration, the tenant's SharePoint estate cannot be assessed for governance, data residency, or sharing exposure risks. Grant the Sites.Read.All application permission and re-run the scan to achieve full coverage.",
          references: {
            observedChecks: ["SPO_SITES_OBS_001"]
          }
        }
      ];
    }

    // isComplete === false but not a permission gap — unexpected/transient failure.
    return [
      {
        checkId: "SPO_SITES_COVERAGE_001",
        severity: "low",
        title: "SharePoint site inventory incomplete — site enumeration failed",
        recommendation:
          "The SharePoint site inventory did not complete successfully. SharePoint estate metrics and findings from this run may be absent or partial. Re-running the scan should resolve a transient failure; if the problem persists, review the collector logs for details.",
        references: {
          observedChecks: ["SPO_SITES_OBS_001"]
        }
      }
    ];
  }
};
