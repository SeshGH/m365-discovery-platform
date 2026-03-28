// apps/worker/src/findings/mdmComplianceGapFinding.ts
//
// Derivation: intune.devices.compliance.gap
// Emits:      MDM_COMPLIANCE_GAP_001
//
// Source OBS: MDM_DEVICES_OBS_001
//
// NOTE — ID correction from spec:
//   The spec proposed MDM_COMPLIANCE_001, but that ID is already owned by
//   mdmComplianceFinding.ts (fires when noncompliant > 0).  Re-using the same
//   checkId with different semantics would violate the ID-stability contract and
//   cause both derivations to delete each other's findings on every run.
//   This finding uses MDM_COMPLIANCE_GAP_001 instead.
//
// NOTE — Detection logic correction from spec:
//   The spec requested "detect absence of compliance-related fields".  In practice,
//   MDM_DEVICES_OBS_001 ALWAYS writes all compliance count fields (compliant,
//   noncompliant, unknown, …) whenever isComplete === true, so those fields are
//   never absent.  The correct detectable proxy for "compliance posture cannot be
//   verified" is: devices are enrolled (total > 0) but neither a compliant nor a
//   noncompliant verdict has been issued for any of them — i.e. all devices sit in
//   unresolved states (unknown, notApplicable, inGracePeriod, conflict).
//   This condition is: counts.total > 0 && counts.compliant === 0 && counts.noncompliant === 0.
//
// Relationship to MDM_COMPLIANCE_001 (mdmComplianceFinding.ts):
//   MDM_COMPLIANCE_001 — fires when noncompliant > 0 (policy violations present)
//   MDM_COMPLIANCE_GAP_001 — fires when total > 0 but no definitive verdict exists
//   Both findings can co-emit when all devices are non-compliant but none are
//   evaluated as compliant; they address complementary risk surfaces.

import type { FindingDerivation, DerivedFinding } from "./types";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

export const mdmComplianceGapFinding: FindingDerivation = {
  id: "intune.devices.compliance.gap",

  emits: ["MDM_COMPLIANCE_GAP_001"],

  derive({ observedChecks }): DerivedFinding[] {
    const obs = observedChecks.find((o) => o.checkId === "MDM_DEVICES_OBS_001");

    // Guard: OBS must be present.
    if (!obs) return [];

    // Guard: collection must be complete.  permissionDenied and truncated both
    // produce null counts; drawing "no compliance verdict" conclusions from
    // incomplete data would risk false positives.
    if ((obs.data as any)?.isComplete !== true) return [];

    const counts = (obs.data as any)?.counts;

    const total = asNumber(counts?.total) ?? 0;

    // Guard: no devices enrolled — nothing to evaluate.
    if (total <= 0) return [];

    const compliant = asNumber(counts?.compliant) ?? 0;
    const noncompliant = asNumber(counts?.noncompliant) ?? 0;

    // Emit only when no device has received a definitive compliance verdict.
    // If any device is compliant or noncompliant the compliance policy framework
    // is functioning — this finding should not add noise in that case.
    if (compliant > 0 || noncompliant > 0) return [];

    // All enrolled devices are in unresolved states (unknown, notApplicable,
    // inGracePeriod, conflict).  Compliance posture cannot be confirmed.
    const unknown = asNumber(counts?.unknown) ?? 0;
    const notApplicable = asNumber(counts?.notApplicable) ?? 0;
    const inGracePeriod = asNumber(counts?.inGracePeriod) ?? 0;
    const conflict = asNumber(counts?.conflict) ?? 0;

    return [
      {
        checkId: "MDM_COMPLIANCE_GAP_001",
        severity: "medium",
        title: "Devices present but compliance posture cannot be verified",
        recommendation:
          "Intune device management shows enrolled devices, but based on available evidence " +
          "no device has been evaluated to a compliant or non-compliant state. All enrolled " +
          "devices are in unresolved compliance states (unknown, not applicable, in grace " +
          "period, or conflict). This may indicate that compliance policies are not configured, " +
          "that devices have not yet been evaluated, or that compliance data is not fully " +
          "exposed within the current collection scope. " +
          "Recommended actions: configure and assign Intune compliance policies to all " +
          "applicable device platforms; verify that devices have completed policy check-in; " +
          "confirm that the DeviceManagementManagedDevices.Read.All permission is granted so " +
          "compliance state is visible; and review compliance reporting within the Intune " +
          "admin centre to validate that policies are evaluating correctly.",
        references: {
          totalEnrolledDevices: total,
          compliant,
          noncompliant,
          unknown,
          notApplicable,
          inGracePeriod,
          conflict,
          observedChecks: ["MDM_DEVICES_OBS_001"]
        }
      }
    ];
  }
};
