// apps/portal/src/app/t/[tenantId]/runs/[runId]/observed/[observedId]/page.tsx
import Link from "next/link";
import {
  getObservedCheck,
  getRunObservedCheck,
  listRunObservedChecks,
  type ObservedCheckItem
} from "@/lib/api";

type BadgeTone = "ok" | "warn" | "bad" | "muted";
type BadgeModel = { label: string; tone: BadgeTone };

function Badge({ badge }: { badge: BadgeModel }) {
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
    <span
      style={{
        background: bg,
        color: fg,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        lineHeight: "16px",
        whiteSpace: "nowrap"
      }}
    >
      {badge.label}
    </span>
  );
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function isMeaningful(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function completenessFromData(data: unknown): {
  badge: BadgeModel;
  permissionDenied: string[];
  truncated: boolean;
  isComplete: boolean | null;
  profile: string | null;
} {
  const d = data && typeof data === "object" ? (data as any) : null;

  const permissionDenied =
    d && Array.isArray(d.permissionDenied) ? d.permissionDenied.filter((x: any) => typeof x === "string") : [];

  const truncated = Boolean(d?.truncated === true || d?.completeness?.truncated === true);

  const isCompleteRaw =
    typeof d?.isComplete === "boolean"
      ? d.isComplete
      : typeof d?.completeness?.isComplete === "boolean"
        ? d.completeness.isComplete
        : null;

  const profile = typeof d?.profile === "string" ? d.profile : null;

  let badge: BadgeModel = { label: "ok", tone: "ok" };
  if (permissionDenied.length > 0) badge = { label: "permission-denied", tone: "warn" };
  else if (truncated) badge = { label: "truncated", tone: "warn" };
  else if (isCompleteRaw === false) badge = { label: "partial", tone: "warn" };

  return { badge, permissionDenied, truncated, isComplete: isCompleteRaw, profile };
}

function pickKpiPairs(data: unknown): Array<[string, string]> {
  const d = data && typeof data === "object" ? (data as any) : null;
  if (!d) return [];

  const candidates: Array<[string, unknown]> = [
    ["totalUsers", d.totalUsers],
    ["memberUsers", d.memberUsers],
    ["guestUsers", d.guestUsers],
    ["enabledUsers", d.enabledUsers],
    ["disabledUsers", d.disabledUsers],
    ["totalGroups", d.totalGroups],
    ["totalApps", d.totalApps],
    ["totalPolicies", d.totalPolicies]
  ];

  const out: Array<[string, string]> = [];
  for (const [k, v] of candidates) {
    if (typeof v === "number" && Number.isFinite(v)) out.push([k, String(v)]);
  }

  return out.slice(0, 6);
}

async function getObservedDetailWithFallback(runId: string, observedId: string): Promise<ObservedCheckItem> {
  // Preferred: run-scoped detail route
  try {
    return await getRunObservedCheck(runId, observedId);
  } catch {
    // Next: global detail route
    try {
      return await getObservedCheck(observedId);
    } catch {
      // Last resort: list + filter (keeps the page working even if detail routes drift)
      const list = await listRunObservedChecks(runId);
      const found = list.find((x) => x.id === observedId);
      if (found) return found;
      throw new Error(`[portal] Observed check not found (runId=${runId}, observedId=${observedId})`);
    }
  }
}

export default async function ObservedCheckPage({
  params
}: {
  params: Promise<{ tenantId: string; runId: string; observedId: string }>;
}) {
  const { tenantId, runId, observedId } = await params;

  const observed = await getObservedDetailWithFallback(runId, observedId);

  const { badge, permissionDenied, isComplete, profile } = completenessFromData(observed.data);
  const kpis = pickKpiPairs(observed.data);

  const notes =
    observed.data && typeof observed.data === "object" && Array.isArray((observed.data as any).notes)
      ? ((observed.data as any).notes as unknown[]).filter((x) => typeof x === "string")
      : [];

  const showReferences = isMeaningful(observed.references);

  return (
    <main>
      <p style={{ marginTop: 0 }}>
        <Link href={`/t/${tenantId}/runs/${runId}`}>← Back to run</Link>
      </p>

      <h2 style={{ marginTop: 0 }}>Observed check</h2>

      {/* Summary strip */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          margin: "8px 0 14px 0"
        }}
      >
        <Badge badge={badge} />
        {profile ? <Badge badge={{ label: `profile: ${profile}`, tone: "muted" }} /> : null}
        {isComplete === true ? <Badge badge={{ label: "isComplete: true", tone: "ok" }} /> : null}
        {isComplete === false ? <Badge badge={{ label: "isComplete: false", tone: "warn" }} /> : null}
        {permissionDenied.length > 0 ? (
          <Badge badge={{ label: `permissionDenied: ${permissionDenied.length}`, tone: "warn" }} />
        ) : null}
        {kpis.map(([k, v]) => (
          <Badge key={k} badge={{ label: `${k}: ${v}`, tone: "muted" }} />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.75 }}>Observed ID</div>
          <div>
            <code>{observed.id}</code>
          </div>

          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 10 }}>Observed At</div>
          <div>{observed.observedAt ?? "—"}</div>

          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 10 }}>Check ID</div>
          <div>
            <code>{observed.checkId}</code>
          </div>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.75 }}>Collector</div>
          <div>{observed.collectorId ?? "—"}</div>

          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 10 }}>Job</div>
          <div>
            <code>{observed.jobId ?? "—"}</code>
          </div>

          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 10 }}>Rule ID</div>
          <div>
            <code>{observed.ruleId ?? "—"}</code>
          </div>
        </div>
      </div>

      {permissionDenied.length > 0 ? (
        <div
          style={{
            border: "1px solid #f2d39b",
            background: "#fff9ec",
            borderRadius: 10,
            padding: 12,
            marginBottom: 12
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Permission denied</div>
          <div style={{ fontSize: 13, opacity: 0.9 }}>{permissionDenied.join(", ")}</div>
        </div>
      ) : null}

      {notes.length > 0 ? (
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Notes</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {notes.map((n, i) => (
              <li key={`${i}-${n}`} style={{ fontSize: 13, opacity: 0.9 }}>
                {n}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <h3 style={{ marginTop: 0 }}>Data</h3>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          border: "1px solid #ddd",
          borderRadius: 10,
          padding: 12,
          background: "#fafafa",
          overflowX: "auto"
        }}
      >
        {safeJson(observed.data)}
      </pre>

      {/* Hide empty references */}
      {showReferences ? (
        <>
          <h3 style={{ marginTop: 16 }}>References</h3>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              border: "1px solid #ddd",
              borderRadius: 10,
              padding: 12,
              background: "#fafafa",
              overflowX: "auto"
            }}
          >
            {safeJson(observed.references)}
          </pre>
        </>
      ) : null}
    </main>
  );
}
