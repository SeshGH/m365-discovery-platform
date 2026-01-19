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

type GraphErrorReference = {
  status?: number;
  url?: string;
  requestId?: string;
  clientRequestId?: string;
  error?: unknown;
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

function buildGraphErrorReference(err: any): GraphErrorReference {
  return {
    status: err?.status,
    url: err?.url,
    requestId: err?.requestId,
    clientRequestId: err?.clientRequestId,
    error: err?.error
  };
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

    let policies: ConditionalAccessPolicy[] = [];
    let permissionDenied = false;
    let permissionErrorRef: GraphErrorReference | null = null;

    // Fetch policies (full shape so we can compute counts + optional full export)
    try {
      policies = await graphGetAllPages<ConditionalAccessPolicy>(
        token,
        "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies"
      );
    } catch (err: any) {
      // Explicitly treat missing scopes / access denied as discovery incompleteness
      if (err?.status === 403) {
        permissionDenied = true;
        permissionErrorRef = buildGraphErrorReference(err);
        policies = [];
      } else {
        throw err;
      }
    }

    // Optional demo/perf cap (not required, but supports predictable demos).
    // If set, we surface truncation as a completeness signal (never silent).
    const MAX_POLICIES = Number(process.env.CA_MAX_POLICIES ?? 0);
    const capTruncated = MAX_POLICIES > 0 && policies.length > MAX_POLICIES;

    // Permission denied is also a completeness problem (treat as truncated)
    const truncated = permissionDenied || capTruncated;

    const targetPolicies = capTruncated ? policies.slice(0, MAX_POLICIES) : policies;
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

    const fullExported = includeSensitive && !permissionDenied;

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
            truncated,
            permissionDenied,
            maxPolicies: MAX_POLICIES > 0 ? MAX_POLICIES : null,
            fullExported
          },
          references: permissionErrorRef ? [permissionErrorRef] : []
        }
      ]
    });

    // -------------------------
    // Finding: ENTRA_CA_001
    // Only when evidence is complete (no truncation AND no permission denial)
    // -------------------------
    if (!truncated && enabledPolicies === 0) {
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
    // Full: includes include/exclude IDs (PII-adjacent), only when dataProfile === \"full\" and permitted.
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

    const safeArtefactBody = {
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
        truncated,
        permissionDenied,
        maxPolicies: MAX_POLICIES > 0 ? MAX_POLICIES : null
      },
      error: permissionErrorRef,
      policies: safePolicies
    };

    const safeArtefactContent = JSON.stringify(safeArtefactBody, null, 2);

    const fullArtefactContent =
      includeSensitive && !permissionDenied
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
                truncated,
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
        truncated,
        permissionDenied,
        fullExported
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
