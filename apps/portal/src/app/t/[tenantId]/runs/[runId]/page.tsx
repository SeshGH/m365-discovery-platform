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

type BadgeModel = {
  label: string;
  tone: BadgeTone;
};

function Badge({ badge }: { badge: BadgeModel }) {
  const bg =
    badge.tone === "ok"
      ? "#e7f7ed"
      : badge.tone === "warn"
        ? "#fff4d6"
        : badge.tone === "bad"
          ? "#fde7e9"
          : "#eee";

  const fg =
    badge.tone === "ok"
      ? "#116329"
      : badge.tone === "warn"
        ? "#8a5a00"
        : badge.tone === "bad"
          ? "#a4262c"
          : "#444";

  return (
    <span
      style={{
        background: bg,
        color: fg,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        lineHeight: "16px",
        whiteSpace: "nowrap"
      }}
    >
      {badge.label}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const s = String(severity ?? "").toLowerCase();

  const badge: BadgeModel =
    s === "critical"
      ? { label: "critical", tone: "bad" }
      : s === "high"
        ? { label: "high", tone: "bad" }
        : s === "medium"
          ? { label: "medium", tone: "warn" }
          : s === "low"
            ? { label: "low", tone: "muted" }
            : s === "info"
              ? { label: "info", tone: "muted" }
              : { label: s || "unknown", tone: "muted" };

  return <Badge badge={badge} />;
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

function groupObservedByCheckId(observed: ObservedCheckItem[]): Map<string, ObservedCheckItem[]> {
  const m = new Map<string, ObservedCheckItem[]>();
  for (const o of observed) {
    const key = String(o.checkId ?? "");
    if (!key) continue;
    const arr = m.get(key) ?? [];
    arr.push(o);
    m.set(key, arr);
  }

  // Stable, predictable ordering within each bucket
  for (const [k, arr] of m.entries()) {
    arr.sort((a, b) => (a.observedAt ?? "").localeCompare(b.observedAt ?? ""));
    m.set(k, arr);
  }

  return m;
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

  // Match your portal ordering: oldest -> newest
  const observedSorted = observed
    .slice()
    .sort((a, b) => (a.observedAt ?? "").localeCompare(b.observedAt ?? ""));

  const observedByCheckId = groupObservedByCheckId(observedSorted);

  return (
    <main>
      <p style={{ marginTop: 0 }}>
        <Link href={`/t/${tenantId}`}>← Back to tenant</Link>
      </p>

      <h2 style={{ marginTop: 0 }}>Run overview</h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Run ID</div>
              <div>
                <code>{run.id}</code>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Status</div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <span style={{ fontWeight: 700 }}>{run.status}</span>
                <Badge badge={phase} />
              </div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                Jobs: q {jobSummary.queued} · r {jobSummary.running} · ok {jobSummary.succeeded} · fail {jobSummary.failed}
                {jobSummary.other > 0 ? ` · other ${jobSummary.other}` : ""}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 13 }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Profile</div>
              <div>{run.dataProfile}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Triggered</div>
              <div>{run.triggeredBy ?? "—"}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 13 }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Created</div>
              <div>{smallTime(run.createdAt)}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Started</div>
              <div>{smallTime(run.startedAt)}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Ended</div>
              <div>{smallTime(run.endedAt)}</div>
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
            Counts: jobs {run.counts.jobs} · findings {run.counts.findings} · artefacts {run.counts.artefacts}
          </div>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 16 }}>Completeness</h3>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Badge badge={completeness} />
            <span style={{ fontSize: 13, opacity: 0.8 }}>Derived from observed checks (no silent assumptions).</span>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
            Observed checks: {observed.length} · Findings: {findings.length} · Artefacts: {artefacts.length}
          </div>

          {hasCompletenessIssues ? (
            <div style={{ marginTop: 10, fontSize: 12 }}>
              {signals.permissionDenied.length > 0 ? (
                <div style={{ marginBottom: 6 }}>
                  <strong>Permission denied:</strong>{" "}
                  <span style={{ opacity: 0.85 }}>{signals.permissionDenied.join(", ")}</span>
                </div>
              ) : null}

              {signals.truncatedChecks.length > 0 ? (
                <div style={{ marginBottom: 6 }}>
                  <strong>Truncated checks:</strong>{" "}
                  <span style={{ opacity: 0.85 }}>{signals.truncatedChecks.join(", ")}</span>
                </div>
              ) : null}

              {signals.incompleteChecks.length > 0 ? (
                <div>
                  <strong>Incomplete checks:</strong>{" "}
                  <span style={{ opacity: 0.85 }}>{signals.incompleteChecks.join(", ")}</span>
                </div>
              ) : null}

              {signals.permissionDenied.length === 0 &&
              signals.truncatedChecks.length === 0 &&
              signals.incompleteChecks.length === 0 ? (
                <div style={{ opacity: 0.85 }}>Completeness warning present but no explicit details found in observed data.</div>
              ) : null}
            </div>
          ) : (
            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>No completeness warnings detected in observed checks.</div>
          )}

          {observed.length > 0 ? (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer" }}>Show observed check IDs</summary>
              <ul style={{ marginTop: 8 }}>
                {observed.map((o) => (
                  <li key={o.id}>
                    <code>{o.checkId}</code> <span style={{ opacity: 0.7 }}>({o.collectorId})</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>No observed checks recorded yet for this run.</div>
          )}
        </div>
      </div>

      <h3 style={{ marginTop: 0 }}>Observed checks</h3>
      <p style={{ marginTop: 0, opacity: 0.75 }}>
        Source of truth for posture + completeness signals. Findings are derived from these checks.
      </p>

      <div style={{ border: "1px solid #ddd", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f6f6f6" }}>
            <tr>
              <th style={{ textAlign: "left", padding: 10 }}>Observed</th>
              <th style={{ textAlign: "left", padding: 10 }}>Check</th>
              <th style={{ textAlign: "left", padding: 10 }}>Collector</th>
              <th style={{ textAlign: "left", padding: 10 }}>Signals</th>
              <th style={{ textAlign: "left", padding: 10 }}>Data</th>
            </tr>
          </thead>
          <tbody>
            {observedSorted.map((o) => {
              const sigs = observedRowSignals(o);

              return (
                <tr key={o.id} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: 10, fontSize: 12 }}>
                    <div>{smallTime(o.observedAt)}</div>
                  </td>
                  <td style={{ padding: 10 }}>
                    <div style={{ fontWeight: 600 }}>
                      <code>{o.checkId}</code>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      id: <code>{o.id}</code>
                      {o.jobId ? (
                        <>
                          {" "}
                          · job: <code>{o.jobId}</code>
                        </>
                      ) : null}
                    </div>
                  </td>
                  <td style={{ padding: 10, fontSize: 12 }}>
                    <code>{o.collectorId}</code>
                  </td>
                  <td style={{ padding: 10, fontSize: 12 }}>
                    {sigs.length > 0 ? <span style={{ opacity: 0.9 }}>{sigs.join(", ")}</span> : <span style={{ opacity: 0.7 }}>—</span>}
                  </td>
                  <td style={{ padding: 10, fontSize: 12 }}>
                    <Link href={`/t/${tenantId}/runs/${runId}/observed/${o.id}`}>view</Link>
                  </td>
                </tr>
              );
            })}
            {observed.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 10, opacity: 0.7 }}>
                  No observed checks recorded for this run.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 0 }}>Reports</h3>
      <p style={{ marginTop: 0, opacity: 0.75 }}>
        Derived outputs (not sources of truth). Known: <code>run-summary.xlsx</code>, <code>run-summary.csv</code>.
      </p>

      <div style={{ border: "1px solid #ddd", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f6f6f6" }}>
            <tr>
              <th style={{ textAlign: "left", padding: 10 }}>Report</th>
              <th style={{ textAlign: "left", padding: 10 }}>Type</th>
              <th style={{ textAlign: "left", padding: 10 }}>Size</th>
              <th style={{ textAlign: "left", padding: 10 }}>Download</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((a) => {
              const filename = filenameFromKey(a.key);
              return (
                <tr key={a.id} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: 10 }}>
                    <div style={{ fontWeight: 600 }}>{filename}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      <code>{a.key}</code>
                    </div>
                  </td>
                  <td style={{ padding: 10 }}>{a.type}</td>
                  <td style={{ padding: 10 }}>{formatBytes(a.sizeBytes)}</td>
                  <td style={{ padding: 10 }}>
                    <a href={`/api/artefacts/${a.id}/download`} target="_blank" rel="noreferrer">
                      Download
                    </a>
                  </td>
                </tr>
              );
            })}
            {reports.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 10, opacity: 0.7 }}>
                  No report artefacts found for this run.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 0 }}>Jobs</h3>
      <div style={{ border: "1px solid #ddd", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f6f6f6" }}>
            <tr>
              <th style={{ textAlign: "left", padding: 10 }}>Collector</th>
              <th style={{ textAlign: "left", padding: 10 }}>Status</th>
              <th style={{ textAlign: "left", padding: 10 }}>Attempts</th>
              <th style={{ textAlign: "left", padding: 10 }}>Error</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} style={{ borderTop: "1px solid #eee" }}>
                <td style={{ padding: 10 }}>
                  <div style={{ fontWeight: 600 }}>{j.collectorId}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    <code>{j.id}</code>
                  </div>
                </td>
                <td style={{ padding: 10 }}>{j.status}</td>
                <td style={{ padding: 10 }}>{j.attempts}</td>
                <td style={{ padding: 10, fontSize: 12 }}>
                  {j.lastError ? <span style={{ color: "#a00" }}>{j.lastError}</span> : <span style={{ opacity: 0.7 }}>—</span>}
                </td>
              </tr>
            ))}
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 10, opacity: 0.7 }}>
                  No jobs found for this run.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 0 }}>Artefacts</h3>
      <p style={{ marginTop: 0, opacity: 0.75 }}>Raw artefacts (sources of truth). Reports are shown above.</p>

      <div style={{ border: "1px solid #ddd", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f6f6f6" }}>
            <tr>
              <th style={{ textAlign: "left", padding: 10 }}>Filename</th>
              <th style={{ textAlign: "left", padding: 10 }}>Type</th>
              <th style={{ textAlign: "left", padding: 10 }}>Size</th>
              <th style={{ textAlign: "left", padding: 10 }}>Download</th>
            </tr>
          </thead>
          <tbody>
            {others.map((a) => {
              const filename = filenameFromKey(a.key);
              return (
                <tr key={a.id} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: 10 }}>
                    <div style={{ fontWeight: 600 }}>{filename}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      job: <code>{a.jobId ?? "—"}</code>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.55 }}>
                      <code>{a.key}</code>
                    </div>
                  </td>
                  <td style={{ padding: 10 }}>{a.type}</td>
                  <td style={{ padding: 10 }}>{formatBytes(a.sizeBytes)}</td>
                  <td style={{ padding: 10 }}>
                    <a href={`/api/artefacts/${a.id}/download`} target="_blank" rel="noreferrer">
                      Download
                    </a>
                  </td>
                </tr>
              );
            })}
            {others.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 10, opacity: 0.7 }}>
                  No non-report artefacts recorded yet for this run.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 0 }}>Findings</h3>
      <p style={{ marginTop: 0, opacity: 0.75 }}>
        Derived view (not a source of truth). Each finding links back to its supporting observed checks.
      </p>

      <div style={{ border: "1px solid #ddd", borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f6f6f6" }}>
            <tr>
              <th style={{ textAlign: "left", padding: 10 }}>Severity</th>
              <th style={{ textAlign: "left", padding: 10 }}>Check</th>
              <th style={{ textAlign: "left", padding: 10 }}>Title</th>
              <th style={{ textAlign: "left", padding: 10 }}>Evidence</th>
              <th style={{ textAlign: "left", padding: 10 }}>Recommendation</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => {
              const supporting = observedByCheckId.get(String(f.checkId ?? "")) ?? [];
              const evidenceBadge =
                supporting.length > 0 ? badgeForObservedChecks(supporting) : { label: "no observed", tone: "muted" as const };

              const first = supporting[0] ?? null;
              const extra = supporting.length > 1 ? supporting.slice(1, 4) : [];

              return (
                <tr key={f.id} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: 10 }}>
                    <SeverityBadge severity={f.severity} />
                  </td>
                  <td style={{ padding: 10 }}>
                    <code>{f.checkId}</code>
                  </td>
                  <td style={{ padding: 10 }}>{f.title}</td>

                  <td style={{ padding: 10, fontSize: 12 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <Badge badge={evidenceBadge} />
                      <span style={{ opacity: 0.75 }}>
                        {supporting.length} observed
                      </span>
                    </div>

                    {first ? (
                      <div style={{ marginTop: 6 }}>
                        <Link href={`/t/${tenantId}/runs/${runId}/observed/${first.id}`}>view observed</Link>
                        <span style={{ opacity: 0.7 }}> · </span>
                        <span style={{ opacity: 0.8 }}>{smallTime(first.observedAt)}</span>
                        <span style={{ opacity: 0.7 }}> · </span>
                        <code style={{ opacity: 0.9 }}>{first.collectorId}</code>
                      </div>
                    ) : (
                      <div style={{ marginTop: 6, opacity: 0.7 }}>No supporting observed checks found for this checkId.</div>
                    )}

                    {extra.length > 0 ? (
                      <details style={{ marginTop: 6 }}>
                        <summary style={{ cursor: "pointer" }}>More evidence ({supporting.length - 1})</summary>
                        <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                          {extra.map((o) => (
                            <li key={o.id}>
                              <Link href={`/t/${tenantId}/runs/${runId}/observed/${o.id}`}>observed</Link>{" "}
                              <span style={{ opacity: 0.75 }}>{smallTime(o.observedAt)}</span>{" "}
                              <span style={{ opacity: 0.7 }}>·</span>{" "}
                              <code style={{ fontSize: 12 }}>{o.collectorId}</code>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </td>

                  <td style={{ padding: 10, fontSize: 12, opacity: 0.9 }}>{f.recommendation ?? "—"}</td>
                </tr>
              );
            })}

            {findings.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 10, opacity: 0.7 }}>
                  No findings recorded for this run.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer" }}>Debug: modulesEnabled</summary>
        <pre style={{ whiteSpace: "pre-wrap" }}>{safeString(run.modulesEnabled)}</pre>
      </details>
    </main>
  );
}
