// apps/worker/src/findings/exchangeTransportRulesFinding.ts

import type { FindingDerivation, DerivedFinding } from "./types";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

export const exchangeTransportRulesFinding: FindingDerivation = {
  id: "exchange.transportRules.posture",

  emits: ["EXO_TRANSPORT_001"],

  derive({ observedChecks }): DerivedFinding[] {
    const obs = observedChecks.find((o) => o.checkId === "EXO_TRANSPORT_OBS_001");
    if (!obs) return [];

    const d = obs.data as any;

    // Do not emit posture findings when the collection was incomplete.
    // permissionDenied means we had no access; truncated means an unexpected
    // error occurred. In either case we cannot draw "no risk" conclusions and
    // the absence of EXO_TRANSPORT_001 should not be read as "no forwarding
    // rules". Future coverage findings will surface this gap separately.
    if (d?.permissionDenied === true || d?.truncated === true) return [];

    const rulesWithExternalForwardingCount = asNumber(d?.rulesWithExternalForwardingCount) ?? 0;

    if (rulesWithExternalForwardingCount === 0) return [];

    const count = rulesWithExternalForwardingCount;
    const forwardingRuleNames: string[] = Array.isArray(d?.forwardingRuleNames)
      ? (d.forwardingRuleNames as unknown[])
          .filter((n): n is string => typeof n === "string")
          .slice(0, 10)
      : [];

    return [
      {
        checkId: "EXO_TRANSPORT_001",
        severity: "high",
        title: `${count} mail flow rule${count === 1 ? "" : "s"} routing email to external recipients detected`,
        recommendation:
          "One or more enabled Exchange transport rules redirect or forward messages to " +
          "addresses outside the tenant's primary domain. " +
          "Forwarding rules are a common exfiltration mechanism in business email compromise attacks. " +
          "Review each flagged rule: confirm the recipient addresses are authorised business partners, " +
          "verify the rule was intentionally created by an administrator, and remove any unexpected rules " +
          "immediately. Consider enabling the anti-spam outbound policy to block auto-forwarding to " +
          "external recipients at the organisation level.",
        references: {
          rulesWithExternalForwardingCount: count,
          forwardingRuleNames,
          observedChecks: ["EXO_TRANSPORT_OBS_001"]
        }
      }
    ];
  }
};
