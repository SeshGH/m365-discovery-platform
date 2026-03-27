// apps/worker/src/findings/exchangeConnectorsFinding.ts

import type { FindingDerivation, DerivedFinding } from "./types";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).filter((n): n is string => typeof n === "string");
}

export const exchangeConnectorsFinding: FindingDerivation = {
  id: "exchange.connectors.posture",

  emits: ["EXO_CONNECTOR_001"],

  derive({ observedChecks }): DerivedFinding[] {
    const obs = observedChecks.find((o) => o.checkId === "EXO_CONNECTOR_OBS_001");
    if (!obs) return [];

    const d = obs.data as any;

    // Do not emit findings when collection was incomplete.
    // permissionDenied = no access to Exchange Admin API (permissions gap).
    // truncated = token failure, unexpected error, or network issue.
    // In either case, the absence of findings must not be read as "no issues".
    if (d?.permissionDenied === true || d?.truncated === true) return [];

    const findings: DerivedFinding[] = [];

    // ── EXO_CONNECTOR_001: permissive inbound connector ───────────────────
    // An inbound connector is permissive when it is enabled but has neither
    // a sender IP restriction (SenderIPAddresses) nor a TLS certificate
    // identity check (RestrictDomainsToCertificate / TlsSenderCertificateName).
    // Without at least one of these, the connector accepts mail from any
    // source that claims an allowed sender domain — domain-only matching
    // is trivially spoofable by any SMTP server.
    const permissiveInboundConnectorsCount =
      asNumber(d?.permissiveInboundConnectorsCount) ?? 0;

    if (permissiveInboundConnectorsCount > 0) {
      const count = permissiveInboundConnectorsCount;
      const permissiveInboundConnectorNames = toStringArray(
        d?.permissiveInboundConnectorNames
      ).slice(0, 10);

      findings.push({
        checkId: "EXO_CONNECTOR_001",
        severity: "medium",
        title:
          `${count} inbound mail connector${count === 1 ? "" : "s"} ` +
          `accept${count === 1 ? "s" : ""} messages without sender IP restriction ` +
          `or TLS certificate validation`,
        recommendation:
          "One or more enabled Exchange Online inbound connectors are configured to accept " +
          "messages from any source without requiring either a sender IP restriction " +
          "(SenderIPAddresses) or TLS certificate identity validation " +
          "(RestrictDomainsToCertificate / TlsSenderCertificateName). " +
          "Without at least one of these controls, the connector relies solely on sender " +
          "domain matching, which can be spoofed by any SMTP server that knows the allowed " +
          "domain. Review each flagged connector in the Exchange admin centre: " +
          "if the intended sender has a fixed IP range, add SenderIPAddresses restrictions; " +
          "if the sender uses a consistent TLS certificate, configure TlsSenderCertificateName " +
          "to require that certificate CN. " +
          "If the connector is no longer in use, disable or remove it. " +
          "Note: RequireTLS=true alone does not verify the sender's certificate identity — " +
          "explicit certificate subject validation is required for strong authentication.",
        references: {
          permissiveInboundConnectorsCount: count,
          permissiveInboundConnectorNames,
          observedChecks: ["EXO_CONNECTOR_OBS_001"]
        }
      });
    }

    return findings;
  }
};
