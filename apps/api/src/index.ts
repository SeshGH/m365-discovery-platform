import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Always load apps/api/.env, regardless of where pnpm was run from
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import Fastify from "fastify";
import cors from "@fastify/cors";
import { CreateRunSchema } from "@acme/core";
import { prisma } from "@acme/db";

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// Allow PowerShell POSTs that default to application/x-www-form-urlencoded with no meaningful body
app.addContentTypeParser(
  "application/x-www-form-urlencoded",
  { parseAs: "string" },
  (_req, _body, done) => done(null, {})
);

// --------------------
// Module -> Collector mapping
// --------------------
// IMPORTANT:
// modulesEnabled keys may be:
// - legacy module keys from the demo UI (entraUsers, enterpriseAppPermissions, ...)
// - canonical collector IDs (entra.users, entra.enterpriseApps.permissions, ...)
// We accept BOTH to avoid drift between UI and API.
const MODULE_TO_COLLECTOR_ID: Record<string, string> = {
  // Legacy keys (demo UI / earlier contract)
  entraUsers: "entra.users",
  enterpriseAppPermissions: "entra.enterpriseApps.permissions",
  conditionalAccessPolicies: "entra.conditionalAccess.policies",
  directoryRolesAssignments: "entra.directoryRoles.assignments",

  // Canonical keys (preferred stable contract)
  "entra.users": "entra.users",
  "entra.enterpriseApps.permissions": "entra.enterpriseApps.permissions",
  "entra.conditionalAccess.policies": "entra.conditionalAccess.policies",
  "entra.directoryRoles.assignments": "entra.directoryRoles.assignments"
};

// Always enqueue these report jobs at the end of a run
const RUN_REPORT_COLLECTOR_IDS = [
  "report.runSummary.csv",
  "report.runSummary.xlsx"
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type JobSpec = {
  collectorId: string;
  module: string;
};

/**
 * modulesEnabled is an object of boolean flags, e.g:
 * { entraUsers: true, enterpriseAppPermissions: false }
 * OR
 * { "entra.users": true, "entra.enterpriseApps.permissions": true }
 *
 * This returns JobSpecs (collectorId + module key). Payload is added later once we know tenantId/tenantGuid.
 */
function resolveCollectorJobs(modulesEnabled: unknown): JobSpec[] {
  // Default behaviour: at least one job
  const fallback: JobSpec[] = [{ collectorId: "entra.users", module: "entra.users" }];

  if (!isPlainObject(modulesEnabled)) return fallback;

  const jobs: JobSpec[] = [];

  for (const [moduleKey, enabled] of Object.entries(modulesEnabled)) {
    if (enabled !== true) continue;

    const collectorId = MODULE_TO_COLLECTOR_ID[moduleKey];
    if (!collectorId) continue;

    jobs.push({
      collectorId,
      module: moduleKey
    });
  }

  return jobs.length > 0 ? jobs : fallback;
}

// ---- S3/MinIO config (fail fast) ----
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_REGION = process.env.S3_REGION ?? "us-east-1";
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY;
const S3_SECRET_KEY = process.env.S3_SECRET_KEY;
const S3_BUCKET = process.env.S3_BUCKET ?? "artefacts";
const S3_FORCE_PATH_STYLE =
  String(process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() === "true";

if (!S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
  throw new Error(
    `[api] Missing S3 config env vars. Required: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY`
  );
}

const S3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY
  },
  forcePathStyle: S3_FORCE_PATH_STYLE
});

app.get("/health", async () => ({ ok: true }));

/**
 * DEMO-ONLY UI
 * This is intentionally in the API for quick local testing.
 * Long-term UI will live in a dedicated portal app.
 */
app.get("/demo", async (_req, reply) => {
  reply.type("text/html").send(`<!doctype html>
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
            <label><input type="checkbox" id="entraUsers" checked /> entraUsers</label>
            <label><input type="checkbox" id="enterpriseAppPermissions" checked /> enterpriseAppPermissions</label>
            <label><input type="checkbox" id="conditionalAccessPolicies" checked /> conditionalAccessPolicies</label>
            <label><input type="checkbox" id="directoryRolesAssignments" checked /> directoryRolesAssignments</label>

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
      // keep it compact-ish
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

        // Observed checks should never break the UI
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

    const entraUsers = $("entraUsers").checked;
    const enterpriseAppPermissions = $("enterpriseAppPermissions").checked;
    const conditionalAccessPolicies = $("conditionalAccessPolicies").checked;
    const directoryRolesAssignments = $("directoryRolesAssignments").checked;

    const payload = {
      tenantGuid,
      primaryDomain,
      displayName: displayName || null,
      triggeredBy,
      dataProfile,
      modulesEnabled: {
        entraUsers,
        enterpriseAppPermissions,
        conditionalAccessPolicies,
        directoryRolesAssignments
      }
    };

    const res = await fetch("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    // Always surface errors in the demo UI
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
</html>`);
});

function safeAttachmentFilename(name: string) {
  return name.replace(/[^\w.\-() ]+/g, "_");
}

function resolveArtefactTtlSeconds() {
  const expiresInSecondsRaw = Number(process.env.ARTEFACT_URL_TTL_SECONDS ?? 300);
  const expiresInSeconds = Number.isFinite(expiresInSecondsRaw)
    ? Math.min(Math.max(expiresInSecondsRaw, 30), 3600)
    : 300;
  return expiresInSeconds;
}

async function presignArtefactDownload(params: { bucket: string; key: string }) {
  const expiresInSeconds = resolveArtefactTtlSeconds();

  const filename = safeAttachmentFilename(params.key.split("/").pop() ?? "artefact");

  const url = await getSignedUrl(
    S3,
    new GetObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      ResponseContentDisposition: `attachment; filename="${filename}"`
    }),
    { expiresIn: expiresInSeconds }
  );

  return {
    url,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString()
  };
}

// --------------------
// Artefact download (GLOBAL)
// GET /artefacts/:artefactId/download
// --------------------
app.get("/artefacts/:artefactId/download", async (req, reply) => {
  const { artefactId } = req.params as { artefactId: string };

  const artefact = await prisma.artefact.findUnique({
    where: { id: artefactId }
  });

  if (!artefact) {
    return reply.code(404).send({ error: "Artefact not found" });
  }

  const { url, expiresAt } = await presignArtefactDownload({
    bucket: artefact.bucket,
    key: artefact.key
  });

  reply.header("X-Download-Expires-At", expiresAt); // optional
  return reply.redirect(302, url);
});

// --------------------
// Artefact download (run-scoped) - keep for backwards compatibility
// GET /runs/:runId/artefacts/:artefactId/download
// --------------------
app.get("/runs/:runId/artefacts/:artefactId/download", async (req, reply) => {
  const { runId, artefactId } = req.params as { runId: string; artefactId: string };

  const artefact = await prisma.artefact.findFirst({
    where: { id: artefactId, runId }
  });

  if (!artefact) {
    return reply.code(404).send({ error: "Artefact not found" });
  }

  const { url, expiresAt } = await presignArtefactDownload({
    bucket: artefact.bucket,
    key: artefact.key
  });

  reply.header("X-Download-Expires-At", expiresAt); // optional
  return reply.redirect(302, url);
});

// --------------------
// Tenants - list / lookup for portal UX
// GET /tenants?tenantGuid=...&primaryDomain=...&q=...&take=...
// --------------------
app.get("/tenants", async (req) => {
  const query = (req.query ?? {}) as {
    tenantGuid?: string;
    primaryDomain?: string;
    q?: string;
    take?: string | number;
  };

  const takeRaw =
    typeof query.take === "string"
      ? Number(query.take)
      : typeof query.take === "number"
        ? query.take
        : 50;

  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(takeRaw, 1), 200) : 50;

  const tenantGuid = typeof query.tenantGuid === "string" ? query.tenantGuid.trim() : "";
  const primaryDomain =
    typeof query.primaryDomain === "string" ? query.primaryDomain.trim() : "";
  const q = typeof query.q === "string" ? query.q.trim() : "";

  const where: any = {};

  if (tenantGuid) where.tenantGuid = tenantGuid;
  if (primaryDomain) where.primaryDomain = primaryDomain;

  if (q) {
    where.OR = [
      { primaryDomain: { contains: q, mode: "insensitive" } },
      { displayName: { contains: q, mode: "insensitive" } }
    ];
  }

  const tenants = await prisma.tenant.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      tenantGuid: true,
      primaryDomain: true,
      displayName: true,
      createdAt: true,
      updatedAt: true,
      auth: {
        select: {
          status: true,
          lastError: true,
          consentedAt: true,
          updatedAt: true
        }
      }
    }
  });

  return tenants.map((t) => ({
    id: t.id,
    tenantGuid: t.tenantGuid,
    primaryDomain: t.primaryDomain,
    displayName: t.displayName,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    auth: t.auth
      ? {
          status: t.auth.status,
          consentedAt: t.auth.consentedAt,
          lastError: t.auth.lastError,
          updatedAt: t.auth.updatedAt
        }
      : null
  }));
});

// --------------------
// TenantAuth
// --------------------

function mapTenantAuthResponse(tenant: {
  id: string;
  tenantGuid: string;
  primaryDomain: string;
  displayName: string | null;
  auth: null | {
    tenantId: string;
    mode: unknown;
    status: unknown;
    lastError: string | null;
    consentedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
}) {
  return {
    tenant: {
      id: tenant.id,
      tenantGuid: tenant.tenantGuid,
      primaryDomain: tenant.primaryDomain,
      displayName: tenant.displayName
    },
    auth: tenant.auth ?? null
  };
}

// GET /tenants/:tenantId/auth
app.get("/tenants/:tenantId/auth", async (req, reply) => {
  const { tenantId } = req.params as { tenantId: string };

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId }, // FIX: tenant primary key is id
    select: {
      id: true,
      tenantGuid: true,
      primaryDomain: true,
      displayName: true,
      auth: {
        select: {
          tenantId: true,
          mode: true,
          status: true,
          lastError: true,
          consentedAt: true,
          createdAt: true,
          updatedAt: true
        }
      }
    }
  });

  if (!tenant) return reply.code(404).send({ error: "Tenant not found" });

  return mapTenantAuthResponse(tenant);
});

// POST /tenants/:tenantId/auth/test
app.post("/tenants/:tenantId/auth/test", async (req, reply) => {
  const { tenantId } = req.params as { tenantId: string };

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true }
  });

  if (!tenant) return reply.code(404).send({ error: "Tenant not found" });

  const run = await prisma.run.create({
    data: {
      tenantId,
      status: "queued",
      triggeredBy: "auth-test",
      modulesEnabled: { authTest: true },
      dataProfile: "safe"
    }
  });

  const job = await prisma.job.create({
    data: {
      runId: run.id,
      status: "queued",
      collectorId: "entra.auth.test",
      payload: { tenantId }
    }
  });

  return reply.code(202).send({
    runId: run.id,
    jobId: job.id
  });
});

// GET /tenants/by-guid/:tenantGuid/auth
app.get("/tenants/by-guid/:tenantGuid/auth", async (req, reply) => {
  const { tenantGuid } = req.params as { tenantGuid: string };

  const tenant = await prisma.tenant.findUnique({
    where: { tenantGuid },
    select: {
      id: true,
      tenantGuid: true,
      primaryDomain: true,
      displayName: true,
      auth: {
        select: {
          tenantId: true,
          mode: true,
          status: true,
          lastError: true,
          consentedAt: true,
          createdAt: true,
          updatedAt: true
        }
      }
    }
  });

  if (!tenant) return reply.code(404).send({ error: "Tenant not found" });

  return mapTenantAuthResponse(tenant);
});

// POST /tenants/by-guid/:tenantGuid/auth/test
app.post("/tenants/by-guid/:tenantGuid/auth/test", async (req, reply) => {
  const { tenantGuid } = req.params as { tenantGuid: string };

  const tenant = await prisma.tenant.findUnique({
    where: { tenantGuid },
    select: { id: true }
  });

  if (!tenant) return reply.code(404).send({ error: "Tenant not found" });

  const run = await prisma.run.create({
    data: {
      tenantId: tenant.id,
      status: "queued",
      triggeredBy: "auth-test",
      modulesEnabled: { authTest: true },
      dataProfile: "safe"
    }
  });

  const job = await prisma.job.create({
    data: {
      runId: run.id,
      status: "queued",
      collectorId: "entra.auth.test",
      payload: { tenantId: tenant.id }
    }
  });

  return reply.code(202).send({
    runId: run.id,
    jobId: job.id,
    tenantId: tenant.id
  });
});

// --------------------
// Create Run + Jobs
// --------------------
app.post("/runs", async (request, reply) => {
  const parsed = CreateRunSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.status(400).send({
      error: "Invalid request",
      details: parsed.error.flatten()
    });
  }

  const input = parsed.data;

  const dataProfile = input.dataProfile === "full" ? "full" : "safe";

  // 1) Upsert tenant
  const tenant = await prisma.tenant.upsert({
    where: { tenantGuid: input.tenantGuid },
    update: {
      primaryDomain: input.primaryDomain,
      displayName: input.displayName ?? undefined
    },
    create: {
      tenantGuid: input.tenantGuid,
      primaryDomain: input.primaryDomain,
      displayName: input.displayName
    }
  });

  // 2) Create run
  const run = await prisma.run.create({
    data: {
      tenantId: tenant.id,
      status: "queued",
      triggeredBy: input.triggeredBy,
      modulesEnabled: input.modulesEnabled,
      dataProfile
    }
  });

  // 3) Create queued jobs based on modulesEnabled -> collectorIds
  const jobSpecs = resolveCollectorJobs(input.modulesEnabled);

  const createdJobs = await prisma.$transaction(
    jobSpecs.map((spec) =>
      prisma.job.create({
        data: {
          runId: run.id,
          status: "queued",
          collectorId: spec.collectorId,
          payload: {
            tenantId: tenant.id,
            tenantGuid: tenant.tenantGuid,
            module: spec.module,
            dataProfile
          }
        }
      })
    )
  );

  // Always enqueue report jobs LAST (so they naturally run after module collectors)
  const reportJobs = await prisma.$transaction(
    RUN_REPORT_COLLECTOR_IDS.map((collectorId) =>
      prisma.job.create({
        data: {
          runId: run.id,
          status: "queued",
          collectorId,
          payload: {
            tenantId: tenant.id,
            tenantGuid: tenant.tenantGuid,
            module: "runReport",
            dataProfile
          }
        }
      })
    )
  );

  return reply.status(201).send({
    runId: run.id,
    jobIds: [...createdJobs.map((j) => j.id), ...reportJobs.map((j) => j.id)],
    tenantId: tenant.id,
    dataProfile
  });
});

// --------------------
// Read-only endpoints
// --------------------

// List runs (latest first) + use _count for perf
app.get("/runs", async () => {
  const runs = await prisma.run.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      startedAt: true,
      endedAt: true,
      triggeredBy: true,
      modulesEnabled: true,
      dataProfile: true,
      tenant: {
        select: {
          id: true,
          tenantGuid: true,
          primaryDomain: true,
          displayName: true
        }
      },
      _count: {
        select: {
          jobs: true,
          findings: true,
          artefacts: true
        }
      }
    }
  });

  return runs.map((r) => ({
    id: r.id,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    triggeredBy: r.triggeredBy,
    modulesEnabled: r.modulesEnabled,
    dataProfile: r.dataProfile ?? "safe",
    tenant: r.tenant,
    counts: {
      jobs: r._count.jobs,
      findings: r._count.findings,
      artefacts: r._count.artefacts
    }
  }));
});

// Get a single run (with tenant + counts)
app.get("/runs/:runId", async (req, reply) => {
  const { runId } = req.params as { runId: string };

  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      startedAt: true,
      endedAt: true,
      triggeredBy: true,
      modulesEnabled: true,
      dataProfile: true,
      tenant: {
        select: {
          id: true,
          tenantGuid: true,
          primaryDomain: true,
          displayName: true
        }
      },
      _count: {
        select: {
          jobs: true,
          findings: true,
          artefacts: true
        }
      }
    }
  });

  if (!run) return reply.code(404).send({ error: "Run not found" });

  return {
    id: run.id,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    triggeredBy: run.triggeredBy,
    modulesEnabled: run.modulesEnabled,
    dataProfile: run.dataProfile ?? "safe",
    tenant: run.tenant,
    counts: {
      jobs: run._count.jobs,
      findings: run._count.findings,
      artefacts: run._count.artefacts
    }
  };
});

function isTerminalJobStatus(status: unknown): boolean {
  return status === "succeeded" || status === "failed";
}

// List jobs for a run (real 1:N now)
app.get("/runs/:runId/jobs", async (req, reply) => {
  const { runId } = req.params as { runId: string };

  const runExists = await prisma.run.findUnique({
    where: { id: runId },
    select: { id: true }
  });

  if (!runExists) return reply.code(404).send({ error: "Run not found" });

  const jobs = await prisma.job.findMany({
    where: { runId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      runId: true,
      status: true,
      attempts: true,
      lockedAt: true,
      lockedBy: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
      collectorId: true,
      payload: true,
      _count: {
        select: {
          findings: true,
          artefacts: true
        }
      }
    }
  });

  return jobs.map((j) => ({
    id: j.id,
    runId: j.runId,
    status: j.status,
    attempts: j.attempts,
    lockedAt: j.lockedAt,
    lockedBy: j.lockedBy,
    lastError: j.lastError,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    startedAt: j.lockedAt ?? null,
    endedAt: isTerminalJobStatus(j.status) ? j.updatedAt : null,
    collectorId: j.collectorId,
    payload: j.payload,
    counts: {
      findings: j._count.findings,
      artefacts: j._count.artefacts
    }
  }));
});

// List findings for a run
app.get("/runs/:runId/findings", async (req, reply) => {
  const { runId } = req.params as { runId: string };

  const runExists = await prisma.run.findUnique({
    where: { id: runId },
    select: { id: true }
  });
  if (!runExists) return reply.code(404).send({ error: "Run not found" });

  const findings = await prisma.finding.findMany({
    where: { runId },
    orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      runId: true,
      jobId: true,
      checkId: true,
      severity: true,
      title: true,
      description: true,
      recommendation: true,
      evidence: true,
      references: true,
      createdAt: true
    }
  });

  return findings;
});

// --------------------
// GET /runs/:runId/observed-checks
// --------------------
app.get("/runs/:runId/observed-checks", async (req, reply) => {
  const { runId } = req.params as { runId: string };

  // Keep consistent with other run-scoped endpoints: validate run exists first
  const runExists = await prisma.run.findUnique({
    where: { id: runId },
    select: { id: true }
  });
  if (!runExists) return reply.code(404).send({ error: "Run not found" });

  const observed = await prisma.observedCheck.findMany({
    where: { runId },
    orderBy: { observedAt: "asc" }
  });

  return observed;
});

// List artefacts for a run (includes bucket/key + jobId)
app.get("/runs/:runId/artefacts", async (req, reply) => {
  const { runId } = req.params as { runId: string };

  const runExists = await prisma.run.findUnique({
    where: { id: runId },
    select: { id: true }
  });
  if (!runExists) return reply.code(404).send({ error: "Run not found" });

  const artefacts = await prisma.artefact.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      runId: true,
      jobId: true,
      type: true,
      uri: true,
      bucket: true,
      key: true,
      hash: true,
      sizeBytes: true,
      createdAt: true
    }
  });

  return artefacts;
});

const port = Number(process.env.PORT ?? 8080);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
