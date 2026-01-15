﻿import type { Collector } from "./types";
import { getGraphAccessToken, graphGetAllPages } from "./graph";

type ServicePrincipal = {
  id: string;
  appId?: string;
  displayName?: string;
  servicePrincipalType?: string;
  accountEnabled?: boolean | null;
};

type GraphSp = {
  appRoles?: Array<{ id?: string; value?: string }>;
  id?: string;
};

type AppRoleAssignment = {
  id: string;
  appRoleId?: string;
  resourceId?: string;
  principalId?: string;
  createdDateTime?: string;
};

type OAuth2PermissionGrant = {
  id: string;
  clientId?: string;
  consentType?: string;
  principalId?: string | null;
  resourceId?: string;
  scope?: string;
};

function parseScopes(scope: string | undefined | null): string[] {
  if (!scope) return [];
  return scope
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean);
}

function limitConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let currentIndex = 0;
  let active = 0;

  return new Promise((resolve, reject) => {
    const next = () => {
      if (currentIndex >= items.length && active === 0) {
        resolve(results);
        return;
      }

      while (active < concurrency && currentIndex < items.length) {
        const idx = currentIndex++;
        active++;

        fn(items[idx])
          .then((r) => {
            results[idx] = r;
            active--;
            next();
          })
          .catch(reject);
      }
    };

    next();
  });
}

const RISKY_PERMS = new Set<string>([
  // Common “high impact” delegated scopes (representative, not exhaustive)
  "Directory.ReadWrite.All",
  "Directory.AccessAsUser.All",
  "RoleManagement.ReadWrite.Directory",
  "User.ReadWrite.All",
  "Group.ReadWrite.All",
  "Policy.ReadWrite.ConditionalAccess",
  "Application.ReadWrite.All",
  "AppRoleAssignment.ReadWrite.All",
  "AuditLog.Read.All",
  "AuditLog.ReadWrite.All",
  "SecurityEvents.Read.All",
  "Mail.Read",
  "Mail.ReadWrite",
  "Mail.Send"
]);

export const enterpriseAppPermissionsCollector: Collector = {
  id: "entra.enterpriseApps.permissions",
  displayName: "Enterprise App Permissions",
  async run(ctx) {
    // Demo-only test hook: slow this collector down to force report job retry/backoff behaviour.
    // Default is 0 (disabled). Set DEMO_DELAY_EAP_MS to e.g. 15000 to delay 15 seconds.
    const DEMO_DELAY_EAP_MS = Number(process.env.DEMO_DELAY_EAP_MS ?? 0);
    if (DEMO_DELAY_EAP_MS > 0) {
      await new Promise((r) => setTimeout(r, DEMO_DELAY_EAP_MS));
    }

    const tenantId = ctx.tenant.tenantGuid;
    const token = await getGraphAccessToken({ tenantId });

    // Collector-level hardening:
    // Only an explicit "full" enables sensitive inventory exports.
    // Any unknown/missing value is treated as "safe".
    const rawProfile = (ctx.run as any)?.dataProfile;
    const dataProfile: "safe" | "full" = rawProfile === "full" ? "full" : "safe";
    const includeSensitive = dataProfile === "full";

    // 1) Load Microsoft Graph service principal (to resolve appRoleId -> permission value)
    const graphSp = await graphGetAllPages<GraphSp>(
      token,
      "https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId eq '00000003-0000-0000-c000-000000000000'&$select=id,appRoles"
    ).then((arr) => arr[0]);

    const graphRoleMap = new Map<string, string>();
    for (const role of graphSp?.appRoles ?? []) {
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

    // Demo-only cap to keep runtimes predictable in CDX and surface truncation as a signal
    const MAX_APPS = Number(process.env.ENTAPP_MAX_APPS ?? 200);
    const CONCURRENCY = Number(process.env.ENTAPP_CONCURRENCY ?? 8);

    const wasTruncated = enterpriseApps.length > MAX_APPS;
    const targetApps = wasTruncated ? enterpriseApps.slice(0, MAX_APPS) : enterpriseApps;

    const totalEnterpriseApps = enterpriseApps.length;

    type AppPermissionReport = {
      id: string;
      displayName: string;
      appId: string;
      accountEnabled: boolean | null;
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
        (a) =>
          (a.resourceId ?? "").toLowerCase() === (graphSp?.id ?? "").toLowerCase()
      );

      const appPerms = graphAssignments
        .map((a) => graphRoleMap.get(a.appRoleId ?? "") ?? "")
        .filter(Boolean);

      const oauth2Grants = await graphGetAllPages<OAuth2PermissionGrant>(
        token,
        `https://graph.microsoft.com/v1.0/servicePrincipals/${sp.id}/oauth2PermissionGrants?$select=id,clientId,consentType,principalId,resourceId,scope`
      );

      const graphGrants = oauth2Grants.filter(
        (g) =>
          (g.resourceId ?? "").toLowerCase() === (graphSp?.id ?? "").toLowerCase()
      );

      const delegated = graphGrants.flatMap((g) => parseScopes(g.scope));

      const risky = [...new Set([...appPerms, ...delegated])].filter((p) =>
        RISKY_PERMS.has(p)
      );

      return {
        id: sp.id,
        displayName: sp.displayName ?? "(unknown)",
        appId: sp.appId ?? "",
        accountEnabled: sp.accountEnabled ?? null,
        applicationPermissions: [...new Set(appPerms)].sort(),
        delegatedPermissions: [...new Set(delegated)].sort(),
        raw: {
          graphAppRoleAssignments: graphAssignments,
          graphOauth2Grants: graphGrants
        },
        risky
      } satisfies AppPermissionReport;
    });

    const riskyApps = reports.filter((r) => r.risky.length > 0);

    // -------------------------
    // Observed check (preferred pattern)
    // -------------------------
    await ctx.prisma.observedCheck.create({
      data: {
        runId: ctx.run.id,
        jobId: ctx.job.id,
        checkId: "ENTRA_EAP_OBS_001",
        collectorId: "entra.enterpriseApps.permissions",
        ruleId: null,
        data: {
          profile: dataProfile,
          totalEnterpriseApps,
          scannedApps: reports.length,
          riskyApps: riskyApps.length,
          truncated: wasTruncated,
          maxApps: MAX_APPS,
          concurrency: CONCURRENCY,
          fullExported: includeSensitive
        },
        references: [] as any
      }
    });

    // 3) Findings
    // ENTRA_EAP_001 — risky permissions exist
    if (riskyApps.length > 0) {
      await ctx.prisma.finding.create({
        data: {
          runId: ctx.run.id,
          jobId: ctx.job.id,
          checkId: "ENTRA_EAP_001",
          severity: "high",
          title: "Risky enterprise application permissions detected",
          description:
            "One or more enterprise applications have been granted high-impact delegated or application permissions.",
          recommendation:
            "Review enterprise application consent and permissions. Remove unnecessary grants, validate least privilege, and enforce admin consent policies.",
          evidence: {
            riskyApps: riskyApps.length,
            scannedApps: reports.length,
            maxApps: MAX_APPS,
            truncated: wasTruncated
          },
          references: [] as any
        }
      });
    }

    // ENTRA_EAP_002 — demo-only truncation signal
    if (wasTruncated) {
      await ctx.prisma.finding.create({
        data: {
          runId: ctx.run.id,
          jobId: ctx.job.id,
          checkId: "ENTRA_EAP_002",
          severity: "info",
          title: "Enterprise app enumeration truncated (demo-only limit)",
          description:
            "Enterprise app enumeration exceeded the configured maximum and was truncated. Results may be incomplete.",
          recommendation:
            "Increase ENTAPP_MAX_APPS or run in an environment where full enumeration is feasible. Treat outputs as incomplete until resolved.",
          evidence: {
            totalEnterpriseApps,
            maxApps: MAX_APPS
          },
          references: [] as any
        }
      });
    }

    // 5) Return a JSON artefact for the report (profile-aware)
    const artefactContent = includeSensitive
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
              totalEnterpriseApps,
              scannedApps: reports.length,
              riskyApps: riskyApps.length,
              truncated: wasTruncated,
              maxApps: MAX_APPS,
              concurrency: CONCURRENCY
            },
            apps: reports
          },
          null,
          2
        )
      : JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            profile: "safe",
            tenant: {
              tenantGuid: ctx.tenant.tenantGuid,
              primaryDomain: ctx.tenant.primaryDomain,
              displayName: ctx.tenant.displayName
            },
            summary: {
              totalEnterpriseApps,
              scannedApps: reports.length,
              riskyApps: riskyApps.length,
              truncated: wasTruncated,
              maxApps: MAX_APPS,
              concurrency: CONCURRENCY
            },
            // Safe profile: only export a minimal list of risky apps (no full permission inventory).
            riskyApps: riskyApps.map((app) => ({
              id: app.id,
              displayName: app.displayName,
              appId: app.appId,
              accountEnabled: app.accountEnabled,
              riskyPermissions: app.risky
            }))
          },
          null,
          2
        );

    return {
      id: "entra.enterpriseApps.permissions",
      status: "ok",
      summary: {
        profile: dataProfile,
        totalEnterpriseApps,
        scannedApps: reports.length,
        riskyApps: riskyApps.length,
        truncated: wasTruncated,
        maxApps: MAX_APPS
      },
      artefacts: [
        {
          type: "json",
          filename: includeSensitive
            ? "enterprise-app-permissions.full.json"
            : "enterprise-app-permissions.json",
          contentType: "application/json",
          content: artefactContent
        }
      ]
    };
  }
};
