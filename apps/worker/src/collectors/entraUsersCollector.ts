import type { Collector } from "./types";
import { getGraphAccessToken, graphGetAllPages } from "./graph";

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

export const entraUsersCollector: Collector = {
  id: "entra.users",
  displayName: "Entra Users",
  async run(ctx) {
    const tenantId = ctx.tenant.tenantGuid;
    const token = await getGraphAccessToken({ tenantId });

    const dataProfile = (ctx.run as any).dataProfile ?? "safe";
    const includeSensitive = dataProfile === "full";

    // Safe profile: minimal fields for counts (no PII-bearing per-user export).
    const inventoryUsers = await graphGetAllPages<GraphUserSafe>(
      token,
      "https://graph.microsoft.com/v1.0/users?$select=id,accountEnabled,userType"
    );

    // Full profile (explicit opt-in): export a PII-bearing inventory artefact.
    // Safe profile: we still fetch minimal fields for counts, but do not export per-user rows.
    const fullUsers = includeSensitive
      ? await graphGetAllPages<GraphUserFull>(
          token,
          "https://graph.microsoft.com/v1.0/users?$select=id,displayName,userPrincipalName,mail,userType,accountEnabled,createdDateTime"
        )
      : [];

    const total = inventoryUsers.length;
    const enabled = inventoryUsers.filter((u) => u.accountEnabled !== false).length;
    const disabled = total - enabled;

    const guests = inventoryUsers.filter((u) => (u.userType ?? "") === "Guest").length;
    const members = total - guests;

    // Finding: Guest users present (counts only; safe-by-default)
    // Contract: stable checkId, small evidence, no inventory/PII.
    if (guests > 0) {
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
            "Guest accounts are present in the tenant. Guest users can increase governance and access management complexity and should be reviewed for lifecycle controls and appropriate access policies.",
          recommendation:
            "Review guest user governance: confirm guest access policies, ensure lifecycle/expiry controls exist, and validate conditional access coverage for external users.",
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

    const fullInventoryArtefact = includeSensitive
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

    return {
      id: "entra.users",
      status: "ok",
      summary: {
        profile: dataProfile,
        totalUsers: total,
        enabledUsers: enabled,
        disabledUsers: disabled,
        guestUsers: guests,
        fullExported: includeSensitive
      },
      artefacts: [
        {
          type: "json",
          filename: includeSensitive ? "users-inventory.safe.json" : "users-inventory.json",
          contentType: "application/json",
          content: inventoryArtefact
        },
        ...(includeSensitive && fullInventoryArtefact
          ? [
              {
                type: "json",
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
