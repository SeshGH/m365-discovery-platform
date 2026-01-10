import type { Collector } from "./types";
import { getGraphAccessToken, graphGetAllPages } from "./graph";

type ServicePrincipal = {
  id: string;
  appId?: string | null;
  displayName?: string | null;
  servicePrincipalType?: string | null;
  accountEnabled?: boolean | null;
};

type AppRole = {
  id: string;
  value?: string | null;
  isEnabled?: boolean | null;
};

type GraphSpWithRoles = {
  id: string;
  appId?: string | null;
  displayName?: string | null;
  appRoles?: AppRole[];
};

type AppRoleAssignment = {
  id: string;
  appRoleId: string;
  resourceId: string;
  principalId: string;
  createdDateTime?: string;
};

type OAuth2PermissionGrant = {
  id: string;
  clientId: string;
  resourceId: string;
  scope?: string | null; // space-separated
  consentType?: string | null;
  principalId?: string | null; // null for AllPrincipals
};

const GRAPH_APP_ID = "00000003-0000-0000-c000-000000000000";

const RISKY_PERMISSIONS = new Set<string>([
  "Directory.ReadWrite.All",
  "Directory.AccessAsUser.All",
  "RoleManagement.ReadWrite.Directory",
  "Application.ReadWrite.All",
  "AppRoleAssignment.ReadWrite.All",
  "DelegatedPermissionGrant.ReadWrite.All",
  "Policy.ReadWrite.ConditionalAccess",
  "PrivilegedAccess.ReadWrite.AzureAD",
  "User.ReadWrite.All"
]);

function splitScopes(scope: string | null | undefined): string[] {
  if (!scope) return [];
  return scope
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean);
}

function limitConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;

  return new Promise((resolve, reject) => {
    let active = 0;

    const next = () => {
      if (idx >= items.length && active === 0) return resolve(results);

      while (active < limit && idx < items.length) {
        const currentIndex = idx++;
        active++;

        fn(items[currentIndex])
          .then((r) => {
            results[currentIndex] = r;
            active--;
            next();
          })
          .catch(reject);
      }
    };

    next();
  });
}

export const enterpriseAppPermissionsCollector: Collector = {
  id: "entra.enterpriseApps.permissions",
  displayName: "Enterprise App Permissions",
  async run(ctx) {
    const tenantId = ctx.tenant.tenantGuid;
    const token = await getGraphAccessToken({ tenantId });

    // 1) Load Microsoft Graph service principal (to resolve appRoleId -> permission value)
    const graphSpList = await graphGetAllPages<GraphSpWithRoles>(
      token,
      `https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId eq '${GRAPH_APP_ID}'&$select=id,appId,displayName,appRoles`
    );

    const graphSp = graphSpList[0];
    if (!graphSp?.id) {
      throw new Error(
        "[enterprise-apps] Could not resolve Microsoft Graph service principal"
      );
    }

    const graphRoleMap = new Map<string, string>();
    for (const role of graphSp.appRoles ?? []) {
      if (role?.id && role?.value) graphRoleMap.set(role.id, role.value);
    }

    // 2) List service principals (enterprise apps)
    const sps = await graphGetAllPages<ServicePrincipal>(
      token,
      "https://graph.microsoft.com/v1.0/servicePrincipals?$select=id,appId,displayName,servicePrincipalType,accountEnabled"
    );

    const enterpriseApps = sps.filter(
      (sp) => (sp.servicePrincipalType ?? "").toLowerCase() === "application"
    );

    // 3) For each app: fetch appRoleAssignments + oauth2PermissionGrants
    const MAX_APPS = Number(process.env.ENTAPP_MAX_APPS ?? 50);
    const CONCURRENCY = Number(process.env.ENTAPP_CONCURRENCY ?? 5);

    const targetApps = enterpriseApps.slice(0, MAX_APPS);

    type AppPermissionReport = {
      id: string;
      displayName?: string | null;
      appId?: string | null;
      accountEnabled?: boolean | null;
      applicationPermissions: string[];
      delegatedPermissions: string[];
      raw: {
        graphAppRoleAssignments: AppRoleAssignment[];
        graphOauth2Grants: OAuth2PermissionGrant[];
      };
      risky: string[];
    };

    const reports = await limitConcurrency(targetApps, CONCURRENCY, async (sp) => {
      const appRoleAssignments = await graphGetAllPages<AppRoleAssignment>(
        token,
        `https://graph.microsoft.com/v1.0/servicePrincipals/${sp.id}/appRoleAssignments?$select=id,appRoleId,resourceId,principalId,createdDateTime`
      );

      const graphAssignments = appRoleAssignments.filter(
        (a) => a.resourceId === graphSp.id
      );

      const appPerms = graphAssignments
        .map((a) => graphRoleMap.get(a.appRoleId) ?? a.appRoleId)
        .filter(Boolean);

      const grants = await graphGetAllPages<OAuth2PermissionGrant>(
        token,
        `https://graph.microsoft.com/v1.0/oauth2PermissionGrants?$filter=clientId eq '${sp.id}'&$select=id,clientId,resourceId,scope,consentType,principalId`
      );

      const graphGrants = grants.filter((g) => g.resourceId === graphSp.id);
      const delegated = graphGrants.flatMap((g) => splitScopes(g.scope));

      const riskyFound = [...new Set([...appPerms, ...delegated])].filter((p) =>
        RISKY_PERMISSIONS.has(p)
      );

      return {
        id: sp.id,
        displayName: sp.displayName,
        appId: sp.appId,
        accountEnabled: sp.accountEnabled,
        applicationPermissions: [...new Set(appPerms)].sort(),
        delegatedPermissions: [...new Set(delegated)].sort(),
        raw: {
          graphAppRoleAssignments: graphAssignments,
          graphOauth2Grants: graphGrants
        },
        risky: riskyFound.sort()
      } satisfies AppPermissionReport;
    });

    // 4) Write findings for risky apps
    const riskyApps = reports.filter((r) => r.risky.length > 0);

    if (riskyApps.length > 0) {
      await ctx.prisma.finding.createMany({
        data: riskyApps.map((app) => ({
          runId: ctx.run.id,
          jobId: ctx.job.id,
          checkId: "ENTRA_EAP_001",
          severity: "high",
          title: `Enterprise App has high-privilege permissions: ${
            app.displayName ?? app.appId ?? app.id
          }`,
          description:
            "This enterprise application has one or more high-privilege Microsoft Graph permissions granted.",
          recommendation:
            "Review and remove unnecessary Graph permissions. Prefer least-privilege scopes/roles and restrict consent. Ensure app owners are known and approvals are governed.",
          evidence: {
            servicePrincipalId: app.id,
            appId: app.appId,
            displayName: app.displayName,
            riskyPermissions: app.risky,
            applicationPermissions: app.applicationPermissions,
            delegatedPermissions: app.delegatedPermissions
          } as any,
          references: ["https://learn.microsoft.com/graph/permissions-reference"] as any
        }))
      });
    }

    // 5) Return a JSON artefact for the report
    const artefactContent = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        tenant: {
          tenantGuid: ctx.tenant.tenantGuid,
          primaryDomain: ctx.tenant.primaryDomain,
          displayName: ctx.tenant.displayName
        },
        summary: {
          scannedApps: reports.length,
          riskyApps: riskyApps.length
        },
        apps: reports
      },
      null,
      2
    );

    return {
      id: "entra.enterpriseApps.permissions",
      status: "ok",
      summary: {
        scannedApps: reports.length,
        riskyApps: riskyApps.length,
        maxApps: MAX_APPS
      },
      artefacts: [
        {
          type: "json",
          filename: "enterprise-app-permissions.json",
          contentType: "application/json",
          content: artefactContent
        }
      ]
    };
  }
};
