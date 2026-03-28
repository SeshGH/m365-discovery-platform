// apps/worker/src/findings/mdmCoverageFinding.ts
//
// Derivation: intune.devices.coverage
// Emits:      MDM_COVERAGE_001
//
// Source OBS:
//   MDM_DEVICES_OBS_001  — Intune managed device enumeration
//   ENTRA_USERS_OBS_001  — Entra user counts
//
// MDM_COVERAGE_001 fires when Intune data was collected successfully (isComplete)
// and shows zero enrolled devices, while the Entra users OBS confirms that
// enabled users are present.  Both OBS must be complete; absence of either is
// treated as a guard failure (no finding emitted) so that an incomplete scan
// does not produce a misleading "no MDM" signal.
//
// Note on license data:
//   This finding does NOT check MDM-capable licensing (e.g. Intune / M365 E3/E5
//   SKU assignments).  The users safe artefact contains counts only — no per-user
//   assignedLicenses data is collected.  Device enrollment is used as the proxy
//   for MDM coverage instead: zero enrolled devices despite enabled users being
//   present is a credible, directly observable MDM gap signal.

import type { FindingDerivation, DerivedFinding } from "./types";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

export const mdmCoverageFinding: FindingDerivation = {
  id: "intune.devices.coverage",

  emits: ["MDM_COVERAGE_001"],

  derive({ observedChecks }): DerivedFinding[] {
    const mdmObs = observedChecks.find((o) => o.checkId === "MDM_DEVICES_OBS_001");
    const usersObs = observedChecks.find((o) => o.checkId === "ENTRA_USERS_OBS_001");

    // Both OBS must be present.
    if (!mdmObs || !usersObs) return [];

    const mdmData = mdmObs.data as any;
    const usersData = usersObs.data as any;

    // Guard: Intune enumeration must have completed successfully.
    // permissionDenied or truncated means absence of devices could be an
    // artefact of incomplete collection, not a real coverage gap.
    if (mdmData?.isComplete !== true) return [];

    // Guard: user data must also be complete so we know enabled users exist.
    if (usersData?.isComplete !== true) return [];

    const totalDevices = asNumber(mdmData?.counts?.total) ?? 0;

    // Guard: devices are enrolled — no coverage gap to report.
    if (totalDevices > 0) return [];

    // Resolve enabled-user count from either OBS shape.
    // ENTRA_USERS_OBS_001 has two equivalent fields for backward-compat;
    // prefer counts.usersEnabled, fall back to top-level enabledUsers.
    const enabledUsers =
      asNumber(usersData?.counts?.usersEnabled) ??
      asNumber(usersData?.enabledUsers) ??
      0;

    // Guard: no enabled users means there is nothing to protect — no finding.
    if (enabledUsers <= 0) return [];

    return [
      {
        checkId: "MDM_COVERAGE_001",
        severity: "medium",
        title: "No devices enrolled in Intune — possible MDM coverage gap",
        recommendation:
          "Intune device management was successfully queried and shows zero enrolled devices, " +
          "while the tenant has enabled users. Based on available evidence this suggests that " +
          "mobile device management may not be in use. " +
          "If MDM is intended to be in place: verify that devices have been enrolled in " +
          "Microsoft Intune, that appropriate MDM-capable licenses (e.g. Microsoft 365 " +
          "Business Premium, E3/E5, or standalone Intune) are assigned to users, and that " +
          "device compliance and configuration policies are active. " +
          "Note: this finding does not claim definitively that MDM is absent — devices may be " +
          "managed through a third-party MDM solution not visible to this collector, or " +
          "enrollment may be in progress. Review with the customer before drawing conclusions.",
        references: {
          totalEnrolledDevices: totalDevices,
          enabledUsers,
          observedChecks: ["MDM_DEVICES_OBS_001", "ENTRA_USERS_OBS_001"]
        }
      }
    ];
  }
};
