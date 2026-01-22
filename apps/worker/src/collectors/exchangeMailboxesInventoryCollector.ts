import type { Collector } from "./types";

type ObservedCheckInput = {
  checkId: string;
  data: unknown;
  references?: unknown; // stored as Json, usually [] or [{...}]
};

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

/**
 * Exchange Online – Mailbox Inventory (v1)
 *
 * Contract-aligned implementation step:
 * - Emits observed checks + safe artefact with correct shapes
 * - Does NOT call Exchange Online yet
 * - Marks completeness as incomplete (isComplete=false) until implemented
 * - No findings in v1 (observed checks only)
 */
export const exchangeMailboxesInventoryCollector: Collector = {
  id: "exchange.mailboxes.inventory",
  displayName: "Exchange Online – Mailbox Inventory",

  run: async (ctx) => {
    // Data profile handling: unknown values coerced to safe.
    const rawProfile = (ctx.run as any)?.dataProfile;
    const dataProfile: "safe" | "full" = rawProfile === "full" ? "full" : "safe";

    // v1, step 6: no EXO calls yet, so we cannot claim completeness.
    const implemented = false;
    const isComplete = false;
    const truncated = false;

    // Because we haven't attempted EXO slices yet, we do not claim permission denied.
    // When we add EXO calls, permissionDenied will reflect actual blocked slices.
    const permissionDenied: string[] = [];
    const slicesAttempted: string[] = [];
    const slicesCompleted: string[] = [];
    const notes: string[] = [
      "Exchange mailbox inventory is not implemented yet. This job currently emits contract-aligned observed checks and a safe artefact shape only (no Exchange Online calls)."
    ];

    const fullExported = false;

    // Counts/buckets are unknown until EXO enumeration is implemented.
    const summary = {
      totalMailboxes: null as number | null,
      byType: {
        user: null as number | null,
        shared: null as number | null,
        room: null as number | null,
        equipment: null as number | null
      },
      byState: {
        enabled: null as number | null,
        disabled: null as number | null
      },
      sizeBuckets: {
        under1GB: null as number | null,
        "1to10GB": null as number | null,
        "10to50GB": null as number | null,
        over50GB: null as number | null
      }
    };

    // -------------------------
    // Observed checks (counts/buckets + completeness only)
    // -------------------------
    await recordObservedChecks({
      prisma: ctx.prisma,
      runId: ctx.run.id,
      jobId: ctx.job?.id ?? null,
      collectorId: exchangeMailboxesInventoryCollector.id,
      checks: [
        {
          checkId: "EXO_MAILBOXES_OBS_001",
          data: {
            ...summary,
            dataProfile,
            fullExported,
            truncated
          },
          references: []
        },
        {
          checkId: "EXO_MAILBOXES_OBS_002",
          data: {
            isComplete,
            truncated,
            permissionDenied,
            slicesAttempted,
            slicesCompleted,
            notes,
            dataProfile
          },
          references: []
        }
      ]
    });

    // -------------------------
    // Safe artefact (no mailbox identifiers)
    // -------------------------
    const safeArtefact = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        profile: "safe",
        completeness: {
          isComplete,
          truncated,
          permissionDenied,
          slicesAttempted,
          slicesCompleted,
          notes,
          implemented
        },
        summary: {
          ...summary,
          dataProfile,
          fullExported
        }
      },
      null,
      2
    );

    return {
      id: "exchange.mailboxes.inventory",
      status: "ok",
      summary: {
        dataProfile,
        implemented,
        isComplete,
        truncated,
        fullExported
      },
      artefacts: [
        {
          type: "json" as const,
          filename: "exchange-mailboxes-inventory.safe.json",
          contentType: "application/json",
          content: safeArtefact
        }
      ]
    };
  }
};
