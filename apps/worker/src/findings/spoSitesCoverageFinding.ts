// apps/worker/src/findings/spoSitesCoverageFinding.ts

import type { FindingDerivation, DerivedFinding } from "./types";

export const spoSitesCoverageFinding: FindingDerivation = {
  id: "spo.sites.coverage",

  emits: ["SPO_SITES_COVERAGE_001", "SPO_SITES_COVERAGE_002"],

  derive({ observedChecks }): DerivedFinding[] {
    const findings: DerivedFinding[] = [];

    // -------------------------
    // SPO_SITES_COVERAGE_001: site inventory incomplete (SPO_SITES_OBS_001)
    // -------------------------
    const obs001 = observedChecks.find((o) => o.checkId === "SPO_SITES_OBS_001");
    if (obs001 && (obs001.data as any)?.isComplete === false) {
      const permissionDenied: string[] =
        Array.isArray((obs001.data as any)?.permissionDenied)
          ? (obs001.data as any).permissionDenied
          : [];

      const hasPermissionGap = permissionDenied.some((p: string) => p.includes("sites:list"));

      if (hasPermissionGap) {
        findings.push({
          checkId: "SPO_SITES_COVERAGE_001",
          severity: "medium",
          title: "SharePoint site inventory incomplete — Sites.Read.All permission missing",
          recommendation:
            "The SharePoint site inventory could not be completed because the scanning identity was denied access to the sites list (403). Without full site enumeration, the tenant's SharePoint estate cannot be assessed for governance, data residency, or sharing exposure risks. Grant the Sites.Read.All application permission and re-run the scan to achieve full coverage.",
          references: {
            observedChecks: ["SPO_SITES_OBS_001"]
          }
        });
      } else {
        // isComplete === false but not a permission gap — unexpected/transient failure.
        findings.push({
          checkId: "SPO_SITES_COVERAGE_001",
          severity: "low",
          title: "SharePoint site inventory incomplete — site enumeration failed",
          recommendation:
            "The SharePoint site inventory did not complete successfully. SharePoint estate metrics and findings from this run may be absent or partial. Re-running the scan should resolve a transient failure; if the problem persists, review the collector logs for details.",
          references: {
            observedChecks: ["SPO_SITES_OBS_001"]
          }
        });
      }
    }

    // -------------------------
    // SPO_SITES_COVERAGE_002: storage/reporting incomplete (SPO_SITES_OBS_010)
    // -------------------------
    const obs010 = observedChecks.find((o) => o.checkId === "SPO_SITES_OBS_010");
    if (obs010 && (obs010.data as any)?.isComplete === false) {
      const permissionDenied: string[] =
        Array.isArray((obs010.data as any)?.permissionDenied)
          ? (obs010.data as any).permissionDenied
          : [];
      const truncated: boolean = (obs010.data as any)?.truncated === true;

      const hasPermissionGap = permissionDenied.some((p: string) =>
        p.includes("reports:getSharePointSiteUsageDetail")
      );

      let title: string;
      if (hasPermissionGap) {
        title = "SharePoint storage usage report unavailable — reporting permissions missing";
      } else if (truncated) {
        title = "SharePoint storage usage report unavailable";
      } else {
        title = "SharePoint storage usage report unavailable — report data not yet generated";
      }

      findings.push({
        checkId: "SPO_SITES_COVERAGE_002",
        severity: "info",
        title,
        recommendation:
          "SharePoint storage usage totals for this run are unavailable. If the Reports.Read.All (or equivalent) application permission has not been granted, admin consent is required. If permissions are in place, the Microsoft 365 usage reports may not yet have been generated for this tenant — this is common on new or lightly used tenants. Re-running the scan after a short delay usually resolves a report-not-ready condition.",
        references: {
          observedChecks: ["SPO_SITES_OBS_010"]
        }
      });
    }

    return findings;
  }
};
