import type { Collector } from "./types";
import { getGraphAccessToken, graphGetAllPages, GraphHttpError } from "./graph";

type GraphUserSafe = {
  id: string;
  accountEnabled?: boolean | null;
  userType?: string | null; // "Member" | "Guest" (not PII)
};

type GraphUserFull = {
  id: string;
  displayName?: string | null;
  userPrincipalName?: string | null;
  mail?: string | null;
  userType?: string | null;
  accountEnabled?: boolean | null;
  createdDateTime?: string | null;
};

type ObservedCheckInput = {
  checkId: string;
  data: unknown;
  references?: unknown; // stored as Json, usually [] or [{...}]
};

function isGraph403(e: unknown): boolean {
  return e instanceof GraphHttpError && e.status === 403;
}

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

  // Idempotency: remove any prior observations from this same job/run for these checkIds
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
      // observedAt uses default(now()) in schema
      data: (c.data ?? {}) as any,
      references: (c.references ?? []) as any
    }))
  });
}

export const entraUsersCollector: Collector = {
  id: "entra.users",
  displayName: "Entra Users",
  async run(ctx) {
    const tenantId = ctx.tenant.tenantGuid;
    const token = await getGraphAccessToken({ tenantId });

    // Collector-level hardening: only explicit "full" enables sensitive exports.
    // Any unknown/missing value is treated as "safe".
    const rawProfile = (ctx.run as any)?.dataProfile;
    const dataProfile: "safe" | "full" = rawProfile === "full" ? "full" : "safe";
    const includeSensitive = dataProfile === "full";

    // Completeness tracking
    let isComplete = true;
    const permissionDenied: string[] = [];
    const notes: string[] = [];

    let inventoryUsers: GraphUserSafe[] = [];
    try {
      // Safe profile: minimal fields for counts (no PII-bearing per-user export).
      inventoryUsers = await graphGetAllPages<GraphUserSafe>(
        token,
        "https://graph.microsoft.com/v1.0/users?$select=id,accountEnabled,userType"
      );
    } catch (e: unknown) {
      if (isGraph403(e)) {
        isComplete = false;
        permissionDenied.push("microsoft.graph/users:list");
        notes.push(
          "Graph returned 403 when listing users. This is treated as a data completeness gap (missing app permissions/admin consent), not a hard failure."
        );
        inventoryUsers = [];
      } else {
        throw e;
      }
    }

    let fullUsers: GraphUserFull[] = [];
    let fullExported = false;

    if (includeSensitive) {
      try {
        fullUsers = await graphGetAllPages<GraphUserFull>(
          token,
          "https://graph.microsoft.com/v1.0/users?$select=id,displayName,userPrincipalName,mail,userType,accountEnabled,createdDateTime"
        );
        fullExported = true;
      } catch (e: unknown) {
        if (isGraph403(e)) {
          // Safe counts may still be present; full export specifically is blocked.
          isComplete = false;
          permissionDenied.push("microsoft.graph/users:list(full)");
          notes.push(
            "Graph returned 403 when listing users with full fields. Safe-by-default counts may still be available, but full export is blocked without required permissions/admin consent."
          );
          fullUsers = [];
          fullExported = false;
        } else {
          throw e;
        }
      }
    }

    // Counts
    // If inventoryUsers couldn't be fetched (403), these will remain null.
    const total: number | null = isComplete || inventoryUsers.length > 0 ? inventoryUsers.length : null;
    const enabled: number | null =
      total === null ? null : inventoryUsers.filter((u) => u.accountEnabled !== false).length;
    const disabled: number | null = total === null || enabled === null ? null : total - enabled;

    const guests: number | null =
      total === null ? null : inventoryUsers.filter((u) => (u.userType ?? "") === "Guest").length;
    const members: number | null = total === null || guests === null ? null : total - guests;

    // -------------------------
    // Observed checks (counts-only; safe-by-default)
    // -------------------------
    await recordObservedChecks({
      prisma: ctx.prisma,
      runId: ctx.run.id,
      jobId: ctx.job?.id ?? null,
      collectorId: entraUsersCollector.id,
      checks: [
        {
          checkId: "ENTRA_USERS_OBS_001",
          data: {
            profile: dataProfile,
            isComplete,
            permissionDenied,
            notes,

            // Canonical metrics surface for portal "Environment overview" (best-effort)
            counts: {
              users: total,
              usersEnabled: enabled,
              usersDisabled: disabled,
              usersMembers: members,
              usersGuests: guests
            },

            // Back-compat (existing fields) — keep for now
            totalUsers: total,
            enabledUsers: enabled,
            disabledUsers: disabled,
            memberUsers: members,
            guestUsers: guests,

            fullExported
          },
          references: []
        }
      ]
    });

    // Finding: Guest users present (counts only; safe-by-default)
    // Only emit if we have complete data for the safe inventory.
    if (isComplete && typeof guests === "number" && guests > 0) {
      await ctx.prisma.finding.create({
        data: {
          runId: ctx.run.id,
          jobId: ctx.job.id,
          checkId: "ENTRA_USERS_001",
          category: "identity",
          severity: "info",
          confidence: "high",
          status: "open",
          score: 0,
          title: "Guest users present",
          description:
            "Guest accounts are present in the tenant. Guest use should be reviewed for lifecycle controls and appropriate access policies.",
          recommendation:
            "Review guest user governance: confirm guest access expiry, review invitation/approval controls, and validate conditional access coverage for external users.",
          evidence: {
            guestUsers: guests,
            totalUsers: total,
            enabledUsers: enabled,
            disabledUsers: disabled
          }
        }
      });
    }

    // Counts-only inventory artefact (safe-by-design)
    const inventoryArtefact = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        profile: "safe",
        tenant: {
          tenantGuid: ctx.tenant.tenantGuid,
          primaryDomain: ctx.tenant.primaryDomain,
          displayName: ctx.tenant.displayName
        },
        completeness: {
          isComplete,
          permissionDenied,
          notes
        },
        summary: {
          totalUsers: total,
          enabledUsers: enabled,
          disabledUsers: disabled,
          memberUsers: members,
          guestUsers: guests
        }
      },
      null,
      2
    );

    const fullInventoryArtefact =
      includeSensitive && fullExported
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
                totalUsers: fullUsers.length,
                guestUsers: fullUsers.filter((u) => (u.userType ?? "") === "Guest").length
              },
              users: fullUsers.map((u) => ({
                id: u.id,
                displayName: u.displayName ?? "",
                userPrincipalName: u.userPrincipalName ?? "",
                mail: u.mail ?? "",
                userType: u.userType ?? "",
                accountEnabled: u.accountEnabled ?? null,
                createdDateTime: u.createdDateTime ?? ""
              }))
            },
            null,
            2
          )
        : null;

    // Filenames:
    // - safe run: users-inventory.json
    // - full run: users-inventory.safe.json + users-inventory.full.json
    const safeFilename = includeSensitive ? "users-inventory.safe.json" : "users-inventory.json";

    return {
      id: "entra.users",
      status: "ok",
      summary: {
        profile: dataProfile,
        isComplete,
        totalUsers: total,
        enabledUsers: enabled,
        disabledUsers: disabled,
        guestUsers: guests,
        fullExported
      },
      artefacts: [
        {
          type: "json" as const,
          filename: safeFilename,
          contentType: "application/json",
          content: inventoryArtefact
        },
        ...(includeSensitive && fullInventoryArtefact
          ? [
              {
                type: "json" as const,
                filename: "users-inventory.full.json",
                contentType: "application/json",
                content: fullInventoryArtefact
              }
            ]
          : [])
      ]
    };
  }
};
