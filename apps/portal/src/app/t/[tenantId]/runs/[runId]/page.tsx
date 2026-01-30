// apps/portal/src/app/t/[tenantId]/runs/[runId]/page.tsx
import Link from "next/link";
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

function smallTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return iso;
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

type BadgeTone = "ok" | "warn" | "bad" | "muted";
type BadgeModel = { label: string; tone: BadgeTone };

function Badge({ badge }: { badge: BadgeModel }) {
  const cls =
    badge.tone === "ok"
      ? "badge ok"
      : badge.tone === "warn"
        ? "badge warn"
        : badge.tone === "bad"
          ? "badge bad"
          : "badge";
  return <span className={cls}>{badge.label}</span>;
}

/** -----------------------------
 *  Completeness signals
 *  ----------------------------*/

function badgeForObservedChecks(observed: ObservedCheckItem[]): BadgeModel {
  let sawPermissionDenied = false;
  let sawTruncated = false;
  let sawIncomplete = false;

  for (const oc of observed) {
    const d = oc.data as any;
    if (d && typeof d === "object") {
      if (Array.isArray(d.permissionDenied) && d.permissionDenied.length > 0) sawPermissionDenied = true;
      if (d.truncated === true) sawTruncated = true;
      if (d.isComplete === false) sawIncomplete = true;

      if (d.completeness && typeof d.completeness === "object") {
        if (Array.isArray(d.completeness.permissionDenied) && d.completeness.permissionDenied.length > 0)
          sawPermissionDenied = true;
        if (d.completeness.truncated === true) sawTruncated = true;
        if (d.completeness.isComplete === false) sawIncomplete = true;
      }
    }
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
    const d = oc.data as any;
    if (!d || typeof d !== "object") continue;

    const pd = (Array.isArray(d.permissionDenied) ? d.permissionDenied : []) as unknown[];
    for (const x of pd) if (typeof x === "string") permissionDenied.push(x);

    if (d.truncated === true) truncatedChecks.push(oc.checkId);
    if (d.isComplete === false) incompleteChecks.push(oc.checkId);

    if (d.completeness && typeof d.completeness === "object") {
      const pd2 = (Array.isArray(d.completeness.permissionDenied) ? d.completeness.permissionDenied : []) as unknown[];
      for (const x of pd2) if (typeof x === "string") permissionDenied.push(x);

      if (d.completeness.truncated === true) truncatedChecks.push(oc.checkId);
      if (d.completeness.isComplete === false) incompleteChecks.push(oc.checkId);
    }
  }

  const uniq = (xs: string[]) => Array.from(new Set(xs));

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
): BadgeModel {
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

/** -----------------------------
 *  Observed checks: table helpers
 *  ----------------------------*/

function observedRowSignals(o: ObservedCheckItem): string[] {
  const d = o.data as any;
  if (!d || typeof d !== "object") return [];

  const hasPd =
    (Array.isArray(d.permissionDenied) && d.permissionDenied.length > 0) ||
    (Array.isArray(d?.completeness?.permissionDenied) && d.completeness.permissionDenied.length > 0);

  const isTruncated = d.truncated === true || d?.completeness?.truncated === true;
  const isIncomplete = d.isComplete === false || d?.completeness?.isComplete === false;

  const sigs: string[] = [];
  if (hasPd) sigs.push("permissionDenied");
  if (isTruncated) sigs.push("truncated");
  if (isIncomplete) sigs.push("incomplete");
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
 *  Visual helpers (A: hierarchy)
 *  ----------------------------*/

function statusBadgeForRunStatus(statusRaw: string | null | undefined): BadgeModel {
  const s = String(statusRaw ?? "").toLowerCase();
  if (s === "succeeded") return { label: "succeeded", tone: "ok" };
  if (s === "failed") return { label: "failed", tone: "bad" };
  if (s === "running") return { label: "running", tone: "warn" };
  if (s === "queued") return { label: "queued", tone: "muted" };
  return { label: s || "unknown", tone: "muted" };
}

/** -----------------------------
 *  D-1: Environment overview (derived from Observed Checks)
 *  ----------------------------*/

type EnvMetric = {
  label: string;
  value: string;
  sourceCheckId?: string;
};

function firstNumberLike(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function inferCountFromObserved(o: ObservedCheckItem): number | null {
  const d = o.data as any;
  if (!d || typeof d !== "object") return null;

  // Common shapes we’ve used/seen in checks
  // { count: 123 } / { total: 123 } / { items: [...] } / { rows: [...] }
  const directKeys = ["count", "total", "totalCount", "itemCount", "itemsCount", "valueCount"];
  for (const k of directKeys) {
    if (k in d) {
      const n = firstNumberLike(d[k]);
      if (n !== null) return n;
    }
  }

  const arrayKeys = ["items", "rows", "users", "mailboxes", "policies", "assignments"];
  for (const k of arrayKeys) {
    if (Array.isArray(d[k])) return d[k].length;
  }

  // Sometimes nested under data.summary / data.result / data.stats
  const nestKeys = ["summary", "result", "stats", "metrics"];
  for (const nk of nestKeys) {
    const sub = d[nk];
    if (sub && typeof sub === "object") {
      for (const k of directKeys) {
        if (k in sub) {
          const n = firstNumberLike((sub as any)[k]);
          if (n !== null) return n;
        }
      }
      for (const k of arrayKeys) {
        if (Array.isArray((sub as any)[k])) return (sub as any)[k].length;
      }
    }
  }

  return null;
}

type EnvMetricTone = "ok" | "warn" | "bad" | "muted";

type EnvMetric = {
  key: string;
  label: string;
  value: string;
  tone: EnvMetricTone;
  hint?: string;
  sources?: string[]; // checkIds/collectorIds that contributed
};

function buildEnvironmentOverview(observed: ObservedCheckItem[]): EnvMetric[] {
  // We deliberately keep this "best effort" and non-breaking:
  // - only show numbers we can confidently derive
  // - never assume presence; never throw
  // - always indicate muted when unknown

  const uniq = (xs: string[]) => Array.from(new Set(xs)).filter(Boolean);

  const sourcesFor = (predicate: (o: ObservedCheckItem) => boolean) =>
    uniq(
      observed
        .filter(predicate)
        .flatMap((o) => [o.checkId, o.collectorId].filter(Boolean) as string[])
    );

  const getByPath = (obj: any, path: string): unknown => {
    const parts = path.split(".");
    let cur = obj;
    for (const p of parts) {
      if (!cur || typeof cur !== "object") return undefined;
      cur = cur[p];
    }
    return cur;
  };

  const firstNumber = (obj: any, paths: string[]): number | undefined => {
    for (const p of paths) {
      const v = getByPath(obj, p);
      if (typeof v === "number" && Number.isFinite(v)) return v;
      // Sometimes numbers arrive as strings, allow safe parse
      if (typeof v === "string") {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
    }
    return undefined;
  };

  // Heuristics: try multiple common shapes
  // (These are intentionally tolerant to different collector payloads)
  const findCount = (match: (o: ObservedCheckItem) => boolean, paths: string[]) => {
    for (const oc of observed) {
      if (!match(oc)) continue;
      const d: any = oc.data;
      if (!d || typeof d !== "object") continue;
      const n = firstNumber(d, paths);
      if (n !== undefined) return n;
    }
    return undefined;
  };

  // Common “inventory/summary” style keys we might see
  const pathsUsers = [
    "counts.users",
    "count.users",
    "summary.users",
    "summary.counts.users",
    "stats.users",
    "totalUsers",
    "total",
    "value"
  ];
  const pathsGroups = [
    "counts.groups",
    "summary.groups",
    "summary.counts.groups",
    "stats.groups",
    "totalGroups",
    "value"
  ];
  const pathsApps = [
    "counts.enterpriseApps",
    "counts.apps",
    "summary.enterpriseApps",
    "summary.apps",
    "summary.counts.apps",
    "stats.apps",
    "totalApps",
    "value"
  ];
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
  const pathsMailboxes = [
    "counts.mailboxes",
    "summary.mailboxes",
    "summary.counts.mailboxes",
    "stats.mailboxes",
    "totalMailboxes",
    "value"
  ];

  // Matchers: based on checkId/collectorId naming (canonical IDs are encouraged)
  const mUsers = (o: ObservedCheckItem) =>
    String(o.checkId).includes("entra") && (String(o.checkId).includes("users") || String(o.collectorId).includes("entra.users"));
  const mGroups = (o: ObservedCheckItem) =>
    String(o.checkId).includes("entra") && (String(o.checkId).includes("groups") || String(o.collectorId).includes("entra.groups"));
  const mApps = (o: ObservedCheckItem) =>
    String(o.checkId).includes("enterprise") ||
    String(o.collectorId).includes("enterpriseApps") ||
    String(o.collectorId).includes("entra.enterpriseApps");
  const mCA = (o: ObservedCheckItem) =>
    String(o.checkId).includes("conditional") ||
    String(o.collectorId).includes("conditionalAccess") ||
    String(o.collectorId).includes("entra.conditionalAccess");
  const mMail = (o: ObservedCheckItem) =>
    String(o.checkId).includes("mailbox") ||
    String(o.collectorId).includes("exchange") ||
    String(o.collectorId).includes("exchange.mailboxes");

  const users = findCount(mUsers, pathsUsers);
  const groups = findCount(mGroups, pathsGroups);
  const apps = findCount(mApps, pathsApps);
  const ca = findCount(mCA, pathsCA);
  const mailboxes = findCount(mMail, pathsMailboxes);

  const anyPermissionDenied = observed.some((o) => {
    const d: any = o.data;
    if (!d || typeof d !== "object") return false;
    const pd1 = Array.isArray(d.permissionDenied) ? d.permissionDenied.length > 0 : false;
    const pd2 =
      d.completeness && typeof d.completeness === "object" && Array.isArray(d.completeness.permissionDenied)
        ? d.completeness.permissionDenied.length > 0
        : false;
    return pd1 || pd2;
  });

  const anyTruncated = observed.some((o) => {
    const d: any = o.data;
    if (!d || typeof d !== "object") return false;
    return d.truncated === true || d?.completeness?.truncated === true;
  });

  const collectorsSeen = uniq(observed.map((o) => String(o.collectorId || "")).filter(Boolean));
  const checksSeen = uniq(observed.map((o) => String(o.checkId || "")).filter(Boolean));

  const metrics: EnvMetric[] = [
    {
      key: "collectors",
      label: "Collectors seen",
      value: collectorsSeen.length ? String(collectorsSeen.length) : "—",
      tone: collectorsSeen.length ? "ok" : "muted",
      hint: collectorsSeen.length ? collectorsSeen.join(", ") : "No observed checks yet",
      sources: []
    },
    {
      key: "checks",
      label: "Observed checks",
      value: checksSeen.length ? String(checksSeen.length) : "—",
      tone: checksSeen.length ? "ok" : "muted",
      sources: []
    },
    {
      key: "users",
      label: "Users",
      value: users === undefined ? "—" : users.toLocaleString(),
      tone: users === undefined ? "muted" : "ok",
      hint: users === undefined ? "Not derived from observed data yet" : undefined,
      sources: sourcesFor(mUsers)
    },
    {
      key: "groups",
      label: "Groups",
      value: groups === undefined ? "—" : groups.toLocaleString(),
      tone: groups === undefined ? "muted" : "ok",
      hint: groups === undefined ? "Not derived from observed data yet" : undefined,
      sources: sourcesFor(mGroups)
    },
    {
      key: "apps",
      label: "Enterprise apps",
      value: apps === undefined ? "—" : apps.toLocaleString(),
      tone: apps === undefined ? "muted" : "ok",
      hint: apps === undefined ? "Not derived from observed data yet" : undefined,
      sources: sourcesFor(mApps)
    },
    {
      key: "ca",
      label: "CA policies",
      value: ca === undefined ? "—" : ca.toLocaleString(),
      tone: ca === undefined ? "muted" : "ok",
      hint: ca === undefined ? "Not derived from observed data yet" : undefined,
      sources: sourcesFor(mCA)
    },
    {
      key: "mailboxes",
      label: "Mailboxes",
      value: mailboxes === undefined ? "—" : mailboxes.toLocaleString(),
      tone: mailboxes === undefined ? "muted" : "ok",
      hint: mailboxes === undefined ? "Not derived from observed data yet" : undefined,
      sources: sourcesFor(mMail)
    },
    {
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
    }
  ];

  return metrics;
}

export default async function RunPage({
  params
}: {
  params: Promise<{ tenantId: string; runId: string }>;
}) {
  const { tenantId, runId } = await params;

  // All calls tenant-scoped via portal BFF (fail-closed)
  const [run, jobs, artefactsRaw, observed, findings] = await Promise.all([
    getRun(tenantId, runId),
    listRunJobs(tenantId, runId),
    listRunArtefacts(tenantId, runId),
    listRunObservedChecks(tenantId, runId),
    listRunFindings(tenantId, runId)
  ]);

  const completeness = badgeForObservedChecks(observed);
  const signals = extractSignals(observed);

  const artefacts: ArtefactRow[] = (artefactsRaw as ArtefactItem[]).map((a) => ({
    id: a.id,
    type: a.type,
    key: a.key,
    jobId: a.jobId ?? null,
    sizeBytes: a.sizeBytes ?? null,
    createdAt: a.createdAt
  }));

  const { reports, others } = buildArtefactLists(artefacts);

  const phase = phaseForRun(
    { status: run.status, startedAt: run.startedAt ?? null, endedAt: run.endedAt ?? null },
    jobs
  );

  const jobSummary = summarizeJobs(jobs);

  const hasCompletenessIssues =
    completeness.tone !== "ok" ||
    signals.permissionDenied.length > 0 ||
    signals.truncatedChecks.length > 0 ||
    signals.incompleteChecks.length > 0;

  // Oldest -> newest
  const observedSorted = observed.slice().sort((a, b) => (a.observedAt ?? "").localeCompare(b.observedAt ?? ""));

  const runStatusBadge = statusBadgeForRunStatus(run.status);

  const env = buildEnvironmentOverview(observed);

  return (
    <main>
      <p style={{ margin: "10px 0 0 0" }}>
        <Link className="link" href={`/t/${tenantId}`}>
          ← Back to tenant
        </Link>
      </p>

      <h2 style={{ marginBottom: 8 }}>Run</h2>

      {/* A: HERO STRIP (hierarchy + scannability) */}
      <div className="hero">
        <div className="hero-top">
          <div className="hero-left">
            <div className="hero-title">
              <span className="subtle">Run ID</span>{" "}
              <span className="hero-code">
                <code>{run.id}</code>
              </span>
            </div>

            <div className="hero-badges">
              <Badge badge={runStatusBadge} />
              <Badge badge={phase} />
              <Badge badge={completeness} />
              {hasCompletenessIssues ? (
                <span className="subtle" style={{ marginLeft: 6 }}>
                  completeness signals present
                </span>
              ) : (
                <span className="subtle" style={{ marginLeft: 6 }}>
                  no completeness warnings
                </span>
              )}
            </div>
          </div>

          <div className="hero-right">
            <div className="metric">
              <div className="metric-k">Jobs</div>
              <div className="metric-v">{run.counts.jobs}</div>
            </div>
            <div className="metric">
              <div className="metric-k">Findings</div>
              <div className="metric-v">{run.counts.findings}</div>
            </div>
            <div className="metric">
              <div className="metric-k">Artefacts</div>
              <div className="metric-v">{run.counts.artefacts}</div>
            </div>
          </div>
        </div>

        <div className="hero-sub">
          <div className="hero-sub-item">
            <span className="subtle">Profile</span> <strong>{run.dataProfile}</strong>
          </div>
          <div className="hero-sub-item">
            <span className="subtle">Triggered</span> <span>{run.triggeredBy ?? "—"}</span>
          </div>
          <div className="hero-sub-item">
            <span className="subtle">Created</span> <span>{smallTime(run.createdAt)}</span>
          </div>
          <div className="hero-sub-item">
            <span className="subtle">Started</span> <span>{smallTime(run.startedAt)}</span>
          </div>
          <div className="hero-sub-item">
            <span className="subtle">Ended</span> <span>{smallTime(run.endedAt)}</span>
          </div>
        </div>

        <div className="hero-foot subtle">
          Jobs: q {jobSummary.queued} · r {jobSummary.running} · ok {jobSummary.succeeded} · fail {jobSummary.failed}
          {jobSummary.other > 0 ? ` · other ${jobSummary.other}` : ""}
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 12, marginTop: 12 }}>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Run details</h3>
          <div className="kv">
            <div className="k">Tenant</div>
            <div className="v">
              <code>{tenantId}</code>
            </div>

            <div className="k">Run</div>
            <div className="v">
              <code>{runId}</code>
            </div>

            <div className="k">Status</div>
            <div className="v">
              <strong>{run.status}</strong>{" "}
              <span style={{ marginLeft: 8 }}>
                <Badge badge={phase} />
              </span>
            </div>

            <div className="k">Counts</div>
            <div className="v">
              jobs {run.counts.jobs} · findings {run.counts.findings} · artefacts {run.counts.artefacts}
            </div>
          </div>
        </div>

        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Completeness</h3>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Badge badge={completeness} />
            <span className="subtle">Derived from observed checks (no silent assumptions).</span>
          </div>

          <div className="subtle" style={{ marginTop: 10 }}>
            Observed checks: {observed.length} · Findings: {findings.length} · Artefacts: {artefacts.length}
          </div>

          {hasCompletenessIssues ? (
            <div style={{ marginTop: 10, fontSize: 13 }}>
              {signals.permissionDenied.length > 0 ? (
                <div style={{ marginBottom: 6 }}>
                  <strong>Permission denied:</strong>{" "}
                  <span style={{ color: "var(--muted)" }}>{signals.permissionDenied.join(", ")}</span>
                </div>
              ) : null}

              {signals.truncatedChecks.length > 0 ? (
                <div style={{ marginBottom: 6 }}>
                  <strong>Truncated checks:</strong>{" "}
                  <span style={{ color: "var(--muted)" }}>{signals.truncatedChecks.join(", ")}</span>
                </div>
              ) : null}

              {signals.incompleteChecks.length > 0 ? (
                <div>
                  <strong>Incomplete checks:</strong>{" "}
                  <span style={{ color: "var(--muted)" }}>{signals.incompleteChecks.join(", ")}</span>
                </div>
              ) : null}

              {signals.permissionDenied.length === 0 &&
              signals.truncatedChecks.length === 0 &&
              signals.incompleteChecks.length === 0 ? (
                <div style={{ color: "var(--muted)" }}>
                  Completeness warning present but no explicit details found in observed data.
                </div>
              ) : null}
            </div>
          ) : (
            <div className="subtle" style={{ marginTop: 10 }}>
              No completeness warnings detected in observed checks.
            </div>
          )}
        </div>
      </div>

      {/* D-1 / C-2: Environment overview (derived from observed checks) */}
<div className="card card-pad" style={{ marginBottom: 12 }}>
  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
    <h3 style={{ marginTop: 0, marginBottom: 6 }}>Environment overview</h3>
    <span className="subtle">Derived from observed checks (best effort)</span>
  </div>

  {env.length === 0 ? (
    <div className="subtle">No observed checks recorded yet, so no environment overview is available.</div>
  ) : (
    <>
      <div className="env-grid" style={{ marginTop: 8 }}>
        {env.map((m) => (
          <div key={m.key} className={`env-card tone-${m.tone}`}>
            <div className="env-k">{m.label}</div>
            <div className="env-v">{m.value}</div>
            {m.hint ? <div className="env-h">{m.hint}</div> : null}
            {m.sources && m.sources.length > 0 ? (
              <div className="env-s">
                <span className="subtle">sources:</span>{" "}
                <span className="muted2">{m.sources.join(", ")}</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer" }}>What is this?</summary>
        <div className="subtle" style={{ marginTop: 8 }}>
          These numbers are only shown when they can be derived from observed check payloads. If a value is “—”, it means
          we haven’t yet emitted a check that includes that count in a known shape.
        </div>
      </details>
    </>
  )}
</div>


      <h3>Observed checks</h3>
      <p className="subtle">Source of truth for posture + completeness signals. Findings are derived from these checks.</p>

      <div className="card" style={{ overflow: "hidden", marginBottom: 12 }}>
        <table className="table table-scan table-oc">
          <thead>
            <tr>
              <th>Observed</th>
              <th>Check</th>
              <th>Collector</th>
              <th>Signals</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {observedSorted.map((o) => {
              const sigs = observedRowSignals(o);

              return (
                <tr key={o.id}>
                  <td style={{ width: 170 }}>
                    <div style={{ color: "var(--muted)" }}>{smallTime(o.observedAt)}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 700 }}>
                      <code>{o.checkId}</code>
                    </div>
                    <div className="meta" style={{ fontSize: 12, color: "var(--muted)" }}>
                      id: <code>{o.id}</code>
                      {o.jobId ? (
                        <>
                          {" "}
                          · job: <code>{o.jobId}</code>
                        </>
                      ) : null}
                    </div>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    <code>{o.collectorId}</code>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{sigs.length > 0 ? sigs.join(", ") : "—"}</td>
                  <td style={{ fontSize: 12 }}>
                    <Link className="link link-action" href={`/t/${tenantId}/runs/${runId}/observed/${o.id}`}>
                      View
                    </Link>
                  </td>
                </tr>
              );
            })}
            {observed.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ color: "var(--muted)" }}>
                  No observed checks recorded for this run.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h3>Reports</h3>
      <p className="subtle">
        Derived outputs (not sources of truth). Known: <code>run-summary.xlsx</code>, <code>run-summary.csv</code>.
      </p>

      <div className="card" style={{ overflow: "hidden", marginBottom: 12 }}>
        <table className="table table-scan">
          <thead>
            <tr>
              <th>Report</th>
              <th>Type</th>
              <th>Size</th>
              <th>Download</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((a) => {
              const filename = filenameFromKey(a.key);
              return (
                <tr key={a.id}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{filename}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      <code>{a.key}</code>
                    </div>
                  </td>
                  <td>{a.type}</td>
                  <td>{formatBytes(a.sizeBytes)}</td>
                  <td>
                    <a className="link link-action" href={`/api/artefacts/${a.id}/download`} target="_blank" rel="noreferrer">
                      Download
                    </a>
                  </td>
                </tr>
              );
            })}
            {reports.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: "var(--muted)" }}>
                  No report artefacts found for this run.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h3>Jobs</h3>
      <div className="card" style={{ overflow: "hidden", marginBottom: 12 }}>
        <table className="table table-scan">
          <thead>
            <tr>
              <th>Collector</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>
                  <div style={{ fontWeight: 700 }}>{j.collectorId}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    <code>{j.id}</code>
                  </div>
                </td>
                <td>{j.status}</td>
                <td>{j.attempts}</td>
                <td style={{ fontSize: 12 }}>
                  {j.lastError ? <span style={{ color: "var(--bad-fg)" }}>{j.lastError}</span> : <span style={{ color: "var(--muted)" }}>—</span>}
                </td>
              </tr>
            ))}
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: "var(--muted)" }}>
                  No jobs found for this run.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h3>Artefacts</h3>
      <p className="subtle">Raw artefacts (sources of truth). Reports are shown above.</p>

      <div className="card" style={{ overflow: "hidden", marginBottom: 12 }}>
        <table className="table table-scan">
          <thead>
            <tr>
              <th>Filename</th>
              <th>Type</th>
              <th>Size</th>
              <th>Download</th>
            </tr>
          </thead>
          <tbody>
            {others.map((a) => {
              const filename = filenameFromKey(a.key);
              return (
                <tr key={a.id}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{filename}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      job: <code>{a.jobId ?? "—"}</code>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted2)" }}>
                      <code>{a.key}</code>
                    </div>
                  </td>
                  <td>{a.type}</td>
                  <td>{formatBytes(a.sizeBytes)}</td>
                  <td>
                    <a className="link link-action" href={`/api/artefacts/${a.id}/download`} target="_blank" rel="noreferrer">
                      Download
                    </a>
                  </td>
                </tr>
              );
            })}
            {others.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: "var(--muted)" }}>
                  No non-report artefacts recorded yet for this run.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h3>Findings</h3>
      <p className="subtle">Derived view (not a source of truth). Use observed checks above to understand completeness context.</p>

      <div className="card" style={{ overflow: "hidden" }}>
        <table className="table table-scan">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Check</th>
              <th>Title</th>
              <th>Recommendation</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => (
              <tr key={f.id}>
                <td>{f.severity}</td>
                <td>
                  <code>{f.checkId}</code>
                </td>
                <td>{f.title}</td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>{f.recommendation ?? "—"}</td>
              </tr>
            ))}
            {findings.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: "var(--muted)" }}>
                  No findings recorded for this run.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: "pointer", color: "var(--muted)" }}>Debug: modulesEnabled</summary>
        <pre className="pre">{safeString(run.modulesEnabled)}</pre>
      </details>
    </main>
  );
}
