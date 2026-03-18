// apps/portal/src/app/t/[tenantId]/runs/[runId]/observed/[observedId]/page.tsx
import Link from "next/link";
import {
  getRunObservedCheck,
  listRunObservedChecks,
  listRunFindings,
  listRunArtefacts,
  type ObservedCheckItem,
  type FindingItem,
  type ArtefactItem
} from "@/lib/api";
import { ocIsIncomplete, ocIsTruncated, ocPermissionDeniedList } from "@/lib/run-metrics";
import { ReadonlyCopyField } from "./_components/ReadonlyCopyField";

type BadgeTone = "ok" | "warn" | "bad" | "muted";
type BadgeModel = { label: string; tone: BadgeTone };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readString(obj: unknown, key: string): string | null {
  if (!isRecord(obj)) return null;
  const v = obj[key];
  return typeof v === "string" && v.trim() ? v : null;
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

function uniq(xs: string[]) {
  return Array.from(new Set(xs)).filter(Boolean);
}

function formatBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) return "—";
  if (!Number.isFinite(bytes) || bytes < 0) return String(bytes);
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function Badge({ badge }: { badge: BadgeModel }) {
  const cls =
    badge.tone === "ok"
      ? "badge ok"
      : badge.tone === "warn"
        ? "badge warn"
        : badge.tone === "bad"
          ? "badge bad"
          : "badge";
  return <span className={cls}>{badge.label}</span>;
}

function SeverityBadge({ severity }: { severity: string }) {
  const s = String(severity ?? "").toLowerCase();
  const badge: BadgeModel =
    s === "critical" || s === "high"
      ? { label: s, tone: "bad" }
      : s === "medium"
        ? { label: "medium", tone: "warn" }
        : s === "low" || s === "info" || s === "informational"
          ? { label: s, tone: "muted" }
          : { label: s || "unknown", tone: "muted" };

  return <Badge badge={badge} />;
}

/**
 * Convert observed.data into a reviewer-friendly completeness state.
 * LOCKED: derived only from explicit fields in observed check payloads.
 */
function completenessFromObserved(observed: ObservedCheckItem): {
  statusBadge: BadgeModel;
  permissionDenied: string[];
  truncated: boolean;
  incomplete: boolean;
  profile: string | null;
  signals: string[];
} {
  const d = observed.data;

  const permissionDenied = ocPermissionDeniedList(d);
  const truncated = ocIsTruncated(d);
  const incomplete = ocIsIncomplete(d);

  // Some checks may store profile as "dataProfile" (current) or "profile" (older)
  const profile = readString(d, "dataProfile") ?? readString(d, "profile");

  const signals = uniq([
    ...(permissionDenied.length > 0 ? ["permissionDenied"] : []),
    ...(truncated ? ["truncated"] : []),
    ...(incomplete ? ["incomplete"] : [])
  ]);

  let statusBadge: BadgeModel;
  if (permissionDenied.length > 0) statusBadge = { label: "Permission missing", tone: "warn" };
  else if (truncated) statusBadge = { label: "Truncated", tone: "warn" };
  else if (incomplete) statusBadge = { label: "Incomplete", tone: "warn" };
  else statusBadge = { label: "Complete", tone: "ok" };

  return { statusBadge, permissionDenied, truncated, incomplete, profile, signals };
}

function filenameFromKey(key: string) {
  return key.split("/").pop() ?? key;
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

function pickTopKpis(data: unknown): Array<{ label: string; value: string }> {
  // Keep this intentionally conservative: only show small, stable-looking fields if present.
  if (!isRecord(data)) return [];

  const tryNum = (key: string) => {
    const v = data[key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };

  const candidates: Array<[string, number | null]> = [
    ["totalUsers", tryNum("totalUsers")],
    ["memberUsers", tryNum("memberUsers")],
    ["guestUsers", tryNum("guestUsers")],
    ["enabledUsers", tryNum("enabledUsers")],
    ["disabledUsers", tryNum("disabledUsers")],
    ["totalMailboxes", tryNum("totalMailboxes")]
  ];

  return candidates
    .filter(([, v]) => typeof v === "number")
    .slice(0, 6)
    .map(([k, v]) => ({ label: k, value: String(v) }));
}

export default async function ObservedCheckPage({
  params
}: {
  params: Promise<{ tenantId: string; runId: string; observedId: string }>;
}) {
  const { tenantId, runId, observedId } = await params;

  const [observed, findings, artefactsRaw] = await Promise.all([
    getObservedDetailWithFallback(tenantId, runId, observedId),
    listRunFindings(tenantId, runId),
    listRunArtefacts(tenantId, runId)
  ]);

  const related: FindingItem[] = findings
    .filter((f) => String(f.checkId) === String(observed.checkId))
    .sort(sortByCreatedDesc);

  const { statusBadge, permissionDenied, truncated, incomplete, profile, signals } =
    completenessFromObserved(observed);

  const kpis = pickTopKpis(observed.data);

  const notesRaw = isRecord(observed.data) ? observed.data["notes"] : undefined;
  const notes =
    Array.isArray(notesRaw) ? notesRaw.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];

  const showReferences = isMeaningful(observed.references);

  const artefacts: ArtefactItem[] = (artefactsRaw as ArtefactItem[]) ?? [];
  const jobArtefacts = observed.jobId ? artefacts.filter((a) => a.jobId === observed.jobId) : [];

  jobArtefacts.sort((a, b) => filenameFromKey(a.key).localeCompare(filenameFromKey(b.key)));

  return (
    <main>
      <p style={{ margin: "10px 0 0 0" }}>
        <Link className="link" href={`/t/${tenantId}/runs/${runId}`}>
          ← Back to run
        </Link>
      </p>

      <h2 style={{ marginBottom: 8 }}>Observed check</h2>

      {/* Summary strip */}
      <div className="card card-pad" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <Badge badge={statusBadge} />
          {profile ? <Badge badge={{ label: `profile: ${profile}`, tone: "muted" }} /> : null}
          {signals.length > 0 ? <Badge badge={{ label: `signals: ${signals.join(", ")}`, tone: "warn" }} /> : null}
          {permissionDenied.length > 0 ? (
            <Badge badge={{ label: `${permissionDenied.length} permission issue(s)`, tone: "warn" }} />
          ) : null}
          {kpis.map((k) => (
            <Badge key={k.label} badge={{ label: `${k.label}: ${k.value}`, tone: "muted" }} />
          ))}
        </div>

        <div className="subtle" style={{ marginTop: 10 }}>
          Reviewer view: observed checks are the source of truth. Findings are derived; artefacts are raw outputs.
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link className="link link-action" href={`/t/${tenantId}/runs/${runId}#evidence-observed-checks`}>
            View in Evidence →
          </Link>
          {observed.checkId ? (
            <Link className="link link-action" href={`/t/${tenantId}/runs/${runId}`}>
              Run summary →
            </Link>
          ) : null}
        </div>
      </div>

      {/* Metadata + copy affordances */}
      <div className="grid-2" style={{ marginBottom: 12 }}>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Identifiers</h3>

          <div style={{ display: "grid", gap: 10 }}>
            <ReadonlyCopyField label="Observed ID" value={observed.id} />
            <ReadonlyCopyField label="Check ID" value={observed.checkId} />
            <ReadonlyCopyField label="Collector ID" value={observed.collectorId ?? "—"} />
          </div>
        </div>

        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Timing & linkage</h3>

          <div style={{ display: "grid", gap: 10 }}>
            <ReadonlyCopyField label="Observed at" value={observed.observedAt ?? "—"} hint="Timestamp recorded when the check emitted." />
            <ReadonlyCopyField label="Job ID" value={observed.jobId ?? "—"} hint="Used to link artefacts best-effort." />
            <ReadonlyCopyField label="Rule ID" value={observed.ruleId ?? "—"} />
          </div>
        </div>
      </div>

      {/* Signals callouts */}
      {permissionDenied.length > 0 ? (
        <div className="callout warn" style={{ marginBottom: 12 }}>
          <strong>Permission denied</strong>
          <div className="subtle" style={{ marginTop: 6 }}>
            {permissionDenied.join(", ")}
          </div>
        </div>
      ) : null}

      {truncated ? (
        <div className="callout warn" style={{ marginBottom: 12 }}>
          <strong>Truncated</strong>
          <div className="subtle" style={{ marginTop: 6 }}>
            This check explicitly reported truncated output. Treat counts and inventory as indicative.
          </div>
        </div>
      ) : null}

      {incomplete ? (
        <div className="callout warn" style={{ marginBottom: 12 }}>
          <strong>Incomplete</strong>
          <div className="subtle" style={{ marginTop: 6 }}>
            This check explicitly reported incomplete output. Validate via artefacts and rerun once addressed.
          </div>
        </div>
      ) : null}

      {notes.length > 0 ? (
        <div className="card card-pad" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>Notes</h3>
          <ul style={{ marginTop: 8 }}>
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Job-linked artefacts */}
      <div className="card card-pad" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
          <h3 style={{ marginTop: 0, marginBottom: 6 }}>Linked artefacts</h3>
          <span className="subtle">
            {observed.jobId ? `job ${observed.jobId}` : "No jobId on this observed check"}
          </span>
        </div>

        <div className="subtle" style={{ marginTop: 6 }}>
          Best-effort linkage: artefacts are matched by <code>jobId</code>. If this check has no jobId, you can still review all artefacts under the Run’s Evidence tab.
        </div>

        {observed.jobId && jobArtefacts.length > 0 ? (
          <div className="card" style={{ overflow: "hidden", marginTop: 10 }}>
            <table className="table table-scan">
              <thead>
                <tr>
                  <th>Filename</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {jobArtefacts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{filenameFromKey(a.key)}</div>
                      <div className="subtle" style={{ fontSize: 12 }}>
                        <code>{a.key}</code>
                      </div>
                    </td>
                    <td>{a.type}</td>
                    <td className="subtle">{formatBytes(a.sizeBytes)}</td>
                    <td style={{ width: 110 }}>
                      <a className="link link-action" href={`/api/artefacts/${a.id}/download`} target="_blank" rel="noreferrer">
                        Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : observed.jobId ? (
          <div className="subtle" style={{ marginTop: 10 }}>
            No artefacts matched this check’s jobId.
          </div>
        ) : (
          <div className="subtle" style={{ marginTop: 10 }}>
            No jobId available to link artefacts for this observed check.
          </div>
        )}
      </div>

      {/* Findings */}
      <div className="card card-pad" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
          <h3 style={{ marginTop: 0, marginBottom: 6 }}>Related findings</h3>
          <span className="subtle">
            check <code>{observed.checkId}</code>
          </span>
        </div>

        <p className="subtle" style={{ marginTop: 6 }}>
          Findings are derived from observed checks; validate any claim via the observed payload and linked artefacts.
        </p>

        <div className="card" style={{ overflow: "hidden", marginTop: 10 }}>
          <table className="table table-scan">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Title</th>
                <th>Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {related.map((f) => (
                <tr key={f.id}>
                  <td style={{ width: 120 }}>
                    <SeverityBadge severity={f.severity} />
                  </td>
                  <td>
                    <div style={{ fontWeight: 800 }}>{f.title}</div>
                    <div className="subtle" style={{ fontSize: 12 }}>
                      id: <code>{f.id}</code>
                    </div>
                  </td>
                  <td style={{ fontSize: 12 }}>{f.recommendation ?? "—"}</td>
                </tr>
              ))}

              {related.length === 0 ? (
                <tr>
                  <td colSpan={3} className="subtle">
                    No findings reference this check.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Data */}
      <h3>Observed payload</h3>
      <p className="subtle">Exact data captured by the collector/check (source of truth).</p>

      <pre className="pre">{safeJson(observed.data)}</pre>

      {showReferences ? (
        <>
          <h3>References</h3>
          <p className="subtle">Optional supplemental references attached to the observed check.</p>
          <pre className="pre">{safeJson(observed.references)}</pre>
        </>
      ) : null}
    </main>
  );
}
