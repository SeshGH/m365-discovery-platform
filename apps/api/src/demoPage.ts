// apps/api/src/demoPage.ts
/**
 * DEMO-ONLY UI
 * This file is intentionally demo-only.
 * Long-term UI will live in a dedicated portal app.
 */

export type DemoModule = {
  // Key used in modulesEnabled payload (legacy-friendly)
  key: string;
  // Canonical collector id (stable contract)
  collectorId: string;
  // Checkbox label in demo UI
  label: string;
  // Default state in UI
  defaultChecked: boolean;
};

export const DEMO_MODULES: DemoModule[] = [
  {
    key: "entraUsers",
    collectorId: "entra.users",
    label: "entraUsers (entra.users)",
    defaultChecked: true
  },
  {
    key: "enterpriseAppPermissions",
    collectorId: "entra.enterpriseApps.permissions",
    label: "enterpriseAppPermissions (entra.enterpriseApps.permissions)",
    defaultChecked: true
  },
  {
    key: "conditionalAccessPolicies",
    collectorId: "entra.conditionalAccess.policies",
    label: "conditionalAccessPolicies (entra.conditionalAccess.policies)",
    defaultChecked: true
  },
  {
    key: "directoryRolesAssignments",
    collectorId: "entra.directoryRoles.assignments",
    label: "directoryRolesAssignments (entra.directoryRoles.assignments)",
    defaultChecked: true
  },

  // Exchange Online (new)
  {
    key: "exchangeMailboxesInventory",
    collectorId: "exchange.mailboxes.inventory",
    label: "exchangeMailboxesInventory (exchange.mailboxes.inventory)",
    defaultChecked: true
  }
];

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function getDemoHtml(): string {
  // Server-side render of the module checkbox list (so we don’t mutate DOM on load)
  const modulesHtml = DEMO_MODULES.map((m) => {
    const checked = m.defaultChecked ? "checked" : "";
    const id = escapeHtml(m.key);
    const label = escapeHtml(m.label);
    return `<label><input type="checkbox" id="${id}" ${checked} /> ${label}</label>`;
  }).join("\n            ");

  // We also embed the module keys into the script so payload building stays in sync.
  const moduleKeysJson = JSON.stringify(DEMO_MODULES.map((m) => m.key));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>M365 Discovery Platform - Demo</title>
  <style>
    :root {
      --border: #e5e7eb;
      --text: #111827;
      --muted: #6b7280;
      --bg: #f8fafc;
      --panel: #ffffff;
      --chip: #f3f4f6;
      --codebg: #0b1020;
      --codefg: #d6e7ff;
      --btn: #111827;
      --btnfg: #ffffff;

      --okbg: #ecfdf5;
      --okfg: #065f46;
      --warnbg: #fffbeb;
      --warnfg: #92400e;
      --badbg: #fef2f2;
      --badfg: #991b1b;
      --infobg: #eff6ff;
      --infofg: #1d4ed8;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      color: var(--text);
      background: var(--bg);
    }

    .wrap { max-width: 1180px; margin: 0 auto; padding: 22px; }

    header.top {
      background: #fff;
      border-bottom: 1px solid var(--border);
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 14px 22px;
      max-width: 1180px;
      margin: 0 auto;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .brand .dot {
      width: 11px; height: 11px; border-radius: 999px;
      background: #111827;
      display: inline-block;
    }
    .tagline { font-size: 13px; color: var(--muted); font-weight: 600; }

    h1 { font-size: 24px; margin: 0 0 6px 0; }
    h2 { margin: 0; font-size: 15px; }
    .sub { color: var(--muted); margin: 0 0 18px 0; }

    .card {
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 18px;
      background: var(--panel);
      box-shadow: 0 1px 0 rgba(17,24,39,0.02);
    }
    .card + .card { margin-top: 16px; }

    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px 18px;
    }
    @media (max-width: 860px) {
      .grid { grid-template-columns: 1fr; }
    }

    label { display:block; font-weight: 700; font-size: 13px; margin-bottom: 6px; }
    input, select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 12px;
      font-size: 14px;
      background: #fff;
    }

    .modules {
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 12px 6px 12px;
      grid-column: 1 / -1;
      background: #fff;
    }
    .note { color: var(--muted); font-size: 13px; margin-top: 6px; }
    .modules .note { margin: 6px 0 10px 0; }

    .checkrow { display:flex; flex-direction: column; gap: 10px; margin-top: 6px; }
    .checkrow label { font-weight: 600; margin: 0; display:flex; gap: 10px; align-items: center; }
    .checkrow input { width: 16px; height: 16px; padding: 0; }

    .btnrow { display:flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
    button {
      padding: 10px 14px;
      border-radius: 12px;
      border: 1px solid var(--border);
      cursor: pointer;
      font-weight: 700;
      font-size: 14px;
      background: #fff;
    }
    button.primary {
      background: var(--btn);
      color: var(--btnfg);
      border-color: var(--btn);
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--chip);
      font-size: 12px;
      color: #374151;
      font-weight: 700;
    }

    .badge {
      display:inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: #fff;
      font-size: 12px;
      font-weight: 800;
    }
    .badge.ok { background: var(--okbg); color: var(--okfg); border-color: #a7f3d0; }
    .badge.warn { background: var(--warnbg); color: var(--warnfg); border-color: #fde68a; }
    .badge.bad { background: var(--badbg); color: var(--badfg); border-color: #fecaca; }
    .badge.info { background: var(--infobg); color: var(--infofg); border-color: #bfdbfe; }

    .row { display:flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center; }

    .links a { color: #0b5bd3; text-decoration: none; }
    .links a:hover { text-decoration: underline; }

    .dash {
      display: grid;
      grid-template-columns: 1.4fr 0.6fr;
      gap: 16px;
      margin-top: 14px;
    }
    @media (max-width: 980px) {
      .dash { grid-template-columns: 1fr; }
    }

    .heroGrid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-top: 12px;
    }
    @media (max-width: 980px) { .heroGrid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 540px) { .heroGrid { grid-template-columns: 1fr; } }

    .heroCard {
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 14px;
      background: #fff;
    }
    .heroTitle { font-size: 13px; font-weight: 900; color: #374151; margin-bottom: 8px; }
    .heroBig { font-size: 22px; font-weight: 950; letter-spacing: -0.02em; margin-bottom: 4px; }
    .heroSub { color: var(--muted); font-size: 13px; font-weight: 600; }

    .coverage {
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 14px;
      background: #fff;
    }
    .covRow {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 0;
      border-top: 1px solid var(--border);
      font-size: 13px;
      font-weight: 700;
    }
    .covRow:first-of-type { border-top: none; padding-top: 4px; }
    .covLeft { display:flex; flex-direction: column; gap: 2px; }
    .covHint { font-size: 12px; color: var(--muted); font-weight: 600; }

    details {
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 10px 12px;
      background: #fff;
      margin-top: 12px;
    }
    details > summary {
      cursor: pointer;
      list-style: none;
      display:flex;
      align-items:center;
      justify-content: space-between;
      gap: 12px;
      font-weight: 900;
      padding: 4px 4px;
    }
    details > summary::-webkit-details-marker { display:none; }
    .summaryMeta { color: var(--muted); font-size: 12px; font-weight: 700; }

    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
    th, td { text-align: left; padding: 8px 10px; border-top: 1px solid var(--border); vertical-align: top; }
    th { color: #374151; font-weight: 900; }

    pre {
      margin-top: 12px;
      background: var(--codebg);
      color: var(--codefg);
      padding: 12px;
      border-radius: 12px;
      overflow: auto;
      max-height: 340px;
      font-size: 12.5px;
      line-height: 1.35;
    }

    .muted { color: var(--muted); }

    .jsoncell {
      max-width: 520px;
      white-space: pre-wrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 12px;
    }

    .footerNote {
      margin-top: 18px;
      color: var(--muted);
      font-size: 12.5px;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <header class="top">
    <div class="topbar">
      <div>
        <div class="brand"><span class="dot"></span> M365 Discovery Platform <span class="tagline">Demo visualiser</span></div>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end;">
        <span class="badge info">DEMO TENANT</span>
        <span class="badge">READ-ONLY UI</span>
      </div>
    </div>
  </header>

  <div class="wrap">
    <div class="card">
      <div class="row">
        <div>
          <h1 style="margin:0;">Run Launcher</h1>
          <div class="sub">Create a discovery run and view evidence live. Demo-only UI — long-term portal will be a dedicated app.</div>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <span class="badge">SAFE by default</span>
          <span class="badge">Contracts-first</span>
        </div>
      </div>

      <div class="grid">
        <div>
          <label for="tenantGuid">Tenant GUID (Directory ID)</label>
          <input id="tenantGuid" value="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" />
        </div>
        <div>
          <label for="primaryDomain">Primary Domain</label>
          <input id="primaryDomain" value="contoso.onmicrosoft.com" />
        </div>

        <div>
          <label for="displayName">Display name (optional)</label>
          <input id="displayName" value="Contoso (Demo)" />
        </div>
        <div>
          <label for="triggeredBy">Triggered by</label>
          <input id="triggeredBy" value="portal-demo" />
        </div>

        <div>
          <label for="dataProfile">Data profile</label>
          <select id="dataProfile">
            <option value="safe" selected>safe</option>
            <option value="full">full</option>
          </select>
          <div class="note">safe = summary-only, no PII. full = deeper collection (may include PII in full artefacts). Reports/UI must never auto-consume PII.</div>
        </div>
        <div></div>

        <div class="modules">
          <label>Modules enabled</label>
          <div class="checkrow">
            ${modulesHtml}
          </div>
          <div class="note">Report collectors are always enqueued at the end of a run.</div>
        </div>
      </div>

      <div class="btnrow">
        <button class="primary" id="createRun">Create run</button>
        <button id="clear">Clear</button>
      </div>
    </div>

    <div class="card" id="statusCard" style="display:none;">
      <div class="row" style="align-items: center;">
        <div style="display:flex; flex-direction:column; gap:10px;">
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <span style="font-weight:950; font-size:16px;">Discovery Run</span>
            <span class="pill" id="runIdPill"></span>
            <span id="runStatusBadge" class="badge">STATUS: —</span>
            <span id="runProfileBadge" class="badge">PROFILE: —</span>
          </div>
          <div class="muted" id="runMetaLine">Tenant: — · Generated: —</div>
        </div>

        <details style="min-width: 280px;">
          <summary>
            <span>Developer links</span>
            <span class="summaryMeta">API endpoints</span>
          </summary>
          <div class="links" id="links" style="margin-top: 8px;"></div>
        </details>

      </div>

      <div class="dash">
        <div>
          <div style="font-weight:950; margin-top: 10px;">Snapshot</div>
          <div class="heroGrid">
            <div class="heroCard">
              <div class="heroTitle">Identity</div>
              <div class="heroBig" id="mUsers">—</div>
              <div class="heroSub" id="mUsersSub">—</div>
            </div>

            <div class="heroCard">
              <div class="heroTitle">Privileged Access</div>
              <div class="heroBig" id="mPriv">—</div>
              <div class="heroSub" id="mPrivSub">—</div>
            </div>

            <div class="heroCard">
              <div class="heroTitle">Exchange</div>
              <div class="heroBig" id="mExo">—</div>
              <div class="heroSub" id="mExoSub">—</div>
            </div>

            <div class="heroCard">
              <div class="heroTitle">Security</div>
              <div class="heroBig" id="mSec">—</div>
              <div class="heroSub" id="mSecSub">—</div>
            </div>
          </div>

          <details open>
            <summary>
              <span>Evidence (observed facts only)</span>
              <span class="summaryMeta">Expandable sections · no findings</span>
            </summary>

            <details>
              <summary>
                <span>Jobs</span>
                <span class="summaryMeta">collector runs + status</span>
              </summary>
              <table>
                <thead>
                  <tr>
                    <th>collectorId</th>
                    <th>status</th>
                    <th>attempts</th>
                    <th>lockedBy</th>
                    <th>lockedAt</th>
                    <th>lastError</th>
                  </tr>
                </thead>
                <tbody id="jobsBody"></tbody>
              </table>
            </details>

            <details>
              <summary>
                <span>Observed checks</span>
                <span class="summaryMeta">counts, booleans, completeness</span>
              </summary>
              <div class="muted" style="margin: 8px 0 0 0;">Observed facts captured by collectors (not findings). Safe to render even if empty.</div>
              <table>
                <thead>
                  <tr>
                    <th>observedAt</th>
                    <th>checkId</th>
                    <th>collectorId</th>
                    <th>data</th>
                  </tr>
                </thead>
                <tbody id="observedBody"></tbody>
              </table>
            </details>

            <details>
              <summary>
                <span>Artefacts</span>
                <span class="summaryMeta">download evidence</span>
              </summary>
              <div class="muted" style="margin: 8px 0 0 0;">Artefacts produced by this run. Downloads use the API redirect flow.</div>
              <table>
                <thead>
                  <tr>
                    <th>filename</th>
                    <th>type</th>
                    <th>sizeBytes</th>
                    <th>createdAt</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody id="artefactsBody"></tbody>
              </table>
            </details>

            <div class="footerNote">
              <strong>Demo visualiser only.</strong> This interface demonstrates discovery evidence and contracts.
              It does not represent the final customer portal.
            </div>
          </details>
        </div>

        <div class="coverage">
          <div style="font-weight:950;">Discovery Coverage</div>
          <div class="covRow">
            <div class="covLeft">
              <div>Identity</div>
              <div class="covHint" id="covIdentityHint">—</div>
            </div>
            <div id="covIdentity"></div>
          </div>
          <div class="covRow">
            <div class="covLeft">
              <div>Access & Privilege</div>
              <div class="covHint" id="covPrivHint">—</div>
            </div>
            <div id="covPriv"></div>
          </div>
          <div class="covRow">
            <div class="covLeft">
              <div>Messaging (Exchange)</div>
              <div class="covHint" id="covExoHint">—</div>
            </div>
            <div id="covExo"></div>
          </div>
          <div class="covRow">
            <div class="covLeft">
              <div>Applications</div>
              <div class="covHint" id="covAppsHint">—</div>
            </div>
            <div id="covApps"></div>
          </div>

          <div class="footerNote">
            Coverage reflects <strong>completeness</strong> and <strong>truncation</strong> signals only.
            It does not imply risk or compliance.
          </div>
        </div>
      </div>
    </div>
  </div>

<script>
  const $ = (id) => document.getElementById(id);

  const DEMO_MODULE_KEYS = ${moduleKeysJson};

  let pollTimer = null;
  let currentRunId = null;

  const normalizeList = (v) => {
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.value)) return v.value;
    return [];
  };

  const mkLink = (href, text) =>
    \`<div><a href="\${href}" target="_blank" rel="noreferrer">\${text}</a></div>\`;

  const safe = (v) => (v === null || v === undefined) ? "" : String(v);

  const safeInt = (v) => {
    const n = (typeof v === "number") ? v : (typeof v === "string" ? Number(v) : NaN);
    return Number.isFinite(n) ? n : null;
  };

  const fmtCount = (n) => {
    if (n === null || n === undefined) return "—";
    try { return Number(n).toLocaleString(); } catch { return String(n); }
  };

  const fmtIso = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString();
  };

  const badgeHtml = (kind, text) => \`<span class="badge \${kind}">\${text}</span>\`;

  const renderJobs = (jobs) => {
    const rows = jobs.map(j => {
      return \`
        <tr>
          <td>\${safe(j.collectorId)}</td>
          <td>\${safe(j.status)}</td>
          <td>\${safe(j.attempts)}</td>
          <td>\${safe(j.lockedBy)}</td>
          <td>\${safe(j.lockedAt)}</td>
          <td style="max-width: 420px; white-space: pre-wrap;">\${safe(j.lastError)}</td>
        </tr>\`;
    }).join("");
    $("jobsBody").innerHTML = rows || \`<tr><td colspan="6" class="muted">No jobs yet</td></tr>\`;
  };

  const safeJsonInline = (obj) => {
    try {
      const s = JSON.stringify(obj ?? {}, null, 0);
      if (s.length > 600) return s.slice(0, 600) + "...";
      return s;
    } catch {
      return "";
    }
  };

  const renderObserved = (observed) => {
    const rows = observed.map(o => {
      return \`
        <tr>
          <td>\${safe(o.observedAt)}</td>
          <td>\${safe(o.checkId)}</td>
          <td>\${safe(o.collectorId)}</td>
          <td class="jsoncell">\${safeJsonInline(o.data)}</td>
        </tr>\`;
    }).join("");

    $("observedBody").innerHTML =
      rows || \`<tr><td colspan="4" class="muted">No observed checks yet</td></tr>\`;
  };

  const filenameFromKey = (a) => {
    const k = (a && (a.key || a.uri)) || "";
    const s = String(k);
    const parts = s.split("/");
    return parts[parts.length - 1] || s;
  };

  const renderArtefacts = (artefacts) => {
    const rows = artefacts.map(a => {
      const filename = filenameFromKey(a);
      const href = "/artefacts/" + a.id + "/download";
      return (
        "<tr>" +
          "<td>" + safe(filename) + "</td>" +
          "<td>" + safe(a.type) + "</td>" +
          "<td>" + safe(a.sizeBytes) + "</td>" +
          "<td>" + safe(a.createdAt) + "</td>" +
          "<td><a href=\\"" + href + "\\" target=\\"_blank\\" rel=\\"noreferrer\\">Download</a></td>" +
        "</tr>"
      );
    }).join("");
    $("artefactsBody").innerHTML = rows || "<tr><td colspan=\\"5\\" class=\\"muted\\">No artefacts yet</td></tr>";
  };

  const byCheckId = (observed) => {
    const map = {};
    for (const o of (observed || [])) {
      if (o && o.checkId) map[o.checkId] = o;
    }
    return map;
  };

  const computeSnapshot = (observed) => {
    const idx = byCheckId(observed);

    const users = idx["ENTRA_USERS_OBS_001"] && idx["ENTRA_USERS_OBS_001"].data ? idx["ENTRA_USERS_OBS_001"].data : {};
    const ca = idx["ENTRA_CA_OBS_001"] && idx["ENTRA_CA_OBS_001"].data ? idx["ENTRA_CA_OBS_001"].data : {};
    const roles1 = idx["ENTRA_DIRROLES_OBS_001"] && idx["ENTRA_DIRROLES_OBS_001"].data ? idx["ENTRA_DIRROLES_OBS_001"].data : {};
    const roles5 = idx["ENTRA_DIRROLES_OBS_005"] && idx["ENTRA_DIRROLES_OBS_005"].data ? idx["ENTRA_DIRROLES_OBS_005"].data : {};
    const eap = idx["ENTRA_EAP_OBS_001"] && idx["ENTRA_EAP_OBS_001"].data ? idx["ENTRA_EAP_OBS_001"].data : {};
    const exo1 = idx["EXO_MAILBOXES_OBS_001"] && idx["EXO_MAILBOXES_OBS_001"].data ? idx["EXO_MAILBOXES_OBS_001"].data : {};
    const exo2 = idx["EXO_MAILBOXES_OBS_002"] && idx["EXO_MAILBOXES_OBS_002"].data ? idx["EXO_MAILBOXES_OBS_002"].data : {};
    const exo3 = idx["EXO_MAILBOXES_OBS_003"] && idx["EXO_MAILBOXES_OBS_003"].data ? idx["EXO_MAILBOXES_OBS_003"].data : {};

    const totalUsers = safeInt(users.totalUsers);
    const guestUsers = safeInt(users.guestUsers);

    const activeAssignmentsCount = safeInt(roles1.activeAssignmentsCount);
    const rolesWithAny = safeInt(roles1.rolesWithAnyActiveAssignmentCount);

    const totalMailboxes = safeInt(exo1.totalMailboxes);

    // EXO features (best-effort)
    const features = (exo3 && exo3.mailboxFeatures) ? exo3.mailboxFeatures : {};
    const archiveEnabled = features && features.archive ? safeInt(features.archive.enabled) : null;
    const litigationEnabled = features && features.litigationHold ? safeInt(features.litigationHold.enabled) : null;

    const totalPolicies = safeInt(ca.totalPolicies);
    const mfaPolicies = safeInt(ca.policiesWithMfaGrantControl);

    // Completeness/truncation signals
    const identityComplete = users.isComplete === true;
    const privComplete = roles5.isComplete === true;
    const exoComplete = exo2.isComplete === true;
    const appsTruncated = eap.truncated === true;

    return {
      cards: {
        identity: {
          big: totalUsers !== null ? \`\${fmtCount(totalUsers)} users\` : "—",
          sub: guestUsers !== null ? \`\${fmtCount(guestUsers)} guests\` : "—"
        },
        priv: {
          big: activeAssignmentsCount !== null ? \`\${fmtCount(activeAssignmentsCount)} assignments\` : "—",
          sub: rolesWithAny !== null ? \`\${fmtCount(rolesWithAny)} roles used\` : "—"
        },
        exo: {
          big: totalMailboxes !== null ? \`\${fmtCount(totalMailboxes)} mailboxes\` : "—",
          sub: (archiveEnabled !== null || litigationEnabled !== null)
            ? \`\${archiveEnabled !== null ? fmtCount(archiveEnabled) : "—"} archives · \${litigationEnabled !== null ? fmtCount(litigationEnabled) : "—"} holds\`
            : "—"
        },
        sec: {
          big: totalPolicies !== null ? \`\${fmtCount(totalPolicies)} CA policies\` : "—",
          sub: mfaPolicies !== null ? \`\${fmtCount(mfaPolicies)} with MFA grant\` : "—"
        }
      },
      coverage: {
        identity: identityComplete ? { kind: "ok", text: "Complete", hint: "Observed check: ENTRA_USERS_OBS_001" }
                                  : (Object.keys(users).length ? { kind: "warn", text: "Partial", hint: "Completeness gap or denied slice(s)" }
                                                             : { kind: "info", text: "Pending", hint: "Awaiting data" }),
        priv: privComplete ? { kind: "ok", text: "Complete", hint: "Observed check: ENTRA_DIRROLES_OBS_005" }
                           : (Object.keys(roles1).length || Object.keys(roles5).length ? { kind: "warn", text: "Partial", hint: "Completeness gap or denied slice(s)" }
                                                                                      : { kind: "info", text: "Pending", hint: "Awaiting data" }),
        exo: exoComplete ? { kind: "ok", text: "Complete", hint: "Observed check: EXO_MAILBOXES_OBS_002" }
                         : (Object.keys(exo1).length || Object.keys(exo2).length ? { kind: "warn", text: "Partial", hint: "Completeness gap or denied slice(s)" }
                                                                                : { kind: "info", text: "Pending", hint: "Awaiting data" }),
        apps: Object.keys(eap).length
          ? (appsTruncated ? { kind: "warn", text: "Partial", hint: "Truncated scan (bounded)" }
                           : { kind: "ok", text: "Complete", hint: "Observed check: ENTRA_EAP_OBS_001" })
          : { kind: "info", text: "Pending", hint: "Awaiting data" }
      }
    };
  };

  const renderSnapshotAndCoverage = (observed) => {
    const snap = computeSnapshot(observed);

    $("mUsers").textContent = snap.cards.identity.big;
    $("mUsersSub").textContent = snap.cards.identity.sub;

    $("mPriv").textContent = snap.cards.priv.big;
    $("mPrivSub").textContent = snap.cards.priv.sub;

    $("mExo").textContent = snap.cards.exo.big;
    $("mExoSub").textContent = snap.cards.exo.sub;

    $("mSec").textContent = snap.cards.sec.big;
    $("mSecSub").textContent = snap.cards.sec.sub;

    $("covIdentity").innerHTML = badgeHtml(snap.coverage.identity.kind, snap.coverage.identity.text);
    $("covIdentityHint").textContent = snap.coverage.identity.hint;

    $("covPriv").innerHTML = badgeHtml(snap.coverage.priv.kind, snap.coverage.priv.text);
    $("covPrivHint").textContent = snap.coverage.priv.hint;

    $("covExo").innerHTML = badgeHtml(snap.coverage.exo.kind, snap.coverage.exo.text);
    $("covExoHint").textContent = snap.coverage.exo.hint;

    $("covApps").innerHTML = badgeHtml(snap.coverage.apps.kind, snap.coverage.apps.text);
    $("covAppsHint").textContent = snap.coverage.apps.hint;
  };

  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };

  const setRunBadges = (run) => {
    const status = (run && run.status) ? String(run.status) : "—";
    const profile = (run && run.dataProfile) ? String(run.dataProfile) : "safe";

    const statusKind =
      status === "succeeded" ? "ok" :
      status === "failed" ? "bad" :
      status === "running" ? "info" :
      "warn";

    $("runStatusBadge").className = "badge " + statusKind;
    $("runStatusBadge").textContent = "STATUS: " + status.toUpperCase();

    $("runProfileBadge").className = "badge";
    $("runProfileBadge").textContent = "PROFILE: " + profile.toUpperCase();

    const tenant = run && run.tenant ? run.tenant : null;
    const tenantLabel =
      tenant && (tenant.displayName || tenant.primaryDomain)
        ? (tenant.displayName ? tenant.displayName : tenant.primaryDomain)
        : "—";

    const generatedAt = run && (run.endedAt || run.updatedAt || run.createdAt) ? (run.endedAt || run.updatedAt || run.createdAt) : null;
    $("runMetaLine").textContent = "Tenant: " + tenantLabel + " · Generated: " + fmtIso(generatedAt);
  };

  const startPolling = () => {
    stopPolling();
    pollTimer = setInterval(async () => {
      if (!currentRunId) return;

      try {
        const [runRes, jobsRes, artefactsRes, observedRes] = await Promise.all([
          fetch("/runs/" + currentRunId),
          fetch("/runs/" + currentRunId + "/jobs"),
          fetch("/runs/" + currentRunId + "/artefacts"),
          fetch("/runs/" + currentRunId + "/observed-checks")
        ]);

        const run = await runRes.json();
        const jobs = await jobsRes.json();
        const artefacts = await artefactsRes.json();

        let observed = [];
        try {
          if (observedRes && observedRes.ok) {
            observed = normalizeList(await observedRes.json());
          }
        } catch { /* ignore */ }

        setRunBadges(run);
        renderJobs(normalizeList(jobs));
        renderArtefacts(normalizeList(artefacts));
        renderObserved(observed);
        renderSnapshotAndCoverage(observed);

        if (run && (run.status === "succeeded" || run.status === "failed")) {
          stopPolling();
        }
      } catch (e) {
        console.warn("poll failed", e);
      }
    }, 500);
  };

  $("clear").addEventListener("click", () => {
    stopPolling();
    currentRunId = null;
    $("statusCard").style.display = "none";
    $("runIdPill").textContent = "";
    $("links").innerHTML = "";
    $("jobsBody").innerHTML = "";
    if ($("artefactsBody")) $("artefactsBody").innerHTML = "";
    if ($("observedBody")) $("observedBody").innerHTML = "";

    // Reset snapshot
    $("runStatusBadge").className = "badge";
    $("runStatusBadge").textContent = "STATUS: —";
    $("runProfileBadge").className = "badge";
    $("runProfileBadge").textContent = "PROFILE: —";
    $("runMetaLine").textContent = "Tenant: — · Generated: —";

    $("mUsers").textContent = "—"; $("mUsersSub").textContent = "—";
    $("mPriv").textContent = "—"; $("mPrivSub").textContent = "—";
    $("mExo").textContent = "—"; $("mExoSub").textContent = "—";
    $("mSec").textContent = "—"; $("mSecSub").textContent = "—";

    $("covIdentity").innerHTML = badgeHtml("info", "Pending"); $("covIdentityHint").textContent = "—";
    $("covPriv").innerHTML = badgeHtml("info", "Pending"); $("covPrivHint").textContent = "—";
    $("covExo").innerHTML = badgeHtml("info", "Pending"); $("covExoHint").textContent = "—";
    $("covApps").innerHTML = badgeHtml("info", "Pending"); $("covAppsHint").textContent = "—";
  });

  $("createRun").addEventListener("click", async () => {
    const tenantGuid = $("tenantGuid").value.trim();
    const primaryDomain = $("primaryDomain").value.trim();
    const displayName = $("displayName").value.trim();
    const triggeredBy = $("triggeredBy").value.trim() || "portal-demo";
    const dataProfile = $("dataProfile").value;

    const modulesEnabled = {};
    for (const key of DEMO_MODULE_KEYS) {
      const el = $(key);
      modulesEnabled[key] = !!(el && el.checked);
    }

    const payload = {
      tenantGuid,
      primaryDomain,
      displayName: displayName || null,
      triggeredBy,
      dataProfile,
      modulesEnabled
    };

    const res = await fetch("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    let json = null;
    let text = "";

    try {
      json = await res.json();
    } catch {
      try { text = await res.text(); } catch { /* ignore */ }
    }

    if (!res.ok) {
      const details = json ? JSON.stringify(json, null, 2) : (text || \`HTTP \${res.status}\`);
      alert("Create run failed:\\n\\n" + details);
      return;
    }

    const runId = json && json.runId;
    if (!runId) {
      alert("Create run failed: no runId returned");
      return;
    }

    currentRunId = runId;
    $("statusCard").style.display = "block";
    $("runIdPill").textContent = runId;

    $("links").innerHTML = [
      mkLink(\`/runs/\${runId}\`, \`GET /runs/\${runId}\`),
      mkLink(\`/runs/\${runId}/jobs\`, \`GET /runs/\${runId}/jobs\`),
      mkLink(\`/runs/\${runId}/findings\`, \`GET /runs/\${runId}/findings\`),
      mkLink(\`/runs/\${runId}/observed-checks\`, \`GET /runs/\${runId}/observed-checks\`),
      mkLink(\`/runs/\${runId}/artefacts\`, \`GET /runs/\${runId}/artefacts\`)
    ].join("");

    // Start polling immediately (run endpoint will populate status/tenant meta)
    startPolling();
  });
</script>
</body>
</html>`;
}
