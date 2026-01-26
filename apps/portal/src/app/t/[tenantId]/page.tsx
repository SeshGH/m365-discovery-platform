// apps/portal/src/app/t/[tenantId]/page.tsx
import Link from "next/link";
import { getTenantAuth, listRuns } from "@/lib/api";

function sortByCreatedDesc(a: { createdAt: string }, b: { createdAt: string }) {
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "succeeded"
      ? { bg: "#e7f7ed", fg: "#116329" }
      : status === "failed"
        ? { bg: "#fde7e9", fg: "#a4262c" }
        : status === "running"
          ? { bg: "#e8f0fe", fg: "#1a73e8" }
          : status === "queued"
            ? { bg: "#f1f3f4", fg: "#444" }
            : { bg: "#eee", fg: "#444" };

  return (
    <span
      style={{
        background: tone.bg,
        color: tone.fg,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        whiteSpace: "nowrap"
      }}
    >
      {status}
    </span>
  );
}

function ProfileBadge({ profile }: { profile: string }) {
  const tone =
    profile === "full"
      ? { bg: "#fff4d6", fg: "#8a5a00" }
      : { bg: "#f1f3f4", fg: "#444" };

  return (
    <span
      style={{
        background: tone.bg,
        color: tone.fg,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12
      }}
    >
      {profile}
    </span>
  );
}

export default async function TenantPage({
  params
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  const [auth, runs] = await Promise.all([
    getTenantAuth(tenantId),
    listRuns()
  ]);

  const tenantRunsAll = runs
    .filter((r) => r.tenant?.id === tenantId)
    .sort(sortByCreatedDesc);

  const maxRows = 20;
  const tenantRuns = tenantRunsAll.slice(0, maxRows);

  return (
    <main>
      <p style={{ marginTop: 0 }}>
        <Link href="/tenants">← Back to tenants</Link>
      </p>

      <h2 style={{ marginTop: 0 }}>
        {auth.tenant.displayName ?? "(no display name)"}{" "}
        <span style={{ fontSize: 14, opacity: 0.7 }}>
          ({auth.tenant.primaryDomain})
        </span>
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 16 }}>Tenant</h3>
          <div style={{ fontSize: 12, opacity: 0.8 }}>ID</div>
          <div><code>{auth.tenant.id}</code></div>

          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 8 }}>Tenant GUID</div>
          <div><code>{auth.tenant.tenantGuid}</code></div>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 16 }}>Auth</h3>
          {auth.auth ? (
            <>
              <div>Status: <strong>{String(auth.auth.status)}</strong></div>
              {auth.auth.lastError ? (
                <div style={{ color: "#a00", marginTop: 6 }}>
                  {auth.auth.lastError}
                </div>
              ) : (
                <div style={{ opacity: 0.7, marginTop: 6 }}>No errors</div>
              )}
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
                Consented: {auth.auth.consentedAt ?? "—"}
              </div>
            </>
          ) : (
            <div style={{ opacity: 0.7 }}>No auth record</div>
          )}
        </div>
      </div>

      <h3 style={{ marginTop: 0 }}>Recent runs</h3>
      <p style={{ marginTop: 0, opacity: 0.75 }}>
        Source: <code>GET /runs</code> (filtered client-side).{" "}
        Showing {tenantRuns.length} of {tenantRunsAll.length}.
      </p>

      <div style={{ border: "1px solid #ddd", borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f6f6f6" }}>
            <tr>
              <th style={{ textAlign: "left", padding: 10 }}>Run</th>
              <th style={{ textAlign: "left", padding: 10 }}>Status</th>
              <th style={{ textAlign: "left", padding: 10 }}>Profile</th>
              <th style={{ textAlign: "left", padding: 10 }}>Created</th>
              <th style={{ textAlign: "left", padding: 10 }}>Counts</th>
            </tr>
          </thead>
          <tbody>
            {tenantRuns.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid #eee" }}>
                <td style={{ padding: 10 }}>
                  <Link href={`/t/${tenantId}/runs/${r.id}`}>
                    <code>{r.id}</code>
                  </Link>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {r.triggeredBy ?? "—"}
                  </div>
                </td>
                <td style={{ padding: 10 }}>
                  <StatusBadge status={r.status} />
                </td>
                <td style={{ padding: 10 }}>
                  <ProfileBadge profile={r.dataProfile} />
                </td>
                <td style={{ padding: 10 }}>
                  <span style={{ opacity: 0.85 }}>{r.createdAt}</span>
                </td>
                <td style={{ padding: 10, fontSize: 12 }}>
                  jobs {r.counts.jobs} · findings {r.counts.findings} · artefacts {r.counts.artefacts}
                </td>
              </tr>
            ))}
            {tenantRuns.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 10, opacity: 0.7 }}>
                  No runs found for this tenant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
