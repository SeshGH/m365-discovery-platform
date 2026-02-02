"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

  // callback for "view evidence" from inside Findings
  const goToEvidenceObservedChecks = () => {
    setTab("evidence");
    // wait for tab content to render, then scroll
    requestAnimationFrame(() => {
      document.getElementById("evidence-observed-checks")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

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
      {tab === "findings" ? <FindingsTab vm={vm} onGoEvidence={goToEvidenceObservedChecks} /> : null}
      {tab === "evidence" ? <EvidenceTab vm={vm} /> : null}
      {tab === "jobs" ? <JobsTab vm={vm} /> : null}
    </main>
  );
}

function SummaryTab({ vm }: { vm: RunDetailViewModel }) {
  const jumpToHeadlineSizing = () => {
    requestAnimationFrame(() => {
      document.getElementById("headline-estate-sizing")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const jumpToEvidence = () => {
    requestAnimationFrame(() => {
      document.getElementById("evidence-observed-checks")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const jumpToJobs = () => {
    requestAnimationFrame(() => {
      document.getElementById("jobs-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

    const headlineMetrics = useMemo(
    () => vm.environmentOverview.filter((m) => m.key !== "signals"),
    [vm.environmentOverview]
  );

  return (
    <>
      {/* Scoping narrative */}
      <div className="card card-pad" style={{ marginTop: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16 }}>Scoping summary</div>
            <div className="subtle" style={{ marginTop: 4 }}>
              This run provides an inventory-style view of the tenant using <strong>observed checks</strong> (source of truth)
              and raw artefacts. Use the headline sizing and the <strong>Headline estate sizing</strong> section below to
              understand estate size and scope.
            </div>
          </div>
          <div className="subtle">Run {vm.run.id}</div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            onClick={jumpToHeadlineSizing}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--card)",
              cursor: "pointer",
              fontWeight: 700,
              color: "var(--fg)"
            }}
          >
            Jump to headline sizing
          </button>

          <button
            type="button"
            onClick={jumpToEvidence}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "transparent",
              cursor: "pointer",
              fontWeight: 700,
              color: "var(--fg)"
            }}
          >
            View evidence
          </button>

          <button
            type="button"
            onClick={jumpToJobs}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "transparent",
              cursor: "pointer",
              fontWeight: 700,
              color: "var(--fg)"
            }}
          >
            View jobs
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 900 }}>What do we have?</div>
          <div className="subtle" style={{ marginTop: 4 }}>
            Start with headline sizing for best-known counts. Use Evidence to inspect the underlying observed checks and
            artefacts if you need detail.
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 900 }}>What should we review next?</div>
          <div className="subtle" style={{ marginTop: 4 }}>
            When you’re ready to move from inventory to interpretation, check the <strong>Findings</strong> tab for derived
            signals (risks / notable conditions), and use the <strong>Evidence</strong> tab to inspect the underlying data.
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="subtle">Completeness</span>
          <Badge badge={vm.completenessBadge} />
          <span className="subtle">
            {vm.completenessSignals.hasCompletenessIssues
              ? "Some checks reported warnings (e.g. permissionDenied / truncated / incomplete). Interpret inventory + findings with that context."
              : "No completeness warnings detected in observed checks."}
          </span>
        </div>
      </div>

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

      {/* Headline estate sizing */}
      <div id="headline-estate-sizing" className="card card-pad" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <h3 style={{ marginTop: 0, marginBottom: 6 }}>Headline estate sizing</h3>
          <span className="subtle">Best-known counts (observed checks)</span>
        </div>

        <div className="subtle" style={{ marginTop: 6 }}>
          These numbers are derived from <strong>observed check</strong> payloads only (no silent assumptions). A value of{" "}
          <code>—</code> means we haven’t yet emitted a check that includes that count in a known shape.
        </div>

        {vm.completenessSignals.hasCompletenessIssues ? (
          <div className="callout warn" style={{ marginTop: 10 }}>
            <strong>Inventory completeness warnings</strong>
            <div className="subtle" style={{ marginTop: 6 }}>
              Some checks reported <code>permissionDenied</code>, <code>truncated</code>, or <code>incomplete</code>. Treat
              counts as indicative and validate via Evidence where needed.
            </div>
          </div>
        ) : null}

        {headlineMetrics.length === 0 ? (
          <div className="subtle" style={{ marginTop: 10 }}>
            No observed checks recorded yet, so no headline sizing is available.
          </div>
        ) : (
          <>
            <div className="env-grid" style={{ marginTop: 10 }}>
              {headlineMetrics.map((m) => {
                const needsFallbackHint = String(m.value ?? "").trim() === "—" && !m.hint;
                const hint = needsFallbackHint ? "Not derived from observed data yet." : m.hint;

                return (
                  <div key={m.key} className={`env-card tone-${m.tone}`}>
                    <div className="env-k">{m.label}</div>
                    <div className="env-v">{m.value}</div>
                    {hint ? <div className="env-h">{hint}</div> : null}
                    {m.sources && m.sources.length > 0 ? (
                      <div className="env-s">
                        <span className="subtle">sources:</span> <span className="muted2">{m.sources.join(", ")}</span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer" }}>How to validate a number</summary>
              <div className="subtle" style={{ marginTop: 8 }}>
                Use the Evidence tab to view the observed check payload(s) listed under each card’s <em>sources</em>. If a
                number looks surprising, confirm completeness signals and inspect the raw artefact outputs for that collector.
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

function severityRank(s: string): number {
  const x = String(s ?? "").toLowerCase();
  if (x === "critical") return 0;
  if (x === "high") return 1;
  if (x === "medium") return 2;
  if (x === "low") return 3;
  if (x === "info" || x === "informational") return 4;
  return 9;
}

function severityTone(s: string): "bad" | "warn" | "muted" {
  const x = String(s ?? "").toLowerCase();
  if (x === "critical" || x === "high") return "bad";
  if (x === "medium") return "warn";
  return "muted";
}

function FindingsTab({ vm, onGoEvidence }: { vm: RunDetailViewModel; onGoEvidence: () => void }) {
  const findingsSorted = useMemo(() => {
    const xs = vm.findings.slice();
    xs.sort((a, b) => {
      const ra = severityRank(a.severity);
      const rb = severityRank(b.severity);
      if (ra !== rb) return ra - rb;
      return String(a.title ?? "").localeCompare(String(b.title ?? ""));
    });
    return xs;
  }, [vm.findings]);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (findingsSorted.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId && findingsSorted.some((f) => f.id === selectedId)) return;
    setSelectedId(findingsSorted[0].id);
  }, [findingsSorted, selectedId]);

  const selected = useMemo(() => findingsSorted.find((f) => f.id === selectedId) ?? null, [findingsSorted, selectedId]);

  const evidenceObserved = useMemo(() => {
    if (!selected) return [];
    // best-effort evidence linkage using checkId equality
    return vm.observedChecks.filter((o) => o.checkId === selected.checkId);
  }, [selected, vm.observedChecks]);

  const evidenceJobIds = useMemo(() => {
    const ids = new Set<string>();
    for (const o of evidenceObserved) if (o.jobId) ids.add(o.jobId);
    return Array.from(ids);
  }, [evidenceObserved]);

  const evidenceArtefacts = useMemo(() => {
    if (evidenceJobIds.length === 0) return [];
    return vm.artefacts.filter((a) => a.jobId && evidenceJobIds.includes(a.jobId));
  }, [vm.artefacts, evidenceJobIds]);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div>
          <h3 style={{ marginBottom: 6 }}>Findings</h3>
          <p className="subtle" style={{ marginTop: 0 }}>
            Findings are derived signals. Evidence is shown from observed checks (source of truth).
          </p>
        </div>
        <div className="subtle">
          {vm.findings.length} finding{vm.findings.length === 1 ? "" : "s"} · {vm.observedChecks.length} observed check
          {vm.observedChecks.length === 1 ? "" : "s"}
        </div>
      </div>

      <div
        className="card"
        style={{
          display: "grid",
          gridTemplateColumns: "380px 1fr",
          gap: 12,
          padding: 12,
          alignItems: "start"
        }}
      >
        {/* Left: list */}
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 14,
            overflow: "hidden",
            background: "var(--card)"
          }}
        >
          <div style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontWeight: 800 }}>All findings</div>
            <div className="subtle" style={{ marginTop: 4 }}>
              Click an item to see details + evidence.
            </div>
          </div>

          <div style={{ maxHeight: 520, overflow: "auto" }}>
            {findingsSorted.map((f) => {
              const active = f.id === selectedId;
              const tone = severityTone(f.severity);
              const sevBadge: BadgeModel = { label: String(f.severity), tone };

              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelectedId(f.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: 12,
                    border: "none",
                    borderTop: "1px solid var(--border)",
                    background: active ? "rgba(0,0,0,0.04)" : "transparent",
                    cursor: "pointer",
                    color: "var(--fg)"
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <Badge badge={sevBadge} />
                    <div style={{ fontWeight: 800 }}>{f.title}</div>
                  </div>
                  <div className="subtle" style={{ marginTop: 6 }}>
                    check: <code>{f.checkId}</code>
                  </div>
                </button>
              );
            })}

            {findingsSorted.length === 0 ? (
              <div style={{ padding: 12 }} className="subtle">
                No findings were recorded for this run.
              </div>
            ) : null}
          </div>
        </div>

        {/* Right: detail */}
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 14,
            padding: 12,
            background: "var(--card)"
          }}
        >
          {!selected ? (
            <div className="subtle">
              Select a finding on the left to view details. If there are no findings, this run may still have observed checks
              and artefacts to review under Evidence.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>{selected.title}</div>
                  <div className="subtle" style={{ marginTop: 4 }}>
                    check: <code>{selected.checkId}</code>
                  </div>
                </div>

                <Badge badge={{ label: String(selected.severity), tone: severityTone(selected.severity) }} />
              </div>

              {vm.completenessSignals.hasCompletenessIssues ? (
                <div className="callout warn" style={{ marginTop: 12 }}>
                  <strong>Completeness signals present</strong>
                  <div className="subtle" style={{ marginTop: 6 }}>
                    Findings are derived from observed checks. This run includes warnings (e.g. truncated, permissionDenied) that
                    may affect interpretation.
                  </div>
                </div>
              ) : null}

              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Recommendation</div>
                {selected.recommendation ? (
                  <div style={{ whiteSpace: "pre-wrap" }}>{selected.recommendation}</div>
                ) : (
                  <div className="subtle">No recommendation provided for this finding.</div>
                )}
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <div style={{ fontWeight: 800 }}>Evidence</div>

                  <button
                    type="button"
                    className="link subtle"
                    onClick={onGoEvidence}
                    style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
                  >
                    View supporting evidence →
                  </button>
                </div>

                <div className="subtle" style={{ marginTop: 6 }}>
                  Evidence is shown from observed checks (source of truth) and related artefacts (raw outputs), best-effort.
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Observed checks</div>

                  {evidenceObserved.length === 0 ? (
                    <div className="subtle">
                      No observed checks matched this finding’s <code>checkId</code>. This indicates the portal cannot currently
                      link evidence for this finding without additional referencing.
                    </div>
                  ) : (
                    <div className="card" style={{ overflow: "hidden" }}>
                      <table className="table table-scan">
                        <thead>
                          <tr>
                            <th>Observed</th>
                            <th>Collector</th>
                            <th>Signals</th>
                            <th>Data</th>
                          </tr>
                        </thead>
                        <tbody>
                          {evidenceObserved.map((o) => (
                            <tr key={o.id}>
                              <td className="subtle" style={{ width: 170 }}>
                                {o.observedAt ?? "—"}
                              </td>
                              <td style={{ fontSize: 12 }}>
                                <code>{o.collectorId}</code>
                                {o.jobId ? (
                                  <div className="subtle" style={{ marginTop: 4 }}>
                                    job: <code>{o.jobId}</code>
                                  </div>
                                ) : null}
                              </td>
                              <td className="subtle" style={{ width: 220 }}>
                                {o.signals.length > 0 ? o.signals.join(", ") : "—"}
                              </td>
                              <td style={{ width: 80 }}>
                                <Link className="link link-action" href={o.viewHref}>
                                  View
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Related artefacts</div>

                  {evidenceArtefacts.length === 0 ? (
                    <div className="subtle">
                      No related artefacts found for the matched observed checks (job-linked best-effort). See the Evidence tab
                      for full artefact lists.
                    </div>
                  ) : (
                    <div className="card" style={{ overflow: "hidden" }}>
                      <table className="table table-scan">
                        <thead>
                          <tr>
                            <th>Filename</th>
                            <th>Size</th>
                            <th>Download</th>
                          </tr>
                        </thead>
                        <tbody>
                          {evidenceArtefacts.map((a) => (
                            <tr key={a.id}>
                              <td>
                                <div style={{ fontWeight: 700 }}>{a.filename}</div>
                                <div className="subtle" style={{ fontSize: 12 }}>
                                  job: <code>{a.jobId ?? "—"}</code>
                                </div>
                              </td>
                              <td className="subtle">{a.sizeLabel}</td>
                              <td style={{ width: 110 }}>
                                <a className="link link-action" href={a.downloadHref} target="_blank" rel="noreferrer">
                                  Download
                                </a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="subtle" style={{ marginTop: 10 }}>
                  Tip: the Evidence tab shows the full observed-check timeline and all artefacts for the run.
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function norm(s: unknown): string {
  return String(s ?? "").toLowerCase().trim();
}

function EvidenceTab({ vm }: { vm: RunDetailViewModel }) {
  const [query, setQuery] = useState("");
  const [groupByCollector, setGroupByCollector] = useState(true);

  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return vm.observedChecks;

    return vm.observedChecks.filter((o) => {
      const hay = [o.checkId, o.collectorId, o.jobId ?? "", (o.signals ?? []).join(" "), o.observedAt ?? ""]
        .map((x) => norm(x))
        .join(" | ");
      return hay.includes(q);
    });
  }, [vm.observedChecks, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const o of filtered) {
      const k = o.collectorId || "(no collectorId)";
      const cur = map.get(k) ?? [];
      cur.push(o);
      map.set(k, cur);
    }
    const keys = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
    return keys.map((k) => ({ collectorId: k, items: map.get(k) ?? [] }));
  }, [filtered]);

  return (
    <>
      <h3 id="evidence-observed-checks">Observed checks</h3>
      <p className="subtle">Source of truth for posture + completeness signals. Findings are derived from these checks.</p>

      {/* Controls */}
      <div
        className="card card-pad"
        style={{
          marginBottom: 12,
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          justifyContent: "space-between"
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label className="subtle" style={{ fontWeight: 700 }}>
            Filter
          </label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search checkId / collectorId / signals / jobId…"
            style={{
              width: 420,
              maxWidth: "80vw",
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--card)",
              color: "var(--fg)"
            }}
          />
          {query ? (
            <button
              type="button"
              className="link"
              onClick={() => setQuery("")}
              style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
            >
              Clear
            </button>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label className="subtle" style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={groupByCollector}
              onChange={(e) => setGroupByCollector(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            Group by collector
          </label>
          <span className="subtle">
            Showing {filtered.length} of {vm.observedChecks.length}
          </span>
        </div>
      </div>

      {/* Observed checks display */}
      {filtered.length === 0 ? (
        <div className="card card-pad" style={{ marginBottom: 12 }}>
          <div className="subtle">No observed checks match the current filter.</div>
        </div>
      ) : groupByCollector ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 12 }}>
          {grouped.map((g) => (
            <div key={g.collectorId} className="card" style={{ overflow: "hidden" }}>
              <div style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontWeight: 900 }}>
                  <code>{g.collectorId}</code>
                </div>
                <div className="subtle" style={{ marginTop: 4 }}>
                  {g.items.length} check{g.items.length === 1 ? "" : "s"}
                </div>
              </div>

              <table className="table table-scan table-oc">
                <thead>
                  <tr>
                    <th>Observed</th>
                    <th>Check</th>
                    <th>Signals</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((o) => (
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
                      <td style={{ fontSize: 12, color: "var(--muted)", width: 240 }}>
                        {o.signals.length > 0 ? o.signals.join(", ") : "—"}
                      </td>
                      <td style={{ fontSize: 12, width: 80 }}>
                        <Link className="link link-action" href={o.viewHref}>
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ) : (
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
              {filtered.map((o) => (
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
            </tbody>
          </table>
        </div>
      )}

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
      <h3 id="jobs-table">Jobs</h3>
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
