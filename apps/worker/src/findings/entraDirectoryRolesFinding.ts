// apps/worker/src/findings/entraDirectoryRolesFinding.ts

import type { FindingDerivation, DerivedFinding, ObservedCheckLike } from "./types";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

/**
 * coreIsComplete: OBS_005.isComplete already accounts for permissionDenied slices.
 * We additionally guard on truncated to ensure counts are reliable before emitting
 * count-threshold findings.
 */
function coreIsComplete(obs005: ObservedCheckLike | undefined): boolean {
  if (!obs005) return false;
  const d = obs005.data as any;
  return d?.isComplete === true && d?.truncated !== true;
}

export const entraDirectoryRolesFinding: FindingDerivation = {
  id: "entra.directoryRoles.privilegedAccess",

  emits: ["ENTRA_DIRROLES_010", "ENTRA_DIRROLES_011", "ENTRA_DIRROLES_012"],

  derive({ observedChecks }): DerivedFinding[] {
    const obs001 = observedChecks.find((o) => o.checkId === "ENTRA_DIRROLES_OBS_001");
    const obs002 = observedChecks.find((o) => o.checkId === "ENTRA_DIRROLES_OBS_002");
    const obs005 = observedChecks.find((o) => o.checkId === "ENTRA_DIRROLES_OBS_005");

    const complete = coreIsComplete(obs005);
    const findings: DerivedFinding[] = [];

    if (complete && obs001) {
      const globalAdminCount = asNumber((obs001.data as any)?.globalAdminCount);
      if (globalAdminCount !== null && globalAdminCount >= 3) {
        findings.push({
          checkId: "ENTRA_DIRROLES_010",
          severity: globalAdminCount >= 5 ? "high" : "medium",
          title: "Excess number of Global Administrators",
          recommendation:
            "Reduce standing Global Administrator assignments and adopt least privilege with role segmentation.",
          references: {
            globalAdminCount,
            observedChecks: ["ENTRA_DIRROLES_OBS_001", "ENTRA_DIRROLES_OBS_005"]
          }
        });
      }
    }

    if (obs002) {
      const spCount = asNumber((obs002.data as any)?.servicePrincipal);
      if (spCount !== null && spCount > 0) {
        findings.push({
          checkId: "ENTRA_DIRROLES_011",
          severity: spCount >= 3 ? "high" : "medium",
          title: "Service principals assigned to privileged roles",
          recommendation:
            "Review service principal role assignments and restrict privileged access to managed identities where possible.",
          references: {
            servicePrincipalCount: spCount,
            observedChecks: ["ENTRA_DIRROLES_OBS_002", "ENTRA_DIRROLES_OBS_005"]
          }
        });
      }
    }

    if (complete && obs001) {
      const activeAssignmentsCount = asNumber((obs001.data as any)?.activeAssignmentsCount);
      if (activeAssignmentsCount !== null && activeAssignmentsCount >= 20) {
        findings.push({
          checkId: "ENTRA_DIRROLES_012",
          severity: activeAssignmentsCount >= 50 ? "high" : "medium",
          title: "Broad privileged role assignment surface",
          recommendation:
            "Reduce the number of standing role assignments and use just-in-time access where possible.",
          references: {
            activeAssignmentsCount,
            observedChecks: ["ENTRA_DIRROLES_OBS_001", "ENTRA_DIRROLES_OBS_005"]
          }
        });
      }
    }

    return findings;
  }
};