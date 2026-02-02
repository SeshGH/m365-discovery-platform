// apps/portal/src/app/t/[tenantId]/runs-list.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { listTenantRuns } from "@/lib/api.client";

type RunListItem = {
  id: string;
  status: string;
  dataProfile: string;
  triggeredBy: string | null;
  createdAt: string;
  counts: { jobs: number; findings: number; artefacts: number };
};

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

function isActive(run: RunListItem) {
  return run.status === "queued" || run.status === "running";
}

type Props = {
  tenantId: string;
  initialRuns: RunListItem[];
  totalRuns: number;
};

export default function RunsList({ tenantId, initialRuns, totalRuns }: Props) {
  const [runs, setRuns] = useState<RunListItem[]>(initialRuns);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasActive = runs.some(isActive);

  useEffect(() => {
    if (!hasActive) return;

    timer.current = setInterval(async () => {
      try {
        const all = await listTenantRuns(tenantId);

        // Keep only the fields we render, so server/client shapes both work
        const mapped: RunListItem[] = all.slice(0, initialRuns.length).map((r) => ({
          id: r.id,
          status: r.status,
          dataProfile: r.dataProfile,
          triggeredBy: r.triggeredBy ?? null,
          createdAt: r.createdAt,
          counts: r.counts
        }));

        setRuns(mapped);

        if (!all.some((r) => r.status === "queued" || r.status === "running") && timer.current) {
          clearInterval(timer.current);
          timer.current = null;
        }
      } catch {
        // best-effort only
      }
    }, 7000);

    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [tenantId, hasActive, initialRuns.length]);

  return (
    <div>
      <h3 style={{ marginBottom: 6 }}>Recent runs</h3>

      <p className="subtle">
        Source: portal BFF <code>/api/tenants/[tenantId]/runs</code>. Showing {runs.length} of {totalRuns}.
        {hasActive ? " Updating automatically…" : ""}
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
            {runs.map((r) => (
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

            {runs.length === 0 ? (
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
  );
}
