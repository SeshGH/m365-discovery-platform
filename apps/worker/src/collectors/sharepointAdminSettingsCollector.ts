// apps/worker/src/collectors/sharepointAdminSettingsCollector.ts

import type { Collector } from "./types";
import { getGraphAccessToken, graphGet, GraphHttpError } from "./graph";

type ObservedCheckInput = {
  checkId: string;
  data: unknown;
  references?: unknown;
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
    where: { runId, jobId: jobId ?? null, checkId: { in: checkIds } }
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

type GraphSharePointSettings = {
  sharingCapability?: string | null;
  isLegacyAuthProtocolsEnabled?: boolean | null;
  isResharingByExternalUsersEnabled?: boolean | null;
  isRequireAcceptingUserToMatchInvitedUserEnabled?: boolean | null;
};

export const sharepointAdminSettingsCollector: Collector = {
  id: "sharepoint.admin.settings",
  displayName: "SharePoint Online – Admin Settings",

  async run(ctx) {
    let isComplete = true;
    const permissionDenied: string[] = [];
    const notes: string[] = [];

    let sharingCapability: string | null = null;
    let isLegacyAuthProtocolsEnabled: boolean | null = null;
    let isResharingByExternalUsersEnabled: boolean | null = null;
    let isRequireAcceptingUserToMatchInvitedUserEnabled: boolean | null = null;

    try {
      const token = await getGraphAccessToken({ tenantId: ctx.tenant.tenantGuid });

      const settings = await graphGet<GraphSharePointSettings>(
        token,
        "https://graph.microsoft.com/v1.0/admin/sharepoint/settings"
      );

      sharingCapability =
        typeof settings.sharingCapability === "string" ? settings.sharingCapability : null;
      isLegacyAuthProtocolsEnabled =
        typeof settings.isLegacyAuthProtocolsEnabled === "boolean"
          ? settings.isLegacyAuthProtocolsEnabled
          : null;
      isResharingByExternalUsersEnabled =
        typeof settings.isResharingByExternalUsersEnabled === "boolean"
          ? settings.isResharingByExternalUsersEnabled
          : null;
      isRequireAcceptingUserToMatchInvitedUserEnabled =
        typeof settings.isRequireAcceptingUserToMatchInvitedUserEnabled === "boolean"
          ? settings.isRequireAcceptingUserToMatchInvitedUserEnabled
          : null;

      notes.push("SharePoint admin settings retrieved successfully.");
    } catch (e: unknown) {
      if (e instanceof GraphHttpError && e.status === 403) {
        isComplete = false;
        permissionDenied.push("microsoft.graph/admin/sharepoint/settings");
        notes.push(
          "Graph returned 403 when reading SharePoint admin settings. This typically indicates the SharePointTenantSettings.Read.All application permission has not been granted or consented."
        );
      } else {
        isComplete = false;
        notes.push("SharePoint admin settings retrieval failed unexpectedly.");
      }
    }

    await recordObservedChecks({
      prisma: ctx.prisma,
      runId: ctx.run.id,
      jobId: ctx.job?.id ?? null,
      collectorId: sharepointAdminSettingsCollector.id,
      checks: [
        {
          checkId: "SPO_ADMIN_OBS_001",
          data: {
            isComplete,
            permissionDenied,
            notes,
            sharingCapability,
            isLegacyAuthProtocolsEnabled,
            isResharingByExternalUsersEnabled,
            isRequireAcceptingUserToMatchInvitedUserEnabled
          }
        }
      ]
    });

    const artefactObj = {
      generatedAt: new Date().toISOString(),
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
      settings: {
        sharingCapability,
        isLegacyAuthProtocolsEnabled,
        isResharingByExternalUsersEnabled,
        isRequireAcceptingUserToMatchInvitedUserEnabled
      }
    };

    return {
      id: sharepointAdminSettingsCollector.id,
      status: "ok",
      summary: {
        isComplete,
        sharingCapability
      },
      artefacts: [
        {
          type: "json" as const,
          filename: "sharepoint-admin-settings.json",
          contentType: "application/json",
          content: JSON.stringify(artefactObj, null, 2)
        }
      ]
    };
  }
};
