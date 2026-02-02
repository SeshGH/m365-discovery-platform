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

function readNumber(obj: unknown, key: string): number | null {
  if (!isRecord(obj)) return null;
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function readStringArray(obj: unknown, key: string): string[] {
  if (!isRecord(obj)) return [];
  const v = obj[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function readNumberAtPath(obj: unknown, paths: string[]): number | undefined {
  for (const p of paths) {
    const v = getPath(obj, p);
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
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

function ocPermissionDeniedList(data: unknown): string[] {
  const direct = readStringArray(data, "permissionDenied");
  const nested = readStringArray(getPath(data, "completeness"), "permissionDenied");
  return uniq([...direct, ...nested]);
}

function ocIsTruncated(data: unknown): boolean {
  return readBool(data, "truncated") === true || readBool(getPath(data, "completeness"), "truncated") === true;
}

function ocIsIncomplete(data: unknown): boolean {
  return readBool(data, "isComplete") === false || readBool(getPath(data, "completeness"), "isComplete") === false;
}

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

/** -----------------------------
 *  Environment overview (derived from Observed Checks; best effort)
 *  ----------------------------*/

type EnvMetricTone = "ok" | "warn" | "bad" | "muted";

type EnvMetric = {
  key: string;
  label: string;
  value: string;
  tone: EnvMetricTone;
  hint?: string;
  sources?: string[];
};

function buildEnvironmentOverview(observed: ObservedCheckItem[]): EnvMetric[] {
  const out: EnvMetric[] = [];

  const sourcesFor = (predicate: (o: ObservedCheckItem) => boolean) =>
    uniq(
      observed
        .filter(predicate)
        .flatMap((o) => [o.checkId, o.collectorId].filter(Boolean) as string[])
    );

  const findCount = (match: (o: ObservedCheckItem) => boolean, paths: string[]) => {
    for (const oc of observed) {
      if (!match(oc)) continue;
      const d = oc.data;
      const n = readNumberAtPath(d, paths);
      if (n !== undefined) return n;
    }
    return undefined;
  };

  const pathsUsers = ["counts.users", "count.users", "summary.users", "summary.counts.users", "stats.users", "totalUsers", "total", "value"];
  const pathsGroups = ["counts.groups", "summary.groups", "summary.counts.groups", "stats.groups", "totalGroups", "value"];
  const pathsApps = ["counts.enterpriseApps", "counts.apps", "summary.enterpriseApps", "summary.apps", "summary.counts.apps", "stats.apps", "totalApps", "value"];
  const pathsCA = [
    "counts.conditionalAccessPolicies",
    "counts.caPolicies",
    "summary.conditionalAccessPolicies",
    "summary.caPolicies",
    "summary.counts.conditionalAccessPolicies",
    "stats.conditionalAccessPolicies",
    "totalPolicies",
    "value"
  ];
  const pathsMailboxes = ["counts.mailboxes", "summary.mailboxes", "summary.counts.mailboxes", "stats.mailboxes", "totalMailboxes", "value"];

  const mUsers = (o: ObservedCheckItem) =>
    String(o.checkId).includes("entra") && (String(o.checkId).includes("users") || String(o.collectorId).includes("entra.users"));

  const mGroups = (o: ObservedCheckItem) =>
    String(o.checkId).includes("entra") && (String(o.checkId).includes("groups") || String(o.collectorId).includes("entra.groups"));

  const mApps = (o: ObservedCheckItem) =>
    String(o.checkId).includes("enterprise") || String(o.collectorId).includes("enterpriseApps") || String(o.collectorId).includes("entra.enterpriseApps");

  const mCA = (o: ObservedCheckItem) =>
    String(o.checkId).includes("conditional") || String(o.collectorId).includes("conditionalAccess") || String(o.collectorId).includes("entra.conditionalAccess");

  const mMail = (o: ObservedCheckItem) =>
    String(o.checkId).includes("mailbox") || String(o.collectorId).includes("exchange") || String(o.collectorId).includes("exchange.mailboxes");

  const users = findCount(mUsers, pathsUsers);
  const groups = findCount(mGroups, pathsGroups);
  const apps = findCount(mApps, pathsApps);
  const ca = findCount(mCA, pathsCA);

  const collectorsSeen = uniq(observed.map((o) => String(o.collectorId || "")).filter(Boolean));
  const checksSeen = uniq(observed.map((o) => String(o.checkId || "")).filter(Boolean));

  out.push({
    key: "collectors",
    label: "Collectors seen",
    value: collectorsSeen.length ? String(collectorsSeen.length) : "—",
    tone: collectorsSeen.length ? "ok" : "muted",
    hint: collectorsSeen.length ? collectorsSeen.join(", ") : "No observed checks yet",
    sources: []
  });

  out.push({
    key: "checks",
    label: "Observed checks",
    value: checksSeen.length ? String(checksSeen.length) : "—",
    tone: checksSeen.length ? "ok" : "muted",
    sources: []
  });

  out.push({
    key: "users",
    label: "Users",
    value: users === undefined ? "—" : users.toLocaleString(),
    tone: users === undefined ? "muted" : "ok",
    hint: users === undefined ? "Not derived from observed data yet" : undefined,
    sources: sourcesFor(mUsers)
  });

  out.push({
    key: "groups",
    label: "Groups",
    value: groups === undefined ? "—" : groups.toLocaleString(),
    tone: groups === undefined ? "muted" : "ok",
    hint: groups === undefined ? "Not derived from observed data yet" : undefined,
    sources: sourcesFor(mGroups)
  });

  out.push({
    key: "apps",
    label: "Enterprise apps",
    value: apps === undefined ? "—" : apps.toLocaleString(),
    tone: apps === undefined ? "muted" : "ok",
    hint: apps === undefined ? "Not derived from observed data yet" : undefined,
    sources: sourcesFor(mApps)
  });

  out.push({
    key: "ca",
    label: "CA policies",
    value: ca === undefined ? "—" : ca.toLocaleString(),
    tone: ca === undefined ? "muted" : "ok",
    hint: ca === undefined ? "Not derived from observed data yet" : undefined,
    sources: sourcesFor(mCA)
  });

  const exo = observed.find((x) => x.checkId === "EXO_MAILBOXES_OBS_001");
  if (exo) {
    const d = exo.data;

    const totalMailboxes = readNumber(d, "totalMailboxes");

    const sizeBuckets = getPath(d, "sizeBuckets");
    const near50 =
      typeof getPath(sizeBuckets, "40to50GB") === "number" && Number.isFinite(getPath(sizeBuckets, "40to50GB") as number)
        ? (getPath(sizeBuckets, "40to50GB") as number)
        : null;
    const over50 =
      typeof getPath(sizeBuckets, "over50GB") === "number" && Number.isFinite(getPath(sizeBuckets, "over50GB") as number)
        ? (getPath(sizeBuckets, "over50GB") as number)
        : null;

    const isComplete = readBool(d, "isComplete");
    const permissionDenied = ocPermissionDeniedList(d);

    const notesRaw = getPath(d, "notes");
    const notes = Array.isArray(notesRaw)
      ? notesRaw.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];

    const exoTone: EnvMetricTone = permissionDenied.length > 0 ? "warn" : isComplete === false ? "warn" : "ok";

    const exoHint =
      permissionDenied.length > 0
        ? `Permission missing: ${permissionDenied.join(", ")}`
        : isComplete === false
          ? notes[0] ?? "Exchange reporting is not available yet (Graph reports)."
          : "Derived from Microsoft Graph mailbox usage reports.";

    const exoSources = uniq([exo.checkId, exo.collectorId].filter(Boolean) as string[]);

    out.push({
      key: "exo_mailboxes_total",
      label: "EXO mailboxes",
      value: totalMailboxes === null ? "—" : totalMailboxes.toLocaleString(),
      tone: exoTone,
      hint: exoHint,
      sources: exoSources
    });

    out.push({
      key: "exo_mailboxes_near50",
      label: "EXO near 50GB",
      value: near50 === null ? "—" : near50.toLocaleString(),
      tone: near50 !== null && near50 > 0 ? "warn" : exoTone,
      hint: "Mailboxes in the 40–50GB range (licensing threshold watchlist).",
      sources: exoSources
    });

    out.push({
      key: "exo_mailboxes_over50",
      label: "EXO over 50GB",
      value: over50 === null ? "—" : over50.toLocaleString(),
      tone: over50 !== null && over50 > 0 ? "warn" : exoTone,
      hint: "Mailboxes above 50GB (often require EXO Plan 2 / E3/E5+).",
      sources: exoSources
    });
  } else {
    const mailboxesHeuristic = findCount(mMail, pathsMailboxes);

    out.push({
      key: "mailboxes",
      label: "Mailboxes",
      value: mailboxesHeuristic === undefined ? "—" : mailboxesHeuristic.toLocaleString(),
      tone: mailboxesHeuristic === undefined ? "muted" : "ok",
      hint: mailboxesHeuristic === undefined ? "Not derived from observed data yet" : "Heuristic (non-EXO-specific) count",
      sources: sourcesFor(mMail)
    });
  }

  const anyPermissionDenied = observed.some((o) => ocPermissionDeniedList(o.data).length > 0);
  const anyTruncated = observed.some((o) => ocIsTruncated(o.data));

  out.push({
    key: "signals",
    label: "Completeness signals",
    value: anyPermissionDenied || anyTruncated ? "attention" : "ok",
    tone: anyPermissionDenied || anyTruncated ? "warn" : "ok",
    hint: anyPermissionDenied
      ? "Some checks reported permissionDenied"
      : anyTruncated
        ? "Some checks reported truncated"
        : "No permissionDenied/truncated detected",
    sources: []
  });

  return out;
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

  const env = buildEnvironmentOverview(observed);

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
