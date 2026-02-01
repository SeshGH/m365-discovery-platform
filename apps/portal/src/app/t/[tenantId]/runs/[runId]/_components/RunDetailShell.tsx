"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type BadgeTone = "ok" | "warn" | "bad" | "muted";
export type BadgeModel = { label: string; tone: BadgeTone };

export type RunDetailViewModel = {
  tenantId: string;
  runId: string;

  run: {
    id: string;
    status: string;
    dataProfile: string;
    triggeredBy: string | null;
    createdAt: string | null;
    startedAt: string | null;
    endedAt: string | null;
    counts: { jobs: number; findings: number; artefacts: number };
    modulesEnabledDebug: string;
  };

  runStatusBadge: BadgeModel;
  phaseBadge: BadgeModel;
  completenessBadge: BadgeModel;

  jobSummary: { queued: number; running: number; succeeded: number; failed: number; other: number };

  completenessSignals: {
    hasCompletenessIssues: boolean;
    permissionDenied: string[];
    truncatedChecks: string[];
    incompleteChecks: string[];
    observedCount: number;
    findingsCount: number;
    artefactsCount: number;
  };

  environmentOverview: Array<{
    key: string;
    label: string;
    value: string;
    tone: "ok" | "warn" | "bad" | "muted";
    hint?: string;
    sources?: string[];
  }>;

  observedChecks: Array<{
    id: string;
    observedAt: string | null;
    checkId: string;
    collectorId: string;
    jobId: string | null;
    signals: string[];
    viewHref: string;
  }>;

  jobs: Array<{
    id: string;
    collectorId: string;
    status: string;
    attempts: number;
    lastError: string | null;
  }>;

  reports: Array<{
    id: string;
    filename: string;
    key: string;
    type: string;
    sizeLabel: string;
    downloadHref: string;
  }>;

  artefacts: Array<{
    id: string;
    filename: string;
    key: string;
    type: string;
    jobId: string | null;
    sizeLabel: string;
    downloadHref: string;
  }>;

  findings: Array<{
    id: string;
    severity: string;
    checkId: string;
    title: string;
    recommendation: string | null;
  }>;
};

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

type TabKey = "summary" | "findings" | "evidence" | "jobs";

function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 12px",
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: active ? "var(--card)" : "transparent",
        color: active ? "var(--fg)" : "var(--muted)",
        fontWeight: active ? 800 : 600,
        cursor: "pointer"
      }}
    >
      {children}
    </button>
  );
}

export function RunDetailShell({ vm }: { vm: RunDetailViewModel }) {
  const [tab, setTab] = useState<TabKey>("summary");

  const tabs = useMemo(
    () => [
      { key: "summary" as const, label: "Summary" },
      { key: "findings" as const, label: "Findings" },
      { key: "evidence" as const, label: "Evidence" },
      { key: "jobs" as const, label: "Jobs" }
    ],
    []
  );

  return (
    <main>
      <p style={{ margin: "10px 0 0 0" }}>
        <Link className="link" href={`/t/${vm.tenantId}`}>
          ← Back to tenant
        </Link>
      </p>

      <h2 style={{ marginBottom: 8 }}>Run</h2>

      {/* HERO STRIP */}
      <div className="hero">
        <div className="hero-top">
          <div className="hero-left">
            <div className="hero-title">
              <span className="subtle">Run ID</span>{" "}
              <span className="hero-code">
                <code>{vm.run.id}</code>
              </span>
            </div>

            <div className="hero-badges">
              <Badge badge={vm.runStatusBadge} />
              <Badge badge={vm.phaseBadge} />
              <Badge badge={vm.completenessBadge} />
              {vm.completenessSignals.hasCompletenessIssues ? (
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
              <div className="metric-v">{vm.run.counts.jobs}</div>
            </div>
            <div className="metric">
              <div className="metric-k">Findings</div>
              <div className="metric-v">{vm.run.counts.findings}</div>
            </div>
            <div className="metric">
              <div className="metric-k">Artefacts</div>
              <div className="metric-v">{vm.run.counts.artefacts}</div>
            </div>
          </div>
        </div>

        <div className="hero-sub">
          <div className="hero-sub-item">
            <span className="subtle">Profile</span> <strong>{vm.run.dataProfile}</strong>
          </div>
          <div className="hero-sub-item">
            <span className="subtle">Triggered</span> <span>{vm.run.triggeredBy ?? "—"}</span>
          </div>
          <div className="hero-sub-item">
            <span className="subtle">Created</span> <span>{vm.run.createdAt ?? "—"}</span>
          </div>
          <div className="hero-sub-item">
            <span className="subtle">Started</span> <span>{vm.run.startedAt ?? "—"}</span>
          </div>
          <div className="hero-sub-item">
            <span className="subtle">Ended</span> <span>{vm.run.endedAt ?? "—"}</span>
          </div>
        </div>

        <div className="hero-foot subtle">
          Jobs: q {vm.jobSummary.queued} · r {vm.jobSummary.running} · ok {vm.jobSummary.succeeded} · fail{" "}
          {vm.jobSummary.failed}
          {vm.jobSummary.other > 0 ? ` · other ${vm.jobSummary.other}` : ""}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, marginBottom: 12 }}>
        {tabs.map((t) => (
          <TabButton key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
          </TabButton>
        ))}
      </div>

      {tab === "summary" ? <SummaryTab vm={vm} /> : null}
      {tab === "findings" ? <FindingsTab vm={vm} /> : null}
      {tab === "evidence" ? <EvidenceTab vm={vm} /> : null}
      {tab === "jobs" ? <JobsTab vm={vm} /> : null}
    </main>
  );
}

function SummaryTab({ vm }: { vm: RunDetailViewModel }) {
  return (
    <>
      <div className="grid-2" style={{ marginBottom: 12, marginTop: 12 }}>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Run details</h3>
          <div className="kv">
            <div className="k">Tenant</div>
            <div className="v">
              <code>{vm.tenantId}</code>
            </div>

            <div className="k">Run</div>
            <div className="v">
              <code>{vm.runId}</code>
            </div>

            <div className="k">Status</div>
            <div className="v">
              <strong>{vm.run.status}</strong>{" "}
              <span style={{ marginLeft: 8 }}>
                <Badge badge={vm.phaseBadge} />
              </span>
            </div>

            <div className="k">Counts</div>
            <div className="v">
              jobs {vm.run.counts.jobs} · findings {vm.run.counts.findings} · artefacts {vm.run.counts.artefacts}
            </div>
          </div>
        </div>

        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Completeness</h3>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Badge badge={vm.completenessBadge} />
            <span className="subtle">Derived from observed checks (no silent assumptions).</span>
          </div>

          <div className="subtle" style={{ marginTop: 10 }}>
            Observed checks: {vm.completenessSignals.observedCount} · Findings: {vm.completenessSignals.findingsCount} ·
            Artefacts: {vm.completenessSignals.artefactsCount}
          </div>

          {vm.completenessSignals.hasCompletenessIssues ? (
            <div style={{ marginTop: 10, fontSize: 13 }}>
              {vm.completenessSignals.permissionDenied.length > 0 ? (
                <div style={{ marginBottom: 6 }}>
                  <strong>Permission denied:</strong>{" "}
                  <span style={{ color: "var(--muted)" }}>{vm.completenessSignals.permissionDenied.join(", ")}</span>
                </div>
              ) : null}

              {vm.completenessSignals.truncatedChecks.length > 0 ? (
                <div style={{ marginBottom: 6 }}>
                  <strong>Truncated checks:</strong>{" "}
                  <span style={{ color: "var(--muted)" }}>{vm.completenessSignals.truncatedChecks.join(", ")}</span>
                </div>
              ) : null}

              {vm.completenessSignals.incompleteChecks.length > 0 ? (
                <div>
                  <strong>Incomplete checks:</strong>{" "}
                  <span style={{ color: "var(--muted)" }}>{vm.completenessSignals.incompleteChecks.join(", ")}</span>
                </div>
              ) : null}

              {vm.completenessSignals.permissionDenied.length === 0 &&
              vm.completenessSignals.truncatedChecks.length === 0 &&
              vm.completenessSignals.incompleteChecks.length === 0 ? (
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

      {/* Environment overview */}
      <div className="card card-pad" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <h3 style={{ marginTop: 0, marginBottom: 6 }}>Environment overview</h3>
          <span className="subtle">Derived from observed checks (best effort)</span>
        </div>

        {vm.environmentOverview.length === 0 ? (
          <div className="subtle">No observed checks recorded yet, so no environment overview is available.</div>
        ) : (
          <>
            <div className="env-grid" style={{ marginTop: 8 }}>
              {vm.environmentOverview.map((m) => (
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
                These numbers are only shown when they can be derived from observed check payloads. If a value is “—”, it
                means we haven’t yet emitted a check that includes that count in a known shape.
              </div>
            </details>
          </>
        )}
      </div>

      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: "pointer", color: "var(--muted)" }}>Debug: modulesEnabled</summary>
        <pre className="pre">{vm.run.modulesEnabledDebug}</pre>
      </details>
    </>
  );
}

function FindingsTab({ vm }: { vm: RunDetailViewModel }) {
  return (
    <>
      <h3>Findings</h3>
      <p className="subtle">
        Derived view (not a source of truth). Use observed checks in Evidence to understand completeness context.
      </p>

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
            {vm.findings.map((f) => (
              <tr key={f.id}>
                <td>{f.severity}</td>
                <td>
                  <code>{f.checkId}</code>
                </td>
                <td>{f.title}</td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>{f.recommendation ?? "—"}</td>
              </tr>
            ))}
            {vm.findings.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: "var(--muted)" }}>
                  No findings recorded for this run.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function EvidenceTab({ vm }: { vm: RunDetailViewModel }) {
  return (
    <>
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
            {vm.observedChecks.map((o) => (
              <tr key={o.id}>
                <td style={{ width: 170 }}>
                  <div style={{ color: "var(--muted)" }}>{o.observedAt ?? "—"}</div>
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
                <td style={{ fontSize: 12, color: "var(--muted)" }}>{o.signals.length > 0 ? o.signals.join(", ") : "—"}</td>
                <td style={{ fontSize: 12 }}>
                  <Link className="link link-action" href={o.viewHref}>
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {vm.observedChecks.length === 0 ? (
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
            {vm.reports.map((a) => (
              <tr key={a.id}>
                <td>
                  <div style={{ fontWeight: 700 }}>{a.filename}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    <code>{a.key}</code>
                  </div>
                </td>
                <td>{a.type}</td>
                <td>{a.sizeLabel}</td>
                <td>
                  <a className="link link-action" href={a.downloadHref} target="_blank" rel="noreferrer">
                    Download
                  </a>
                </td>
              </tr>
            ))}
            {vm.reports.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: "var(--muted)" }}>
                  No report artefacts found for this run.
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
            {vm.artefacts.map((a) => (
              <tr key={a.id}>
                <td>
                  <div style={{ fontWeight: 700 }}>{a.filename}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    job: <code>{a.jobId ?? "—"}</code>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted2)" }}>
                    <code>{a.key}</code>
                  </div>
                </td>
                <td>{a.type}</td>
                <td>{a.sizeLabel}</td>
                <td>
                  <a className="link link-action" href={a.downloadHref} target="_blank" rel="noreferrer">
                    Download
                  </a>
                </td>
              </tr>
            ))}
            {vm.artefacts.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: "var(--muted)" }}>
                  No non-report artefacts recorded yet for this run.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function JobsTab({ vm }: { vm: RunDetailViewModel }) {
  return (
    <>
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
            {vm.jobs.map((j) => (
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
                  {j.lastError ? (
                    <span style={{ color: "var(--bad-fg)" }}>{j.lastError}</span>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>—</span>
                  )}
                </td>
              </tr>
            ))}
            {vm.jobs.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: "var(--muted)" }}>
                  No jobs found for this run.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
