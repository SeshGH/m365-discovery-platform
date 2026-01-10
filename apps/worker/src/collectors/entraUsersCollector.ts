import type { Collector } from "./types";
import { getGraphAccessToken, graphGetAllPages, graphGet } from "./graph";

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

function isGraphPermissionMissingError(err: any, permissionName: string): boolean {
  const msg = String(err?.message ?? "");
  // Our graphGet() wraps Graph error JSON into the message string
  return (
    msg.includes("Authentication_MSGraphPermissionMissing") &&
    msg.includes(permissionName)
  );
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

    // --- Phase 1: always-get inventory (no special perms) ---
    const inventoryUsers = await graphGetAllPages<GraphUser>(
      token,
      "https://graph.microsoft.com/v1.0/users?$select=id,accountEnabled"
    );

    const enabledUsers = inventoryUsers.filter((u) => u.accountEnabled === true);
    const disabledUsers = inventoryUsers.filter((u) => u.accountEnabled === false);

    const enabledCount = enabledUsers.length;
    const disabledCount = disabledUsers.length;

    // --- Phase 2: optional enrichment (signInActivity) ---
    // If missing permission, we still succeed the job and emit a coverage-gap finding.
    let signInActivityAvailable = true;
    let inactiveEnabledCount: number | null = null;
    let inactiveEnabledPct: number | null = null;

    try {
      // If this call works, we can compute inactivity signal.
      const enrichedUsers = await graphGetAllPages<GraphUser>(
        token,
        "https://graph.microsoft.com/v1.0/users?$select=id,accountEnabled,signInActivity"
      );

      const enrichedEnabled = enrichedUsers.filter((u) => u.accountEnabled === true);

      const enabledNoSuccessfulSignIn = enrichedEnabled.filter((u) => {
        const days = toDaysSince(u.signInActivity?.lastSuccessfulSignInDateTime);
        // Treat "never" or "unknown" as inactive for this signal
        if (days === null) return true;
        return days >= INACTIVE_DAYS;
      });

      inactiveEnabledCount = enabledNoSuccessfulSignIn.length;
      inactiveEnabledPct =
        enrichedEnabled.length > 0
          ? clampPct(inactiveEnabledCount / enrichedEnabled.length)
          : 0;

      const shouldEmitInactiveFinding =
        enrichedEnabled.length >= MIN_ENABLED_USERS &&
        (inactiveEnabledPct ?? 0) >= HIGH_INACTIVE_PCT;

      if (shouldEmitInactiveFinding) {
        const severity = (inactiveEnabledPct ?? 0) >= 0.8 ? "high" : "medium";
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
              enabledUsers: enrichedEnabled.length,
              enabledUsersNoSuccessfulSignInSinceThreshold: inactiveEnabledCount,
              enabledUsersNoSuccessfulSignInSinceThresholdPct: inactiveEnabledPct,
              minEnabledUsersForSignal: MIN_ENABLED_USERS,
              highInactivePctThreshold: HIGH_INACTIVE_PCT
            } as any,
            references: [] as any
          }
        });
      }
    } catch (err: any) {
      // Expected in many tenants unless the app is consented for AuditLog.Read.All
      if (isGraphPermissionMissingError(err, "AuditLog.Read.All")) {
        signInActivityAvailable = false;

        await ctx.prisma.finding.create({
          data: {
            runId: ctx.run.id,
            jobId: ctx.job.id,
            checkId: "ENTRA_USERS_003",
            category: "audit_and_logging",
            severity: "info",
            confidence: "high",
            status: "open",
            score: 0,
            title: "Sign-in activity unavailable for users (permission missing)",
            description:
              "The discovery app is not consented for AuditLog.Read.All, so user sign-in activity cannot be queried. Inactivity-based scoping and lifecycle signals were skipped for this run.",
            recommendation:
              "If you want inactivity and lifecycle insights, consent the discovery app for AuditLog.Read.All (application permission) with admin approval. If not, this can be left unconsented and the platform will treat sign-in activity as an explicit scoping unknown.",
            evidence: {
              missingPermission: "AuditLog.Read.All",
              skippedAnalysis: "users signInActivity / inactivity signal",
              inactiveDaysThreshold: INACTIVE_DAYS
            } as any,
            references: [] as any
          }
        });
      } else {
        // Anything else is a real failure: bubble up so the job fails.
        throw err;
      }
    }

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
          totalUsers: inventoryUsers.length,
          enabledUsers: enabledCount,
          disabledUsers: disabledCount
        },
        signInActivity: {
          available: signInActivityAvailable,
          inactiveDaysThreshold: INACTIVE_DAYS,
          enabledUsersNoSuccessfulSignInSinceThreshold: inactiveEnabledCount,
          enabledUsersNoSuccessfulSignInSinceThresholdPct: inactiveEnabledPct
        }
      },
      null,
      2
    );

    return {
      id: "entra.users",
      status: "ok",
      data: {
        summary: {
          totalUsers: inventoryUsers.length,
          enabledUsers: enabledCount,
          disabledUsers: disabledCount
        },
        signInActivity: {
          available: signInActivityAvailable,
          inactiveDaysThreshold: INACTIVE_DAYS,
          enabledUsersNoSuccessfulSignInSinceThreshold: inactiveEnabledCount,
          enabledUsersNoSuccessfulSignInSinceThresholdPct: inactiveEnabledPct
        }
      },
      summary: {
        userCount: inventoryUsers.length,
        enabledCount,
        disabledCount,
        signInActivityAvailable
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