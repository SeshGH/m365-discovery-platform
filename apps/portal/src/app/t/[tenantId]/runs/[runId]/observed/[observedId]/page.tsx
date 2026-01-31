// apps/portal/src/app/t/[tenantId]/runs/[runId]/observed/[observedId]/page.tsx
import Link from "next/link";
import {
  getRunObservedCheck,
  listRunObservedChecks,
  listRunFindings,
  type ObservedCheckItem,
  type FindingItem
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

function SeverityBadge({ severity }: { severity: string }) {
  const s = String(severity ?? "").toLowerCase();
  const badge: BadgeModel =
    s === "critical" || s === "high"
      ? { label: s, tone: "bad" }
      : s === "medium"
        ? { label: "medium", tone: "warn" }
        : s === "low" || s === "info"
          ? { label: s, tone: "muted" }
          : { label: s || "unknown", tone: "muted" };

  return <Badge badge={badge} />;
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

/**
 * Convert raw observed.data into human-readable completeness state
 */
function completenessFromData(data: unknown): {
  statusBadge: BadgeModel;
  permissionDenied: string[];
  truncated: boolean;
  profile: string | null;
} {
  const d = data && typeof data === "object" ? (data as any) : null;

  const permissionDenied =
    Array.isArray(d?.permissionDenied)
      ? d.permissionDenied.filter((x: any) => typeof x === "string")
      : [];

  const truncated = Boolean(d?.truncated === true);
  const isComplete =
    typeof d?.isComplete === "boolean" ? d.isComplete : null;

  const profile = typeof d?.dataProfile === "string" ? d.dataProfile : null;

  let statusBadge: BadgeModel;

  if (permissionDenied.length > 0) {
    statusBadge = { label: "Permission missing", tone: "warn" };
  } else if (truncated) {
    statusBadge = { label: "Truncated", tone: "warn" };
  } else if (isComplete === false) {
    statusBadge = { label: "Incomplete", tone: "warn" };
  } else {
    statusBadge = { label: "Complete", tone: "ok" };
  }

  return { statusBadge, permissionDenied, truncated, profile };
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
    ["totalMailboxes", d.totalMailboxes]
  ];

  return candidates
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
    .slice(0, 6)
    .map(([k, v]) => [k, String(v)]);
}

function sortByCreatedDesc(a: { createdAt: string }, b: { createdAt: string }) {
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
}

async function getObservedDetailWithFallback(
  tenantId: string,
  runId: string,
  observedId: string
): Promise<ObservedCheckItem> {
  try {
    return await getRunObservedCheck(tenantId, runId, observedId);
  } catch {
    const list = await listRunObservedChecks(tenantId, runId);
    const found = list.find((x) => x.id === observedId);
    if (found) return found;
    throw new Error(`[portal] Observed check not found (${observedId})`);
  }
}

export default async function ObservedCheckPage({
  params
}: {
  params: Promise<{ tenantId: string; runId: string; observedId: string }>;
}) {
  const { tenantId, runId, observedId } = await params;

  const [observed, findings] = await Promise.all([
    getObservedDetailWithFallback(tenantId, runId, observedId),
    listRunFindings(tenantId, runId)
  ]);

  const related: FindingItem[] = findings
    .filter((f) => String(f.checkId) === String(observed.checkId))
    .sort(sortByCreatedDesc);

  const { statusBadge, permissionDenied, profile } =
    completenessFromData(observed.data);

  const kpis = pickKpiPairs(observed.data);

  const notes =
    Array.isArray((observed.data as any)?.notes)
      ? ((observed.data as any).notes as unknown[]).filter((x) => typeof x === "string")
      : [];

  const showReferences = isMeaningful(observed.references);

  return (
    <main>
      <p>
        <Link href={`/t/${tenantId}/runs/${runId}`}>← Back to run</Link>
      </p>

      <h2>Observed check</h2>

      {/* Summary strip */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          margin: "8px 0 14px 0",
          padding: "8px 10px",
          border: "1px solid #eee",
          borderRadius: 10,
          background: "#fafafa"
        }}
      >
        <Badge badge={statusBadge} />
        {profile ? <Badge badge={{ label: `profile: ${profile}`, tone: "muted" }} /> : null}
        {permissionDenied.length > 0 ? (
          <Badge badge={{ label: `${permissionDenied.length} permission issue(s)`, tone: "warn" }} />
        ) : null}
        {kpis.map(([k, v]) => (
          <Badge key={k} badge={{ label: `${k}: ${v}`, tone: "muted" }} />
        ))}
      </div>

      {/* Metadata */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.75 }}>Observed ID</div>
          <code>{observed.id}</code>

          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 10 }}>Observed at</div>
          <div>{observed.observedAt ?? "—"}</div>

          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 10 }}>Check ID</div>
          <code>{observed.checkId}</code>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.75 }}>Collector</div>
          <div>{observed.collectorId ?? "—"}</div>

          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 10 }}>Job</div>
          <code>{observed.jobId ?? "—"}</code>

          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 10 }}>Rule ID</div>
          <code>{observed.ruleId ?? "—"}</code>
        </div>
      </div>

      {permissionDenied.length > 0 ? (
        <div style={{ border: "1px solid #f2d39b", background: "#fff9ec", borderRadius: 10, padding: 12 }}>
          <strong>Permission denied</strong>
          <div style={{ fontSize: 13 }}>{permissionDenied.join(", ")}</div>
        </div>
      ) : null}

      {notes.length > 0 ? (
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12, marginTop: 12 }}>
          <strong>Notes</strong>
          <ul>
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Findings */}
      <h3>Related findings</h3>
      <p style={{ opacity: 0.75 }}>
        Findings derived from <code>{observed.checkId}</code>
      </p>

      <div style={{ border: "1px solid #ddd", borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f6f6f6" }}>
            <tr>
              <th style={{ textAlign: "left", padding: 10 }}>Severity</th>
              <th style={{ textAlign: "left", padding: 10 }}>Title</th>
              <th style={{ textAlign: "left", padding: 10 }}>Recommendation</th>
            </tr>
          </thead>
          <tbody>
            {related.map((f) => (
              <tr key={f.id} style={{ borderTop: "1px solid #eee" }}>
                <td style={{ padding: 10 }}>
                  <SeverityBadge severity={f.severity} />
                </td>
                <td style={{ padding: 10 }}>
                  <strong>{f.title}</strong>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    <code>{f.id}</code>
                  </div>
                </td>
                <td style={{ padding: 10, fontSize: 12 }}>{f.recommendation ?? "—"}</td>
              </tr>
            ))}

            {related.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ padding: 10, opacity: 0.7 }}>
                  No findings reference this check.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h3>Data</h3>
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

      {showReferences ? (
        <>
          <h3>References</h3>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              border: "1px solid #ddd",
              borderRadius: 10,
              padding: 12,
              background: "#fafafa"
            }}
          >
            {safeJson(observed.references)}
          </pre>
        </>
      ) : null}
    </main>
  );
}
