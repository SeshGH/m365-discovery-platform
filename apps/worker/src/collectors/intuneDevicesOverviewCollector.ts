// apps/worker/src/collectors/intuneDevicesOverviewCollector.ts

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

type GraphManagedDevice = {
  id: string;
  operatingSystem?: string | null;
  complianceState?: string | null;
};

type GraphPage<T> = {
  value: T[];
  "@odata.nextLink"?: string;
};

/* ---------- helpers ---------- */

// Known compliance state values from Graph API
const KNOWN_COMPLIANCE_STATES = [
  "compliant",
  "noncompliant",
  "inGracePeriod",
  "unknown",
  "notApplicable",
  "conflict"
] as const;

type ComplianceKey = (typeof KNOWN_COMPLIANCE_STATES)[number];

function normaliseOS(os: string | null | undefined): "windows" | "ios" | "android" | "macOS" | "other" {
  if (!os) return "other";
  const l = os.toLowerCase().trim();
  if (l === "windows") return "windows";
  if (l === "ios") return "ios";
  if (l === "android") return "android";
  if (l === "macos" || l === "mac os" || l === "mac os x") return "macOS";
  return "other";
}

/* ---------- collector ---------- */

export const intuneDevicesOverviewCollector: Collector = {
  id: "intune.devices.overview",
  displayName: "Intune – Managed Device Overview",

  async run(ctx) {
    const envCap = process.env.INTUNE_MAX_DEVICES ? Number(process.env.INTUNE_MAX_DEVICES) : null;
    const devicesCap =
      envCap !== null && Number.isFinite(envCap) && envCap > 0 ? envCap : 1000;

    let isComplete = true;
    let truncated = false;
    const permissionDenied: string[] = [];
    const notes: string[] = [];

    // Aggregate on the fly — never store the full device list
    const complianceCounts: Record<ComplianceKey, number> = {
      compliant: 0,
      noncompliant: 0,
      inGracePeriod: 0,
      unknown: 0,
      notApplicable: 0,
      conflict: 0
    };
    const osCounts = { windows: 0, ios: 0, android: 0, macOS: 0, other: 0 };
    let totalEnumerated = 0;

    try {
      const token = await getGraphAccessToken({ tenantId: ctx.tenant.tenantGuid });

      let nextUrl: string | undefined =
        "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices" +
        "?$select=id,operatingSystem,complianceState&$top=999";

      while (nextUrl && !truncated) {
        const page = await graphGet<GraphPage<GraphManagedDevice>>(token, nextUrl);

        for (const device of page.value ?? []) {
          // Compliance state
          const cs =
            typeof device.complianceState === "string" && device.complianceState.length > 0
              ? device.complianceState
              : "unknown";
          if ((KNOWN_COMPLIANCE_STATES as readonly string[]).includes(cs)) {
            complianceCounts[cs as ComplianceKey]++;
          } else {
            complianceCounts.unknown++;
          }

          // OS
          osCounts[normaliseOS(device.operatingSystem)]++;

          totalEnumerated++;

          if (totalEnumerated >= devicesCap) {
            truncated = true;
            notes.push(
              `Device enumeration capped at ${devicesCap} (INTUNE_MAX_DEVICES). Counts reflect the first ${devicesCap} devices only. Increase the cap to enumerate more.`
            );
            break;
          }
        }

        nextUrl = truncated ? undefined : page["@odata.nextLink"];
      }

      if (!truncated) {
        notes.push(
          `Device inventory complete. ${totalEnumerated} device${totalEnumerated === 1 ? "" : "s"} enumerated.`
        );
      }
    } catch (e: unknown) {
      if (e instanceof GraphHttpError && e.status === 403) {
        isComplete = false;
        permissionDenied.push("microsoft.graph/deviceManagement/managedDevices");
        notes.push(
          "Graph returned 403 when enumerating managed devices. This typically indicates the DeviceManagementManagedDevices.Read.All application permission has not been granted or consented."
        );
      } else {
        isComplete = false;
        notes.push("Intune managed device enumeration failed unexpectedly.");
      }
    }

    // Counts are null when we have no data (permission denied or unexpected failure).
    // They are numeric (including 0) when the API responded successfully.
    const hasData = isComplete || totalEnumerated > 0;

    const counts = hasData
      ? {
          total: totalEnumerated,
          compliant: complianceCounts.compliant,
          noncompliant: complianceCounts.noncompliant,
          inGracePeriod: complianceCounts.inGracePeriod,
          unknown: complianceCounts.unknown,
          notApplicable: complianceCounts.notApplicable,
          conflict: complianceCounts.conflict
        }
      : {
          total: null,
          compliant: null,
          noncompliant: null,
          inGracePeriod: null,
          unknown: null,
          notApplicable: null,
          conflict: null
        };

    const byOS = hasData
      ? {
          windows: osCounts.windows,
          ios: osCounts.ios,
          android: osCounts.android,
          macOS: osCounts.macOS,
          other: osCounts.other
        }
      : { windows: null, ios: null, android: null, macOS: null, other: null };

    await recordObservedChecks({
      prisma: ctx.prisma,
      runId: ctx.run.id,
      jobId: ctx.job?.id ?? null,
      collectorId: intuneDevicesOverviewCollector.id,
      checks: [
        {
          checkId: "MDM_DEVICES_OBS_001",
          data: {
            isComplete,
            truncated,
            permissionDenied,
            notes,
            devicesCap,
            counts,
            byOS
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
        truncated,
        permissionDenied,
        notes,
        devicesCap
      },
      summary: {
        counts,
        byOS
      }
    };

    return {
      id: intuneDevicesOverviewCollector.id,
      status: "ok",
      summary: {
        isComplete,
        truncated,
        totalEnumerated
      },
      artefacts: [
        {
          type: "json" as const,
          filename: "intune-devices-overview.json",
          contentType: "application/json",
          content: JSON.stringify(artefactObj, null, 2)
        }
      ]
    };
  }
};
