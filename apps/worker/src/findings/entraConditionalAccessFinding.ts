// apps/worker/src/findings/entraConditionalAccessFinding.ts

import type { FindingDerivation, DerivedFinding } from "./types";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

export const entraConditionalAccessFinding: FindingDerivation = {
  id: "entra.conditionalAccess.posture",

  emits: ["ENTRA_CA_002", "ENTRA_CA_003", "ENTRA_CA_004"],

  derive({ observedChecks }): DerivedFinding[] {
    const obs = observedChecks.find((o) => o.checkId === "ENTRA_CA_OBS_001");
    if (!obs) return [];

    const d = obs.data as any;

    // Do not emit security posture findings when the collection was incomplete.
    // permissionDenied and truncated (which includes the cap case) both mean the
    // set of policies we saw is not reliable enough to draw absence-of-control conclusions.
    if (d?.permissionDenied === true || d?.truncated === true) return [];

    const enabledPolicies = asNumber(d?.enabledPolicies) ?? 0;
    const policiesWithMfaGrantControl = asNumber(d?.policiesWithMfaGrantControl) ?? 0;
    const hasLegacyAuthPolicyDetected: boolean = d?.hasLegacyAuthPolicyDetected === true;
    const policiesExcludingUsersCount = asNumber(d?.policiesExcludingUsersCount) ?? 0;

    // If there are no enabled policies at all, the collector-emitted ENTRA_CA_001
    // already surfaces that as the primary signal. The posture findings below are
    // only meaningful when there IS a CA baseline in place but it has gaps.
    if (enabledPolicies === 0) return [];

    const findings: DerivedFinding[] = [];

    // ENTRA_CA_002 — No MFA grant control across any enabled policy.
    // The collector's hasMfaGrantControl checks builtInControls for "mfa".
    // policiesWithMfaGrantControl === 0 means no enabled policy enforces MFA.
    if (policiesWithMfaGrantControl === 0) {
      findings.push({
        checkId: "ENTRA_CA_002",
        severity: "medium",
        title: "No Conditional Access policy enforces MFA",
        recommendation:
          "At least one enabled policy with an MFA grant control was not detected. Review whether MFA is enforced via Conditional Access and consider policies targeting administrators and all users.",
        references: {
          enabledPolicies,
          policiesWithMfaGrantControl,
          observedChecks: ["ENTRA_CA_OBS_001"]
        }
      });
    }

    // ENTRA_CA_003 — Legacy authentication not blocked.
    // The collector's detectsLegacyAuthBlock checks for a policy targeting
    // "exchangeactivesync" or "other" clientAppTypes with a "block" grant control.
    // If none is detected, legacy auth protocols remain available and bypass MFA.
    if (!hasLegacyAuthPolicyDetected) {
      findings.push({
        checkId: "ENTRA_CA_003",
        severity: "medium",
        title: "Legacy authentication protocols not blocked by Conditional Access",
        recommendation:
          "No enabled policy targeting legacy authentication client types (Exchange ActiveSync and Other) with a Block grant control was detected. Legacy protocols do not support modern authentication and can bypass MFA controls.",
        references: {
          enabledPolicies,
          hasLegacyAuthPolicyDetected,
          observedChecks: ["ENTRA_CA_OBS_001"]
        }
      });
    }

    // ENTRA_CA_004 — User exclusions present across enabled policies.
    // policiesExcludingUsersCount is the sum of excludeUsers array lengths across
    // all scanned policies. Any non-zero value means at least one user is excluded
    // from at least one policy, bypassing its controls.
    if (policiesExcludingUsersCount > 0) {
      findings.push({
        checkId: "ENTRA_CA_004",
        severity: "low",
        title: `Conditional Access policies contain user exclusions (${policiesExcludingUsersCount} exclusion${policiesExcludingUsersCount === 1 ? "" : "s"} observed)`,
        recommendation:
          "One or more Conditional Access policies exclude specific users, causing those users to bypass the policy controls. Exclusions are appropriate for break-glass accounts but should be minimised, documented, and monitored.",
        references: {
          policiesExcludingUsersCount,
          enabledPolicies,
          observedChecks: ["ENTRA_CA_OBS_001"]
        }
      });
    }

    return findings;
  }
};
