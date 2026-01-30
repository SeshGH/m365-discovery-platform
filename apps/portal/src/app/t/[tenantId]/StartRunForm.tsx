// apps/portal/src/app/t/[tenantId]/StartRunForm.tsx
"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Props = {
  tenantId: string;
};

export default function StartRunForm({ tenantId }: Props) {
  const router = useRouter();

  const [profile, setProfile] = useState<"safe" | "full">("safe");
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const helpText = useMemo(() => {
    return profile === "safe"
      ? "Safe runs collect counts only."
      : "Full runs export user-level data and require elevated permissions.";
  }, [profile]);

  async function start() {
    if (isStarting) return;
    setIsStarting(true);
    setError(null);

    try {
      const res = await fetch(`/api/tenants/${tenantId}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ dataProfile: profile })
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Start run failed (${res.status})`);
      }

      const json = (await res.json()) as any;
      const runId = json?.runId;

      if (!runId) {
        throw new Error("Start run succeeded but response did not include runId.");
      }

      // Redirect to the run page
      router.push(`/t/${tenantId}/runs/${runId}`);
      router.refresh();
    } catch (e: any) {
      setError(e?.message ? String(e.message) : "Start run failed.");
      setIsStarting(false);
    }
  }

  return (
    <div className="card card-pad">
      <h3 style={{ marginTop: 0, marginBottom: 10 }}>New discovery run</h3>

      <div className="runform">
        <div>
          <div className="subtle" style={{ marginBottom: 6 }}>
            Data profile
          </div>

          <select
            className="select"
            value={profile}
            disabled={isStarting}
            onChange={(e) => setProfile((String(e.target.value).toLowerCase() === "full" ? "full" : "safe") as any)}
          >
            <option value="safe">Safe (counts only)</option>
            <option value="full">Full (sensitive data)</option>
          </select>
        </div>

        <div className="runform-cta">
          <button className="btn btn-primary" disabled={isStarting} onClick={start}>
            {isStarting ? "Starting…" : "Start run"}
          </button>
        </div>

        <div className="runform-help subtle">{helpText}</div>
      </div>

      {error ? (
        <div className="callout warn" style={{ marginTop: 10 }}>
          <strong>Start failed</strong>
          <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{error}</div>
        </div>
      ) : null}
    </div>
  );
}
