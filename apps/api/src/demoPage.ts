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
      --bg: #ffffff;
      --panel: #ffffff;
      --chip: #f3f4f6;
      --btn: #111827;
      --btnfg: #ffffff;
      --focus: rgba(59,130,246,0.45);
    }
    * { box-sizing: border-box; }
    body {
      margin: 24px;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      color: var(--text);
      background: var(--bg);
    }
    h1 { font-size: 24px; margin: 0 0 6px 0; }
    .sub { color: var(--muted); margin: 0 0 18px 0; }
    .wrap { max-width: 1100px; }
    .card {
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 18px;
      background: var(--panel);
    }
    .card + .card { margin-top: 16px; }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px 18px;
    }
    label { display:block; font-weight: 600; font-size: 13px; margin-bottom: 6px; }
    input, select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 10px;
      font-size: 14px;
      background: #fff;
      outline: none;
    }
    input:focus, select:focus {
      border-color: rgba(59,130,246,0.65);
      box-shadow: 0 0 0 3px var(--focus);
    }
    .modules {
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 12px 6px 12px;
      grid-column: 1 / -1;
    }
    .modules .note { color: var(--muted); font-size: 13px; margin: 6px 0 10px 0; }
    .note { color: var(--muted); font-size: 13px; margin-top: 6px; }
    .checkrow { display:flex; flex-direction: column; gap: 10px; margin-top: 6px; }
    .checkrow label { font-weight: 500; margin: 0; display:flex; gap: 10px; align-items: center; }
    .checkrow input { width: 16px; height: 16px; padding: 0; }
    .btnrow { display:flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
    button {
      padding: 10px 14px;
      border-radius: 12px;
      border: 1px solid var(--border);
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      background: #fff;
    }
    button.primary {
      background: var(--btn);
      color: var(--btnfg);
      border-color: var(--btn);
    }
    button.small {
      padding: 6px 10px;
      border-radius: 10px;
      font-size: 13px;
    }
    button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .pill {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 999px;
      background: var(--chip);
      font-size: 12px;
      margin-left: 8px;
      color: #374151;
      vertical-align: middle;
      word-break: break-all;
    }
    .row { display:flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .links a { color: #0b5bd3; text-decoration: none; }
    .links a:hover { text-decoration: underline; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
    th, td { text-align: left; padding: 8px 10px; border-top: 1px solid var(--border); vertical-align: top; }
    th { color: #374151; font-weight: 700; }
    .status {
      display:inline-block; padding: 2px 8px; border-radius: 999px;
      border: 1px solid var(--border); background: #fff; font-size: 12px;
    }
    .muted { color: var(--muted); }
    .jsoncell { max-width: 520px; white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; }

    .divider { height: 1px; background: var(--border); margin: 16px 0; }

    details {
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px 12px;
      background: #fff;
    }
    details + details { margin-top: 12px; }
    details summary {
      cursor: pointer;
      list-style: none;
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 13px;
      color: #111827;
      user-select: none;
    }
    details summary::-webkit-details-marker { display:none; }

    .summaryMeta {
      font-weight: 600;
      font-size: 12px;
      color: var(--muted);
      background: var(--chip);
      padding: 2px 8px;
      border-radius: 999px;
      margin-left: auto;
    }

    .exportRow {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .exportRow a.buttonLink {
      display: inline-block;
      text-decoration: none;
      padding: 8px 12px;
      border-radius: 10px;
      border: 1px solid var(--border);
      font-weight: 700;
      font-size: 13px;
      color: var(--text);
      background: #fff;
    }
    .exportRow a.buttonLink.primaryLink {
      background: var(--btn);
      color: var(--btnfg);
      border-color: var(--btn);
    }
    .exportRow a.buttonLink[aria-disabled="true"] {
      opacity: 0.55;
      pointer-events: none;
    }

    .runHeaderLine { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    .toast { margin-left: 10px; font-size: 12px; color: var(--muted); }
    .pollMeta { margin-top: 4px; font-size: 12px; color: var(--muted); }

    /* Summary tiles */
    .tiles {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 12px;
      margin-top: 12px;
    }
    .tile {
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 12px;
      background: #fff;
      min-height: 86px;
    }
    .tile .kicker {
      font-size: 12px;
      color: var(--muted);
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .tile .title {
      margin-top: 6px;
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .tile .subline {
      margin-top: 4px;
      font-size: 12px;
      color: var(--muted);
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: #fff;
      font-weight: 700;
      font-size: 11.5px;
      color: #374151;
    }
    .tile.span3 { grid-column: span 3; }
    .tile.span4 { grid-column: span 4; }
    .tile.span6 { grid-column: span 6; }

    /* Resume-last-run row */
    .resumeRow {
      margin-top: 8px;
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
    .resumeHint {
      font-size: 12px;
      color: var(--muted);
    }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 12px;
    }

    @media (max-width: 980px) {
      .tile.span3, .tile.span4, .tile.span6 { grid-column: span 12; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>M365 Discovery Platform - Demo</h1>
    <div class="sub">Demo-only run launcher and progress viewer. Long-term UI will live in a dedicated portal app.</div>

    <div class="card">
      <h2 style="margin:0 0 10px 0; font-size: 16px;">Create Run</h2>

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
          <div class="note">Use safe for low-impact discovery. Use full for deeper collection. Unknown values will be treated as safe.</div>
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

      <div class="divider"></div>

      <h2 style="margin:0 0 10px 0; font-size: 16px;">Load existing run</h2>
      <div class="grid">
        <div>
          <label for="existingRunId">Run ID</label>
          <input id="existingRunId" placeholder="cmk..." />
          <div class="note">Paste a runId to resume polling and view jobs/observed checks/artefacts.</div>
          <div class="resumeRow">
            <button class="small" id="resumeLastRun" disabled title="Resume last run from this browser">Resume last run</button>
            <span class="resumeHint">Last run: <span id="lastRunHint" class="mono">—</span></span>
          </div>
        </div>
        <div style="display:flex; align-items:flex-end;">
          <button class="primary small" id="loadRun">Load run</button>
        </div>
      </div>
    </div>

    <div class="card" id="statusCard" style="display:none;">
      <div class="row" style="align-items: center;">
        <div>
          <div class="runHeaderLine" style="font-weight:700;">
            <span>Run</span>
            <span class="pill" id="runIdPill"></span>
            <button class="small" id="copyRunId" title="Copy runId to clipboard">Copy</button>
            <span class="toast" id="copyToast" style="display:none;"></span>
          </div>

          <div class="pollMeta" id="pollStatus">Polling: off</div>
        </div>

        <details style="min-width: 280px;">
          <summary>
            <span>Developer links</span>
            <span class="summaryMeta">API endpoints</span>
          </summary>
          <div class="links" id="links" style="margin-top: 8px;"></div>
        </details>
      </div>

      <!-- Summary tiles (restored) -->
      <div class="tiles" aria-label="Run summary tiles">
        <div class="tile span3">
          <div class="kicker">
            <span>Run</span>
            <span class="chip" id="tileRunStatus">—</span>
          </div>
          <div class="title" id="tileJobsDone">—</div>
          <div class="subline">
            <span class="chip" id="tileJobsQueued">queued: —</span>
            <span class="chip" id="tileJobsFailed">failed: —</span>
          </div>
        </div>

        <div class="tile span3">
          <div class="kicker">
            <span>Entra Users</span>
            <span class="chip" id="tileUsersProfile">—</span>
          </div>
          <div class="title" id="tileUsersTotal">—</div>
          <div class="subline">
            <span class="chip" id="tileUsersEnabled">enabled: —</span>
            <span class="chip" id="tileUsersGuests">guests: —</span>
          </div>
        </div>

        <div class="tile span3">
          <div class="kicker">
            <span>Mailboxes</span>
            <span class="chip" id="tileMbxProfile">—</span>
          </div>
          <div class="title" id="tileMbxTotal">—</div>
          <div class="subline">
            <span class="chip" id="tileMbxEnabled">enabled: —</span>
            <span class="chip" id="tileMbxOver50">>50GB: —</span>
          </div>
        </div>

        <div class="tile span3">
          <div class="kicker">
            <span>Enterprise Apps</span>
            <span class="chip" id="tileAppsTrunc">—</span>
          </div>
          <div class="title" id="tileAppsTotal">—</div>
          <div class="subline">
            <span class="chip" id="tileAppsScanned">scanned: —</span>
            <span class="chip" id="tileAppsRisky">risky: —</span>
          </div>
        </div>

        <div class="tile span12" style="padding: 12px;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap: 12px; flex-wrap: wrap;">
            <div>
              <div class="kicker" style="justify-content:flex-start; gap: 8px;">
                <span>Conditional Access</span>
                <span class="chip" id="tileCaProfile">—</span>
              </div>
              <div class="subline" style="margin-top: 8px;">
                <span class="chip" id="tileCaTotal">total: —</span>
                <span class="chip" id="tileCaEnabled">enabled: —</span>
                <span class="chip" id="tileCaMfa">with MFA: —</span>
                <span class="chip" id="tileCaAllUsers">target all users: —</span>
              </div>
            </div>

            <div style="min-width: 320px;">
              <div style="font-weight:700; font-size: 13px;">Run summary exports</div>
              <div class="muted" style="margin-top: 4px;">These appear once report jobs finish.</div>
              <div class="exportRow">
                <a id="runSummaryXlsx" class="buttonLink primaryLink" aria-disabled="true" href="#" target="_blank" rel="noreferrer">Download XLSX</a>
                <a id="runSummaryCsv" class="buttonLink" aria-disabled="true" href="#" target="_blank" rel="noreferrer">Download CSV</a>
                <span id="runSummaryStatus" class="muted">Not ready yet.</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Default collapsed now: no "open" attribute -->
      <details style="margin-top: 14px;">
        <summary>
          <span>Jobs</span>
          <span class="summaryMeta">collectorId / status</span>
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
          <span class="summaryMeta">facts (not findings)</span>
        </summary>

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
          <span class="summaryMeta">downloads</span>
        </summary>

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
    </div>
  </div>

<script>
  const $ = (id) => document.getElementById(id);

  const DEMO_MODULE_KEYS = ${moduleKeysJson};

  const POLL_INTERVAL_MS = 500;

  const STORAGE_LAST_RUN_ID = "m365dp:lastRunId";

  let pollTimer = null;
  let currentRunId = null;
  let lastPollAtMs = null;

  const normalizeList = (v) => {
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.value)) return v.value;
    return [];
  };

  const mkLink = (href, text) =>
    \`<div><a href="\${href}" target="_blank" rel="noreferrer">\${text}</a></div>\`;

  const safe = (v) => (v === null || v === undefined) ? "" : String(v);

  const fmtNumber = (n) => {
    if (typeof n !== "number" || !Number.isFinite(n)) return "—";
    try { return n.toLocaleString(undefined); } catch { return String(n); }
  };

  const fmtBytes = (bytes) => {
    if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "—";
    const abs = Math.abs(bytes);
    const units = ["B", "KB", "MB", "GB", "TB"];
    let u = 0;
    let v = abs;
    while (v >= 1024 && u < units.length - 1) {
      v = v / 1024;
      u += 1;
    }
    const rounded = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
    const sign = bytes < 0 ? "-" : "";
    return sign + rounded.toLocaleString(undefined) + " " + units[u];
  };

  const fmtLocalTime = (iso) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      return d.toLocaleString(undefined);
    } catch {
      return String(iso);
    }
  };

  const fmtAgo = (msAgo) => {
    if (typeof msAgo !== "number" || !Number.isFinite(msAgo) || msAgo < 0) return "";
    const s = Math.floor(msAgo / 1000);
    if (s < 5) return "just now";
    if (s < 60) return s + "s ago";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    if (h < 48) return h + "h ago";
    const d = Math.floor(h / 24);
    return d + "d ago";
  };

  const setPollStatus = (text) => {
    const el = $("pollStatus");
    if (el) el.textContent = text;
  };

  const showToast = (text) => {
    const el = $("copyToast");
    if (!el) return;
    el.textContent = text;
    el.style.display = "inline";
    setTimeout(() => {
      try { el.style.display = "none"; } catch { /* ignore */ }
    }, 1200);
  };

  const copyTextToClipboard = async (text) => {
    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* ignore */ }

    // Fallback
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "true");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  const setTile = (id, text) => {
    const el = $(id);
    if (el) el.textContent = text;
  };

  const firstObserved = (observed, checkId) => {
    if (!Array.isArray(observed)) return null;
    for (const o of observed) {
      if (o && o.checkId === checkId) return o;
    }
    return null;
  };

  const renderSummaryTiles = (run, jobs, observed, artefacts) => {
    // Run / Jobs tile
    const listJobs = Array.isArray(jobs) ? jobs : [];
    const totalJobs = listJobs.length;

    let done = 0;
    let queued = 0;
    let failed = 0;

    for (const j of listJobs) {
      const s = j && j.status;
      if (s === "succeeded") done += 1;
      else if (s === "failed") failed += 1;
      else queued += 1;
    }

    setTile("tileRunStatus", run && run.status ? String(run.status) : "—");
    setTile("tileJobsDone", totalJobs ? \`\${done}/\${totalJobs}\` : "—");
    setTile("tileJobsQueued", \`queued: \${fmtNumber(queued)}\`);
    setTile("tileJobsFailed", \`failed: \${fmtNumber(failed)}\`);

    // Entra Users
    const usersObs = firstObserved(observed, "ENTRA_USERS_OBS_001");
    const u = usersObs && usersObs.data ? usersObs.data : null;
    const usersProfile = u && (u.profile || u.dataProfile) ? String(u.profile || u.dataProfile) : "—";
    setTile("tileUsersProfile", usersProfile);

    const usersTotal = u && typeof u.totalUsers === "number" ? u.totalUsers : null;
    setTile("tileUsersTotal", usersTotal === null ? "—" : fmtNumber(usersTotal));
    setTile("tileUsersEnabled", "enabled: " + (typeof u?.enabledUsers === "number" ? fmtNumber(u.enabledUsers) : "—"));
    setTile("tileUsersGuests", "guests: " + (typeof u?.guestUsers === "number" ? fmtNumber(u.guestUsers) : "—"));

    // Mailboxes
    const mbxObs = firstObserved(observed, "EXO_MAILBOXES_OBS_001");
    const m = mbxObs && mbxObs.data ? mbxObs.data : null;
    const mbxProfile = m && (m.profile || m.dataProfile) ? String(m.profile || m.dataProfile) : "—";
    setTile("tileMbxProfile", mbxProfile);

    const mbxTotal = m && typeof m.totalMailboxes === "number" ? m.totalMailboxes : null;
    setTile("tileMbxTotal", mbxTotal === null ? "—" : fmtNumber(mbxTotal));
    setTile("tileMbxEnabled", "enabled: " + (typeof m?.byState?.enabled === "number" ? fmtNumber(m.byState.enabled) : "—"));
    setTile("tileMbxOver50", ">50GB: " + (typeof m?.sizeBuckets?.over50GB === "number" ? fmtNumber(m.sizeBuckets.over50GB) : "—"));

    // Enterprise Apps
    const appsObs = firstObserved(observed, "ENTRA_EAP_OBS_001");
    const a = appsObs && appsObs.data ? appsObs.data : null;

    const appsTrunc = a && typeof a.truncated === "boolean" ? (a.truncated ? "truncated" : "complete") : "—";
    setTile("tileAppsTrunc", appsTrunc);

    const appsTotal =
      a && typeof a.totalEnterpriseApps === "number"
        ? a.totalEnterpriseApps
        : a && typeof a.totalApps === "number"
          ? a.totalApps
          : null;

    setTile("tileAppsTotal", appsTotal === null ? "—" : fmtNumber(appsTotal));
    setTile("tileAppsScanned", "scanned: " + (typeof a?.scannedApps === "number" ? fmtNumber(a.scannedApps) : "—"));

    const risky =
      typeof a?.riskyApps === "number"
        ? a.riskyApps
        : typeof a?.riskyAppsCount === "number"
          ? a.riskyAppsCount
          : null;
    setTile("tileAppsRisky", "risky: " + (typeof risky === "number" ? fmtNumber(risky) : "—"));

    // Conditional Access
    const caObs = firstObserved(observed, "ENTRA_CA_OBS_001");
    const c = caObs && caObs.data ? caObs.data : null;

    const caProfile = c && (c.profile || c.dataProfile) ? String(c.profile || c.dataProfile) : "—";
    setTile("tileCaProfile", caProfile);

    setTile("tileCaTotal", "total: " + (typeof c?.totalPolicies === "number" ? fmtNumber(c.totalPolicies) : "—"));
    setTile("tileCaEnabled", "enabled: " + (typeof c?.enabledPolicies === "number" ? fmtNumber(c.enabledPolicies) : "—"));
    setTile("tileCaMfa", "with MFA: " + (typeof c?.policiesWithMfaGrantControl === "number" ? fmtNumber(c.policiesWithMfaGrantControl) : "—"));
    setTile("tileCaAllUsers", "target all users: " + (typeof c?.policiesTargetingAllUsers === "number" ? fmtNumber(c.policiesTargetingAllUsers) : "—"));
  };

  const renderJobs = (jobs) => {
    const rows = jobs.map(j => {
      return \`
        <tr>
          <td>\${safe(j.collectorId)}</td>
          <td><span class="status">\${safe(j.status)}</span></td>
          <td>\${fmtNumber(Number(j.attempts ?? 0))}</td>
          <td>\${safe(j.lockedBy)}</td>
          <td>\${fmtLocalTime(j.lockedAt)}</td>
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
          <td>\${fmtLocalTime(o.observedAt)}</td>
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
      const sizePretty = typeof a.sizeBytes === "number" ? fmtBytes(a.sizeBytes) : "—";
      return (
        "<tr>" +
          "<td>" + safe(filename) + "</td>" +
          "<td>" + safe(a.type) + "</td>" +
          "<td title=\\"" + safe(a.sizeBytes) + "\\">" + sizePretty + "</td>" +
          "<td>" + fmtLocalTime(a.createdAt) + "</td>" +
          "<td><a href=\\"" + href + "\\" target=\\"_blank\\" rel=\\"noreferrer\\">Download</a></td>" +
        "</tr>"
      );
    }).join("");
    $("artefactsBody").innerHTML = rows || "<tr><td colspan=\\"5\\" class=\\"muted\\">No artefacts yet</td></tr>";
  };

  const setRunSummaryLinks = (artefacts) => {
    const xlsxEl = $("runSummaryXlsx");
    const csvEl = $("runSummaryCsv");
    const statusEl = $("runSummaryStatus");

    const list = Array.isArray(artefacts) ? artefacts : [];

    const findByFilename = (name) => {
      for (const a of list) {
        const fn = filenameFromKey(a);
        if (fn === name) return a;
      }
      return null;
    };

    const xlsx = findByFilename("run-summary.xlsx");
    const csv = findByFilename("run-summary.csv");

    const setLink = (el, artefact) => {
      if (!el) return;
      if (artefact && artefact.id) {
        el.setAttribute("href", "/artefacts/" + artefact.id + "/download");
        el.setAttribute("aria-disabled", "false");
      } else {
        el.setAttribute("href", "#");
        el.setAttribute("aria-disabled", "true");
      }
    };

    setLink(xlsxEl, xlsx);
    setLink(csvEl, csv);

    if (statusEl) {
      if (xlsx && csv) statusEl.textContent = "Ready.";
      else if (xlsx || csv) statusEl.textContent = "Partially ready (one report still running).";
      else statusEl.textContent = "Not ready yet.";
    }
  };

  const persistLastRunId = (runId) => {
    try {
      if (!runId) return;
      localStorage.setItem(STORAGE_LAST_RUN_ID, String(runId));
      updateResumeUi();
    } catch { /* ignore */ }
  };

  const readLastRunId = () => {
    try {
      const v = localStorage.getItem(STORAGE_LAST_RUN_ID);
      return (v && String(v).trim()) ? String(v).trim() : null;
    } catch {
      return null;
    }
  };

  const updateResumeUi = () => {
    const hint = $("lastRunHint");
    const btn = $("resumeLastRun");
    if (!hint || !btn) return;

    const last = readLastRunId();
    if (last) {
      hint.textContent = last;
      btn.disabled = false;
    } else {
      hint.textContent = "—";
      btn.disabled = true;
    }
  };

  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    lastPollAtMs = null;
    setPollStatus("Polling: off");
  };

  const setLinksForRun = (runId) => {
    $("links").innerHTML = [
      mkLink(\`/runs/\${runId}\`, \`GET /runs/\${runId}\`),
      mkLink(\`/runs/\${runId}/jobs\`, \`GET /runs/\${runId}/jobs\`),
      mkLink(\`/runs/\${runId}/findings\`, \`GET /runs/\${runId}/findings\`),
      mkLink(\`/runs/\${runId}/observed-checks\`, \`GET /runs/\${runId}/observed-checks\`),
      mkLink(\`/runs/\${runId}/artefacts\`, \`GET /runs/\${runId}/artefacts\`)
    ].join("");
  };

  const showRun = (runId) => {
    currentRunId = runId;
    $("statusCard").style.display = "block";
    $("runIdPill").textContent = runId;
    setLinksForRun(runId);

    // reset summary links until next artefact poll
    setRunSummaryLinks([]);

    // reset tiles until first poll
    renderSummaryTiles(null, [], [], []);

    // persist for quick demo resumes
    persistLastRunId(runId);

    // keep input in sync for convenience
    if ($("existingRunId")) $("existingRunId").value = runId;
  };

  const startPolling = () => {
    stopPolling();

    lastPollAtMs = Date.now();
    setPollStatus("Polling every " + (POLL_INTERVAL_MS / 1000) + "s (" + fmtAgo(0) + ")");

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

        const jobsList = normalizeList(jobs);
        const artefactList = normalizeList(artefacts);

        renderJobs(jobsList);
        renderArtefacts(artefactList);
        renderObserved(observed);

        // Update run-summary export buttons near the top
        setRunSummaryLinks(artefactList);

        // Restore overview tiles
        renderSummaryTiles(run, jobsList, observed, artefactList);

        lastPollAtMs = Date.now();
        const since = Date.now() - lastPollAtMs; // 0
        setPollStatus("Polling every " + (POLL_INTERVAL_MS / 1000) + "s (" + fmtAgo(since) + ")");

        if (run && (run.status === "succeeded" || run.status === "failed")) {
          stopPolling();
          setPollStatus("Polling stopped (run " + run.status + ").");
        }
      } catch (e) {
        console.warn("poll failed", e);
        // show staleness hint
        if (lastPollAtMs) {
          const age = Date.now() - lastPollAtMs;
          setPollStatus("Polling every " + (POLL_INTERVAL_MS / 1000) + "s (last update " + fmtAgo(age) + ")");
        }
      }
    }, POLL_INTERVAL_MS);
  };

  $("copyRunId").addEventListener("click", async () => {
    const runId = $("runIdPill").textContent || "";
    if (!runId) return;
    const ok = await copyTextToClipboard(runId);
    showToast(ok ? "Copied." : "Copy failed.");
  });

  $("resumeLastRun").addEventListener("click", async () => {
    const last = readLastRunId();
    if (!last) return;

    try {
      const res = await fetch("/runs/" + last);
      if (!res.ok) {
        alert("Last runId not found anymore (HTTP " + res.status + ").");
        return;
      }
    } catch {
      alert("Unable to reach API to load run.");
      return;
    }

    showRun(last);
    startPolling();
  });

  $("clear").addEventListener("click", () => {
    stopPolling();
    currentRunId = null;
    $("statusCard").style.display = "none";
    $("runIdPill").textContent = "";
    $("links").innerHTML = "";
    $("jobsBody").innerHTML = "";
    if ($("artefactsBody")) $("artefactsBody").innerHTML = "";
    if ($("observedBody")) $("observedBody").innerHTML = "";
    if ($("existingRunId")) $("existingRunId").value = "";

    // reset summary links/tiles
    setRunSummaryLinks([]);
    renderSummaryTiles(null, [], [], []);

    // DO NOT clear localStorage: it's for demo convenience
    updateResumeUi();
  });

  $("loadRun").addEventListener("click", async () => {
    const runId = $("existingRunId").value.trim();
    if (!runId) {
      alert("Please enter a runId to load.");
      return;
    }

    try {
      const res = await fetch("/runs/" + runId);
      if (!res.ok) {
        alert("Run not found (HTTP " + res.status + ").");
        return;
      }
    } catch {
      alert("Unable to reach API to load run.");
      return;
    }

    showRun(runId);
    startPolling();
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

    showRun(runId);
    startPolling();
  });

  // Init
  updateResumeUi();
  const last = readLastRunId();
  if (last && $("existingRunId") && !$("existingRunId").value) {
    $("existingRunId").value = last;
  }
</script>
</body>
</html>`;
}
