// apps/worker/src/findings/exoMailboxesCoverageFinding.ts

import type { FindingDerivation, DerivedFinding } from "./types";

export const exoMailboxesCoverageFinding: FindingDerivation = {
  id: "exo.mailboxes.coverage",

  emits: ["EXO_MAILBOXES_COVERAGE_001"],

  derive({ observedChecks }): DerivedFinding[] {
    const obs = observedChecks.find((o) => o.checkId === "EXO_MAILBOXES_OBS_001");
    if (!obs) return [];

    // Only emit when collection was attempted but did not complete.
    if ((obs.data as any)?.isComplete !== false) return [];

    const permissionDenied: string[] =
      Array.isArray((obs.data as any)?.permissionDenied)
        ? (obs.data as any).permissionDenied
        : [];
    const truncated: boolean = (obs.data as any)?.truncated === true;

    const hasPermissionGap = permissionDenied.some((p: string) =>
      p.includes("reports:getMailboxUsageDetail")
    );

    let title: string;
    let severity: "medium" | "low" | "info";

    if (hasPermissionGap) {
      title = "Exchange mailbox usage report unavailable — reporting permissions missing";
      severity = "medium";
    } else if (truncated) {
      title = "Exchange mailbox usage report unavailable";
      severity = "low";
    } else {
      title = "Exchange mailbox usage report unavailable — report data not yet generated";
      severity = "info";
    }

    return [
      {
        checkId: "EXO_MAILBOXES_COVERAGE_001",
        severity,
        title,
        recommendation:
          "Exchange mailbox usage and sizing visibility for this run is unavailable or incomplete. Mailbox count, size distribution, and licensing pressure metrics are absent. If the Reports.Read.All (or equivalent) application permission has not been granted, admin consent is required. If permissions are in place, Exchange reporting may not yet have been initialised — this is common on new or lightly used tenants. Re-running the scan after a short delay usually resolves a report-not-ready condition.",
        references: {
          observedChecks: ["EXO_MAILBOXES_OBS_001"]
        }
      }
    ];
  }
};
