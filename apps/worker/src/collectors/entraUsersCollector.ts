import type { Collector } from "./types";
import { getGraphAccessToken, graphGetAllPages } from "./graph";

type SignInActivity = {
  lastSignInDateTime?: string | null;
  lastNonInteractiveSignInDateTime?: string | null;
  lastSuccessfulSignInDateTime?: string | null;
};

type GraphUser = {
  id: string;
  accountEnabled?: boolean | null;
  signInActivity?: SignInActivity;
};

function toDaysSince(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const ms = Date.now() - d.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export const entraUsersCollector: Collector = {
  id: "entra.users",
  displayName: "Entra ID Users",
  async run(ctx) {
    const tenantId = ctx.tenant.tenantGuid;
    const token = await getGraphAccessToken({ tenantId });

    // Derived finding thresholds (configurable, safe defaults)
    const INACTIVE_DAYS = Number(process.env.ENTRA_USERS_INACTIVE_DAYS ?? 30);
    const HIGH_INACTIVE_PCT = Number(
      process.env.ENTRA_USERS_HIGH_INACTIVE_PCT ?? 0.5
    );
    const MIN_ENABLED_USERS = Number(process.env.ENTRA_USERS_MIN_ENABLED ?? 10);

    // We intentionally avoid PII fields (displayName/UPN). Inventory is counts-only.
    // NOTE: selecting signInActivity can require extra directory/audit permissions and premium licensing.
    const users = await graphGetAllPages<GraphUser>(
      token,
      "https://graph.microsoft.com/v1.0/users?$select=id,accountEnabled,signInActivity"
    );

    const enabledUsers = users.filter((u) => u.accountEnabled === true);
    const disabledUsers = users.filter((u) => u.accountEnabled === false);

    const enabledCount = enabledUsers.length;
    const disabledCount = disabledUsers.length;

    // Inactivity heuristic (successful sign-in is the best “real usage” indicator)
    const enabledNoSuccessfulSignIn = enabledUsers.filter((u) => {
      const days = toDaysSince(u.signInActivity?.lastSuccessfulSignInDateTime);
      // Treat "never" or "unknown" as inactive for the purposes of this signal
      if (days === null) return true;
      return days >= INACTIVE_DAYS;
    });

    const inactiveEnabledCount = enabledNoSuccessfulSignIn.length;
    const inactiveEnabledPct =
      enabledCount > 0 ? clampPct(inactiveEnabledCount / enabledCount) : 0;

    // Counts-only inventory artefact (safe-by-design: no PII list)
    const inventoryArtefact = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        tenant: {
          tenantGuid: ctx.tenant.tenantGuid,
          primaryDomain: ctx.tenant.primaryDomain,
          displayName: ctx.tenant.displayName
        },
        summary: {
          totalUsers: users.length,
          enabledUsers: enabledCount,
          disabledUsers: disabledCount
        },
        signInActivity: {
          inactiveDaysThreshold: INACTIVE_DAYS,
          enabledUsersNoSuccessfulSignInSinceThreshold: inactiveEnabledCount,
          enabledUsersNoSuccessfulSignInSinceThresholdPct: inactiveEnabledPct
        }
      },
      null,
      2
    );

    // Step 7.1 derived finding: emit ONE signal when the proportion is “high”.
    // Keep evidence counts-only (no lists).
    const shouldEmitInactiveFinding =
      enabledCount >= MIN_ENABLED_USERS && inactiveEnabledPct >= HIGH_INACTIVE_PCT;

    if (shouldEmitInactiveFinding) {
      // Severity is deliberately simple and explainable for the first derived finding.
      // We can evolve this later (e.g. severity bands) once we have real tenant data.
      const severity = inactiveEnabledPct >= 0.8 ? "high" : "medium";
      const score = severity === "high" ? 80 : 50;

      await ctx.prisma.finding.create({
        data: {
          runId: ctx.run.id,
          jobId: ctx.job.id,
          checkId: "ENTRA_USERS_002",
          category: "identity",
          severity: severity as any,
          confidence: "high",
          status: "open",
          score,
          title: `High proportion of enabled users have no successful sign-in in the last ${INACTIVE_DAYS} days`,
          description:
            "A large share of enabled user accounts show no successful sign-in activity within the configured window. This can indicate stale accounts, incomplete offboarding, shared/legacy identities, or gaps in lifecycle governance.",
          recommendation:
            "Review inactive enabled accounts. Validate owners, disable or remove stale accounts, and implement lifecycle controls (joiner/mover/leaver). Consider Conditional Access and periodic access reviews for privileged or sensitive accounts.",
          evidence: {
            inactiveDaysThreshold: INACTIVE_DAYS,
            enabledUsers: enabledCount,
            enabledUsersNoSuccessfulSignInSinceThreshold: inactiveEnabledCount,
            enabledUsersNoSuccessfulSignInSinceThresholdPct: inactiveEnabledPct,
            minEnabledUsersForSignal: MIN_ENABLED_USERS,
            highInactivePctThreshold: HIGH_INACTIVE_PCT
          } as any,
          references: [] as any
        }
      });
    }

    // Step 6: inventory belongs in artefacts; findings are reserved for signals.
    return {
      id: "entra.users",
      status: "ok",
      data: {
        // Keep the run result useful without leaking PII lists:
        summary: {
          totalUsers: users.length,
          enabledUsers: enabledCount,
          disabledUsers: disabledCount
        },
        signInActivity: {
          inactiveDaysThreshold: INACTIVE_DAYS,
          enabledUsersNoSuccessfulSignInSinceThreshold: inactiveEnabledCount,
          enabledUsersNoSuccessfulSignInSinceThresholdPct: inactiveEnabledPct
        }
      },
      summary: {
        userCount: users.length,
        enabledCount,
        disabledCount,
        inactiveEnabledCount,
        inactiveDaysThreshold: INACTIVE_DAYS
      },
      artefacts: [
        {
          type: "json",
          filename: "users-inventory.json",
          contentType: "application/json",
          content: inventoryArtefact
        }
      ]
    };
  }
};
