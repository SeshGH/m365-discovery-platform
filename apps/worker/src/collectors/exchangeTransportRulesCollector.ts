// apps/worker/src/collectors/exchangeTransportRulesCollector.ts

import type { Collector } from "./types";
import { getExchangeAdminAccessToken, exchangeAdminPost, GraphHttpError } from "./graph";

// Exchange Online Admin REST API base.
// Token must be scoped to https://outlook.office365.com/.default via
// getExchangeAdminAccessToken (not the Graph token).
const EXCHANGE_ADMIN_BASE = "https://outlook.office365.com/adminapi/beta";

// ─── Exchange transport rule shape ───────────────────────────────────────────
// Properties use Exchange PowerShell naming (PascalCase) as returned by
// InvokeCommand with Get-TransportRule. Only the fields relevant to the
// implemented detections are typed; all other properties are ignored.
type TransportRule = {
  Identity?: string;
  Name?: string;
  State?: string; // "Enabled" | "Disabled"
  Priority?: number;
  // Forwarding / redirect actions that can route mail externally:
  RedirectMessageTo?: string[];
  ForwardMessageTo?: string[];
  BlindCopyTo?: string[];
  CopyTo?: string[];
  // Spam filter bypass:
  // SetSCL=-1 instructs Exchange Online Protection to classify matching
  // messages as non-spam regardless of content analysis results.
  // null / undefined = action not set on this rule.
  // Exchange returns this as a string ("-1") via InvokeCommand despite the
  // underlying type being numeric — both forms must be handled.
  SetSCL?: number | string | null;
  // Suppressive actions (EXO_TRANSPORT_003):
  // DeleteMessage=true silently drops matching messages with no delivery or NDR.
  DeleteMessage?: boolean;
  // Quarantine holds matching messages in the quarantine store rather than
  // delivering them. Exchange returns this as a boolean or omits it.
  Quarantine?: boolean | null;
  // ── Narrowing condition fields (used by breadth heuristic) ───────────────
  // These are the most common conditions that restrict a rule's scope.
  // If ALL are absent/empty, the rule is considered "broad" — it applies to
  // all messages without discrimination.
  SenderDomainIs?: string[];
  From?: string[];
  FromAddressContainsWords?: string[];
  FromAddressMatchesPatterns?: string[];
  FromMemberOf?: string[];
  SenderIpRanges?: string[];
  SubjectContainsWords?: string[];
  SubjectMatchesPatterns?: string[];
  RecipientDomainIs?: string[];
  SentTo?: string[];
  SentToMemberOf?: string[];
  RecipientAddressContainsWords?: string[];
  AnyOfRecipientAddressContainsWords?: string[];
  // MessageTypeMatches is a single enum value (e.g. "OOF", "NDR", "AutoForward")
  // rather than an array. Present and non-empty → rule has a type condition.
  MessageTypeMatches?: string | null;
};

// InvokeCommand response envelope.
// ResultSize field uses the non-standard "@AdminAPI.ResultSize" annotation.
// All results are returned in a single response when ResultSize=Unlimited is
// passed — there is no @odata.nextLink pagination for InvokeCommand.
type InvokeCommandResponse<T> = {
  "@AdminAPI.ResultSize"?: number;
  value: T[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normaliseState(state: string | null | undefined): "enabled" | "disabled" | "unknown" {
  const s = (state ?? "").toLowerCase();
  if (s === "enabled") return "enabled";
  if (s === "disabled") return "disabled";
  return "unknown";
}

/**
 * Returns true if `address` is considered external relative to `primaryDomain`.
 *
 * Detection heuristic (first-pass):
 * - Must contain "@" to be treated as an addressable recipient.
 * - The domain part must not match `primaryDomain` (case-insensitive).
 * - The domain part must not end with ".onmicrosoft.com" (Microsoft-issued
 *   internal routing domain, also covers the routing variant used by tenants).
 *
 * Limitation: tenants with multiple verified custom domains may produce false
 * positives for rules forwarding to a secondary custom domain. Future passes
 * can enrich the OBS with the full verified-domain list from Graph /domains.
 */
function isExternalAddress(address: string, primaryDomain: string): boolean {
  const lower = (address ?? "").toLowerCase().trim();
  if (!lower.includes("@")) return false;
  const parts = lower.split("@");
  const domain = parts[parts.length - 1] ?? "";
  if (!domain) return false;
  if (domain === primaryDomain.toLowerCase()) return false;
  if (domain.endsWith(".onmicrosoft.com")) return false;
  return true;
}

/**
 * Returns true if any forwarding/redirect action on `rule` contains at least
 * one address that appears to be external.
 */
function ruleHasExternalForwarding(rule: TransportRule, primaryDomain: string): boolean {
  const actionFields: (string[] | undefined)[] = [
    rule.RedirectMessageTo,
    rule.ForwardMessageTo,
    rule.BlindCopyTo,
    rule.CopyTo
  ];
  return actionFields.some(
    (addrs) => Array.isArray(addrs) && addrs.some((a) => isExternalAddress(a, primaryDomain))
  );
}

/**
 * Returns true if the rule sets SCL to -1, bypassing spam filtering.
 * SCL -1 is the only Exchange-defined value that means "bypass EOP spam
 * analysis for matched messages". All other SetSCL values modify the score
 * but do not unconditionally bypass filtering.
 */
function ruleBypassesSpamFilter(rule: TransportRule): boolean {
  // Exchange returns SetSCL as a string ("-1") via InvokeCommand even though
  // the underlying property is numeric. Accept both forms.
  return rule.SetSCL === -1 || rule.SetSCL === "-1";
}

/**
 * Returns true if the rule carries a suppressive action: DeleteMessage (silent
 * drop) or Quarantine. These actions prevent message delivery entirely rather
 * than redirecting or modifying the message.
 */
function ruleHasSuppressiveAction(rule: TransportRule): boolean {
  if (rule.DeleteMessage === true) return true;
  if (rule.Quarantine === true) return true;
  return false;
}

// Representative set of condition fields that narrow a rule's scope.
// If ALL of these are absent or empty on an enabled rule, the rule applies to
// every message in scope of the connector without further discrimination.
// Note: Exchange has additional condition fields not listed here; the heuristic
// is intentionally conservative — it flags only rules with NO detectable
// narrowing criteria from this representative set.
const NARROWING_CONDITION_FIELDS: (keyof TransportRule)[] = [
  "SenderDomainIs",
  "From",
  "FromAddressContainsWords",
  "FromAddressMatchesPatterns",
  "FromMemberOf",
  "SenderIpRanges",
  "SubjectContainsWords",
  "SubjectMatchesPatterns",
  "RecipientDomainIs",
  "SentTo",
  "SentToMemberOf",
  "RecipientAddressContainsWords",
  "AnyOfRecipientAddressContainsWords",
  "MessageTypeMatches"
];

/**
 * Returns true when none of the representative narrowing condition fields are
 * set on the rule (the rule applies to all messages with no scope restriction).
 * Used to reduce false positives for EXO_TRANSPORT_003: only a suppressive
 * rule with no detectable conditions warrants a finding.
 */
function ruleIsBroad(rule: TransportRule): boolean {
  for (const field of NARROWING_CONDITION_FIELDS) {
    const v = rule[field];
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "string" && v === "") continue;
    // At least one narrowing condition is present — not a broad rule.
    return false;
  }
  return true;
}

// ─── Collector ────────────────────────────────────────────────────────────────

// Cap the number of rule names stored per detection category to bound OBS size.
const MAX_RULE_NAMES_PER_CATEGORY = 20;

export const exchangeTransportRulesCollector: Collector = {
  id: "exchange.transportRules",
  displayName: "Exchange Transport Rules",

  async run(ctx) {
    const tenantId: string = ctx.tenant.tenantGuid;
    // primaryDomain is used to distinguish internal vs external forwarding
    // targets. Falls back to empty string if absent (isExternalAddress will
    // still work: every address with a non-empty domain will be flagged).
    const primaryDomain: string = ctx.tenant.primaryDomain ?? "";

    // ── Accumulators (populated on success path) ──────────────────────────
    let totalRules = 0;
    let enabledRulesCount = 0;
    // EXO_TRANSPORT_001: external forwarding
    let rulesWithExternalForwardingCount = 0;
    const forwardingRuleNames: string[] = [];
    // EXO_TRANSPORT_002: spam filter bypass (SetSCL=-1)
    let rulesWithSclBypassCount = 0;
    const sclBypassRuleNames: string[] = [];
    // EXO_TRANSPORT_003: broad suppressive action (delete/quarantine + no conditions)
    let rulesWithSuppressiveActionCount = 0;
    const suppressiveActionRuleNames: string[] = [];

    // ── Completeness signals (populated on error path) ────────────────────
    // These are the contract the derivation pipeline depends on.
    let permissionDenied = false; // Exchange Admin API returned 401 or 403
    let truncated = false;        // Any other error (token failure, 5xx, network)
    let errorCode: number | null = null;
    let errorMessage: string | null = null;

    try {
      const token = await getExchangeAdminAccessToken({ tenantId });

      // TransportRule is NOT an OData entity set in the Exchange Admin REST API.
      // The correct surface is InvokeCommand, which maps Exchange PowerShell
      // cmdlets to REST. This is the same mechanism used by the EXO V3
      // PowerShell module internally.
      //
      // ResultSize: "Unlimited" instructs Exchange to return all rules in a
      // single response. InvokeCommand does not use @odata.nextLink pagination.
      const invokeUrl = `${EXCHANGE_ADMIN_BASE}/${encodeURIComponent(tenantId)}/InvokeCommand`;

      const response = await exchangeAdminPost<InvokeCommandResponse<TransportRule>>(
        token,
        invokeUrl,
        {
          CmdletInput: {
            CmdletName: "Get-TransportRule",
            Parameters: {
              ResultSize: "Unlimited"
            }
          }
        }
      );

      const rules: TransportRule[] = Array.isArray(response.value) ? response.value : [];

      totalRules = rules.length;

      const enabledRules = rules.filter((r) => normaliseState(r.State) === "enabled");
      enabledRulesCount = enabledRules.length;

      for (const rule of enabledRules) {
        // EXO_TRANSPORT_001 detection
        if (ruleHasExternalForwarding(rule, primaryDomain)) {
          rulesWithExternalForwardingCount++;
          if (forwardingRuleNames.length < MAX_RULE_NAMES_PER_CATEGORY) {
            forwardingRuleNames.push(rule.Name ?? rule.Identity ?? "(unknown)");
          }
        }

        // EXO_TRANSPORT_002 detection
        if (ruleBypassesSpamFilter(rule)) {
          rulesWithSclBypassCount++;
          if (sclBypassRuleNames.length < MAX_RULE_NAMES_PER_CATEGORY) {
            sclBypassRuleNames.push(rule.Name ?? rule.Identity ?? "(unknown)");
          }
        }

        // EXO_TRANSPORT_003 detection: suppressive action with no narrowing conditions.
        // Only flag the rule when ruleIsBroad() is true so that legitimate narrow
        // admin rules (e.g. "delete NDR from [specific domain]") are not surfaced.
        if (ruleHasSuppressiveAction(rule) && ruleIsBroad(rule)) {
          rulesWithSuppressiveActionCount++;
          if (suppressiveActionRuleNames.length < MAX_RULE_NAMES_PER_CATEGORY) {
            suppressiveActionRuleNames.push(rule.Name ?? rule.Identity ?? "(unknown)");
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof GraphHttpError && (err.status === 401 || err.status === 403)) {
        // API-level permission denial: Exchange.ManageAsApp not granted, or the
        // service principal is not assigned an Exchange management role in this tenant.
        permissionDenied = true;
        errorCode = err.status;
        errorMessage = (err.bodyText ?? "").slice(0, 400) || null;
      } else if (err instanceof GraphHttpError) {
        // Token-acquisition failure (e.g. 400 bad credentials), API unavailability,
        // unexpected 5xx, etc. Mark as truncated — data is not reliable.
        truncated = true;
        errorCode = err.status;
        errorMessage = (err.bodyText ?? "").slice(0, 400) || null;
      } else {
        // Network error, JSON parse error, unexpected throw
        truncated = true;
        errorCode = null;
        errorMessage =
          err instanceof Error ? err.message.slice(0, 400) : String(err).slice(0, 400);
      }
    }

    // isComplete is the single canonical flag for downstream derivations:
    // "was this collector able to enumerate transport rules reliably?"
    const isComplete = !permissionDenied && !truncated;

    // ── Observed check (EXO_TRANSPORT_OBS_001) ────────────────────────────
    // Delete-then-insert for idempotency (same as other collectors).
    const jobId: string | null = ctx.job?.id ?? null;

    await ctx.prisma.observedCheck.deleteMany({
      where: { runId: ctx.run.id, jobId, checkId: "EXO_TRANSPORT_OBS_001" }
    });

    await ctx.prisma.observedCheck.createMany({
      data: [
        {
          runId: ctx.run.id,
          jobId,
          checkId: "EXO_TRANSPORT_OBS_001",
          collectorId: "exchange.transportRules",
          ruleId: null,
          data: {
            // Completeness signals — always present regardless of success/failure.
            // Future coverage findings gate on these fields.
            isComplete,
            permissionDenied,
            truncated,
            errorCode,
            errorMessage,

            // Facts — only meaningful when isComplete === true.
            totalRules,
            enabledRulesCount,

            // EXO_TRANSPORT_001: external-forwarding detection results.
            rulesWithExternalForwardingCount,
            forwardingRuleNames,

            // EXO_TRANSPORT_002: spam-filter bypass detection results.
            // rulesWithSclBypassCount > 0 means at least one enabled rule
            // sets SCL to -1, explicitly bypassing EOP spam analysis.
            rulesWithSclBypassCount,
            sclBypassRuleNames,

            // EXO_TRANSPORT_003: broad suppressive-action detection results.
            // rulesWithSuppressiveActionCount > 0 means at least one enabled rule
            // deletes or quarantines messages AND has no detectable narrowing
            // conditions (i.e. it applies to all messages in scope).
            rulesWithSuppressiveActionCount,
            suppressiveActionRuleNames,

            // Domain context used for "external" determination.
            // Stored in OBS so findings derivations can show it in references.
            tenantPrimaryDomain: primaryDomain
          } as any,
          references: [] as any
        }
      ]
    });

    // ── Collector result ──────────────────────────────────────────────────
    // Status is always "ok": completeness is captured in the OBS, not in the
    // job result. This matches the convention used by other collectors
    // (e.g. entraConditionalAccessPoliciesCollector).
    return {
      id: "exchange.transportRules",
      status: "ok",
      summary: {
        isComplete,
        permissionDenied,
        truncated,
        totalRules,
        enabledRulesCount,
        rulesWithExternalForwardingCount,
        rulesWithSclBypassCount,
        rulesWithSuppressiveActionCount
      }
    };
  }
};
