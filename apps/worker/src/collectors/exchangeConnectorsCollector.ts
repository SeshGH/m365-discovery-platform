// apps/worker/src/collectors/exchangeConnectorsCollector.ts

import type { Collector } from "./types";
import { getExchangeAdminAccessToken, exchangeAdminPost, GraphHttpError } from "./graph";

// Exchange Online Admin REST API base.
// Token must be scoped to https://outlook.office365.com/.default via
// getExchangeAdminAccessToken (not the Graph token).
const EXCHANGE_ADMIN_BASE = "https://outlook.office365.com/adminapi/beta";

// ─── Inbound connector shape ──────────────────────────────────────────────────
// Properties use Exchange PowerShell naming (PascalCase) as returned by
// InvokeCommand with Get-InboundConnector. Only fields relevant to the
// implemented detections are typed; all other properties are ignored.
type InboundConnector = {
  Identity?: string;
  Name?: string;
  // Enabled may come back as a boolean or as the string "True"/"False"
  // depending on the Exchange Online API version. Both forms are handled.
  Enabled?: boolean | string | null;
  ConnectorType?: string | null;   // "OnPremises" | "Partner"
  ConnectorSource?: string | null; // "AdminUI" | "HybridWizard" | "Default"
  Comment?: string | null;
  // ── Sender restriction fields ──────────────────────────────────────────
  // SenderDomains contains SMTP domain expressions (e.g. "smtp:contoso.com;1").
  // Domain-only restriction is spoofable; meaningful auth requires IP or cert.
  SenderDomains?: string[];
  // SenderIPAddresses: if non-empty, only the listed IP ranges are accepted.
  // Empty = any source IP may connect and present as an allowed sender domain.
  SenderIPAddresses?: string[];
  // RestrictDomainsToIPAddresses: when true, Exchange enforces that the
  // connecting IP matches SenderIPAddresses. Redundant when IPs are listed but
  // included here for completeness.
  RestrictDomainsToIPAddresses?: boolean | string | null;
  // ── TLS / certificate enforcement fields ──────────────────────────────
  // RequireTLS: true = inbound connection must use TLS. Does NOT verify
  // the sender's certificate identity — any valid TLS connection passes.
  RequireTLS?: boolean | string | null;
  // RestrictDomainsToCertificate: when true, Exchange verifies that the
  // sender's TLS certificate matches TlsSenderCertificateName.
  RestrictDomainsToCertificate?: boolean | string | null;
  // TlsSenderCertificateName: the specific certificate CN or SAN to match.
  // A non-empty value here means Exchange will validate the sender's cert.
  TlsSenderCertificateName?: string | null;
  // ── Other fields ──────────────────────────────────────────────────────
  // TreatMessagesAsInternal: when true, matched messages receive internal mail
  // trust (bypassing anti-spam/anti-phishing checks for external mail).
  TreatMessagesAsInternal?: boolean | string | null;
  CloudServicesMailEnabled?: boolean | string | null;
};

// InvokeCommand response envelope (shared pattern with transport rules).
type InvokeCommandResponse<T> = {
  "@AdminAPI.ResultSize"?: number;
  value: T[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalises the many forms Exchange may return a boolean value in.
 * Returns true/false, or null if the value cannot be interpreted.
 */
function normaliseBoolean(v: unknown): boolean | null {
  if (v === true || v === "True" || v === "true") return true;
  if (v === false || v === "False" || v === "false") return false;
  return null;
}

function isConnectorEnabled(connector: InboundConnector): boolean {
  return normaliseBoolean(connector.Enabled) === true;
}

/**
 * Returns true when the connector has a sender IP restriction.
 * This means the connector will only accept connections from the listed
 * IP ranges, providing a meaningful source-authentication check.
 */
function connectorHasIPRestriction(connector: InboundConnector): boolean {
  const ips = connector.SenderIPAddresses;
  return Array.isArray(ips) && ips.length > 0;
}

/**
 * Returns true when the connector enforces TLS certificate identity validation.
 * Either `RestrictDomainsToCertificate === true` (cert CN must match) or a
 * non-empty `TlsSenderCertificateName` (an explicit cert subject is required)
 * qualifies — both mean Exchange will verify WHO holds the connecting cert.
 *
 * Note: `RequireTLS=true` alone does NOT qualify — that only requires TLS to
 * be used but does not validate the cert's identity. Any TLS-capable server
 * would satisfy it.
 */
function connectorHasTlsCertCheck(connector: InboundConnector): boolean {
  if (normaliseBoolean(connector.RestrictDomainsToCertificate) === true) return true;
  const certName = (connector.TlsSenderCertificateName ?? "").trim();
  return certName.length > 0;
}

/**
 * Returns true when an enabled inbound connector has neither a sender IP
 * restriction nor a TLS certificate identity check.
 *
 * Without at least one of these, the connector relies solely on the sender
 * claiming the right domain (SenderDomains), which any SMTP server can spoof.
 * Such a connector is considered "permissive" and warrants review.
 */
function connectorIsPermissive(connector: InboundConnector): boolean {
  return (
    isConnectorEnabled(connector) &&
    !connectorHasIPRestriction(connector) &&
    !connectorHasTlsCertCheck(connector)
  );
}

// ─── Collector ────────────────────────────────────────────────────────────────

// Cap the number of connector names stored per detection category to bound OBS size.
const MAX_CONNECTOR_NAMES = 20;

export const exchangeConnectorsCollector: Collector = {
  id: "exchange.connectors",
  displayName: "Exchange Connectors",

  async run(ctx) {
    const tenantId: string = ctx.tenant.tenantGuid;

    // ── Accumulators (populated on success path) ──────────────────────────
    let totalInboundConnectors = 0;
    let enabledInboundConnectorsCount = 0;
    // EXO_CONNECTOR_001: permissive inbound connector detection
    let permissiveInboundConnectorsCount = 0;
    const permissiveInboundConnectorNames: string[] = [];

    // ── Completeness signals (populated on error path) ────────────────────
    let permissionDenied = false;
    let truncated = false;
    let errorCode: number | null = null;
    let errorMessage: string | null = null;

    try {
      const token = await getExchangeAdminAccessToken({ tenantId });
      const invokeUrl = `${EXCHANGE_ADMIN_BASE}/${encodeURIComponent(tenantId)}/InvokeCommand`;

      // Fetch all inbound connectors via InvokeCommand.
      // InvokeCommand with ResultSize=Unlimited returns all results in a
      // single response — no @odata.nextLink pagination applies.
      const response = await exchangeAdminPost<InvokeCommandResponse<InboundConnector>>(
        token,
        invokeUrl,
        {
          CmdletInput: {
            CmdletName: "Get-InboundConnector",
            Parameters: {
              ResultSize: "Unlimited"
            }
          }
        }
      );

      const connectors: InboundConnector[] = Array.isArray(response.value)
        ? response.value
        : [];

      totalInboundConnectors = connectors.length;

      for (const connector of connectors) {
        if (!isConnectorEnabled(connector)) continue;
        enabledInboundConnectorsCount++;

        if (connectorIsPermissive(connector)) {
          permissiveInboundConnectorsCount++;
          if (permissiveInboundConnectorNames.length < MAX_CONNECTOR_NAMES) {
            permissiveInboundConnectorNames.push(
              connector.Name ?? connector.Identity ?? "(unknown)"
            );
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof GraphHttpError && (err.status === 401 || err.status === 403)) {
        permissionDenied = true;
        errorCode = err.status;
        errorMessage = (err.bodyText ?? "").slice(0, 400) || null;
      } else if (err instanceof GraphHttpError) {
        truncated = true;
        errorCode = err.status;
        errorMessage = (err.bodyText ?? "").slice(0, 400) || null;
      } else {
        truncated = true;
        errorCode = null;
        errorMessage =
          err instanceof Error ? err.message.slice(0, 400) : String(err).slice(0, 400);
      }
    }

    const isComplete = !permissionDenied && !truncated;

    // ── Observed check (EXO_CONNECTOR_OBS_001) ────────────────────────────
    const jobId: string | null = ctx.job?.id ?? null;

    await ctx.prisma.observedCheck.deleteMany({
      where: { runId: ctx.run.id, jobId, checkId: "EXO_CONNECTOR_OBS_001" }
    });

    await ctx.prisma.observedCheck.createMany({
      data: [
        {
          runId: ctx.run.id,
          jobId,
          checkId: "EXO_CONNECTOR_OBS_001",
          collectorId: "exchange.connectors",
          ruleId: null,
          data: {
            // Completeness signals — always present regardless of success/failure.
            isComplete,
            permissionDenied,
            truncated,
            errorCode,
            errorMessage,

            // Inventory facts — only meaningful when isComplete === true.
            totalInboundConnectors,
            enabledInboundConnectorsCount,

            // EXO_CONNECTOR_001: permissive inbound connector detection.
            // A connector is "permissive" when enabled and has neither a sender
            // IP restriction nor a TLS certificate identity check. The connector
            // relies solely on sender domain matching, which is spoofable.
            permissiveInboundConnectorsCount,
            permissiveInboundConnectorNames
          } as any,
          references: [] as any
        }
      ]
    });

    return {
      id: "exchange.connectors",
      status: "ok",
      summary: {
        isComplete,
        permissionDenied,
        truncated,
        totalInboundConnectors,
        enabledInboundConnectorsCount,
        permissiveInboundConnectorsCount
      }
    };
  }
};
