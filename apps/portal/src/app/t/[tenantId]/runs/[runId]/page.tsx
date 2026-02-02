// apps/portal/src/app/t/[tenantId]/runs/[runId]/page.tsx
import {
  getRun,
  listRunJobs,
  listRunArtefacts,
  listRunObservedChecks,
  listRunFindings,
  type ObservedCheckItem,
  type JobListItem,
  type ArtefactItem
} from "@/lib/api";
import { RunDetailShell, type RunDetailViewModel } from "./_components/RunDetailShell";
import {
  buildEnvironmentOverview,
  ocIsIncomplete,
  ocIsTruncated,
  ocPermissionDeniedList
} from "@/lib/run-metrics";

/** -----------------------------
 *  Tiny runtime helpers (server-only)
 *  ----------------------------*/

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (!isRecord(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function readBool(obj: unknown, key: string): boolean | null {
  if (!isRecord(obj)) return null;
  const v = obj[key];
  return typeof v === "boolean" ? v : null;
}

function uniq(xs: string[]) {
  return Array.from(new Set(xs)).filter(Boolean);
}

function safeString(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function formatBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) return "—";
  if (!Number.isFinite(bytes) || bytes < 0) return String(bytes);
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

/** -----------------------------
 *  Completeness signals (derived from Observed Checks)
 *  ----------------------------*/

function badgeForObservedChecks(observed: ObservedCheckItem[]): RunDetailViewModel["completenessBadge"] {
  let sawPermissionDenied = false;
  let sawTruncated = false;
  let sawIncomplete = false;

  for (const oc of observed) {
    const d = oc.data;
    if (ocPermissionDeniedList(d).length > 0) sawPermissionDenied = true;
    if (ocIsTruncated(d)) sawTruncated = true;
    if (ocIsIncomplete(d)) sawIncomplete = true;
  }

  if (sawPermissionDenied) return { label: "permission-denied", tone: "warn" };
  if (sawTruncated) return { label: "truncated", tone: "warn" };
  if (sawIncomplete) return { label: "partial", tone: "warn" };
  return { label: "ok", tone: "ok" };
}

function extractSignals(observed: ObservedCheckItem[]) {
  const permissionDenied: string[] = [];
  const truncatedChecks: string[] = [];
  const incompleteChecks: string[] = [];

  for (const oc of observed) {
    const d = oc.data;

    for (const x of ocPermissionDeniedList(d)) permissionDenied.push(x);
    if (ocIsTruncated(d)) truncatedChecks.push(oc.checkId);
    if (ocIsIncomplete(d)) incompleteChecks.push(oc.checkId);
  }

  return {
    permissionDenied: uniq(permissionDenied),
    truncatedChecks: uniq(truncatedChecks),
    incompleteChecks: uniq(incompleteChecks)
  };
}

function deriveConfidence(signals: { permissionDenied: string[]; truncatedChecks: string[]; incompleteChecks: string[] }) {
  // LOCKED: derived only from explicit observed signals
  if (signals.permissionDenied.length > 0) {
    return {
      level: "low" as const,
      tone: "warn" as const,
      reasons: [
        `permissionDenied reported (${signals.permissionDenied.length})`
      ]
    };
  }

  if (signals.truncatedChecks.length > 0 || signals.incompleteChecks.length > 0) {
    const bits: string[] = [];
    if (signals.truncatedChecks.length > 0) bits.push(`truncated (${signals.truncatedChecks.length})`);
    if (signals.incompleteChecks.length > 0) bits.push(`incomplete (${signals.incompleteChecks.length})`);
    return {
      level: "medium" as const,
      tone: "warn" as const,
      reasons: bits
    };
  }

  return { level: "high" as const, tone: "ok" as const, reasons: ["no completeness warnings detected"] };
}

function buildNextActions(args: {
  tenantId: string;
  runId: string;
  run: { dataProfile: string };
  signals: { permissionDenied: string[]; truncatedChecks: string[]; incompleteChecks: string[] };
  reportsCount: number;
}) {
  const { tenantId, runId, signals, reportsCount } = args;

  const actions: RunDetailViewModel["nextActions"] = [];

  if (signals.permissionDenied.length > 0) {
    actions.push({
      id: "fix-permissions",
      title: "Resolve permission gaps",
      tone: "warn",
      detail: `This run reported permissionDenied for: ${signals.permissionDenied.join(", ")}.`,
      cta: {
        label: "Show permissionDenied evidence",
        evidenceQuery: "permissionDenied"
      }
    });
  }

  if (signals.truncatedChecks.length > 0) {
    actions.push({
      id: "review-truncation",
      title: "Review truncated data",
      tone: "warn",
      detail: `Some checks reported truncated (${signals.truncatedChecks.length}). Counts may be indicative.`,
      cta: {
        label: "Show truncated evidence",
        evidenceQuery: "truncated"
      }
    });
  }

  if (signals.incompleteChecks.length > 0) {
    actions.push({
      id: "review-incomplete",
      title: "Review incomplete areas",
      tone: "warn",
      detail: `Some checks reported incomplete (${signals.incompleteChecks.length}). Validate the underlying evidence.`,
      cta: {
        label: "Show incomplete evidence",
        evidenceQuery: "incomplete"
      }
    });
  }

  if (reportsCount > 0) {
    actions.push({
      id: "download-report",
      title: "Download the run summary report",
      tone: "ok",
      detail: "Use the report for an MSP-friendly summary alongside evidence traceability in the portal.",
      cta: {
        label: "Jump to Reports",
        evidenceQuery: "" // shell will just switch tab and scroll; query left blank
      }
    });
  } else {
    actions.push({
      id: "no-report",
      title: "No report artefact found",
      tone: "muted",
      detail: "This run has no run-summary artefact yet. Evidence and findings are still available for review.",
      cta: {
        label: "Go to Evidence",
        evidenceQuery: ""
      }
    });
  }

  // Always include a “review findings” nudge if any exist.
  actions.push({
    id: "review-findings",
    title: "Review derived findings",
    tone: "muted",
    detail: "Move from inventory to interpretation using Findings, then validate via Evidence.",
    cta: {
      label: "Go to Findings",
      goToTab: "findings"
    }
  });

  // Ensure stable ordering: permission → trunc/incomplete → report → findings
  return actions;
}

/** -----------------------------
 *  Run phase & job summary
 *  ----------------------------*/

type JobSummary = {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  other: number;
};

function summarizeJobs(jobs: JobListItem[]): JobSummary {
  const s: JobSummary = { queued: 0, running: 0, succeeded: 0, failed: 0, other: 0 };
  for (const j of jobs) {
    switch (j.status) {
      case "queued":
        s.queued++;
        break;
      case "running":
        s.running++;
        break;
      case "succeeded":
        s.succeeded++;
        break;
      case "failed":
        s.failed++;
        break;
      default:
        s.other++;
        break;
    }
  }
  return s;
}

function phaseForRun(
  run: { status: string; startedAt: string | null; endedAt: string | null },
  jobs: JobListItem[]
): RunDetailViewModel["phaseBadge"] {
  const status = String(run.status ?? "").toLowerCase();
  const summary = summarizeJobs(jobs);

  if (status === "succeeded") return { label: "phase: succeeded", tone: "ok" };
  if (status === "failed") return { label: "phase: failed", tone: "bad" };

  if (summary.running > 0) return { label: "phase: running", tone: "warn" };
  if (run.startedAt && !run.endedAt) return { label: "phase: running", tone: "warn" };

  if (run.endedAt && status !== "succeeded" && status !== "failed")
    return { label: "phase: ended (non-terminal)", tone: "warn" };

  return { label: "phase: queued", tone: "muted" };
}

function statusBadgeForRunStatus(statusRaw: string | null | undefined): RunDetailViewModel["runStatusBadge"] {
  const s = String(statusRaw ?? "").toLowerCase();
  if (s === "succeeded") return { label: "succeeded", tone: "ok" };
  if (s === "failed") return { label: "failed", tone: "bad" };
  if (s === "running") return { label: "running", tone: "warn" };
  if (s === "queued") return { label: "queued", tone: "muted" };
  return { label: s || "unknown", tone: "muted" };
}

/** -----------------------------
 *  Observed checks view helpers
 *  ----------------------------*/

function observedRowSignals(o: ObservedCheckItem): string[] {
  const d = o.data;
  const sigs: string[] = [];

  if (ocPermissionDeniedList(d).length > 0) sigs.push("permissionDenied");
  if (ocIsTruncated(d)) sigs.push("truncated");
  if (ocIsIncomplete(d)) sigs.push("incomplete");

  return sigs;
}

/** -----------------------------
 *  Artefacts: reports vs raw
 *  ----------------------------*/

type ArtefactRow = {
  id: string;
  type: string;
  key: string;
  jobId: string | null;
  sizeBytes: number | null;
  createdAt: string;
};

function filenameFromKey(key: string) {
  return key.split("/").pop() ?? key;
}

function isKnownReportFilename(filenameLower: string) {
  return filenameLower === "run-summary.xlsx" || filenameLower === "run-summary.csv";
}

function buildArtefactLists(all: ArtefactRow[]) {
  const reports = all.filter((a) => isKnownReportFilename(filenameFromKey(a.key).toLowerCase()));
  const others = all.filter((a) => !isKnownReportFilename(filenameFromKey(a.key).toLowerCase()));

  reports.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  others.sort((a, b) => {
    const f = filenameFromKey(a.key).localeCompare(filenameFromKey(b.key));
    if (f !== 0) return f;
    return (a.jobId ?? "").localeCompare(b.jobId ?? "");
  });

  return { reports, others };
}

export default async function RunPage({ params }: { params: Promise<{ tenantId: string; runId: string }> }) {
  const { tenantId, runId } = await params;

  const [run, jobs, artefactsRaw, observed, findings] = await Promise.all([
    getRun(tenantId, runId),
    listRunJobs(tenantId, runId),
    listRunArtefacts(tenantId, runId),
    listRunObservedChecks(tenantId, runId),
    listRunFindings(tenantId, runId)
  ]);

  const completenessBadge = badgeForObservedChecks(observed);
  const signals = extractSignals(observed);

  const hasCompletenessIssues =
    completenessBadge.tone !== "ok" ||
    signals.permissionDenied.length > 0 ||
    signals.truncatedChecks.length > 0 ||
    signals.incompleteChecks.length > 0;

  const confidence = deriveConfidence(signals);

  const artefacts: ArtefactRow[] = (artefactsRaw as ArtefactItem[]).map((a) => ({
    id: a.id,
    type: a.type,
    key: a.key,
    jobId: a.jobId ?? null,
    sizeBytes: a.sizeBytes ?? null,
    createdAt: a.createdAt
  }));

  const { reports, others } = buildArtefactLists(artefacts);

  const phaseBadge = phaseForRun({ status: run.status, startedAt: run.startedAt ?? null, endedAt: run.endedAt ?? null }, jobs);
  const jobSummary = summarizeJobs(jobs);
  const runStatusBadge = statusBadgeForRunStatus(run.status);

  const observedSorted = observed.slice().sort((a, b) => (a.observedAt ?? "").localeCompare(b.observedAt ?? ""));

  // Registry-driven overview (schema-to-UI)
  const env = buildEnvironmentOverview(observed);

  const nextActions = buildNextActions({
    tenantId,
    runId,
    run: { dataProfile: run.dataProfile },
    signals,
    reportsCount: reports.length
  });

  const vm: RunDetailViewModel = {
    tenantId,
    runId,

    run: {
      id: run.id,
      status: run.status,
      dataProfile: run.dataProfile,
      triggeredBy: run.triggeredBy ?? null,
      createdAt: run.createdAt ?? null,
      startedAt: run.startedAt ?? null,
      endedAt: run.endedAt ?? null,
      counts: {
        jobs: run.counts.jobs,
        findings: run.counts.findings,
        artefacts: run.counts.artefacts
      },
      modulesEnabledDebug: safeString(run.modulesEnabled)
    },

    runStatusBadge,
    phaseBadge,
    completenessBadge,

    confidence: {
      level: confidence.level,
      tone: confidence.tone,
      reasons: confidence.reasons
    },

    jobSummary,

    completenessSignals: {
      hasCompletenessIssues,
      permissionDenied: signals.permissionDenied,
      truncatedChecks: signals.truncatedChecks,
      incompleteChecks: signals.incompleteChecks,
      observedCount: observed.length,
      findingsCount: findings.length,
      artefactsCount: artefacts.length
    },

    nextActions,

    environmentOverview: env,

    observedChecks: observedSorted.map((o) => ({
      id: o.id,
      observedAt: o.observedAt ?? null,
      checkId: o.checkId,
      collectorId: o.collectorId,
      jobId: o.jobId ?? null,
      signals: observedRowSignals(o),
      viewHref: `/t/${tenantId}/runs/${runId}/observed/${o.id}`
    })),

    jobs: jobs.map((j) => ({
      id: j.id,
      collectorId: j.collectorId,
      status: j.status,
      attempts: j.attempts,
      lastError: j.lastError ?? null
    })),

    reports: reports.map((a) => ({
      id: a.id,
      filename: filenameFromKey(a.key),
      key: a.key,
      type: a.type,
      sizeLabel: formatBytes(a.sizeBytes),
      downloadHref: `/api/artefacts/${a.id}/download`
    })),

    artefacts: others.map((a) => ({
      id: a.id,
      filename: filenameFromKey(a.key),
      key: a.key,
      type: a.type,
      jobId: a.jobId,
      sizeLabel: formatBytes(a.sizeBytes),
      downloadHref: `/api/artefacts/${a.id}/download`
    })),

    findings: findings.map((f) => ({
      id: f.id,
      severity: f.severity,
      checkId: f.checkId,
      title: f.title,
      recommendation: f.recommendation ?? null
    }))
  };

  return <RunDetailShell vm={vm} />;
}
