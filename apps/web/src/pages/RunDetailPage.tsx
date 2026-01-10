import React from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../lib/http";
import { Finding, severityRank } from "../lib/findings";

type Run = {
  id: string;
  tenantId: string;
  status: string;
  startedAt?: string | null;
  endedAt?: string | null;
  modulesEnabled?: any;
  createdAt: string;
  updatedAt: string;
};

type Job = {
  id: string;
  runId: string;
  collectorId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  lastError?: string | null;
  startedAt?: string | null; // derived by API from lockedAt
  endedAt?: string | null; // derived by API from updatedAt when terminal
  createdAt: string;
  updatedAt: string;
  result?: any; // Prisma Json (collector result)
};

type Artefact = {
  id: string;
  runId: string;
  jobId?: string | null;
  type: string;
  uri: string;
  bucket: string;
  key: string;
  sizeBytes?: number | null;
  hash?: string | null;
  createdAt: string;
};

type PresignResponse = {
  url: string;
  expiresAt?: string;
};

type TabKey = "findings" | "jobs" | "artefacts";

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #e5e5e5",
    background: active ? "#f5f5f5" : "transparent",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: active ? 700 : 500
  };
}

function cardStyle(): React.CSSProperties {
  return {
    border: "1px solid #e5e5e5",
    borderRadius: 10,
    padding: 12,
    background: "#fff"
  };
}

function fmtTs(ts?: string | null) {
  return ts ?? "—";
}

type CapabilityKey =
  | "entra_users"
  | "entra_enterprise_app_permissions"
  | "entra_privileged_roles"
  | "entra_guests"
  | "conditional_access"
  | "exchange_mailboxes"
  | "sharepoint_onedrive"
  | "teams_inventory"
  | "intune_devices";

const CAPABILITY_LABEL: Record<CapabilityKey, string> = {
  entra_users: "Entra users assessed",
  entra_enterprise_app_permissions: "Enterprise app permissions assessed",
  entra_privileged_roles: "Privileged role assignments assessed",
  entra_guests: "Guest/external users assessed",
  conditional_access: "Conditional Access assessed",
  exchange_mailboxes: "Exchange Online assessed (mailbox inventory)",
  sharepoint_onedrive: "SharePoint/OneDrive assessed (sites & storage)",
  teams_inventory: "Teams assessed (teams/channels/apps footprint)",
  intune_devices: "Intune assessed (enrollment/compliance)"
};

// What we WANT the scoping lens to cover (gaps are derived from this)
const SCOPING_TARGET_CAPABILITIES: CapabilityKey[] = [
  "entra_users",
  "entra_enterprise_app_permissions",
  "entra_privileged_roles",
  "entra_guests",
  "conditional_access",
  "exchange_mailboxes",
  "sharepoint_onedrive",
  "teams_inventory",
  "intune_devices"
];

// Map collectors → the capabilities they satisfy
const COLLECTOR_CAPABILITIES: Record<string, CapabilityKey[]> = {
  "entra.users": ["entra_users"],
  "entra.enterpriseApps.permissions": ["entra_enterprise_app_permissions"],
  // Future (placeholders so the UI becomes accurate the moment these land)
  "entra.roles.privilegedAssignments": ["entra_privileged_roles"],
  "entra.users.guests": ["entra_guests"],
  "entra.conditionalAccess.policies": ["conditional_access"],
  "exchange.mailboxes.inventory": ["exchange_mailboxes"],
  "sharepoint.sites.inventory": ["sharepoint_onedrive"],
  "teams.inventory": ["teams_inventory"],
  "intune.devices.inventory": ["intune_devices"]
};

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function getUsersInventoryCountFromJobs(jobs: Job[]): number | null {
  const j = jobs.find((x) => x.collectorId === "entra.users" && x.status === "succeeded");
  if (!j?.result) return null;

  // Prefer explicit summary
  const summaryCount = j.result?.summary?.userCount;
  if (typeof summaryCount === "number") return summaryCount;

  // Fallback: sometimes result may carry data.users
  const users = j.result?.data?.users;
  if (Array.isArray(users)) return users.length;

  return null;
}

function hasUsersInventoryArtefact(artefacts: Artefact[]): boolean {
  // We don’t have a filename field from the API, but MinIO keys typically contain it.
  // This is a best-effort detection for UI messaging only.
  return artefacts.some((a) => (a.key ?? "").toLowerCase().includes("users-inventory.json"));
}

export default function RunDetailPage() {
  const { runId } = useParams();
  const id = runId ?? "";

  const [run, setRun] = React.useState<Run | null>(null);
  const [findings, setFindings] = React.useState<Finding[]>([]);
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [artefacts, setArtefacts] = React.useState<Artefact[]>([]);

  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const [activeTab, setActiveTab] = React.useState<TabKey>("findings");

  // Findings filters
  const [severity, setSeverity] = React.useState<string>("all");
  const [category, setCategory] = React.useState<string>("all");
  const [status, setStatus] = React.useState<string>("all");
  const [confidence, setConfidence] = React.useState<string>("all");
  const [q, setQ] = React.useState("");

  const [downloading, setDownloading] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);

        const [r, f, j, a] = await Promise.all([
          apiGet<Run>(`/runs/${id}`),
          apiGet<Finding[]>(`/runs/${id}/findings`),
          apiGet<Job[]>(`/runs/${id}/jobs`),
          apiGet<Artefact[]>(`/runs/${id}/artefacts`)
        ]);

        if (!cancelled) {
          setRun(r);
          setFindings(f);
          setJobs(j);
          setArtefacts(a);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const filteredFindings = React.useMemo(() => {
    const needle = q.trim().toLowerCase();

    return findings
      .filter((f) => (severity === "all" ? true : f.severity === severity))
      .filter((f) => (category === "all" ? true : (f.category ?? "other") === category))
      .filter((f) => (status === "all" ? true : (f.status ?? "open") === status))
      .filter((f) => (confidence === "all" ? true : (f.confidence ?? "medium") === confidence))
      .filter((f) => {
        if (!needle) return true;
        const hay = `${f.title} ${f.checkId} ${f.ruleId ?? ""} ${f.description}`.toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => {
        const as = a.score ?? -1;
        const bs = b.score ?? -1;
        if (bs !== as) return bs - as;
        return severityRank(b.severity) - severityRank(a.severity);
      });
  }, [findings, severity, category, status, confidence, q]);

  const sortedJobs = React.useMemo(() => {
    const rank = (s: Job["status"]) => {
      switch (s) {
        case "running":
          return 3;
        case "queued":
          return 2;
        case "failed":
          return 1;
        case "succeeded":
          return 0;
        default:
          return 0;
      }
    };
    return [...jobs].sort((a, b) => {
      const ra = rank(a.status);
      const rb = rank(b.status);
      if (rb !== ra) return rb - ra;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [jobs]);

  const sortedArtefacts = React.useMemo(() => {
    return [...artefacts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [artefacts]);

  // --- Scoping Summary derived from existing data + job/capability mapping ---
  const scoping = React.useMemo(() => {
    // Job health / confidence
    const totalJobs = jobs.length;
    const jobsSucceeded = jobs.filter((j) => j.status === "succeeded").length;
    const jobsFailed = jobs.filter((j) => j.status === "failed").length;
    const jobsRunning = jobs.filter((j) => j.status === "running").length;
    const jobsQueued = jobs.filter((j) => j.status === "queued").length;

    const failedCollectors = jobs.filter((j) => j.status === "failed").map((j) => j.collectorId);

    // Inventory signals:
    // Prefer job.result.summary.userCount (derived from explicit inventory artefact work),
    // fallback to old behaviour for historical runs.
    const usersFromJob = getUsersInventoryCountFromJobs(jobs);
    const usersFromFindings = findings.filter((f) => f.checkId === "ENTRA_USERS_001").length;
    const usersCount = typeof usersFromJob === "number" ? usersFromJob : usersFromFindings;

    const usersCountSource =
      typeof usersFromJob === "number"
        ? hasUsersInventoryArtefact(artefacts)
          ? "inventory-artefact"
          : "collector-summary"
        : "findings-fallback";

    // "ENTRA_EAP_001" is currently used for high-privilege app permissions
    const enterpriseAppHighPrivCount = findings.filter((f) => f.checkId === "ENTRA_EAP_001").length;

    // Findings severity distribution
    const sevCounts = {
      critical: findings.filter((f) => f.severity === "critical").length,
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
      info: findings.filter((f) => f.severity === "info").length,
      unknown: findings.filter((f) => f.severity === "unknown").length
    };

    // Complexity drivers
    const complexityDrivers: { title: string; detail: string }[] = [];

    if (jobsFailed > 0) {
      complexityDrivers.push({
        title: "Reduced confidence (collector failures)",
        detail: `One or more collectors failed, so parts of this discovery may be incomplete. Failed collectors: ${failedCollectors.join(", ")}`
      });
    }

    if (enterpriseAppHighPrivCount > 0) {
      complexityDrivers.push({
        title: "Enterprise app permission complexity signal",
        detail: `${enterpriseAppHighPrivCount} finding(s) indicate high-privilege Microsoft Graph permissions. This often correlates with SSO/app-integration governance work (owners, review process, access model) during take-on or tenant migration.`
      });
    }

    // Coverage mapping
    const succeededCaps = uniq(
      jobs
        .filter((j) => j.status === "succeeded")
        .flatMap((j) => COLLECTOR_CAPABILITIES[j.collectorId] ?? [])
    );

    const failedCaps = uniq(
      jobs
        .filter((j) => j.status === "failed")
        .flatMap((j) => COLLECTOR_CAPABILITIES[j.collectorId] ?? [])
    );

    const covered = succeededCaps;
    const attemptedFailed = failedCaps.filter((c) => !covered.includes(c));
    const gaps = SCOPING_TARGET_CAPABILITIES.filter((c) => !covered.includes(c) && !attemptedFailed.includes(c));

    // Evidence
    const artefactsCount = artefacts.length;

    return {
      totalJobs,
      jobsSucceeded,
      jobsFailed,
      jobsRunning,
      jobsQueued,
      failedCollectors,
      usersCount,
      usersCountSource,
      enterpriseAppHighPrivCount,
      sevCounts,
      complexityDrivers,
      artefactsCount,
      coverage: {
        covered,
        attemptedFailed,
        gaps
      }
    };
  }, [jobs, findings, artefacts]);

  async function downloadArtefact(artefactId: string) {
    try {
      setDownloading((prev) => ({ ...prev, [artefactId]: true }));
      const presign = await apiGet<PresignResponse>(`/artefacts/${artefactId}/download`);
      if (!presign?.url) throw new Error("Presign response missing url");
      window.open(presign.url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      alert(e?.message ?? String(e));
    } finally {
      setDownloading((prev) => ({ ...prev, [artefactId]: false }));
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Link to="/" style={{ textDecoration: "none" }}>
          ← Back to Runs
        </Link>
      </div>

      <h2 style={{ margin: "8px 0 12px" }}>Run Detail</h2>

      {loading && <div>Loading…</div>}

      {error && (
        <div style={{ border: "1px solid #f2c2c2", background: "#fff5f5", padding: 12, borderRadius: 8 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Error</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{error}</div>
        </div>
      )}

      {!loading && !error && run && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div style={cardStyle()}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Run ID</div>
              <div
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: 12
                }}
              >
                {run.id}
              </div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>Status</div>
              <div>{run.status}</div>
            </div>

            <div style={cardStyle()}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Tenant ID</div>
              <div
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: 12
                }}
              >
                {run.tenantId}
              </div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>Window</div>
              <div style={{ fontSize: 12 }}>
                {fmtTs(run.startedAt)} → {fmtTs(run.endedAt)}
              </div>
            </div>
          </div>

          {/* Scoping Summary */}
          <div style={{ ...cardStyle(), marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Scoping Summary</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>
                  Inventory & complexity signals for take-on / migration scoping
                </div>
              </div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                Evidence available: <span style={{ fontWeight: 700 }}>{scoping.artefactsCount}</span> artefact(s)
              </div>
            </div>

            <div style={{ height: 10 }} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div style={{ border: "1px solid #efefef", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Execution confidence</div>
                <div style={{ marginTop: 4, fontSize: 13 }}>
                  Jobs:{" "}
                  <span style={{ fontWeight: 700 }}>
                    {scoping.jobsSucceeded}/{scoping.totalJobs}
                  </span>{" "}
                  succeeded
                  {scoping.jobsFailed > 0 && (
                    <span style={{ marginLeft: 8 }}>
                      • <span style={{ fontWeight: 700 }}>{scoping.jobsFailed}</span> failed
                    </span>
                  )}
                  {scoping.jobsRunning > 0 && (
                    <span style={{ marginLeft: 8 }}>
                      • <span style={{ fontWeight: 700 }}>{scoping.jobsRunning}</span> running
                    </span>
                  )}
                  {scoping.jobsQueued > 0 && (
                    <span style={{ marginLeft: 8 }}>
                      • <span style={{ fontWeight: 700 }}>{scoping.jobsQueued}</span> queued
                    </span>
                  )}
                </div>
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                  {scoping.jobsFailed > 0
                    ? "Some discovery areas may be incomplete due to collector failures."
                    : "All enabled collectors succeeded for this run."}
                </div>
              </div>

              <div style={{ border: "1px solid #efefef", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Inventory signals (current coverage)</div>
                <div style={{ marginTop: 6, fontSize: 13 }}>
                  Users discovered: <span style={{ fontWeight: 700 }}>{scoping.usersCount.toLocaleString()}</span>
                </div>
                <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>
                  Source:{" "}
                  {scoping.usersCountSource === "inventory-artefact"
                    ? "users-inventory artefact"
                    : scoping.usersCountSource === "collector-summary"
                    ? "collector job summary"
                    : "legacy findings-derived (fallback)"}
                </div>

                <div style={{ marginTop: 6, fontSize: 13 }}>
                  High-privilege app permission signals:{" "}
                  <span style={{ fontWeight: 700 }}>{scoping.enterpriseAppHighPrivCount.toLocaleString()}</span>
                </div>
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                  As we add inventory collectors, these counts will become a stronger scoping baseline.
                </div>
              </div>

              <div style={{ border: "1px solid #efefef", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Attention / prioritisation</div>
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  Critical: <b>{scoping.sevCounts.critical}</b> • High: <b>{scoping.sevCounts.high}</b> • Medium:{" "}
                  <b>{scoping.sevCounts.medium}</b> • Low: <b>{scoping.sevCounts.low}</b> • Info: <b>{scoping.sevCounts.info}</b>
                </div>
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                  Severity is primarily a security lens concept, but still useful as an “effort attention” indicator during scoping.
                </div>
              </div>
            </div>

            <div style={{ height: 12 }} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ border: "1px solid #efefef", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Complexity drivers (signals)</div>

                {scoping.complexityDrivers.length === 0 ? (
                  <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                    No complexity drivers detected from current coverage. As we add collectors, this section will become more informative.
                  </div>
                ) : (
                  <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                    {scoping.complexityDrivers.map((d, idx) => (
                      <li key={idx} style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{d.title}</div>
                        <div style={{ fontSize: 12, opacity: 0.85 }}>{d.detail}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div style={{ border: "1px solid #efefef", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Coverage (scoping lens)</div>

                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                  Coverage is derived from which collectors succeeded for this run. “Not assessed” items remain explicit scoping unknowns.
                </div>

                <div style={{ height: 8 }} />

                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                  Covered ({scoping.coverage.covered.length})
                </div>
                {scoping.coverage.covered.length === 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.75 }}>No scoping coverage detected for this run.</div>
                ) : (
                  <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
                    {scoping.coverage.covered.map((c) => (
                      <li key={c} style={{ fontSize: 12, marginBottom: 4 }}>
                        {CAPABILITY_LABEL[c]}
                      </li>
                    ))}
                  </ul>
                )}

                {scoping.coverage.attemptedFailed.length > 0 && (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                      Attempted but failed ({scoping.coverage.attemptedFailed.length})
                    </div>
                    <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
                      {scoping.coverage.attemptedFailed.map((c) => (
                        <li key={c} style={{ fontSize: 12, marginBottom: 4 }}>
                          {CAPABILITY_LABEL[c]}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                  Not assessed ({scoping.coverage.gaps.length})
                </div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {scoping.coverage.gaps.map((c) => (
                    <li key={c} style={{ fontSize: 12, marginBottom: 4 }}>
                      {CAPABILITY_LABEL[c]}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <button type="button" style={pillStyle(activeTab === "findings")} onClick={() => setActiveTab("findings")}>
              Findings ({filteredFindings.length}/{findings.length})
            </button>
            <button type="button" style={pillStyle(activeTab === "jobs")} onClick={() => setActiveTab("jobs")}>
              Jobs ({jobs.length})
            </button>
            <button type="button" style={pillStyle(activeTab === "artefacts")} onClick={() => setActiveTab("artefacts")}>
              Artefacts ({artefacts.length})
            </button>
          </div>

          {/* Findings tab */}
          {activeTab === "findings" && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
                <label style={{ fontSize: 12 }}>
                  Severity{" "}
                  <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                    <option value="all">All</option>
                    <option value="critical">critical</option>
                    <option value="high">high</option>
                    <option value="medium">medium</option>
                    <option value="low">low</option>
                    <option value="info">info</option>
                    <option value="unknown">unknown</option>
                  </select>
                </label>

                <label style={{ fontSize: 12 }}>
                  Category{" "}
                  <select value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="all">All</option>
                    <option value="identity">identity</option>
                    <option value="access">access</option>
                    <option value="application_permissions">application_permissions</option>
                    <option value="tenant_configuration">tenant_configuration</option>
                    <option value="audit_and_logging">audit_and_logging</option>
                    <option value="data_protection">data_protection</option>
                    <option value="device_management">device_management</option>
                    <option value="other">other</option>
                  </select>
                </label>

                <label style={{ fontSize: 12 }}>
                  Status{" "}
                  <select value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="all">All</option>
                    <option value="open">open</option>
                    <option value="acknowledged">acknowledged</option>
                    <option value="resolved">resolved</option>
                    <option value="false_positive">false_positive</option>
                  </select>
                </label>

                <label style={{ fontSize: 12 }}>
                  Confidence{" "}
                  <select value={confidence} onChange={(e) => setConfidence(e.target.value)}>
                    <option value="all">All</option>
                    <option value="high">high</option>
                    <option value="medium">medium</option>
                    <option value="low">low</option>
                  </select>
                </label>

                <label style={{ fontSize: 12, flex: "1 1 240px" }}>
                  Search{" "}
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="title, checkId, ruleId, description…"
                    style={{ width: "100%" }}
                  />
                </label>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Score", "Severity", "Category", "Status", "Confidence", "Title", "Check", "Created"].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: "left",
                            padding: 8,
                            borderBottom: "1px solid #e5e5e5",
                            fontSize: 12,
                            opacity: 0.8
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFindings.map((f) => (
                      <tr key={f.id}>
                        <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{f.score ?? "—"}</td>
                        <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{f.severity}</td>
                        <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{f.category ?? "other"}</td>
                        <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{f.status ?? "open"}</td>
                        <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{f.confidence ?? "medium"}</td>
                        <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                          <div style={{ fontWeight: 600 }}>{f.title}</div>
                          <div style={{ fontSize: 12, opacity: 0.75 }}>{f.description}</div>
                        </td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: "1px solid #f0f0f0",
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                            fontSize: 12
                          }}
                        >
                          {f.ruleId ?? f.checkId}
                        </td>
                        <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0", fontSize: 12 }}>{f.createdAt}</td>
                      </tr>
                    ))}
                    {filteredFindings.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ padding: 12, opacity: 0.7 }}>
                          No findings match the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Jobs tab */}
          {activeTab === "jobs" && (
            <>
              <h3 style={{ margin: "8px 0 8px" }}>Jobs</h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Collector", "Status", "Attempts", "Started", "Ended", "Last error"].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: "left",
                            padding: 8,
                            borderBottom: "1px solid #e5e5e5",
                            fontSize: 12,
                            opacity: 0.8
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedJobs.map((j) => (
                      <tr key={j.id}>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: "1px solid #f0f0f0",
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                            fontSize: 12
                          }}
                        >
                          {j.collectorId}
                        </td>
                        <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{j.status}</td>
                        <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{j.attempts}</td>
                        <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0", fontSize: 12 }}>{j.startedAt ?? "—"}</td>
                        <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0", fontSize: 12 }}>{j.endedAt ?? "—"}</td>
                        <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0", fontSize: 12, whiteSpace: "pre-wrap" }}>
                          {j.lastError ?? "—"}
                        </td>
                      </tr>
                    ))}
                    {sortedJobs.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ padding: 12, opacity: 0.7 }}>
                          No jobs found for this run.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Artefacts tab */}
          {activeTab === "artefacts" && (
            <>
              <h3 style={{ margin: "8px 0 8px" }}>Artefacts</h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Type", "Object key", "Size", "Created", "Download"].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: "left",
                            padding: 8,
                            borderBottom: "1px solid #e5e5e5",
                            fontSize: 12,
                            opacity: 0.8
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedArtefacts.map((a) => (
                      <tr key={a.id}>
                        <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{a.type}</td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: "1px solid #f0f0f0",
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                            fontSize: 12
                          }}
                          title={`${a.bucket}/${a.key}`}
                        >
                          {a.bucket}/{a.key}
                        </td>
                        <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0", fontSize: 12 }}>
                          {typeof a.sizeBytes === "number" ? a.sizeBytes.toLocaleString() : "—"}
                        </td>
                        <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0", fontSize: 12 }}>{a.createdAt}</td>
                        <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                          <button
                            type="button"
                            onClick={() => downloadArtefact(a.id)}
                            disabled={!!downloading[a.id]}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 8,
                              border: "1px solid #e5e5e5",
                              background: "#fff",
                              cursor: downloading[a.id] ? "not-allowed" : "pointer",
                              fontSize: 12
                            }}
                          >
                            {downloading[a.id] ? "Preparing…" : "Download"}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {sortedArtefacts.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ padding: 12, opacity: 0.7 }}>
                          No artefacts found for this run.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
                Downloads use presigned URLs generated by the API. Links open in a new tab.
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
