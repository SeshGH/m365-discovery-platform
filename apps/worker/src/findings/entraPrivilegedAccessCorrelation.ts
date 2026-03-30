// apps/worker/src/findings/entraPrivilegedAccessCorrelation.ts
//
// Derived finding: Privileged accounts detected (ENTRA_PRIV_ACCESS_001)
//
// Reads:
//   ENTRA_DIRROLES_OBS_001  — summary counts (activeAssignmentsCount)
//   ENTRA_DIRROLES_OBS_005  — completeness gate (isComplete, truncated)
//
// Emits:
//   ENTRA_PRIV_ACCESS_001   — when at least one active directory role assignment exists
//                             and the completeness gate is satisfied

import type { FindingDerivation, DerivedFinding, ObservedCheckLike } from "./types";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function coreIsComplete(obs005: ObservedCheckLike | undefined): boolean {
  if (!obs005) return false;
  const d = obs005.data as any;
  return d?.isComplete === true && d?.truncated !== true;
}

export const entraPrivilegedAccessCorrelation: FindingDerivation = {
  id: "entra.privAccess.correlation",

  emits: ["ENTRA_PRIV_ACCESS_001"],

  derive({ observedChecks }): DerivedFinding[] {
    const obs001 = observedChecks.find((o) => o.checkId === "ENTRA_DIRROLES_OBS_001");
    const obs005 = observedChecks.find((o) => o.checkId === "ENTRA_DIRROLES_OBS_005");

    const findings: DerivedFinding[] = [];

    if (!coreIsComplete(obs005) || !obs001) return findings;

    const activeAssignmentsCount = asNumber((obs001.data as any)?.activeAssignmentsCount);

    if (activeAssignmentsCount === null || activeAssignmentsCount === 0) return findings;

    const plural = activeAssignmentsCount === 1 ? "" : "s";

    findings.push({
      checkId: "ENTRA_PRIV_ACCESS_001",
      severity: activeAssignmentsCount >= 10 ? "high" : "medium",
      title: "Standing privileged role assignments detected",
      recommendation:
        `${activeAssignmentsCount} active privileged role assignment${plural} detected across ` +
        "Entra directory roles. Directory role assignments represent standing privileged access " +
        "to the Microsoft 365 environment. Review each assignment to confirm it is necessary, " +
        "intentional, and assigned to the least-privileged role that satisfies the operational " +
        "need. Remove assignments that are stale, overly broad, or no longer required. Where " +
        "Entra ID P2 licensing is available, consider migrating standing role assignments to " +
        "Privileged Identity Management (PIM) eligible assignments to require explicit " +
        "just-in-time activation.",
      references: {
        activeAssignmentsCount,
        observedChecks: ["ENTRA_DIRROLES_OBS_001", "ENTRA_DIRROLES_OBS_005"]
      }
    });

    return findings;
  }
};
