// apps/portal/src/app/t/[tenantId]/page.tsx
import Link from "next/link";
import { getTenantAuth, listTenantRuns } from "@/lib/api";

function sortByCreatedDesc(a: { createdAt: string }, b: { createdAt: string }) {
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
}

function StatusBadge({ status }: { status: string }) {
  const s = String(status ?? "").toLowerCase();
  const cls =
    s === "succeeded"
      ? "badge ok"
      : s === "failed"
        ? "badge bad"
        : s === "running"
          ? "badge warn"
          : s === "queued"
            ? "badge"
            : "badge";
  return <span className={cls}>{status}</span>;
}

function ProfileBadge({ profile }: { profile: string }) {
  const p = String(profile ?? "").toLowerCase();
  const cls = p === "full" ? "badge warn" : "badge";
  return <span className={cls}>{profile}</span>;
}

export default async function TenantPage({
  params
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  const [auth, runs] = await Promise.all([
    getTenantAuth(tenantId),
    listTenantRuns(tenantId)
  ]);

  const tenantRunsAll = runs.slice().sort(sortByCreatedDesc);

  const maxRows = 20;
  const tenantRuns = tenantRunsAll.slice(0, maxRows);

  return (
    <main>
      <p style={{ margin: "10px 0 0 0" }}>
        <Link className="link" href="/tenants">← Back to tenants</Link>
      </p>

      <div className="stack">
        <div>
          <h2 style={{ marginBottom: 6 }}>
            {auth.tenant.displayName ?? "(no display name)"}{" "}
            <span className="subtle">({auth.tenant.primaryDomain})</span>
          </h2>
          <div className="subtle">
            Tenant ID: <code>{auth.tenant.id}</code>
          </div>
        </div>

        <div className="grid-2">
          <div className="card card-pad">
            <h3 style={{ marginTop: 0 }}>Tenant</h3>

            <div className="kv">
              <div className="k">ID</div>
              <div className="v"><code>{auth.tenant.id}</code></div>

              <div className="k">Tenant GUID</div>
              <div className="v"><code>{auth.tenant.tenantGuid}</code></div>

              <div className="k">Primary domain</div>
              <div className="v">{auth.tenant.primaryDomain}</div>

              <div className="k">Display</div>
              <div className="v">{auth.tenant.displayName ?? "—"}</div>
            </div>
          </div>

          <div className="card card-pad">
            <h3 style={{ marginTop: 0 }}>Auth</h3>

            {auth.auth ? (
              <div className="stack">
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="subtle">Status</span>
                  <span className="badge ok">{String(auth.auth.status)}</span>
                  {auth.auth.consentedAt ? (
                    <span className="subtle">Consented: {auth.auth.consentedAt}</span>
                  ) : (
                    <span className="subtle">Consented: —</span>
                  )}
                </div>

                {auth.auth.lastError ? (
                  <div className="callout warn">
                    <strong>Last error</strong>
                    <div style={{ marginTop: 6 }}>{auth.auth.lastError}</div>
                  </div>
                ) : (
                  <div className="subtle">No auth errors recorded.</div>
                )}
              </div>
            ) : (
              <div className="callout warn">
                <strong>No auth record</strong>
                <div style={{ marginTop: 6 }}>
                  This tenant has no stored auth status yet.
                </div>
              </div>
            )}
          </div>
        </div>

        <div>
          <h3 style={{ marginBottom: 6 }}>Recent runs</h3>
          <p className="subtle">
            Source: portal BFF <code>/api/tenants/[tenantId]/runs</code>. Showing {tenantRuns.length} of{" "}
            {tenantRunsAll.length}.
          </p>

          <div className="card" style={{ overflow: "hidden" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Profile</th>
                  <th>Created</th>
                  <th>Counts</th>
                </tr>
              </thead>
              <tbody>
                {tenantRuns.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link className="link" href={`/t/${tenantId}/runs/${r.id}`}>
                        <code>{r.id}</code>
                      </Link>
                      <div className="subtle">{r.triggeredBy ?? "—"}</div>
                    </td>

                    <td>
                      <StatusBadge status={r.status} />
                    </td>

                    <td>
                      <ProfileBadge profile={r.dataProfile} />
                    </td>

                    <td className="subtle">{r.createdAt}</td>

                    <td className="subtle">
                      jobs {r.counts.jobs} · findings {r.counts.findings} · artefacts {r.counts.artefacts}
                    </td>
                  </tr>
                ))}

                {tenantRuns.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="subtle">
                      No runs found for this tenant.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
