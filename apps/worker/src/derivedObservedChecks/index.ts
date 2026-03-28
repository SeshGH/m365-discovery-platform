// apps/worker/src/derivedObservedChecks/index.ts
//
// Second-stage derivation pipeline: Derived Observed Checks.
//
// Derived Observed Checks (derived OBS) are ObservedCheck records that are
// NOT written directly by a collector.  They are computed AFTER all collector
// jobs are terminal, by reading artefact content from S3 and distilling it
// into structured signals that the findings derivation layer can consume
// without direct S3 access.
//
// Pipeline order (enforced in apps/worker/src/index.ts):
//   collectors → raw OBS → derived OBS (this module) → findings
//
// Derived OBS are stored in the ObservedCheck table with jobId: null.
// A derived OBS is emitted ONLY when its source artefact is complete
// (not permission-denied, not truncated, not missing).  Absence of a derived
// OBS therefore signals incompleteness; findings must treat it as a guard.
//
// ─── Current derived OBS ──────────────────────────────────────────────────────
//
//   ENTRA_CA_DERIVED_001 — Conditional Access MFA coverage signal
//     Source: conditional-access-policies.safe.json artefact
//     Payload: { hasAnyEnabledPolicy, hasAnyMfaPolicy, hasEnabledMfaForAllUsers }
//
// ─── Adding new derived OBS ────────────────────────────────────────────────────
//
//   1. Define the artefact filename constant.
//   2. Write a pure `evaluate*` function that takes the relevant data slice.
//   3. Add a derivation block inside `deriveSecondaryObservedChecksForRun`.
//   4. Export the evaluate function for unit testing.

import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";

// ─── Safe artefact types (subset used for derivation) ─────────────────────────

type SafePolicy = {
  state?: string | null;
  conditions?: {
    users?: {
      targetsAllUsers?: boolean;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  grantControls?: {
    builtInControls?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type SafeArtefactBody = {
  summary?: {
    permissionDenied?: boolean;
    truncated?: boolean;
    [key: string]: unknown;
  };
  policies?: SafePolicy[];
  [key: string]: unknown;
};

// ─── ENTRA_CA_DERIVED_001 payload ─────────────────────────────────────────────

export type EntraCaDerivedPayload = {
  /** At least one policy with state === "enabled" exists */
  hasAnyEnabledPolicy: boolean;
  /** At least one policy with "mfa" in builtInControls exists (any state) */
  hasAnyMfaPolicy: boolean;
  /**
   * At least one policy that is ENABLED, has "mfa" in builtInControls, AND
   * targets all users (conditions.users.targetsAllUsers === true) exists.
   *
   * Note: role-targeted policies (e.g., targeting the Global Administrator
   * directory role via includeRoles) are NOT detected here because includeRoles
   * IDs are stripped from the safe artefact profile.  This produces conservative
   * false negatives (fails to credit role-targeted protection) but never false
   * positives.
   */
  hasEnabledMfaForAllUsers: boolean;
};

// ─── Pure evaluation ──────────────────────────────────────────────────────────

/**
 * Evaluates a slice of CA policy objects and returns the ENTRA_CA_DERIVED_001
 * payload.
 *
 * Assumes the caller has already confirmed the source artefact is complete
 * (not permission-denied, not truncated).  This function is pure (no I/O)
 * and is exported for unit testing.
 */
export function evaluateCaArtefact(policies: SafePolicy[]): EntraCaDerivedPayload {
  const hasAnyEnabledPolicy = policies.some((p) => p.state === "enabled");

  const hasAnyMfaPolicy = policies.some((p) =>
    (p.grantControls?.builtInControls ?? []).some(
      (c) => (c ?? "").toLowerCase() === "mfa"
    )
  );

  const hasEnabledMfaForAllUsers = policies.some(
    (p) =>
      p.state === "enabled" &&
      (p.grantControls?.builtInControls ?? []).some(
        (c) => (c ?? "").toLowerCase() === "mfa"
      ) &&
      p.conditions?.users?.targetsAllUsers === true
  );

  return { hasAnyEnabledPolicy, hasAnyMfaPolicy, hasEnabledMfaForAllUsers };
}

// ─── S3 helper ────────────────────────────────────────────────────────────────

async function readS3Object(s3: S3Client, bucket: string, key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3.send(cmd);

  const stream = response.Body;
  if (!stream) throw new Error(`Empty S3 response body for key=${key}`);

  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// ─── Derivation constants ─────────────────────────────────────────────────────

const ENTRA_CA_DERIVED_CHECK_ID = "ENTRA_CA_DERIVED_001";
const ENTRA_CA_DERIVED_COLLECTOR_ID = "derived.conditionalAccess.mfaCoverage";
const CA_SAFE_ARTEFACT_FILENAME = "conditional-access-policies.safe.json";

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Derives and persists secondary Observed Checks for a run.
 *
 * Must be called AFTER all collector jobs are terminal and BEFORE
 * `deriveAndPersistFindingsForRun`.  Safe to call multiple times — each
 * derived OBS block is idempotent (delete-then-insert).
 *
 * A derived OBS is emitted ONLY when its source data is complete.  Callers
 * (findings derivations) treat absence of a derived OBS as a completeness
 * guard failure.
 *
 * Non-fatal: any error inside a derivation block is silently swallowed.
 * Partial failures do not propagate — the caller receives no error.
 */
export async function deriveSecondaryObservedChecksForRun(params: {
  prisma: any;
  runId: string;
  s3: S3Client;
  bucket: string;
}): Promise<{ derived: string[] }> {
  const { prisma, runId, s3, bucket } = params;
  const derived: string[] = [];

  // ── ENTRA_CA_DERIVED_001: Conditional Access MFA coverage ─────────────────

  try {
    // Locate the safe CA artefact DB record for this run.
    // Key pattern: runs/{runId}/jobs/{jobId}/conditional-access-policies.safe.json
    const caArtefact = await prisma.artefact.findFirst({
      where: {
        runId,
        key: { endsWith: `/${CA_SAFE_ARTEFACT_FILENAME}` }
      }
    });

    if (caArtefact) {
      let content: string;
      try {
        content = await readS3Object(s3, bucket, caArtefact.key);
      } catch {
        // S3 read failure — skip this derived OBS silently.
        content = "";
      }

      if (content) {
        let artefactBody: SafeArtefactBody | null = null;
        try {
          artefactBody = JSON.parse(content) as SafeArtefactBody;
        } catch {
          // JSON parse failure — skip.
        }

        if (artefactBody) {
          // Guard: incomplete artefact must not produce a derived OBS.
          // Absence of the OBS is itself the completeness signal to findings.
          const permissionDenied = artefactBody.summary?.permissionDenied === true;
          const truncated = artefactBody.summary?.truncated === true;

          if (!permissionDenied && !truncated) {
            const policies: SafePolicy[] = Array.isArray(artefactBody.policies)
              ? artefactBody.policies
              : [];

            const payload = evaluateCaArtefact(policies);

            // Idempotent upsert: delete previous, then insert fresh.
            await prisma.observedCheck.deleteMany({
              where: { runId, jobId: null, checkId: ENTRA_CA_DERIVED_CHECK_ID }
            });

            await prisma.observedCheck.createMany({
              data: [
                {
                  runId,
                  jobId: null,
                  checkId: ENTRA_CA_DERIVED_CHECK_ID,
                  collectorId: ENTRA_CA_DERIVED_COLLECTOR_ID,
                  ruleId: null,
                  data: payload as any,
                  references: [] as any
                }
              ]
            });

            derived.push(ENTRA_CA_DERIVED_CHECK_ID);
          }
        }
      }
    }
  } catch {
    // Any unexpected error in this derivation block must not propagate.
    // The findings pipeline will proceed without ENTRA_CA_DERIVED_001.
  }

  return { derived };
}
