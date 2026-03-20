// apps/worker/src/findings/mdmComplianceFinding.ts

import type { FindingDerivation, DerivedFinding } from "./types";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

export const mdmComplianceFinding: FindingDerivation = {
  id: "intune.devices.compliance",

  // 🔑 REQUIRED: declare which finding checkIds this derivation owns
  emits: ["MDM_COMPLIANCE_001"],

  derive({ observedChecks }): DerivedFinding[] {
    const obs = observedChecks.find((o) => o.checkId === "MDM_DEVICES_OBS_001");
    if (!obs) return [];

    const counts = (obs.data as any)?.counts;
    const noncompliant = asNumber(counts?.noncompliant);

    // Only emit when we have a confirmed non-zero noncompliant count.
    if (noncompliant === null || noncompliant <= 0) return [];

    return [
      {
        checkId: "MDM_COMPLIANCE_001",
        severity: "medium",
        title: `${noncompliant} device${noncompliant === 1 ? "" : "s"} reporting non-compliant in Intune`,
        recommendation:
          "One or more managed devices are reporting a non-compliant state in Intune. Validate active compliance policies and device remediation status with the customer."
      }
    ];
  }
};
