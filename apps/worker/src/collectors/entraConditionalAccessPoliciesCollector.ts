import type { Collector } from "./types";
import { getGraphAccessToken, graphGetAllPages, GraphHttpError } from "./graph";

// NOTE: This is a FULL FILE REPLACEMENT.
// It preserves existing behaviour and adds resilient handling for missing Graph scopes (403).

type ConditionalAccessPolicy = {
  id: string;
  displayName?: string | null;
  state?: string | null; // enabled | disabled | enabledForReportingButNotEnforced
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
    authenticationStrength?: unknown;
  };
  sessionControls?: Record<string, unknown> | null;
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
  bodyText?: string;
};

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

function graphErrorToReference(err: GraphHttpError): GraphErrorReference {
  return {
    status: err.status,
    url: err.url,
    requestId: err.requestId,
    clientRequestId: err.clientRequestId,
    bodyText: err.bodyText
  };
}

export const entraConditionalAccessPoliciesCollector: Collector = {
  id: "entra.conditionalAccess.policies",
  displayName: "Conditional Access Policies",

  async run(ctx) {
    const tenantGuid = ctx.tenant.tenantGuid;
    const token = await getGraphAccessToken({ tenantId: tenantGuid });

    const rawProfile = (ctx.run as any)?.dataProfile;
    const dataProfile: "safe" | "full" = rawProfile === "full" ? "full" : "safe";
    const includeSensitive = dataProfile === "full";

    let policies: ConditionalAccessPolicy[] = [];
    let permissionDenied = false;
    let permissionError: GraphErrorReference | null = null;

    try {
      policies = await graphGetAllPages<ConditionalAccessPolicy>(
        token,
        "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies"
      );
    } catch (err: any) {
      if (err instanceof GraphHttpError && err.status === 403) {
        permissionDenied = true;
        permissionError = graphErrorToReference(err);
        policies = [];
      } else {
        throw err;
      }
    }

    const MAX_POLICIES = Number(process.env.CA_MAX_POLICIES ?? 0);
    const capTruncated = MAX_POLICIES > 0 && policies.length > MAX_POLICIES;

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
    const namedLocationsCount = 0; // not enumerated yet

    const fullExported = includeSensitive && !permissionDenied;

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
          references: permissionError ? [permissionError] : []
        }
      ]
    });

    if (!truncated && enabledPolicies === 0) {
      await ctx.prisma.finding.create({
        data: {
          runId: ctx.run.id,
          jobId: ctx.job.id,
          checkId: "ENTRA_CA_001",
          severity: "low",
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
      error: permissionError,
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
      id: "entra.conditionalAccess.policies",
      status: "ok",
      summary: {
        profile: dataProfile,
        totalPolicies,
        enabledPolicies,
        reportOnlyPolicies,
        disabledPolicies,
        truncated,
        permissionDenied,
        fullExported: includeSensitive
      },
      artefacts: [
        {
          type: "json" as const,
          filename: "conditional-access-policies.safe.json",
          contentType: "application/json",
          content: safeArtefactContent
        },
        ...(includeSensitive && fullArtefactContent
          ? [
              {
                type: "json" as const,
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
