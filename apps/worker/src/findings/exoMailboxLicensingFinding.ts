// apps/worker/src/findings/exoMailboxLicensingFinding.ts

import type { FindingDerivation, DerivedFinding } from "./types";

function asNumber(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export const exoMailboxLicensingFinding: FindingDerivation = {
  id: "exo.mailboxes.licensing-pressure",

  // 🔑 REQUIRED: declare which finding checkIds this derivation owns
  emits: ["EXO_LICENSE_001"],

  derive({ observedChecks }): DerivedFinding[] {
    // Source checks emitted by exchange.mailboxes.inventory collector
    const sizeObs = observedChecks.find((o) => o.checkId === "EXO_MAILBOXES_OBS_001");
    const signalObs = observedChecks.find((o) => o.checkId === "EXO_MAILBOXES_OBS_010");

    const totalMailboxes = asNumber(sizeObs?.data?.totalMailboxes);
    const near =
      asNumber(sizeObs?.data?.sizeBuckets?.["40to50GB"]) ??
      asNumber(signalObs?.data?.nearLimit40to50GB) ??
      0;

    const over =
      asNumber(sizeObs?.data?.sizeBuckets?.over50GB) ??
      asNumber(signalObs?.data?.over50GB) ??
      0;

    // No pressure → no finding
    if (!(near > 0 || over > 0)) return [];

    const title =
      over > 0
        ? "Mailbox licensing pressure: over 50GB detected"
        : "Mailbox licensing pressure: nearing 50GB detected";

    const recommendation =
      over > 0
        ? "Some mailboxes exceed 50GB. When scoping, validate Exchange Online licensing and storage limits to avoid future quota-related support issues."
        : "Some mailboxes are approaching 50GB. When scoping, validate Exchange Online licensing and storage limits to avoid future quota-related support issues.";

    return [
      {
        checkId: "EXO_LICENSE_001",
        severity: "info",
        title,
        recommendation,
        confidence: "medium"
      }
    ];
  }
};
