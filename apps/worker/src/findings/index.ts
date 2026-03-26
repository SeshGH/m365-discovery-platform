// apps/worker/src/findings/index.ts
import type { FindingDerivation, ObservedCheckLike } from "./types";
import { exoMailboxLicensingFinding } from "./exoMailboxLicensingFinding";
import { spoSharingFinding } from "./spoSharingFinding";
import { mdmComplianceFinding } from "./mdmComplianceFinding";
import { eapHighPrivFinding } from "./eapHighPrivFinding";
import { entraDirectoryRolesFinding } from "./entraDirectoryRolesFinding";

// Registry (single source of truth)
const DERIVATIONS: FindingDerivation[] = [
  exoMailboxLicensingFinding,
  spoSharingFinding,
  mdmComplianceFinding,
  eapHighPrivFinding,
  entraDirectoryRolesFinding
];

function uniq(xs: string[]) {
  return Array.from(new Set(xs)).filter(Boolean);
}

export async function deriveAndPersistFindingsForRun(params: {
  prisma: any;
  runId: string;
  observedChecks?: ObservedCheckLike[];
}) {
  const { prisma, runId } = params;

  // Allow caller to pass observed checks to avoid requery, but support fallback.
  const observedChecks: ObservedCheckLike[] =
    params.observedChecks ??
    (await prisma.observedCheck.findMany({
      where: { runId }
    }));

  // We keep this idempotent by:
  // 1) deleting previous derived findings for the derivations we own
  // 2) inserting the newly derived findings
  const ownedCheckIds = uniq(DERIVATIONS.flatMap((d) => d.emits));

  if (ownedCheckIds.length > 0) {
    await prisma.finding.deleteMany({
      where: {
        runId,
        // derived findings are jobless + ruleless
        jobId: null,
        ruleId: null,
        checkId: { in: ownedCheckIds }
      }
    });
  }

  const derived = DERIVATIONS.flatMap((d) => d.derive({ observedChecks }));

  if (derived.length === 0) {
    return { deletedOwned: ownedCheckIds.length, inserted: 0 };
  }

  // Insert as derived findings (jobId/ruleId null)
  // Note: Finding has no unique constraint, so we enforce idempotency above.
  await prisma.finding.createMany({
    data: derived.map((f) => ({
      runId,
      jobId: null,
      ruleId: null,
      checkId: f.checkId,
      severity: f.severity,
      title: f.title,
      description: (f as any).description ?? f.title,
      recommendation: f.recommendation ?? null,

      // Optional fields (won’t break if Prisma schema lacks them, but to be safe
      // we only attach them if present via "as any")
      ...(f.category != null ? { category: f.category } : {}),
      ...(f.confidence != null ? { confidence: f.confidence } : {}),
      ...(f.status != null ? { status: f.status } : {}),
      ...(f.score != null ? { score: f.score } : {}),
      ...(f.references != null ? { references: f.references } : {})
    })) as any
  });

  return { deletedOwned: ownedCheckIds.length, inserted: derived.length };
}
