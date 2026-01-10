import type { Collector } from "./types";
import { getGraphAccessToken, graphGetAllPages } from "./graph";

type GraphUser = {
  id: string;
  displayName?: string | null;
  userPrincipalName?: string | null;
  accountEnabled?: boolean | null;
};

export const entraUsersCollector: Collector = {
  id: "entra.users",
  displayName: "Entra ID Users",
  async run(ctx) {
    const tenantId = ctx.tenant.tenantGuid;
    const token = await getGraphAccessToken({ tenantId });

    // Keep it lightweight: select key fields
    const users = await graphGetAllPages<GraphUser>(
      token,
      "https://graph.microsoft.com/v1.0/users?$select=id,displayName,userPrincipalName,accountEnabled"
    );

    const enabledCount = users.filter((u) => u.accountEnabled === true).length;
    const disabledCount = users.filter((u) => u.accountEnabled === false).length;

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
        }
      },
      null,
      2
    );

    // Step 6: inventory belongs in artefacts; findings are reserved for signals.
    // So we intentionally do NOT return data.users (PII list).
    return {
      id: "entra.users",
      status: "ok",
      data: {
        // Keep the run result useful without leaking PII lists:
        summary: {
          totalUsers: users.length,
          enabledUsers: enabledCount,
          disabledUsers: disabledCount
        }
      },
      summary: {
        userCount: users.length,
        enabledCount,
        disabledCount
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

