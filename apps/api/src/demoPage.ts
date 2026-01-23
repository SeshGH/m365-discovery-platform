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
      --codebg: #0b1020;
      --codefg: #d6e7ff;
      --btn: #111827;
      --btnfg: #ffffff;
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
    .btnrow { display:flex; gap: 10px; margin-top: 14px; }
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
    .pill {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 999px;
      background: var(--chip);
      font-size: 12px;
      margin-left: 8px;
      color: #374151;
      vertical-align: middle;
    }
    .row { display:flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .links a { color: #0b5bd3; text-decoration: none; }
    .links a:hover { text-decoration: underline; }
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
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
    th, td { text-align: left; padding: 8px 10px; border-top: 1px solid var(--border); vertical-align: top; }
    th { color: #374151; font-weight: 700; }
    .status {
      display:inline-block; padding: 2px 8px; border-radius: 999px;
      border: 1px solid var(--border); background: #fff; font-size: 12px;
    }
    .muted { color: var(--muted); }
    .jsoncell { max-width: 520px; white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; }
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
    </div>

    <div class="card" id="statusCard" style="display:none;">
      <div class="row" style="align-items: center;">
        <div>
          <div style="font-weight:700;">Run <span class="pill" id="runIdPill"></span></div>
          <div class="muted">Live status below (polling).</div>
        </div>
        <div class="links" id="links"></div>
      </div>

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

      <div style="margin-top: 14px; font-weight:700;">Observed checks</div>
      <div class="muted" style="margin-bottom: 8px;">Observed facts captured by collectors (not findings). Should always render even if empty.</div>

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

      <div style="margin-top: 14px; font-weight:700;">Artefacts</div>
      <div class="muted" style="margin-bottom: 8px;">Artefacts produced by this run. Downloads use the API redirect flow.</div>

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

  const renderJobs = (jobs) => {
    const rows = jobs.map(j => {
      return \`
        <tr>
          <td>\${safe(j.collectorId)}</td>
          <td><span class="status">\${safe(j.status)}</span></td>
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
          "<td><a href=\\\"" + href + "\\\" target=\\\"_blank\\\" rel=\\\"noreferrer\\\">Download</a></td>" +
        "</tr>"
      );
    }).join("");
    $("artefactsBody").innerHTML = rows || "<tr><td colspan=\\\"5\\\" class=\\\"muted\\\">No artefacts yet</td></tr>";
  };

  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
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

        renderJobs(normalizeList(jobs));
        renderArtefacts(normalizeList(artefacts));
        renderObserved(observed);

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

    startPolling();
  });
</script>
</body>
</html>`;
}
