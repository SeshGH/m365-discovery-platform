// apps/portal/src/app/t/[tenantId]/runs/[runId]/page.tsx
import Link from "next/link";
import {
  getRun,
  listRunJobs,
  listRunArtefacts,
  listRunObservedChecks,
  listRunFindings,
  type ObservedCheckItem
} from "@/lib/api";

function smallTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return iso;
}

function safeString(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

type CompletenessBadge = {
  label: string;
  tone: "ok" | "warn" | "bad" | "muted";
};

function badgeForObservedChecks(observed: ObservedCheckItem[]): CompletenessBadge {
  // Prefer explicit completeness signals if present (common pattern in your registry).
  // We don't assume specific checkIds yet; we scan for known fields.
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

function Badge({ badge }: { badge: CompletenessBadge }) {
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
    <span style={{ background: bg, color: fg, padding: "2px 8px", borderRadius: 999, fontSize: 12 }}>
      {badge.label}
    </span>
  );
}

export default async function RunPage({
  params
}: {
  params: { tenantId: string; runId: string };
}) {
  const { tenantId, runId } = params;

  const [run, jobs, artefacts, observed, findings] = await Promise.all([
    getRun(runId),
    listRunJobs(runId),
    listRunArtefacts(runId),
    listRunObservedChecks(runId),
    listRunFindings(runId)
  ]);

  // Tenant isolation (portal-side guardrail)
  if (run.tenant?.id !== tenantId) {
    return (
      <main>
        <p style={{ marginTop: 0 }}>
          <Link href={`/t/${tenantId}`}>← Back to tenant</Link>
        </p>
        <h2 style={{ marginTop: 0 }}>Run not in tenant</h2>
        <p style={{ opacity: 0.8 }}>
          This run belongs to tenant <code>{run.tenant?.id}</code>, not <code>{tenantId}</code>.
        </p>
      </main>
    );
  }

  const completeness = badgeForObservedChecks(observed);

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
              <div style={{ fontWeight: 700 }}>{run.status}</div>
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
            <span style={{ fontSize: 13, opacity: 0.8 }}>
              Derived from observed checks (no silent assumptions).
            </span>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
            Observed checks: {observed.length} · Findings: {findings.length} · Artefacts: {artefacts.length}
          </div>

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
            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
              No observed checks recorded yet for this run.
            </div>
          )}
        </div>
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
            {artefacts.map((a) => {
              const filename = a.key.split("/").pop() ?? a.key;
              return (
                <tr key={a.id} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: 10 }}>
                    <div style={{ fontWeight: 600 }}>{filename}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      job: <code>{a.jobId ?? "—"}</code>
                    </div>
                  </td>
                  <td style={{ padding: 10 }}>{a.type}</td>
                  <td style={{ padding: 10 }}>{a.sizeBytes}</td>
                  <td style={{ padding: 10 }}>
                    <a href={`/api/artefacts/${a.id}/download`}>Download</a>
                  </td>
                </tr>
              );
            })}
            {artefacts.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 10, opacity: 0.7 }}>
                  No artefacts recorded yet for this run.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 0 }}>Findings</h3>
      <div style={{ border: "1px solid #ddd", borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f6f6f6" }}>
            <tr>
              <th style={{ textAlign: "left", padding: 10 }}>Severity</th>
              <th style={{ textAlign: "left", padding: 10 }}>Check</th>
              <th style={{ textAlign: "left", padding: 10 }}>Title</th>
              <th style={{ textAlign: "left", padding: 10 }}>Recommendation</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => (
              <tr key={f.id} style={{ borderTop: "1px solid #eee" }}>
                <td style={{ padding: 10 }}>{f.severity}</td>
                <td style={{ padding: 10 }}>
                  <code>{f.checkId}</code>
                </td>
                <td style={{ padding: 10 }}>{f.title}</td>
                <td style={{ padding: 10, fontSize: 12, opacity: 0.9 }}>{f.recommendation}</td>
              </tr>
            ))}
            {findings.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 10, opacity: 0.7 }}>
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
