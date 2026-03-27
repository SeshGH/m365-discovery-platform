// apps/worker/src/findings/exchangeTransportRulesFinding.ts

import type { FindingDerivation, DerivedFinding } from "./types";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).filter((n): n is string => typeof n === "string");
}

export const exchangeTransportRulesFinding: FindingDerivation = {
  id: "exchange.transportRules.posture",

  emits: ["EXO_TRANSPORT_001", "EXO_TRANSPORT_002"],

  derive({ observedChecks }): DerivedFinding[] {
    const obs = observedChecks.find((o) => o.checkId === "EXO_TRANSPORT_OBS_001");
    if (!obs) return [];

    const d = obs.data as any;

    // Do not emit posture findings when the collection was incomplete.
    // permissionDenied means we had no access; truncated means an unexpected
    // error occurred. In either case we cannot draw "no risk" conclusions and
    // the absence of findings should not be read as "no issues".
    if (d?.permissionDenied === true || d?.truncated === true) return [];

    const findings: DerivedFinding[] = [];

    // ── EXO_TRANSPORT_001: external forwarding ──────────────────────────────
    const rulesWithExternalForwardingCount = asNumber(d?.rulesWithExternalForwardingCount) ?? 0;

    if (rulesWithExternalForwardingCount > 0) {
      const count = rulesWithExternalForwardingCount;
      const forwardingRuleNames = toStringArray(d?.forwardingRuleNames).slice(0, 10);

      findings.push({
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
      });
    }

    // ── EXO_TRANSPORT_002: spam filter bypass (SetSCL = -1) ────────────────
    // SCL -1 is the Exchange Online Protection score that explicitly marks a
    // message as non-spam, bypassing junk mail filtering regardless of content.
    // A transport rule that sets SCL=-1 on matched messages causes EOP to skip
    // spam analysis for those messages entirely.
    const rulesWithSclBypassCount = asNumber(d?.rulesWithSclBypassCount) ?? 0;

    if (rulesWithSclBypassCount > 0) {
      const count = rulesWithSclBypassCount;
      const sclBypassRuleNames = toStringArray(d?.sclBypassRuleNames).slice(0, 10);

      findings.push({
        checkId: "EXO_TRANSPORT_002",
        severity: "medium",
        title: `${count} mail flow rule${count === 1 ? "" : "s"} bypass${count === 1 ? "es" : ""} spam filtering (SCL -1)`,
        recommendation:
          "One or more enabled Exchange transport rules set the Spam Confidence Level (SCL) to -1, " +
          "which instructs Exchange Online Protection to skip spam analysis for messages matched by those rules. " +
          "This is a legitimate mechanism for trusted senders (e.g. on-premises relay, approved bulk systems), " +
          "but it is also exploited in phishing campaigns to ensure delivery of malicious mail. " +
          "Review each flagged rule: confirm the rule's conditions are narrow and target only genuinely trusted sources, " +
          "ensure the rule was created intentionally by a known administrator, " +
          "and remove any rules whose conditions are unexpectedly broad or whose origin is unclear.",
        references: {
          rulesWithSclBypassCount: count,
          sclBypassRuleNames,
          observedChecks: ["EXO_TRANSPORT_OBS_001"]
        }
      });
    }

    return findings;
  }
};
