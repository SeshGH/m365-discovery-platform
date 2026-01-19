import type { Collector } from "./types";
import { getGraphAccessToken, graphGetAllPages } from "./graph";

type ConditionalAccessPolicy = {
  id: string;
  displayName?: string | null;
  state?: string | null; // "enabled" | "disabled" | "enabledForReportingButNotEnforced" (Graph)
  conditions?: {
    users?: {
      includeUsers?: string[];
      excludeUsers?: string[];
      includeGroups?: string[];
      excludeGroups?: string[];
      includeRoles?: string[];
      excludeRoles?: string[];
    };
    applications?: {
      includeApplications?: string[];
      excludeApplications?: string[];
      includeUserActions?: string[];
    };
    clientAppTypes?: string[];
  };
  grantControls?: {
    operator?: string | null;
    builtInControls?: string[];
    customAuthenticationFactors?: string[];
    termsOfUse?: string[];
    authenticationStrength?: any;
  };
  sessionControls?: Record<string, any> | null;
};

type ObservedCheckInput = {
  checkId: string;
  data: unknown;
  references?: unknown;
};

/**
 * Record observed checks in an idempotent way.
 * Since ObservedCheck has no unique constraint, we enforce idempotency by:
 * - deleting existing rows for the same (runId, jobId, checkId)
 * - inserting fresh rows
 */
async function recordObservedChecks(params: {
  prisma: any;
  runId: string;
  jobId?: string | null;
  collectorId: string;
  checks: ObservedCheckInput[];
}) {
  const { prisma, runId, jobId, collectorId, checks } = params;

  const checkIds = checks.map((c) => c.checkId);

  await prisma.observedCheck.deleteMany({
    where: {
      runId,
      jobId: jobId ?? null,
      checkId: { in: checkIds }
    }
  });

  if (checks.length === 0) return;

  await prisma.observedCheck.createMany({
    data: checks.map((c) => ({
      runId,
      jobId: jobId ?? null,
      checkId: c.checkId,
      collectorId,
      ruleId: null,
      data: (c.data ?? {}) as any,
      references: (c.references ?? []) as any
    }))
  });
}

function normaliseState(state: string | null | undefined) {
  const s = (state ?? "").toLowerCase();
  if (s === "enabled") return "enabled";
  if (s === "disabled") return "disabled";
  if (s === "enabledforreportingbutnotenforced") return "reportOnly";
  return "unknown";
}

function countArray(a: unknown): number {
  return Array.isArray(a) ? a.length : 0;
}

function hasMfaGrantControl(policy: ConditionalAccessPolicy): boolean {
  const controls = policy.grantControls?.builtInControls ?? [];
  return controls.some((c) => (c ?? "").toLowerCase() === "mfa");
}

function isTargetsAllUsers(policy: ConditionalAccessPolicy): boolean {
  const includeUsers = policy.conditions?.users?.includeUsers ?? [];
  return includeUsers.some((u) => (u ?? "").toLowerCase() === "all");
}

function detectsLegacyAuthBlock(policy: ConditionalAccessPolicy): boolean {
  // Factual heuristic (not a compliance judgement):
  // - CA policy targets legacy client app types (exchangeActiveSync/other)
  // - and includes "block" built-in control
  const clientAppTypes = (policy.conditions?.clientAppTypes ?? []).map((s) =>
    (s ?? "").toLowerCase()
  );
  const targetsLegacy =
    clientAppTypes.includes("exchangeactivesync") || clientAppTypes.includes("other");

  const builtIn = (policy.grantControls?.builtInControls ?? []).map((s) =>
    (s ?? "").toLowerCase()
  );
  const blocks = builtIn.includes("block");

  return targetsLegacy && blocks;
}

export const entraConditionalAccessPoliciesCollector: Collector = {
  id: "entra.conditionalAccess.policies",
  displayName: "Conditional Access Policies",
  async run(ctx) {
    const tenantId = ctx.tenant.tenantGuid;
    const token = await getGraphAccessToken({ tenantId });

    // Collector-level hardening: only explicit "full" enables sensitive exports.
    // Any unknown/missing value is treated as "safe".
    const rawProfile = (ctx.run as any)?.dataProfile;
    const dataProfile: "safe" | "full" = rawProfile === "full" ? "full" : "safe";
    const includeSensitive = dataProfile === "full";

    // Fetch policies (full shape so we can compute counts + optional full export)
    // We do not assume execution order; this collector is standalone evidence + observation.
    const policies = await graphGetAllPages<ConditionalAccessPolicy>(
      token,
      "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies"
    );

    // Optional demo/perf cap (not required, but supports predictable demos).
    // If set, we surface truncation as a completeness signal (never silent).
    const MAX_POLICIES = Number(process.env.CA_MAX_POLICIES ?? 0);
    const wasTruncated = MAX_POLICIES > 0 && policies.length > MAX_POLICIES;
    const targetPolicies = wasTruncated ? policies.slice(0, MAX_POLICIES) : policies;

    const totalPolicies = policies.length;

    const enabledPolicies = targetPolicies.filter(
      (p) => normaliseState(p.state) === "enabled"
    ).length;

    const reportOnlyPolicies = targetPolicies.filter(
      (p) => normaliseState(p.state) === "reportOnly"
    ).length;

    const disabledPolicies = targetPolicies.filter(
      (p) => normaliseState(p.state) === "disabled"
    ).length;

    const policiesTargetingAllUsers = targetPolicies.filter(isTargetsAllUsers).length;
    const policiesWithMfaGrantControl = targetPolicies.filter(hasMfaGrantControl).length;

    const policiesExcludingUsersCount = targetPolicies.reduce((acc, p) => {
      return acc + countArray(p.conditions?.users?.excludeUsers);
    }, 0);

    const hasLegacyAuthPolicyDetected = targetPolicies.some(detectsLegacyAuthBlock);

    // Named locations: not enumerated in v1; we expose a factual 0.
    const namedLocationsCount = 0;

    // -------------------------
    // Observed check (preferred pattern)
    // -------------------------
    await recordObservedChecks({
      prisma: ctx.prisma,
      runId: ctx.run.id,
      jobId: ctx.job?.id ?? null,
      collectorId: entraConditionalAccessPoliciesCollector.id,
      checks: [
        {
          checkId: "ENTRA_CA_OBS_001",
          data: {
            profile: dataProfile,
            totalPolicies,
            enabledPolicies,
            reportOnlyPolicies,
            disabledPolicies,
            policiesTargetingAllUsers,
            policiesWithMfaGrantControl,
            policiesExcludingUsersCount,
            hasLegacyAuthPolicyDetected,
            namedLocationsCount,
            truncated: wasTruncated,
            maxPolicies: MAX_POLICIES > 0 ? MAX_POLICIES : null,
            fullExported: includeSensitive
          },
          references: []
        }
      ]
    });

    // -------------------------
    // Finding: ENTRA_CA_001
    // Meaning (stable): "No enabled Conditional Access policies detected"
    // Safety: do NOT raise this if results are truncated/incomplete.
    // -------------------------
    if (!wasTruncated && enabledPolicies === 0) {
      await ctx.prisma.finding.create({
        data: {
          runId: ctx.run.id,
          jobId: ctx.job.id,
          checkId: "ENTRA_CA_001",
          severity: "high",
          title: "No enabled Conditional Access policies detected",
          description:
            "No enabled Conditional Access policies were observed at discovery time.",
          recommendation:
            "Review and implement baseline Conditional Access policies appropriate to organisational risk and licensing.",
          evidence: {
            totalPolicies,
            enabledPolicies,
            reportOnlyPolicies,
            disabledPolicies
          },
          references: [] as any
        }
      });
    }

    // -------------------------
    // Artefacts (evidence layer)
    // Safe: counts/states/control types only; no membership identifiers.
    // Full: includes include/exclude IDs (PII-adjacent), only when dataProfile === \"full\".
    // -------------------------
    const safePolicies = targetPolicies.map((p) => ({
      id: p.id,
      displayName: p.displayName ?? "(unknown)",
      state: normaliseState(p.state),
      conditions: {
        users: {
          includeUsersCount: countArray(p.conditions?.users?.includeUsers),
          excludeUsersCount: countArray(p.conditions?.users?.excludeUsers),
          includeGroupsCount: countArray(p.conditions?.users?.includeGroups),
          excludeGroupsCount: countArray(p.conditions?.users?.excludeGroups),
          includeRolesCount: countArray(p.conditions?.users?.includeRoles),
          excludeRolesCount: countArray(p.conditions?.users?.excludeRoles),
          targetsAllUsers: isTargetsAllUsers(p)
        },
        applications: {
          includeApplicationsCount: countArray(p.conditions?.applications?.includeApplications),
          excludeApplicationsCount: countArray(p.conditions?.applications?.excludeApplications),
          includeUserActionsCount: countArray(p.conditions?.applications?.includeUserActions)
        },
        clientAppTypes: (p.conditions?.clientAppTypes ?? []).map((x) => x ?? "")
      },
      grantControls: {
        operator: p.grantControls?.operator ?? null,
        builtInControls: (p.grantControls?.builtInControls ?? []).map((x) => x ?? ""),
        customAuthenticationFactors: (
          p.grantControls?.customAuthenticationFactors ?? []
        ).map((x) => x ?? ""),
        termsOfUse: (p.grantControls?.termsOfUse ?? []).map((x) => x ?? "")
      },
      hasSessionControls: !!p.sessionControls
    }));

    const safeArtefactContent = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        profile: "safe",
        tenant: {
          tenantGuid: ctx.tenant.tenantGuid,
          primaryDomain: ctx.tenant.primaryDomain,
          displayName: ctx.tenant.displayName
        },
        summary: {
          totalPolicies,
          enabledPolicies,
          reportOnlyPolicies,
          disabledPolicies,
          policiesTargetingAllUsers,
          policiesWithMfaGrantControl,
          policiesExcludingUsersCount,
          hasLegacyAuthPolicyDetected,
          namedLocationsCount,
          truncated: wasTruncated,
          maxPolicies: MAX_POLICIES > 0 ? MAX_POLICIES : null
        },
        policies: safePolicies
      },
      null,
      2
    );

    const fullArtefactContent = includeSensitive
      ? JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            profile: "full",
            tenant: {
              tenantGuid: ctx.tenant.tenantGuid,
              primaryDomain: ctx.tenant.primaryDomain,
              displayName: ctx.tenant.displayName
            },
            summary: {
              totalPolicies,
              enabledPolicies,
              reportOnlyPolicies,
              disabledPolicies,
              truncated: wasTruncated,
              maxPolicies: MAX_POLICIES > 0 ? MAX_POLICIES : null
            },
            policies: targetPolicies.map((p) => ({
              id: p.id,
              displayName: p.displayName ?? "(unknown)",
              state: normaliseState(p.state),
              conditions: p.conditions ?? {},
              grantControls: p.grantControls ?? {},
              sessionControls: p.sessionControls ?? null
            }))
          },
          null,
          2
        )
      : null;

    return {
      id: entraConditionalAccessPoliciesCollector.id,
      status: "ok",
      summary: {
        profile: dataProfile,
        totalPolicies,
        enabledPolicies,
        reportOnlyPolicies,
        disabledPolicies,
        truncated: wasTruncated,
        fullExported: includeSensitive
      },
      artefacts: [
        {
          type: "json",
          filename: "conditional-access-policies.safe.json",
          contentType: "application/json",
          content: safeArtefactContent
        },
        ...(includeSensitive && fullArtefactContent
          ? [
              {
                type: "json",
                filename: "conditional-access-policies.full.json",
                contentType: "application/json",
                content: fullArtefactContent
              }
            ]
          : [])
      ]
    };
  }
};
