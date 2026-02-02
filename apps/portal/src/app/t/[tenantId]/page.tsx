// apps/portal/src/app/t/[tenantId]/page.tsx
import Link from "next/link";
import { getTenantAuth, listTenantRuns } from "@/lib/api";
import StartRunForm from "./StartRunForm";
import RunsList from "./runs-list";

function sortByCreatedDesc(a: { createdAt: string }, b: { createdAt: string }) {
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
}

export default async function TenantPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;

  const [auth, runs] = await Promise.all([getTenantAuth(tenantId), listTenantRuns(tenantId)]);

  const tenantRunsAll = runs.slice().sort(sortByCreatedDesc);

  const maxRows = 20;
  const tenantRuns = tenantRunsAll.slice(0, maxRows);

  return (
    <main>
      <p style={{ margin: "10px 0 0 0" }}>
        <Link className="link" href="/tenants">
          ← Back to tenants
        </Link>
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

          <div className="subtle" style={{ marginTop: 8, maxWidth: 900 }}>
            This page is a tenant-level entry point into discovery runs. Runs produce <strong>observed checks</strong> (source of truth),
            raw <strong>artefacts</strong>, and derived <strong>findings</strong>. Start a run when you’re ready, then use “Recent runs”
            to jump into the latest results.
          </div>
        </div>

        <div className="grid-2">
          <div className="card card-pad">
            <h3 style={{ marginTop: 0 }}>Tenant</h3>

            <div className="kv">
              <div className="k">ID</div>
              <div className="v">
                <code>{auth.tenant.id}</code>
              </div>

              <div className="k">Tenant GUID</div>
              <div className="v">
                <code>{auth.tenant.tenantGuid}</code>
              </div>

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
                  <div className="subtle">
                    No auth errors recorded. If a run shows permissionDenied or incomplete signals, check consent/scopes and rerun.
                  </div>
                )}
              </div>
            ) : (
              <div className="callout warn">
                <strong>No auth record</strong>
                <div style={{ marginTop: 6 }}>This tenant has no stored auth status yet.</div>
              </div>
            )}
          </div>
        </div>

        {/* Start run */}
        <StartRunForm tenantId={tenantId} />

        {/* Runs: keep RunsList's own heading, just add a link above it */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
          <Link className="link subtle" href={`/t/${tenantId}/runs`}>
            View all runs →
          </Link>
        </div>

        {/* Runs (polling client component) */}
        <RunsList tenantId={tenantId} initialRuns={tenantRuns} totalRuns={tenantRunsAll.length} />
      </div>
    </main>
  );
}
