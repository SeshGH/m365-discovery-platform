﻿import type { Collector } from "./types";
import { getGraphAccessToken, graphGetAllPages } from "./graph";

type GraphSp = {
  id: string;
  appId?: string | null;
  displayName?: string | null;
  accountEnabled?: boolean | null;
};

type AppRoleAssignment = {
  id: string;
  principalId?: string | null;
  resourceId?: string | null;
  appRoleId?: string | null;
};

type OAuth2PermissionGrant = {
  id: string;
  clientId?: string | null;
  consentType?: string | null;
  principalId?: string | null;
  resourceId?: string | null;
  scope?: string | null;
};

type ServicePrincipal = GraphSp & {
  appRoles?: Array<{
    id: string;
    value?: string | null;
    displayName?: string | null;
    description?: string | null;
    isEnabled?: boolean | null;
    origin?: string | null;
    allowedMemberTypes?: string[] | null;
  }>;
};

function uniqStrings(values: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    const s = String(v).trim();
    if (s) set.add(s);
  }
  return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
}

function splitScopes(scope: string | null | undefined): string[] {
  if (!scope) return [];
  return scope
    .split(" ")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Extremely lightweight “risky” heuristic list (demo-friendly).
// Contract is that this is only a bounded signal, not a full risk engine.
const RISKY_GRAPH_APP_PERMS = new Set<string>([
  "Application.ReadWrite.All",
  "AppRoleAssignment.ReadWrite.All",
  "Directory.ReadWrite.All",
  "Group.ReadWrite.All",
  "RoleManagement.ReadWrite.Directory",
  "User.ReadWrite.All",
  "Policy.ReadWrite.ConditionalAccess",
  "Policy.ReadWrite.AuthenticationMethod",
  "AuditLog.Read.All",
  "SecurityEvents.Read.All"
]);

function classifyRisky(applicationPermissions: string[], delegatedPermissions: string[]): string[] {
  const risky = new Set<string>();

  for (const p of applicationPermissions) {
    if (RISKY_GRAPH_APP_PERMS.has(p)) risky.add(p);
  }

  // Delegated can still be powerful, but we keep it conservative for now.
  for (const p of delegatedPermissions) {
    if (RISKY_GRAPH_APP_PERMS.has(p)) risky.add(p);
  }

  return Array.from(risky.values()).sort((a, b) => a.localeCompare(b));
}

export const enterpriseAppPermissionsCollector: Collector = {
  id: "entra.enterpriseApps.permissions",
  displayName: "Entra Enterprise Apps (Permissions)",
  async run(ctx) {
    const tenantId = ctx.tenant.tenantGuid;
    const token = await getGraphAccessToken({ tenantId });

    const rawProfile = (ctx.run as any)?.dataProfile;
    const dataProfile: "safe" | "full" = rawProfile === "full" ? "full" : "safe";
    const includeSensitive = dataProfile === "full";

    const maxAppsEnv = process.env.EAP_MAX_APPS;
    const maxApps = maxAppsEnv ? Number(maxAppsEnv) : 100;
    const cap = Number.isFinite(maxApps) && maxApps > 0 ? maxApps : 100;

    const allSps = await graphGetAllPages<GraphSp>(
      token,
      "https://graph.microsoft.com/v1.0/servicePrincipals?$select=id,appId,displayName,accountEnabled"
    );

    // Optional cap (demo guardrails)
    const scanned = allSps.slice(0, cap);
    const truncated = allSps.length > scanned.length;

    const apps: Array<{
      appId: string;
      displayName: string;
      servicePrincipalId: string;
      applicationPermissions: string[];
      delegatedPermissions: string[];
      risky: string[];
      accountEnabled: boolean | null;
    }> = [];

    for (const sp of scanned) {
      // Pull assignments and grants for each service principal (bounded by cap)
      const appRoleAssignments = await graphGetAllPages<AppRoleAssignment>(
        token,
        `https://graph.microsoft.com/v1.0/servicePrincipals/${encodeURIComponent(sp.id)}/appRoleAssignedTo?$select=id,principalId,resourceId,appRoleId`
      );

      const oauth2Grants = await graphGetAllPages<OAuth2PermissionGrant>(
        token,
        `https://graph.microsoft.com/v1.0/servicePrincipals/${encodeURIComponent(sp.id)}/oauth2PermissionGrants?$select=id,clientId,consentType,principalId,resourceId,scope`
      );

      // Resolve resource service principals referenced in assignments/grants.
      const resourceIds = uniqStrings([
        ...appRoleAssignments.map((a) => a.resourceId),
        ...oauth2Grants.map((g) => g.resourceId)
      ]);

      const resourceSps: Record<string, ServicePrincipal> = {};

      for (const rid of resourceIds) {
        // we need appRoles to map appRoleId -> value/displayName for application perms
        const rspArr = await graphGetAllPages<ServicePrincipal>(
          token,
          `https://graph.microsoft.com/v1.0/servicePrincipals/${encodeURIComponent(rid)}?$select=id,appId,displayName&$expand=appRoles`
        );
        const rsp = rspArr[0];
        if (rsp) resourceSps[rid] = rsp;
      }

      // Application permissions: appRoleAssignedTo where resource is Graph and role maps to value
      const applicationPermissions: string[] = [];
      for (const a of appRoleAssignments) {
        const resource = a.resourceId ? resourceSps[a.resourceId] : undefined;
        if (!resource || !a.appRoleId) continue;

        // Only interpret Graph perms if resource is Graph (appId well-known)
        const isGraph = String(resource.appId ?? "").toLowerCase() === "00000003-0000-0000-c000-000000000000";
        if (!isGraph) continue;

        const role = Array.isArray(resource.appRoles)
          ? resource.appRoles.find((r) => String(r.id).toLowerCase() === String(a.appRoleId).toLowerCase())
          : undefined;

        if (role?.value) applicationPermissions.push(role.value);
      }

      // Delegated permissions: oauth2PermissionGrants scope strings, scoped to Graph only
      const delegatedPermissions: string[] = [];
      for (const g of oauth2Grants) {
        const resource = g.resourceId ? resourceSps[g.resourceId] : undefined;
        if (!resource) continue;

        const isGraph = String(resource.appId ?? "").toLowerCase() === "00000003-0000-0000-c000-000000000000";
        if (!isGraph) continue;

        delegatedPermissions.push(...splitScopes(g.scope));
      }

      const appPerms = uniqStrings(applicationPermissions);
      const delPerms = uniqStrings(delegatedPermissions);
      const risky = classifyRisky(appPerms, delPerms);

      apps.push({
        appId: sp.appId ?? "",
        displayName: sp.displayName ?? "",
        servicePrincipalId: sp.id,
        applicationPermissions: appPerms,
        delegatedPermissions: delPerms,
        risky,
        accountEnabled: sp.accountEnabled ?? null
      });
    }

    const riskyApps = apps.filter((a) => a.risky.length > 0).length;

    // Observed check (counts only)
    await ctx.prisma.observedCheck.deleteMany({
      where: {
        runId: ctx.run.id,
        jobId: ctx.job?.id ?? null,
        checkId: { in: ["ENTRA_EAP_OBS_001"] }
      }
    });

    await ctx.prisma.observedCheck.createMany({
      data: [
        {
          runId: ctx.run.id,
          jobId: ctx.job?.id ?? null,
          checkId: "ENTRA_EAP_OBS_001",
          collectorId: enterpriseAppPermissionsCollector.id,
          ruleId: null,
          data: {
            profile: dataProfile,
            totalEnterpriseApps: allSps.length,
            scannedApps: scanned.length,
            riskyApps,
            truncated,
            maxApps: cap
          } as any,
          references: [] as any
        }
      ]
    });

    // Findings (bounded)
    if (riskyApps > 0) {
      await ctx.prisma.finding.create({
        data: {
          runId: ctx.run.id,
          jobId: ctx.job.id,
          checkId: "ENTRA_EAP_001",
          category: "application_permissions",
          severity: "high",
          confidence: "medium",
          status: "open",
          score: 0,
          title: "High-privilege Graph permissions detected",
          description:
            "One or more enterprise applications have high-privilege Microsoft Graph permissions. These permissions can represent significant tenant-wide impact depending on how the application is secured and used.",
          recommendation:
            "Review high-privilege application permissions: validate business justification, ensure application ownership is known, confirm credential hygiene (certificates/secrets), and remove unused permissions.",
          evidence: {
            riskyApps,
            scannedApps: scanned.length,
            totalEnterpriseApps: allSps.length,
            truncated
          }
        }
      });
    }

    if (truncated) {
      await ctx.prisma.finding.create({
        data: {
          runId: ctx.run.id,
          jobId: ctx.job.id,
          checkId: "ENTRA_EAP_002",
          category: "other",
          severity: "info",
          confidence: "high",
          status: "open",
          score: 0,
          title: "Enterprise app scan truncated",
          description:
            "The enterprise application permissions scan was truncated due to configured guardrails. Results may be incomplete and should be interpreted as a subset.",
          recommendation:
            "If you need a complete view, increase the scan cap in a controlled environment and re-run discovery.",
          evidence: {
            scannedApps: scanned.length,
            totalEnterpriseApps: allSps.length,
            maxApps: cap
          }
        }
      });
    }

    const safeArtefact = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        profile: "safe",
        tenant: {
          tenantGuid: ctx.tenant.tenantGuid,
          primaryDomain: ctx.tenant.primaryDomain,
          displayName: ctx.tenant.displayName
        },
        summary: {
          totalEnterpriseApps: allSps.length,
          scannedApps: scanned.length,
          riskyApps,
          truncated,
          maxApps: cap
        },
        // Safe-by-design: we include only permission names and app identifiers (no owners/creds)
        apps: apps.map((a) => ({
          appId: a.appId,
          displayName: a.displayName,
          servicePrincipalId: a.servicePrincipalId,
          applicationPermissions: a.applicationPermissions,
          delegatedPermissions: a.delegatedPermissions,
          risky: a.risky,
          accountEnabled: a.accountEnabled
        }))
      },
      null,
      2
    );

    // For now, full artefact is the same shape; future work can enrich with additional evidence.
    const fullArtefact = includeSensitive
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
              totalEnterpriseApps: allSps.length,
              scannedApps: scanned.length,
              riskyApps,
              truncated,
              maxApps: cap
            },
            apps
          },
          null,
          2
        )
      : null;

    return {
      id: enterpriseAppPermissionsCollector.id,
      status: "ok",
      summary: {
        profile: dataProfile,
        totalEnterpriseApps: allSps.length,
        scannedApps: scanned.length,
        riskyApps,
        truncated,
        maxApps: cap,
        fullExported: includeSensitive
      },
      artefacts: [
        {
          type: "json" as const,
          filename: includeSensitive ? "enterprise-app-permissions.safe.json" : "enterprise-app-permissions.json",
          contentType: "application/json",
          content: Buffer.from(safeArtefact, "utf-8")
        },
        ...(includeSensitive && fullArtefact
          ? [
              {
                type: "json" as const,
                filename: "enterprise-app-permissions.full.json",
                contentType: "application/json",
                content: Buffer.from(fullArtefact, "utf-8")
              }
            ]
          : [])
      ]
    };
  }
};
