"use client";
// apps/portal/src/app/tenants/_components/TenantsClient.tsx

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TenantListItem } from "@/lib/api";
import { OnboardTenantModal } from "./OnboardTenantModal";

type Props = {
  initialTenants: TenantListItem[];
};

export function TenantsClient({ initialTenants }: Props) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);

  function handleComplete() {
    setModalOpen(false);
    // Re-run the server component to pick up the newly created tenant.
    router.refresh();
  }

  return (
    <main>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
          marginTop: 0
        }}
      >
        <h2 style={{ margin: 0 }}>Tenants</h2>
        <button
          onClick={() => setModalOpen(true)}
          style={{
            padding: "8px 18px",
            borderRadius: 6,
            border: "none",
            background: "#0070f3",
            color: "#fff",
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 600
          }}
        >
          Onboard tenant
        </button>
      </div>

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
            {initialTenants.map((t) => (
              <tr key={t.id} style={{ borderTop: "1px solid #eee" }}>
                <td style={{ padding: 10 }}>
                  <div style={{ fontWeight: 600 }}>
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
            {initialTenants.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: 10, opacity: 0.7 }}>
                  No tenants found yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <OnboardTenantModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onComplete={handleComplete}
      />
    </main>
  );
}
