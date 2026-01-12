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
// IMPORTANT: The keys here must match CreateRunSchema input.modulesEnabled keys
const MODULE_TO_COLLECTOR_ID: Record<string, string> = {
  entraUsers: "entra.users",
  enterpriseAppPermissions: "entra.enterpriseApps.permissions"
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
 *
 * This returns JobSpecs (collectorId + module key). Payload is added later once we know tenantId/tenantGuid.
 */
function resolveCollectorJobs(modulesEnabled: unknown): JobSpec[] {
  // Default behaviour: at least one job
  const fallback: JobSpec[] = [{ collectorId: "entra.users", module: "entraUsers" }];

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

// --------------------
// DEMO-ONLY: Minimal portal to create runs + watch progress
// GET /demo
// --------------------
function renderDemoHtml() {
  // Kept deliberately framework-free to avoid introducing frontend dependencies.
  // This page is intended for demo/dev only; long-term UI belongs in a dedicated app.
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>M365 Discovery Platform — Demo</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Noto Sans", "Helvetica Neue", sans-serif; margin: 24px; line-height: 1.4; }
    h1 { margin: 0 0 8px 0; font-size: 22px; }
    .muted { color: #555; }
    .row { display: flex; gap: 12px; flex-wrap: wrap; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 14px; margin: 14px 0; }
    label { display: block; font-size: 12px; color: #333; margin-bottom: 4px; }
    input[type="text"] { width: min(520px, 100%); padding: 8px 10px; border: 1px solid #ccc; border-radius: 8px; }
    .btn { padding: 9px 12px; border: 1px solid #222; border-radius: 10px; background: #111; color: white; cursor: pointer; }
    .btn.secondary { background: white; color: #111; }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #eee; padding: 8px; text-align: left; vertical-align: top; }
    th { font-size: 12px; color: #555; }
    code { background: #f6f6f6; padding: 2px 5px; border-radius: 6px; }
    .pill { display:inline-block; padding: 2px 8px; border-radius: 999px; border:1px solid #ddd; font-size: 12px; }
    .status-queued { background:#fff7ed; }
    .status-running { background:#eff6ff; }
    .status-succeeded { background:#ecfdf5; }
    .status-failed { background:#fef2f2; }
    .err { color: #b42318; white-space: pre-wrap; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    .list { border: 1px solid #eee; border-radius: 10px; overflow: hidden; }
    .listItem { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; cursor: pointer; }
    .listItem:last-child { border-bottom: 0; }
    .listItem:hover { background: #fafafa; }
    .tag { display:inline-block; font-size: 11px; border: 1px solid #ddd; border-radius: 999px; padding: 2px 8px; margin-right: 6px; color: #333; background: #fff; }
  </style>
</head>
<body>
  <h1>M365 Discovery Platform — Demo</h1>
  <div class="muted">
    Demo-only run launcher and progress viewer. Long-term UI will live in a dedicated portal app.
  </div>

  <div class="card">
    <h2 style="margin:0 0 10px 0; font-size:16px;">Create Run</h2>

    <div class="card" style="margin:0 0 12px 0;">
      <div style="font-weight:600; margin-bottom:8px;">Quick fill (from existing tenants)</div>
      <div class="row">
        <div style="flex:1; min-width: 280px;">
          <label for="tenantSearch">Search tenants (domain or display name)</label>
          <input id="tenantSearch" type="text" placeholder="e.g. contoso or onmicrosoft" />
        </div>
        <div style="display:flex; align-items:end; gap:8px;">
          <button id="btnTenantSearch" class="btn secondary">Search</button>
          <button id="btnTenantClear" class="btn secondary">Clear</button>
        </div>
      </div>
      <div id="tenantSearchError" class="err" style="margin-top:10px;"></div>
      <div id="tenantResultsWrap" style="margin-top:10px; display:none;">
        <div class="muted" style="margin-bottom:6px;">Click a tenant to populate the form.</div>
        <div id="tenantResults" class="list"></div>
      </div>
    </div>

    <div class="row">
      <div style="flex:1; min-width: 280px;">
        <label for="tenantGuid">Tenant GUID (Directory ID)</label>
        <input id="tenantGuid" type="text" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
      </div>
      <div style="flex:1; min-width: 280px;">
        <label for="primaryDomain">Primary Domain</label>
        <input id="primaryDomain" type="text" placeholder="contoso.onmicrosoft.com" />
      </div>
    </div>

    <div class="row" style="margin-top:10px;">
      <div style="flex:1; min-width: 280px;">
        <label for="displayName">Display name (optional)</label>
        <input id="displayName" type="text" placeholder="Contoso (Demo)" />
      </div>
      <div style="flex:1; min-width: 280px;">
        <label for="triggeredBy">Triggered by</label>
        <input id="triggeredBy" type="text" value="portal-demo" />
      </div>
    </div>

    <div class="card" style="margin:12px 0 0 0;">
      <div style="font-weight:600; margin-bottom:8px;">Modules enabled</div>
      <label><input id="modEntraUsers" type="checkbox" checked /> entraUsers</label>
      <label><input id="modEapPerms" type="checkbox" checked /> enterpriseAppPermissions</label>
      <div class="muted" style="margin-top:8px;">
        Report collectors are always enqueued at the end of a run.
      </div>
    </div>

    <div style="margin-top:12px;">
      <button id="btnCreate" class="btn">Create run</button>
      <button id="btnClear" class="btn secondary" style="margin-left:8px;">Clear</button>
    </div>

    <div id="createError" class="err" style="margin-top:10px;"></div>
  </div>

  <div class="card" id="runCard" style="display:none;">
    <h2 style="margin:0 0 10px 0; font-size:16px;">Run</h2>
    <div>Run ID: <span class="mono" id="runId"></span></div>
    <div class="muted" style="margin-top:6px;">
      Polling <code>/runs/:runId</code>, <code>/runs/:runId/jobs</code>, and <code>/runs/:runId/artefacts</code>
    </div>

    <div style="margin-top:12px;">
      <div>Run status: <span id="runStatus" class="pill"></span></div>
      <div class="muted">Started: <span id="runStarted"></span> • Ended: <span id="runEnded"></span></div>
    </div>

    <h3 style="margin:16px 0 8px 0; font-size:14px;">Jobs</h3>
    <table>
      <thead>
        <tr>
          <th>collectorId</th>
          <th>status</th>
          <th>attempts</th>
          <th>lockedBy</th>
          <th>lastError</th>
        </tr>
      </thead>
      <tbody id="jobsBody"></tbody>
    </table>

    <h3 style="margin:16px 0 8px 0; font-size:14px;">Artefacts</h3>
    <table>
      <thead>
        <tr>
          <th>type</th>
          <th>key</th>
          <th>size</th>
          <th>download</th>
        </tr>
      </thead>
      <tbody id="artefactsBody"></tbody>
    </table>
  </div>

<script>
(() => {
  const $ = (id) => document.getElementById(id);

  const state = {
    runId: null,
    pollTimer: null,
    tenantSearchTimer: null
  };

  function setPill(el, status) {
    el.textContent = status || "";
    el.className = "pill";
    if (status) el.classList.add("status-" + status);
  }

  function clearRun() {
    $("createError").textContent = "";
    $("runCard").style.display = "none";
    $("runId").textContent = "";
    $("jobsBody").innerHTML = "";
    $("artefactsBody").innerHTML = "";
    if (state.pollTimer) window.clearInterval(state.pollTimer);
    state.pollTimer = null;
    state.runId = null;
  }

  function clearTenantResults() {
    $("tenantSearchError").textContent = "";
    $("tenantResults").innerHTML = "";
    $("tenantResultsWrap").style.display = "none";
  }

  function clearAll() {
    clearTenantResults();
    clearRun();
    $("tenantGuid").value = "";
    $("primaryDomain").value = "";
    $("displayName").value = "";
    // keep triggeredBy
  }

  async function api(path, opts) {
    const res = await fetch(path, opts);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
      const msg = (json && (json.error || json.message)) ? (json.error || json.message) : text;
      throw new Error(msg || ("HTTP " + res.status));
    }
    return json;
  }

  function renderJobs(jobs) {
    const body = $("jobsBody");
    body.innerHTML = "";
    for (const j of jobs || []) {
      const tr = document.createElement("tr");
      tr.innerHTML = \`
        <td class="mono">\${j.collectorId}</td>
        <td><span class="pill status-\${j.status}">\${j.status}</span></td>
        <td>\${j.attempts ?? 0}</td>
        <td class="mono">\${j.lockedBy ?? ""}</td>
        <td class="err">\${j.lastError ? String(j.lastError) : ""}</td>
      \`;
      body.appendChild(tr);
    }
  }

  async function presignAndDownload(artefactId) {
    const signed = await api(\`/artefacts/\${artefactId}/download\`);
    if (!signed || !signed.url) throw new Error("No presigned URL returned");
    window.open(signed.url, "_blank", "noopener,noreferrer");
  }

  function renderArtefacts(artefacts) {
    const body = $("artefactsBody");
    body.innerHTML = "";
    for (const a of artefacts || []) {
      const tr = document.createElement("tr");
      const size = (a.sizeBytes != null) ? a.sizeBytes : "";
      tr.innerHTML = \`
        <td class="mono">\${a.type}</td>
        <td class="mono">\${a.key}</td>
        <td>\${size}</td>
        <td><button class="btn secondary" data-artefact="\${a.id}">Download</button></td>
      \`;
      tr.querySelector("button").addEventListener("click", async (e) => {
        const id = e.currentTarget.getAttribute("data-artefact");
        e.currentTarget.disabled = true;
        try {
          await presignAndDownload(id);
        } catch (err) {
          alert(String(err && err.message ? err.message : err));
        } finally {
          e.currentTarget.disabled = false;
        }
      });
      body.appendChild(tr);
    }
  }

  function renderTenantResults(tenants) {
    const wrap = $("tenantResultsWrap");
    const list = $("tenantResults");
    list.innerHTML = "";

    if (!tenants || tenants.length === 0) {
      wrap.style.display = "none";
      return;
    }

    for (const t of tenants) {
      const item = document.createElement("div");
      item.className = "listItem";
      const auth = t.auth ? String(t.auth.status ?? "") : "unknown";
      item.innerHTML = \`
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <span class="tag">\${auth}</span>
          <span style="font-weight:600;">\${t.primaryDomain}</span>
          <span class="muted">\${t.displayName ? "• " + t.displayName : ""}</span>
        </div>
        <div class="mono muted" style="margin-top:4px;">\${t.tenantGuid}</div>
      \`;

      item.addEventListener("click", () => {
        $("tenantGuid").value = t.tenantGuid || "";
        $("primaryDomain").value = t.primaryDomain || "";
        $("displayName").value = t.displayName || "";
        clearTenantResults();
      });

      list.appendChild(item);
    }

    wrap.style.display = "block";
  }

  async function searchTenants() {
    clearTenantResults();
    const q = $("tenantSearch").value.trim();
    if (!q) return;

    try {
      $("btnTenantSearch").disabled = true;
      const tenants = await api(\`/tenants?q=\${encodeURIComponent(q)}&take=20\`);
      renderTenantResults(tenants);
    } catch (err) {
      $("tenantSearchError").textContent = String(err && err.message ? err.message : err);
    } finally {
      $("btnTenantSearch").disabled = false;
    }
  }

  async function poll() {
    if (!state.runId) return;

    const run = await api(\`/runs/\${state.runId}\`);
    setPill($("runStatus"), run.status);
    $("runStarted").textContent = run.startedAt || "";
    $("runEnded").textContent = run.endedAt || "";

    const jobs = await api(\`/runs/\${state.runId}/jobs\`);
    renderJobs(jobs);

    const artefacts = await api(\`/runs/\${state.runId}/artefacts\`);
    renderArtefacts(artefacts);

    // Stop polling once terminal
    if (run.status === "succeeded" || run.status === "failed") {
      if (state.pollTimer) window.clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  $("btnClear").addEventListener("click", clearAll);

  $("btnTenantClear").addEventListener("click", () => {
    $("tenantSearch").value = "";
    clearTenantResults();
  });

  $("btnTenantSearch").addEventListener("click", () => {
    searchTenants().catch((err) => console.error(err));
  });

  $("tenantSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      searchTenants().catch((err) => console.error(err));
    }
  });

  // light debounce as you type
  $("tenantSearch").addEventListener("input", () => {
    if (state.tenantSearchTimer) window.clearTimeout(state.tenantSearchTimer);
    state.tenantSearchTimer = window.setTimeout(() => {
      searchTenants().catch(() => {});
    }, 250);
  });

  $("btnCreate").addEventListener("click", async () => {
    $("createError").textContent = "";

    const tenantGuid = $("tenantGuid").value.trim();
    const primaryDomain = $("primaryDomain").value.trim();
    const displayName = $("displayName").value.trim();
    const triggeredBy = $("triggeredBy").value.trim() || "portal-demo";

    const modulesEnabled = {
      entraUsers: $("modEntraUsers").checked,
      enterpriseAppPermissions: $("modEapPerms").checked
    };

    const payload = {
      tenantGuid,
      primaryDomain,
      displayName: displayName || undefined,
      triggeredBy,
      modulesEnabled
    };

    try {
      $("btnCreate").disabled = true;
      const created = await api("/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });

      state.runId = created.runId;
      $("runId").textContent = state.runId;
      $("runCard").style.display = "block";

      // Start polling immediately
      await poll();
      if (state.pollTimer) window.clearInterval(state.pollTimer);
      state.pollTimer = window.setInterval(() => {
        poll().catch((err) => console.error(err));
      }, 1000);
    } catch (err) {
      $("createError").textContent = String(err && err.message ? err.message : err);
    } finally {
      $("btnCreate").disabled = false;
    }
  });
})();
</script>
</body>
</html>`;
}

app.get("/demo", async (_req, reply) => {
  reply.type("text/html; charset=utf-8").send(renderDemoHtml());
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

  return presignArtefactDownload({ bucket: artefact.bucket, key: artefact.key });
});

// --------------------
// Artefact download (run-scoped) — keep for backwards compatibility
// GET /runs/:runId/artefacts/:artefactId/download
// --------------------
app.get("/runs/:runId/artefacts/:artefactId/download", async (req, reply) => {
  const { runId, artefactId } = req.params as {
    runId: string;
    artefactId: string;
  };

  const artefact = await prisma.artefact.findFirst({
    where: { id: artefactId, runId }
  });

  if (!artefact) {
    return reply.code(404).send({ error: "Artefact not found" });
  }

  return presignArtefactDownload({ bucket: artefact.bucket, key: artefact.key });
});

// --------------------
// Tenants — list / lookup for portal UX
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
    where: { id: tenantId },
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
      modulesEnabled: { authTest: true }
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
      modulesEnabled: { authTest: true }
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
      modulesEnabled: input.modulesEnabled
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
            module: spec.module
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
            module: "runReport"
          }
        }
      })
    )
  );

  return reply.status(201).send({
    runId: run.id,
    jobIds: [...createdJobs.map((j) => j.id), ...reportJobs.map((j) => j.id)],
    tenantId: tenant.id
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
