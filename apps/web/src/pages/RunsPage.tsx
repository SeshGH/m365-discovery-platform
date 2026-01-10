import React from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../lib/http";

type RunSummary = {
  id: string;
  tenantId: string;
  status: string;
  startedAt?: string | null;
  endedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export default function RunsPage() {
  const [runs, setRuns] = React.useState<RunSummary[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await apiGet<RunSummary[]>("/runs");
        if (!cancelled) setRuns(data);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <h2 style={{ margin: "8px 0 12px" }}>Runs</h2>

      {loading && <div>Loading…</div>}
      {error && (
        <div style={{ border: "1px solid #f2c2c2", background: "#fff5f5", padding: 12, borderRadius: 8 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Error</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{error}</div>
        </div>
      )}

      {!loading && !error && runs.length === 0 && <div>No runs found.</div>}

      {!loading && !error && runs.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Run ID", "Tenant ID", "Status", "Started", "Ended", "Created"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e5e5", fontSize: 12, opacity: 0.8 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                    <Link to={`/runs/${r.id}`} style={{ textDecoration: "none" }}>
                      {r.id}
                    </Link>
                  </td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}>
                    {r.tenantId}
                  </td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{r.status}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{r.startedAt ?? "—"}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{r.endedAt ?? "—"}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{r.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
