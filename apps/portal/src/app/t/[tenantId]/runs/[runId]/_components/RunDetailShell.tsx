// apps/portal/src/app/t/[tenantId]/runs/[runId]/_components/RunDetailShell.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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

  confidence: {
    level: "high" | "medium" | "low";
    tone: BadgeTone;
    reasons: string[];
  };

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

  nextActions: Array<{
    id: string;
    title: string;
    tone: BadgeTone;
    detail: string;
    cta: {
      label: string;
      evidenceQuery?: string;
      goToTab?: "summary" | "findings" | "evidence" | "jobs";
    };
  }>;

  environmentOverview: Array<{
    key: string;
    label: string;
    value: string;
    tone: "ok" | "warn" | "bad" | "muted";
    hint?: string;
    sources?: string[];

    // Option A: registry-provided CTA metadata (string-only; UI just consumes)
    evidenceQuery?: string; // NOTE: empty string is meaningful ("show all")
    evidenceHint?: string;
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
    references: unknown;
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
type FindingsKindFilter = "all" | "posture" | "coverage";

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

// How often to re-fetch server data while a run is in progress.
const POLL_INTERVAL_MS = 5_000;

// Statuses from which a run will never transition. Polling stops here.
const TERMINAL_STATUSES = new Set(["succeeded", "failed"]);

function isTerminalStatus(s: unknown): boolean {
  return TERMINAL_STATUSES.has(String(s ?? "").toLowerCase().trim());
}

function norm(s: unknown): string {
  return String(s ?? "").toLowerCase().trim();
}

function isCoverageFinding(f: { checkId: string }): boolean {
  return f.checkId.includes("_COVERAGE_");
}

function isMissingValue(v: string | null | undefined): boolean {
  const x = norm(v);
  return x === "" || x === "—" || x === "-" || x === "n/a" || x === "na" || x === "unknown";
}

function findMetricValue(metrics: RunDetailViewModel["environmentOverview"], key: string): string | null {
  const m = metrics.find((x) => x.key === key);
  if (!m) return null;
  return m.value ?? null;
}

function EstateSizingNarrative({
  metrics,
  hasCompletenessIssues
}: {
  metrics: RunDetailViewModel["environmentOverview"];
  hasCompletenessIssues: boolean;
}) {
  const users = findMetricValue(metrics, "users");
  const groups = findMetricValue(metrics, "groups");
  const apps = findMetricValue(metrics, "apps");
  const ca = findMetricValue(metrics, "ca");

  const exoMail = findMetricValue(metrics, "exo_mailboxes_total");
  const mailFallback = findMetricValue(metrics, "mailboxes");
  const mailboxes = !isMissingValue(exoMail) ? exoMail : mailFallback;

  const parts: Array<{ label: string; value: string | null }> = [
    { label: "Users", value: users },
    { label: "Groups", value: groups },
    { label: "Enterprise apps", value: apps },
    { label: "CA policies", value: ca },
    { label: "Mailboxes", value: mailboxes }
  ];

  const known = parts.filter((p) => !isMissingValue(p.value ?? "—"));
  const missing = parts.length - known.length;

  const tone = hasCompletenessIssues ? "warn" : known.length >= 2 ? "ok" : "warn";

  const line =
    known.length === 0
      ? "Best-known counts are not available for this run yet."
      : `Best-known counts: ${known.map((p) => `${p.label} ${p.value}`).join(" · ")}.`;

  const tail =
    missing > 0
      ? ` ${missing} metric${missing === 1 ? "" : "s"} not observed in a known shape (shown as "—" below).`
      : "";

  const caveat = hasCompletenessIssues
    ? " Completeness warnings exist — treat these as indicative and validate via Evidence where needed."
    : "";

  return (
    <div className={`callout ${tone === "warn" ? "warn" : ""}`} style={{ marginTop: 10 }}>
      <strong>At a glance</strong>
      <div className="subtle" style={{ marginTop: 6 }}>
        {line}
        {tail}
        {caveat}
      </div>
    </div>
  );
}

export function RunDetailShell({ vm }: { vm: RunDetailViewModel }) {
  const [tab, setTab] = useState<TabKey>("summary");

  // Evidence filter must be shell-owned so Next Actions can drive it.
  const [evidenceQuery, setEvidenceQuery] = useState<string>("");

  // Findings kind filter is shell-owned so Summary tab can pre-select it.
  const [findingsKindFilter, setFindingsKindFilter] = useState<FindingsKindFilter>("all");

  // ── Auto-refresh while run is in progress ─────────────────────────────────
  // router.refresh() re-runs the server component and patches the RSC tree in
  // place — the active tab and all other client state are preserved.
  const router = useRouter();
  const isTerminal = isTerminalStatus(vm.run.status);

  useEffect(() => {
    if (isTerminal) return;
    const id = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isTerminal, router]);

  const tabs = useMemo(
    () => [
      { key: "summary" as const, label: "Summary" },
      { key: "findings" as const, label: "Findings" },
      { key: "evidence" as const, label: "Evidence" },
      { key: "jobs" as const, label: "Jobs" }
    ],
    []
  );

  const goToEvidenceObservedChecks = (q?: string) => {
    if (typeof q === "string") setEvidenceQuery(q);
    setTab("evidence");
    requestAnimationFrame(() => {
      document.getElementById("evidence-observed-checks")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const goToReports = () => {
    setTab("evidence");
    requestAnimationFrame(() => {
      document.getElementById("evidence-reports")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const goToHeadlineSizing = () => {
    setTab("summary");
    requestAnimationFrame(() => {
      document.getElementById("headline-estate-sizing")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const goToJobs = () => {
    setTab("jobs");
    requestAnimationFrame(() => {
      document.getElementById("jobs-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const goToFindings = (filter?: FindingsKindFilter) => {
    if (filter) setFindingsKindFilter(filter);
    setTab("findings");
  };

  const onAction = (a: RunDetailViewModel["nextActions"][number]) => {
    if (a.cta.goToTab === "findings") return goToFindings();
    if (a.cta.goToTab === "summary") return setTab("summary");
    if (a.cta.goToTab === "jobs") return goToJobs();

    // Evidence-driven CTAs
    if (a.cta.label.toLowerCase().includes("report")) return goToReports();
    return goToEvidenceObservedChecks(a.cta.evidenceQuery ?? "");
  };

  const confidenceBadge: BadgeModel = useMemo(() => {
    const label = `confidence: ${vm.confidence.level}`;
    return { label, tone: vm.confidence.tone };
  }, [vm.confidence.level, vm.confidence.tone]);

  const runQualityBadge: BadgeModel = useMemo(() => {
    const partial = vm.findings.some(isCoverageFinding);
    return partial
      ? { label: "run quality: partial", tone: "warn" }
      : { label: "run quality: complete", tone: "ok" };
  }, [vm.findings]);

  return (
    <main>
      <p style={{ margin: "10px 0 0 0" }}>
        <Link className="link" href={`/t/${vm.tenantId}`}>
          ← Back to tenant
        </Link>
      </p>

      <h2 style={{ marginBottom: 8 }}>Run</h2>

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
              <Badge badge={confidenceBadge} />
              <Badge badge={runQualityBadge} />
              <span className="subtle" style={{ marginLeft: 6 }}>
                {vm.confidence.reasons.join(" · ")}
              </span>
              {!isTerminal && (
                <span className="subtle" style={{ marginLeft: 8, fontSize: "0.82em" }}>
                  · updating automatically…
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
          Jobs: q {vm.jobSummary.queued} · r {vm.jobSummary.running} · ok {vm.jobSummary.succeeded} · fail {vm.jobSummary.failed}
          {vm.jobSummary.other > 0 ? ` · other ${vm.jobSummary.other}` : ""}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, marginBottom: 12 }}>
        {tabs.map((t) => (
          <TabButton key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
          </TabButton>
        ))}
      </div>

{tab === "summary" ? (
  <SummaryTab
    vm={vm}
    onGoHeadlineSizing={goToHeadlineSizing}
    onGoEvidence={() => goToEvidenceObservedChecks("")}
    onGoEvidenceQuery={(q) => goToEvidenceObservedChecks(q)}
    onGoReports={goToReports}
    onGoJobs={goToJobs}
    onGoFindings={goToFindings}
    onAction={onAction}
  />
) : null}

{tab === "findings" ? (
  <FindingsTab
    vm={vm}
    onGoEvidence={(q) => goToEvidenceObservedChecks(q)}
    kindFilter={findingsKindFilter}
    onKindFilterChange={setFindingsKindFilter}
    onRefreshFindings={async () => {
      const res = await fetch(
        `/api/tenants/${vm.tenantId}/runs/${vm.runId}/findings/derive`,
        { method: "POST" }
      );

      if (!res.ok) {
        console.error("Failed to re-derive findings", res.status);
        alert("Failed to refresh findings. Please try again.");
        return;
      }

      router.refresh();
    }}
  />
) : null}

{tab === "evidence" ? (
  <EvidenceTab
    vm={vm}
    query={evidenceQuery}
    onQueryChange={setEvidenceQuery}
  />
) : null}

{tab === "jobs" ? <JobsTab vm={vm} /> : null}
    </main>
  );
}

function SummaryTab({
  vm,
  onGoHeadlineSizing,
  onGoEvidence,
  onGoEvidenceQuery,
  onGoReports,
  onGoJobs,
  onGoFindings,
  onAction
}: {
  vm: RunDetailViewModel;
  onGoHeadlineSizing: () => void;
  onGoEvidence: () => void;
  onGoEvidenceQuery: (q: string) => void;
  onGoReports: () => void;
  onGoJobs: () => void;
  onGoFindings: (filter?: FindingsKindFilter) => void;
  onAction: (a: RunDetailViewModel["nextActions"][number]) => void;
}) {
  const headlineMetrics = useMemo(() => vm.environmentOverview.filter((m) => m.key !== "signals"), [vm.environmentOverview]);

  const canCtaEvidence = (m: RunDetailViewModel["environmentOverview"][number]) => m.evidenceQuery !== undefined;

  const groupedMetrics = useMemo(() => {
    const byKey = new Map(headlineMetrics.map((m) => [m.key, m]));
    const used = new Set<string>();

    const groups = METRIC_GROUPS
      .map(({ label, keys }) => {
        const metrics = keys
          .map((k) => byKey.get(k))
          .filter((m): m is RunDetailViewModel["environmentOverview"][number] => m !== undefined);
        metrics.forEach((m) => used.add(m.key));
        return { label, metrics };
      })
      .filter((g) => g.metrics.length > 0);

    const rest = headlineMetrics.filter((m) => !used.has(m.key));
    return { groups, rest };
  }, [headlineMetrics]);

  const findingCounts = useMemo(() => {
    const coverage = vm.findings.filter(isCoverageFinding).length;
    return { coverage, posture: vm.findings.length - coverage };
  }, [vm.findings]);

  return (
    <>
      <div className="card card-pad" style={{ marginTop: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16 }}>Scoping summary</div>
            <div className="subtle" style={{ marginTop: 4 }}>
              This run provides an inventory-style view of the tenant using <strong>observed checks</strong> (source of truth) and raw
              artefacts. Use headline sizing and Environment overview to understand estate size and scope.
            </div>
          </div>
          <div className="subtle">Run {vm.run.id}</div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onGoHeadlineSizing}
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
            onClick={onGoEvidence}
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
            View evidence
          </button>

          <button
            type="button"
            onClick={onGoReports}
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
            Reports
          </button>

          <button
            type="button"
            onClick={() => onGoFindings()}
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
            Findings
          </button>

          <button
            type="button"
            onClick={onGoJobs}
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
            Jobs
          </button>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 900 }}>Next actions</div>
          <div className="subtle" style={{ marginTop: 4 }}>
            Derived from explicit observed completeness signals only (no silent assumptions).
          </div>

          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            {vm.nextActions.map((a) => (
              <div key={a.id} className="card card-pad" style={{ background: "var(--card)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 900 }}>{a.title}</div>
                  <Badge badge={{ label: a.tone, tone: a.tone }} />
                </div>
                <div className="subtle" style={{ marginTop: 6 }}>
                  {a.detail}
                </div>
                <div style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => onAction(a)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: "1px solid var(--border)",
                      background: "var(--card)",
                      cursor: "pointer",
                      fontWeight: 800,
                      color: "var(--fg)"
                    }}
                  >
                    {a.cta.label}
                  </button>

                  {a.cta.evidenceQuery ? (
                    <button
                      type="button"
                      className="link subtle"
                      onClick={() => onGoEvidenceQuery("")}
                      style={{ marginLeft: 10, background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
                    >
                      Clear evidence filter
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="subtle">Completeness</span>
          <Badge badge={vm.completenessBadge} />
          <span className="subtle">
            {vm.completenessSignals.hasCompletenessIssues
              ? "Some checks reported warnings (permissionDenied / truncated / incomplete). Interpret inventory + findings with that context."
              : "No completeness warnings detected in observed checks."}
          </span>
        </div>
      </div>

      {vm.findings.length > 0 ? (
        <div className="card card-pad" style={{ marginBottom: 12, marginTop: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900, fontSize: 15 }}>Findings quality &amp; coverage</div>
            <div style={{ display: "flex", gap: 16 }}>
              <button
                type="button"
                className="link"
                onClick={() => onGoFindings("posture")}
                style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--fg)" }}
              >
                <strong>{findingCounts.posture}</strong>{" "}
                <span className="subtle">posture finding{findingCounts.posture !== 1 ? "s" : ""}</span>
              </button>
              <button
                type="button"
                className="link"
                onClick={() => onGoFindings("coverage")}
                style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--fg)" }}
              >
                <strong>{findingCounts.coverage}</strong>{" "}
                <span className="subtle">coverage finding{findingCounts.coverage !== 1 ? "s" : ""}</span>
              </button>
            </div>
          </div>
          {findingCounts.coverage > 0 ? (
            <div className="subtle" style={{ marginTop: 6 }}>
              Coverage findings (checkId contains <code>_COVERAGE_</code>) indicate scan visibility limitations — missing permissions or incomplete data collection. They do not reflect tenant risk by themselves.
            </div>
          ) : (
            <div className="subtle" style={{ marginTop: 6 }}>
              No coverage limitations detected — all collectors completed successfully.
            </div>
          )}
        </div>
      ) : null}

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
          <h3 style={{ marginTop: 0 }}>Completeness & confidence</h3>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Badge badge={vm.completenessBadge} />
            <Badge badge={{ label: `confidence: ${vm.confidence.level}`, tone: vm.confidence.tone }} />
            <span className="subtle">Derived from observed checks only.</span>
          </div>

          <div className="subtle" style={{ marginTop: 10 }}>
            Observed checks: {vm.completenessSignals.observedCount} · Findings: {vm.completenessSignals.findingsCount} · Artefacts:{" "}
            {vm.completenessSignals.artefactsCount}
          </div>

          <div className="subtle" style={{ marginTop: 8 }}>
            {vm.confidence.reasons.join(" · ")}
          </div>

          {vm.completenessSignals.hasCompletenessIssues ? (
            <div style={{ marginTop: 10, fontSize: 13 }}>
              {vm.completenessSignals.permissionDenied.length > 0 ? (
                <div style={{ marginBottom: 6 }}>
                  <strong>Permission denied:</strong>{" "}
                  <span style={{ color: "var(--muted)" }}>{vm.completenessSignals.permissionDenied.join(", ")}</span>{" "}
                  <button
                    type="button"
                    className="link subtle"
                    onClick={() => onGoEvidenceQuery("permissionDenied")}
                    style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
                  >
                    View permission-denied evidence →
                  </button>
                </div>
              ) : null}

              {vm.completenessSignals.truncatedChecks.length > 0 ? (
                <div style={{ marginBottom: 6 }}>
                  <strong>Truncated checks:</strong>{" "}
                  {vm.completenessSignals.truncatedChecks.map((checkId, i) => (
                    <span key={checkId}>
                      {i > 0 && ", "}
                      <button
                        type="button"
                        className="link subtle"
                        onClick={() => onGoEvidenceQuery(checkId)}
                        style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
                      >
                        {checkId}
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              {vm.completenessSignals.incompleteChecks.length > 0 ? (
                <div>
                  <strong>Incomplete checks:</strong>{" "}
                  {vm.completenessSignals.incompleteChecks.map((checkId, i) => (
                    <span key={checkId}>
                      {i > 0 && ", "}
                      <button
                        type="button"
                        className="link subtle"
                        onClick={() => onGoEvidenceQuery(checkId)}
                        style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
                      >
                        {checkId}
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              {vm.completenessSignals.permissionDenied.length === 0 &&
              vm.completenessSignals.truncatedChecks.length === 0 &&
              vm.completenessSignals.incompleteChecks.length === 0 ? (
                <div style={{ color: "var(--muted)" }}>Completeness warning present but no explicit details found in observed data.</div>
              ) : null}
            </div>
          ) : (
            <div className="subtle" style={{ marginTop: 10 }}>
              No completeness warnings detected in observed checks.
            </div>
          )}
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 12 }} id="headline-estate-sizing">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <h3 style={{ marginTop: 0, marginBottom: 6 }}>Headline estate sizing</h3>
          <span className="subtle">Best-known counts (observed checks)</span>
        </div>

        <div className="subtle" style={{ marginTop: 6 }}>
          These numbers are derived from observed check payloads only (no silent assumptions). A value of "—" means we haven’t yet
          emitted a check that includes that count in a known shape.
        </div>

        <EstateSizingNarrative metrics={headlineMetrics} hasCompletenessIssues={vm.completenessSignals.hasCompletenessIssues} />

        {vm.completenessSignals.hasCompletenessIssues ? (
          <div className="callout warn" style={{ marginTop: 10 }}>
            <strong>Inventory completeness warnings</strong>
            <div className="subtle" style={{ marginTop: 6 }}>
              Some checks reported permissionDenied, truncated, or incomplete. Treat counts as indicative and validate via Evidence
              where needed.
            </div>
          </div>
        ) : null}

        {headlineMetrics.length === 0 ? (
          <div className="subtle" style={{ marginTop: 10 }}>
            No observed checks recorded yet, so no environment overview is available.
          </div>
        ) : (
          <>
            {groupedMetrics.groups.map((g, i) => (
              <div
                key={g.label}
                style={{
                  marginTop: i === 0 ? 0 : 28,
                  padding: 16,
                  border: "1px solid var(--border)",
                  borderLeft: "3px solid var(--border)",
                  background: "var(--panel)",
                  borderRadius: "var(--radius)"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontWeight: 600,
                    fontSize: 19,
                    color: "var(--fg)",
                    marginBottom: 12,
                    paddingBottom: 10,
                    borderBottom: "1px solid var(--border)"
                  }}
                >
                  <SectionIcon name={g.label} />
                  {g.label}
                </div>
                <div className="env-grid">
                  {g.metrics.map((m) => (
                    <HeadlineMetricCard key={m.key} m={m} onGoEvidenceQuery={onGoEvidenceQuery} canCtaEvidence={canCtaEvidence} />
                  ))}
                </div>
              </div>
            ))}

            {groupedMetrics.rest.length > 0 ? (
              <div
                style={{
                  marginTop: 28,
                  padding: 16,
                  border: "1px solid var(--border)",
                  borderLeft: "3px solid var(--border)",
                  background: "var(--panel)",
                  borderRadius: "var(--radius)"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontWeight: 600,
                    fontSize: 19,
                    color: "var(--fg)",
                    marginBottom: 12,
                    paddingBottom: 10,
                    borderBottom: "1px solid var(--border)"
                  }}
                >
                  <SectionIcon name="Other" />
                  Other
                </div>
                <div className="env-grid">
                  {groupedMetrics.rest.map((m) => (
                    <HeadlineMetricCard key={m.key} m={m} onGoEvidenceQuery={onGoEvidenceQuery} canCtaEvidence={canCtaEvidence} />
                  ))}
                </div>
              </div>
            ) : null}

            <details style={{ marginTop: 14 }}>
              <summary style={{ cursor: "pointer" }}>How to validate a number</summary>
              <div className="subtle" style={{ marginTop: 8 }}>
                Use the Evidence tab to locate the observed check(s) listed in "sources", then inspect the underlying payload and
                related artefacts.
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

type EnvMetricItem = RunDetailViewModel["environmentOverview"][number];

function interpretMetric(m: EnvMetricItem): string | null {
  if (m.value === "—") return null;

  const num = parseFloat(m.value.replace(/,/g, ""));
  const hasNum = Number.isFinite(num);
  const capped = m.value.includes("(capped)");

  switch (m.key) {
    case "apps":
      if (!hasNum) return null;
      if (capped) return "Scan capped — footprint indicative only";
      if (num >= 100) return "High app footprint";
      if (num >= 20) return "Moderate app footprint";
      return "Low app footprint";

    case "spo_sharing_capability":
      if (m.value === "Anyone links allowed") return "External sharing risk";
      if (m.value === "External users only") return "External sharing enabled";
      if (m.value === "Existing guests only") return "Limited external sharing";
      if (m.value === "Disabled") return "Sharing fully restricted";
      return null;

    case "mdm_devices_total":
      if (!hasNum) return null;
      if (num === 0) return "No managed devices observed";
      if (capped) return "Large estate — device scan capped";
      if (num >= 500) return "Large managed device estate";
      if (num >= 50) return "Active MDM deployment";
      return "Small MDM footprint";

    case "mdm_noncompliant_devices":
      if (!hasNum) return null;
      if (num === 0) return "Healthy compliance posture";
      if (num >= 10) return "Compliance remediation needed";
      return "Minor compliance gaps present";

    case "exo_mailboxes_total":
      if (!hasNum) return null;
      if (num === 0) return "No Exchange mailboxes observed";
      if (num >= 500) return "Large mailbox estate";
      if (num >= 50) return "Mailbox estate present";
      return "Small mailbox deployment";

    case "ca":
      if (!hasNum) return null;
      if (num === 0) return "No CA policies — open access risk";
      if (num >= 10) return "Mature conditional access posture";
      return "Basic conditional access posture";

    case "users":
      if (!hasNum) return null;
      if (num >= 10000) return "Large enterprise directory";
      if (num >= 1000) return "Large user directory";
      if (num >= 100) return "Mid-size user base";
      return "Small user base";

    case "global_admins":
      if (!hasNum) return null;
      if (num === 0) return "No active Global Administrators observed";
      if (num <= 2) return "Tightly controlled privileged access";
      if (num <= 5) return "Broad privileged access surface";
      return "High number of Global Administrators";

    default:
      return null;
  }
}

function HeadlineMetricCard({
  m,
  onGoEvidenceQuery,
  canCtaEvidence
}: {
  m: RunDetailViewModel["environmentOverview"][number];
  onGoEvidenceQuery: (q: string) => void;
  canCtaEvidence: (m: RunDetailViewModel["environmentOverview"][number]) => boolean;
}) {
  const interpretation = interpretMetric(m);
  return (
    <div className={`env-card tone-${m.tone}`}>
      <div className="env-k">{m.label}</div>
      <div className="env-v">{m.value}</div>
      {interpretation ? (
        <div style={{ fontSize: 11, fontStyle: "italic", color: "var(--muted)", marginTop: 2 }}>
          {interpretation}
        </div>
      ) : null}
      {m.hint ? <div className="env-h">{m.hint}</div> : null}

      {m.sources && m.sources.length > 0 ? (
        <div className="env-s">
          <span className="subtle">sources:</span> <span className="muted2">{m.sources.join(", ")}</span>
        </div>
      ) : null}

      {canCtaEvidence(m) ? (
        <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="link link-action"
            onClick={() => onGoEvidenceQuery(m.evidenceQuery ?? "")}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontWeight: 800,
              color: "var(--fg)"
            }}
            title={m.evidenceHint ?? "View supporting observed checks in Evidence"}
          >
            View evidence →
          </button>
        </div>
      ) : null}
    </div>
  );
}

const METRIC_GROUPS: ReadonlyArray<{ label: string; keys: ReadonlyArray<string> }> = [
  { label: "Entra ID", keys: ["users", "groups", "apps", "ca", "global_admins"] },
  { label: "Exchange", keys: ["exo_mailboxes_total", "exo_mailboxes_near50", "exo_mailboxes_over50", "mailboxes"] },
  { label: "SharePoint", keys: ["spo_sites_in_report", "spo_sharing_capability", "spo_storage_used_gb"] },
  { label: "Intune", keys: ["mdm_devices_total", "mdm_noncompliant_devices"] }
];

function SectionIcon({ name }: { name: string }) {
  const p = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style: { flexShrink: 0 },
    "aria-hidden": true
  };
  if (name === "Entra ID") return <svg {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>;
  if (name === "Exchange")
    return (
      <svg {...p}>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
      </svg>
    );
  if (name === "SharePoint") return <svg {...p}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>;
  if (name === "Intune")
    return (
      <svg {...p}>
        <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
        <path d="M12 18h.01" />
      </svg>
    );
  return (
    <svg {...p}>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
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

function resolveEvidenceCheckIds(finding: RunDetailViewModel["findings"][number]): string[] {
  const refs = finding.references;
  if (
    refs !== null &&
    typeof refs === "object" &&
    "observedChecks" in refs
  ) {
    const { observedChecks } = refs as { observedChecks: unknown };
    if (Array.isArray(observedChecks) && observedChecks.length > 0) {
      const ids = observedChecks.filter((id): id is string => typeof id === "string");
      if (ids.length > 0) return ids;
    }
  }
  return [finding.checkId];
}

function FindingsTab({
  vm,
  onGoEvidence,
  kindFilter,
  onKindFilterChange,
  onRefreshFindings
}: {
  vm: RunDetailViewModel;
  onGoEvidence: (q?: string) => void;
  kindFilter: FindingsKindFilter;
  onKindFilterChange: (f: FindingsKindFilter) => void;
  onRefreshFindings: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const kindCounts = useMemo(() => {
    const coverage = vm.findings.filter(isCoverageFinding).length;
    return { all: vm.findings.length, coverage, posture: vm.findings.length - coverage };
  }, [vm.findings]);

  const findingsFiltered = useMemo(() => {
    let xs = vm.findings;
    if (kindFilter === "coverage") xs = xs.filter(isCoverageFinding);
    else if (kindFilter === "posture") xs = xs.filter((f) => !isCoverageFinding(f));

    const q = norm(query);
    if (!q) return xs;

    return xs.filter((f) => {
      const hay = [f.title, f.checkId, f.severity].map((x) => norm(x)).join(" | ");
      return hay.includes(q);
    });
  }, [vm.findings, query, kindFilter]);

  const findingsSorted = useMemo(() => {
    const xs = findingsFiltered.slice();
    xs.sort((a, b) => {
      const ra = severityRank(a.severity);
      const rb = severityRank(b.severity);
      if (ra !== rb) return ra - rb;
      return String(a.title ?? "").localeCompare(String(b.title ?? ""));
    });
    return xs;
  }, [findingsFiltered]);

  const effectiveSelectedId = useMemo(() => {
    if (selectedId && findingsSorted.some((f) => f.id === selectedId)) return selectedId;
    return findingsSorted[0]?.id ?? null;
  }, [selectedId, findingsSorted]);

  const selected = useMemo(() => {
    if (!effectiveSelectedId) return null;
    return findingsSorted.find((f) => f.id === effectiveSelectedId) ?? null;
  }, [findingsSorted, effectiveSelectedId]);

  const evidenceObserved = useMemo(() => {
    if (!selected) return [];
    const ids = resolveEvidenceCheckIds(selected);
    return vm.observedChecks.filter((o) => ids.includes(o.checkId));
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

  const evidenceStatsByFindingId = useMemo(() => {
    const stats = new Map<string, { observed: number; artefacts: number }>();

    const observedByCheckId = new Map<string, RunDetailViewModel["observedChecks"]>();
    for (const o of vm.observedChecks) {
      const k = String(o.checkId ?? "");
      const cur = observedByCheckId.get(k) ?? [];
      cur.push(o);
      observedByCheckId.set(k, cur);
    }

    const artefactsByJobId = new Map<string, number>();
    for (const a of vm.artefacts) {
      if (!a.jobId) continue;
      artefactsByJobId.set(a.jobId, (artefactsByJobId.get(a.jobId) ?? 0) + 1);
    }

    for (const f of vm.findings) {
      const ids = resolveEvidenceCheckIds(f);
      const jobIds = new Set<string>();
      let observedCount = 0;

      for (const id of ids) {
        const matching = observedByCheckId.get(id) ?? [];
        observedCount += matching.length;
        for (const o of matching) if (o.jobId) jobIds.add(o.jobId);
      }

      let artefactCount = 0;
      for (const id of jobIds) artefactCount += artefactsByJobId.get(id) ?? 0;

      stats.set(f.id, { observed: observedCount, artefacts: artefactCount });
    }

    return stats;
  }, [vm.findings, vm.observedChecks, vm.artefacts]);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ marginBottom: 6 }}>Findings</h3>
          <p className="subtle" style={{ marginTop: 0 }}>
            Findings are a derived "what matters" view. Supporting evidence is shown from observed checks (source of truth) and related
            artefacts (raw outputs), best-effort.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {(["all", "posture", "coverage"] as const).map((f) => (
              <TabButton key={f} active={kindFilter === f} onClick={() => onKindFilterChange(f)}>
                {f === "all" ? `All (${kindCounts.all})` : f === "posture" ? `Posture (${kindCounts.posture})` : `Coverage (${kindCounts.coverage})`}
              </TabButton>
            ))}
          </div>

          <span className="subtle">
            Showing {findingsSorted.length} of {kindFilter === "all" ? vm.findings.length : kindFilter === "coverage" ? kindCounts.coverage : kindCounts.posture}
          </span>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter findings…"
            style={{
              width: 260,
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
              className="link subtle"
              onClick={() => setQuery("")}
              style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
            >
              Clear
            </button>
          ) : null}

          <button
            type="button"
            className="link subtle"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              try { await onRefreshFindings(); } finally { setRefreshing(false); }
            }}
            style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            {refreshing ? "Refreshing…" : "Re-derive findings"}
          </button>
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
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 14,
            overflow: "hidden",
            background: "var(--card)"
          }}
        >
          <div style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontWeight: 800 }}>
              {kindFilter === "coverage" ? "Coverage findings" : kindFilter === "posture" ? "Posture findings" : "All findings"}
            </div>
            <div className="subtle" style={{ marginTop: 4 }}>
              Select an item to see details and supporting evidence.
            </div>
          </div>

          <div style={{ maxHeight: 520, overflow: "auto" }}>
            {findingsSorted.map((f) => {
              const active = f.id === effectiveSelectedId;
              const tone = severityTone(f.severity);
              const sevBadge = { label: String(f.severity), tone };

              const st = evidenceStatsByFindingId.get(f.id) ?? { observed: 0, artefacts: 0 };
              const evidenceLabel =
                st.observed === 0 && st.artefacts === 0 ? "no evidence linked" : `${st.observed} observed · ${st.artefacts} artefacts`;

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
                    <Badge badge={{ label: isCoverageFinding(f) ? "Coverage" : "Posture", tone: "muted" }} />
                    <div style={{ fontWeight: 800 }}>{f.title}</div>
                  </div>

                  <div className="subtle" style={{ marginTop: 6 }}>
                    check: <code>{f.checkId}</code>
                  </div>

                  <div className="subtle" style={{ marginTop: 6 }}>
                    evidence: {evidenceLabel}
                  </div>
                </button>
              );
            })}

            {findingsSorted.length === 0 ? (
              <div style={{ padding: 12 }} className="subtle">
                No findings match the current filter.
              </div>
            ) : null}
          </div>
        </div>

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
              Select a finding on the left to view details. If there are no findings, this run may still have observed checks and
              artefacts to review under Evidence.
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
                    This run includes warnings (e.g. truncated, permissionDenied, incomplete) that may affect interpretation. Use the
                    evidence below to confirm details.
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
                  <div style={{ fontWeight: 800 }}>Supporting evidence</div>

                  <button
                    type="button"
                    className="link subtle"
                    onClick={() => onGoEvidence(resolveEvidenceCheckIds(selected)[0] ?? selected.checkId)}
                    style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
                  >
                    View in Evidence tab →
                  </button>
                </div>

                <div className="subtle" style={{ marginTop: 6 }}>
                  Evidence is best-effort: observed checks are linked via <code>references.observedChecks</code> for derived findings,
                  and artefacts are linked by jobId where available.
                </div>

                <div className="subtle" style={{ marginTop: 6 }}>
                  Linked observed checks:{" "}
                  <code>{resolveEvidenceCheckIds(selected).join(", ")}</code>
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Observed checks</div>

                  {evidenceObserved.length === 0 ? (
                    <div className="subtle">
                      No observed checks linked to this finding. Use Evidence to search for related collector activity.
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
                      No related artefacts found for the matched observed checks (job-linked best-effort). See Evidence for full
                      artefact lists.
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

function looksLikeRunEntityId(q: string): boolean {
  const x = norm(q);
  if (!x) return false;
  return x.startsWith("c") && x.length >= 18 && /^[a-z0-9]+$/.test(x);
}

function EvidenceTab({
  vm,
  query,
  onQueryChange
}: {
  vm: RunDetailViewModel;
  query: string;
  onQueryChange: (q: string) => void;
}) {
  const [groupByCollector, setGroupByCollector] = useState(true);

  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return vm.observedChecks;

    const exactByCheckId = vm.observedChecks.filter((o) => norm(o.checkId) === q);
    if (exactByCheckId.length > 0) return exactByCheckId;

    const exactByCollectorId = vm.observedChecks.filter((o) => norm(o.collectorId) === q);
    if (exactByCollectorId.length > 0) return exactByCollectorId;

    const exactByJobId = vm.observedChecks.filter((o) => o.jobId && norm(o.jobId) === q);
    if (exactByJobId.length > 0) return exactByJobId;

    if (looksLikeRunEntityId(q)) {
      const exactById = vm.observedChecks.filter((o) => norm(o.id) === q);
      if (exactById.length > 0) return exactById;
    }

    return vm.observedChecks.filter((o) => {
      const hay = [o.checkId, o.collectorId, o.id, o.jobId ?? "", (o.signals ?? []).join(" "), o.observedAt ?? ""]
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

  const resolvedQueryLabel = useMemo(() => {
    if (!query) return null;
    const match = vm.environmentOverview.find((m) => typeof m.evidenceQuery === "string" && m.evidenceQuery === query);
    return match ? match.label : null;
  }, [vm.environmentOverview, query]);

  return (
    <>
      <h3 id="evidence-observed-checks">Observed checks</h3>
      <p className="subtle">Source of truth for posture + completeness signals. Findings are derived from these checks.</p>

      {query ? (
        <div className="callout" style={{ marginBottom: 12 }}>
          <strong>{resolvedQueryLabel ? `Filtered by: ${resolvedQueryLabel}` : "Evidence filter active"}</strong>
          <div className="subtle" style={{ marginTop: 4 }}>
            {resolvedQueryLabel ? (
              <>
                Showing observed checks for <strong>{resolvedQueryLabel}</strong> · filter: <code>{query}</code>
              </>
            ) : (
              <>
                Showing observed checks matching: <code>{query}</code>
              </>
            )}
          </div>
          <button
            type="button"
            className="link link-action"
            onClick={() => onQueryChange("")}
            style={{ marginTop: 6, background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
          >
            Clear filter
          </button>
        </div>
      ) : null}

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
            onChange={(e) => onQueryChange(e.target.value)}
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

      <h3 id="evidence-reports">Reports</h3>
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
                  {j.lastError ? <span style={{ color: "var(--bad-fg)" }}>{j.lastError}</span> : <span style={{ color: "var(--muted)" }}>—</span>}
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