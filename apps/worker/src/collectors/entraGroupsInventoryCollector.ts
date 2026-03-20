// apps/worker/src/collectors/entraGroupsInventoryCollector.ts

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

/* ---------- Graph model (minimal — only selected fields) ---------- */

type GraphGroup = {
  id: string;
  groupTypes?: string[] | null;
  mailEnabled?: boolean | null;
  securityEnabled?: boolean | null;
  membershipRule?: string | null;
};

type GraphPage<T> = {
  value: T[];
  "@odata.nextLink"?: string;
};

/* ---------- collector ---------- */

export const entraGroupsInventoryCollector: Collector = {
  id: "entra.groups.inventory",
  displayName: "Entra Groups Inventory",

  async run(ctx) {
    const envCap = process.env.ENTRA_GROUPS_MAX ? Number(process.env.ENTRA_GROUPS_MAX) : null;
    const groupsCap =
      envCap !== null && Number.isFinite(envCap) && envCap > 0 ? envCap : 5000;

    let isComplete = true;
    let truncated = false;
    const permissionDenied: string[] = [];
    const notes: string[] = [];

    // Aggregate on the fly — never store the full group list
    let m365 = 0;
    let security = 0;
    let distribution = 0;
    let mailEnabledSecurity = 0;
    let dynamic = 0;
    let other = 0;
    let totalEnumerated = 0;

    try {
      const token = await getGraphAccessToken({ tenantId: ctx.tenant.tenantGuid });

      let nextUrl: string | undefined =
        "https://graph.microsoft.com/v1.0/groups" +
        "?$select=id,groupTypes,mailEnabled,securityEnabled,membershipRule&$top=999";

      while (nextUrl && !truncated) {
        const page = await graphGet<GraphPage<GraphGroup>>(token, nextUrl);

        for (const g of page.value ?? []) {
          if (totalEnumerated >= groupsCap) {
            truncated = true;
            notes.push(
              `Group enumeration capped at ${groupsCap} (ENTRA_GROUPS_MAX). Counts are indicative.`
            );
            break;
          }

          const types: string[] = Array.isArray(g.groupTypes) ? g.groupTypes : [];
          const isM365 = types.includes("Unified");
          const isSec = g.securityEnabled === true;
          const isMail = g.mailEnabled === true;
          const isDynamic = typeof g.membershipRule === "string" && g.membershipRule.trim().length > 0;

          if (isM365) {
            m365++;
          } else if (isSec && !isMail) {
            security++;
          } else if (!isSec && isMail) {
            distribution++;
          } else if (isSec && isMail) {
            mailEnabledSecurity++;
          } else {
            other++;
          }

          // dynamic is orthogonal — a group can be any type AND dynamic
          if (isDynamic) dynamic++;

          totalEnumerated++;
        }

        nextUrl = truncated
          ? undefined
          : typeof page["@odata.nextLink"] === "string"
            ? page["@odata.nextLink"]
            : undefined;
      }
    } catch (e: unknown) {
      if (e instanceof GraphHttpError && e.status === 403) {
        isComplete = false;
        permissionDenied.push("microsoft.graph/groups:list");
        notes.push(
          "Graph returned 403 when listing groups. This is treated as a data completeness gap (missing app permissions/admin consent), not a hard failure."
        );
      } else {
        throw e;
      }
    }

    const hasData = isComplete || totalEnumerated > 0;
    const totalGroups = hasData ? totalEnumerated : null;

    await recordObservedChecks({
      prisma: ctx.prisma,
      runId: ctx.run.id,
      jobId: ctx.job?.id ?? null,
      collectorId: entraGroupsInventoryCollector.id,
      checks: [
        {
          checkId: "ENTRA_GROUPS_OBS_001",
          data: {
            isComplete,
            truncated,
            permissionDenied,
            notes,
            totalGroups,
            counts: hasData
              ? { m365, security, distribution, mailEnabledSecurity, dynamic, other }
              : null
          },
          references: []
        }
      ]
    });

    const artefact = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        tenant: {
          tenantGuid: ctx.tenant.tenantGuid,
          primaryDomain: ctx.tenant.primaryDomain,
          displayName: ctx.tenant.displayName
        },
        completeness: { isComplete, truncated, permissionDenied, notes },
        summary: {
          totalGroups,
          counts: hasData
            ? { m365, security, distribution, mailEnabledSecurity, dynamic, other }
            : null
        }
      },
      null,
      2
    );

    return {
      id: "entra.groups.inventory",
      status: "ok",
      summary: {
        isComplete,
        truncated,
        totalGroups
      },
      artefacts: [
        {
          type: "json" as const,
          filename: "entra-groups-inventory.json",
          contentType: "application/json",
          content: artefact
        }
      ]
    };
  }
};
