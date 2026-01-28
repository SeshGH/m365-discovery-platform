// apps/portal/src/app/tenants/page.tsx
import Link from "next/link";
import { listTenants } from "@/lib/api";

export default async function TenantsPage() {
  const tenants = await listTenants({ take: 50 });

  return (
    <main>
      <h2 style={{ marginTop: 0 }}>Tenants</h2>

      <p style={{ opacity: 0.75, marginTop: 0 }}>
        Loaded from Fastify <code>GET /tenants</code>.
      </p>

      <div style={{ border: "1px solid #ddd", borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f6f6f6" }}>
            <tr>
              <th style={{ textAlign: "left", padding: 10 }}>Display</th>
              <th style={{ textAlign: "left", padding: 10 }}>Primary domain</th>
              <th style={{ textAlign: "left", padding: 10 }}>Tenant GUID</th>
              <th style={{ textAlign: "left", padding: 10 }}>Auth</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} style={{ borderTop: "1px solid #eee" }}>
                <td style={{ padding: 10 }}>
                  <div style={{ fontWeight: 600 }}>
                    {/* Canonical route */}
                    <Link href={`/tenants/${t.id}`} style={{ textDecoration: "none" }}>
                      {t.displayName ?? "(no display name)"}
                    </Link>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{t.id}</div>
                </td>
                <td style={{ padding: 10 }}>{t.primaryDomain}</td>
                <td style={{ padding: 10 }}>
                  <code style={{ fontSize: 12 }}>{t.tenantGuid}</code>
                </td>
                <td style={{ padding: 10 }}>
                  {t.auth ? (
                    <div>
                      <div>
                        <strong>{t.auth.status}</strong>
                      </div>
                      {t.auth.lastError ? (
                        <div style={{ color: "#a00", fontSize: 12 }}>{t.auth.lastError}</div>
                      ) : (
                        <div style={{ fontSize: 12, opacity: 0.7 }}>No errors</div>
                      )}
                    </div>
                  ) : (
                    <span style={{ opacity: 0.7 }}>No auth record</span>
                  )}
                </td>
              </tr>
            ))}
            {tenants.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 10, opacity: 0.7 }}>
                  No tenants found yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
