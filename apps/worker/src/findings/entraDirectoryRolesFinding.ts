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

  emits: ["ENTRA_DIRROLES_010", "ENTRA_DIRROLES_011", "ENTRA_DIRROLES_012", "ENTRA_PIM_001"],

  derive({ observedChecks }): DerivedFinding[] {
    const obs001 = observedChecks.find((o) => o.checkId === "ENTRA_DIRROLES_OBS_001");
    const obs002 = observedChecks.find((o) => o.checkId === "ENTRA_DIRROLES_OBS_002");
    const obs004 = observedChecks.find((o) => o.checkId === "ENTRA_DIRROLES_OBS_004");
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

    // ── ENTRA_PIM_001: no PIM eligible assignments while standing assignments exist ──
    //
    // Source OBS:
    //   ENTRA_DIRROLES_OBS_004 — PIM eligibility schedule count (best-effort slice)
    //   ENTRA_DIRROLES_OBS_001 — active assignment counts (core slice)
    //   ENTRA_DIRROLES_OBS_005 — core completeness gate
    //
    // Guard chain:
    //   1. OBS_004 must be present.  The collector only emits this OBS when
    //      DIRROLES_ENABLE_PIM_SLICE is enabled (env-controlled, default = "1").
    //      Absence means the PIM slice was disabled env-side; skip silently.
    //   2. OBS_004.succeeded === true.  The collector sets succeeded: false when the
    //      roleEligibilitySchedules API returns 403 (P2 not licensed or admin consent
    //      missing) or any other error.  We must NOT draw "no JIT" conclusions from
    //      a failed query — absence of eligibility data != absence of eligible roles.
    //   3. eligibleAssignmentsCount === 0.  The collector sets this to schedules.length
    //      on success and leaves it undefined on failure.  asNumber(undefined) returns
    //      null, so the === 0 check silently guards the undefined path too.
    //   4. core completeness (OBS_005) — role definitions + active assignments data
    //      must be complete so we can trust activeAssignmentsCount.
    //   5. activeAssignmentsCount > 0.  If there are no standing assignments there is
    //      nothing to protect with JIT; emitting would be noise.
    //
    // Evidence limitation (must be acknowledged in recommendation text):
    //   The roleEligibilitySchedules endpoint covers DIRECT role eligibility only.
    //   PIM for Groups (where group membership is eligible, and that group holds a
    //   directory role) creates equivalent JIT coverage that is NOT visible here.
    //   A tenant using PIM for Groups would still show eligibleAssignmentsCount === 0
    //   and ENTRA_PIM_001 would fire — a false positive.  The recommendation text
    //   must acknowledge this so reviewers can dismiss the finding when applicable.
    if (obs004) {
      const d004 = obs004.data as any;

      if (
        d004?.succeeded === true &&
        asNumber(d004?.eligibleAssignmentsCount) === 0 &&
        complete &&
        obs001 !== undefined
      ) {
        const activeCount = asNumber((obs001.data as any)?.activeAssignmentsCount);

        if (activeCount !== null && activeCount > 0) {
          findings.push({
            checkId: "ENTRA_PIM_001",
            severity: "medium",
            title:
              "No PIM-eligible role assignments detected — privileged access appears to be standing",
            recommendation:
              "Based on available evidence, the Privileged Identity Management (PIM) eligibility " +
              "schedules API was successfully queried but returned zero eligible role assignments, " +
              "while active standing role assignments are present in the directory. This suggests " +
              "that privileged access is granted on a permanent basis rather than through " +
              "just-in-time (JIT) activation. Standing privileged access increases the window " +
              "of exposure if a privileged account is compromised — an attacker gains immediate " +
              "and continuous elevated access without needing to trigger or approve a PIM " +
              "activation request. " +
              "Review whether Privileged Identity Management is configured and in active use. " +
              "Where Entra ID P2 licensing is available, consider migrating standing role " +
              "assignments to PIM eligible assignments so that privileged access requires " +
              "explicit activation, approval or justification, and time-bounding. " +
              "Important evidence limitation: this signal reads direct role eligibility " +
              "schedules only. PIM for Groups — where group membership (and therefore role " +
              "membership) is eligible rather than the role assignment directly — is not " +
              "visible via this endpoint and would not suppress this finding. If the tenant " +
              "uses PIM for Groups to govern privileged access, this finding may be a false " +
              "positive and should be reviewed in context before acting on it.",
            references: {
              activeAssignmentsCount: activeCount,
              eligibleAssignmentsCount: 0,
              observedChecks: [
                "ENTRA_DIRROLES_OBS_001",
                "ENTRA_DIRROLES_OBS_004",
                "ENTRA_DIRROLES_OBS_005"
              ]
            }
          });
        }
      }
    }

    return findings;
  }
};
