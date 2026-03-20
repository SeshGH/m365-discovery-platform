// apps/portal/src/lib/run-metrics.ts

export type ObservedCheckItem = {
  id: string;
  runId: string;
  jobId: string | null;
  checkId: string;
  collectorId: string;
  observedAt: string;
  data: unknown;
  ruleId: string | null;
  references: unknown;
};

export type MetricTone = "ok" | "warn" | "bad" | "muted";

export type EnvMetric = {
  key: string;
  label: string;
  value: string;
  tone: MetricTone;
  hint?: string;
  sources?: string[];

  /**
   * Optional UX affordances:
   * If present, UI can offer a "View evidence" CTA that pre-filters Evidence.
   * Must remain collector-agnostic and purely string-based (no code refs in UI).
   */
  evidenceQuery?: string;
  evidenceHint?: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (!isRecord(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function readBool(obj: unknown, key: string): boolean | null {
  if (!isRecord(obj)) return null;
  const v = obj[key];
  return typeof v === "boolean" ? v : null;
}

function readNumber(obj: unknown, key: string): number | null {
  if (!isRecord(obj)) return null;
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function readStringArray(obj: unknown, key: string): string[] {
  if (!isRecord(obj)) return [];
  const v = obj[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function readNumberAtPath(obj: unknown, paths: string[]): number | undefined {
  for (const p of paths) {
    const v = getPath(obj, p);
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function uniq(xs: string[]) {
  return Array.from(new Set(xs)).filter(Boolean);
}

function formatInt(n: number) {
  return n.toLocaleString();
}

function formatGb(n: number) {
  const rounded = Math.round(n * 100) / 100;
  return rounded.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** -----------------------------
 *  Completeness signals (shared)
 *  ----------------------------*/

export function ocPermissionDeniedList(data: unknown): string[] {
  const direct = readStringArray(data, "permissionDenied");
  const nested = readStringArray(getPath(data, "completeness"), "permissionDenied");
  return uniq([...direct, ...nested]);
}

export function ocIsTruncated(data: unknown): boolean {
  return (
    readBool(data, "truncated") === true || readBool(getPath(data, "completeness"), "truncated") === true
  );
}

export function ocIsIncomplete(data: unknown): boolean {
  return (
    readBool(data, "isComplete") === false || readBool(getPath(data, "completeness"), "isComplete") === false
  );
}

/** -----------------------------
 *  Metric registry
 *  ----------------------------*/

type MetricDefinition = {
  key: string;
  label: string;

  // Optional: makes metric self-describing in UI ("View evidence" CTA)
  evidenceQuery?: string;
  evidenceHint?: string;

  derive: (
    observed: ObservedCheckItem[]
  ) =>
    | {
        value?: string;
        tone?: MetricTone;
        hint?: string;
        sources?: string[];
      }
    | null;
};

function sourcesFor(observed: ObservedCheckItem[], predicate: (o: ObservedCheckItem) => boolean): string[] {
  return uniq(
    observed
      .filter(predicate)
      .flatMap((o) => [o.checkId, o.collectorId].filter(Boolean) as string[])
  );
}

function findCount(
  observed: ObservedCheckItem[],
  match: (o: ObservedCheckItem) => boolean,
  paths: string[]
): number | undefined {
  for (const oc of observed) {
    if (!match(oc)) continue;
    const n = readNumberAtPath(oc.data, paths);
    if (n !== undefined) return n;
  }
  return undefined;
}

const pathsUsers = ["counts.users", "count.users", "summary.users", "summary.counts.users", "stats.users", "totalUsers", "total", "value"];
const pathsGroups = ["counts.groups", "summary.groups", "summary.counts.groups", "stats.groups", "totalGroups", "value"];
const pathsApps = [
  "counts.enterpriseApps",
  "counts.apps",
  "summary.enterpriseApps",
  "summary.apps",
  "summary.counts.apps",
  "stats.apps",
  "totalApps",
  "value"
];
const pathsCA = [
  "counts.conditionalAccessPolicies",
  "counts.caPolicies",
  "summary.conditionalAccessPolicies",
  "summary.caPolicies",
  "summary.counts.conditionalAccessPolicies",
  "stats.conditionalAccessPolicies",
  "totalPolicies",
  "value"
];
const pathsMailboxes = ["counts.mailboxes", "summary.mailboxes", "summary.counts.mailboxes", "stats.mailboxes", "totalMailboxes", "value"];

// SharePoint (SPO) — storage report emits nested fields under data.storage.*
const pathsSPO_SitesInReport = ["storage.sitesInReport"];
const pathsSPO_StorageUsedGbTotal = ["storage.storageUsedGbTotal"];

const mUsers = (o: ObservedCheckItem) =>
  String(o.checkId).includes("entra") &&
  (String(o.checkId).includes("users") || String(o.collectorId).includes("entra.users"));

const mGroups = (o: ObservedCheckItem) =>
  String(o.checkId).includes("entra") &&
  (String(o.checkId).includes("groups") || String(o.collectorId).includes("entra.groups"));

const mApps = (o: ObservedCheckItem) =>
  String(o.checkId).includes("enterprise") ||
  String(o.collectorId).includes("enterpriseApps") ||
  String(o.collectorId).includes("entra.enterpriseApps");

const mCA = (o: ObservedCheckItem) =>
  String(o.checkId).includes("conditional") ||
  String(o.collectorId).includes("conditionalAccess") ||
  String(o.collectorId).includes("entra.conditionalAccess");

const mMail = (o: ObservedCheckItem) =>
  String(o.checkId).includes("mailbox") ||
  String(o.collectorId).includes("exchange") ||
  String(o.collectorId).includes("exchange.mailboxes");

/**
 * NOTE: We keep EXO / SPO special-casing *inside the registry*, not in UI shells.
 * This makes it explicit + isolated, and prevents scattered "if checkId === ..." logic.
 */
const EXO_OBS_CHECK_ID = "EXO_MAILBOXES_OBS_001";
const SPO_STORAGE_OBS_CHECK_ID = "SPO_SITES_OBS_010";

function toneFromSignals(data: unknown): MetricTone {
  const denied = ocPermissionDeniedList(data);
  if (denied.length > 0) return "warn";
  if (ocIsTruncated(data)) return "warn";
  if (ocIsIncomplete(data)) return "warn";
  return "ok";
}

function hintFromSignals(params: { base: string; data: unknown }): string {
  const denied = ocPermissionDeniedList(params.data);
  if (denied.length > 0) return `Permission missing: ${denied.join(", ")}`;
  if (ocIsTruncated(params.data)) return `${params.base} (truncated — treat as indicative).`;
  if (ocIsIncomplete(params.data)) return `${params.base} (incomplete — treat as indicative).`;
  return params.base;
}

const metricRegistry: MetricDefinition[] = [
  {
    key: "collectors",
    label: "Collectors seen",
    evidenceQuery: "collector",
    evidenceHint: "Shows observed checks grouped by collectorId.",
    derive: (observed) => {
      const collectorsSeen = uniq(observed.map((o) => String(o.collectorId || "")).filter(Boolean));
      return {
        value: collectorsSeen.length ? String(collectorsSeen.length) : "—",
        tone: collectorsSeen.length ? "ok" : "muted",
        hint: collectorsSeen.length ? collectorsSeen.join(", ") : "No observed checks yet",
        sources: []
      };
    }
  },
  {
    key: "checks",
    label: "Observed checks",
    evidenceQuery: "", // empty means "show all" (still useful for CTA)
    evidenceHint: "Shows the observed-check timeline for this run.",
    derive: (observed) => {
      const checksSeen = uniq(observed.map((o) => String(o.checkId || "")).filter(Boolean));
      return {
        value: checksSeen.length ? String(checksSeen.length) : "—",
        tone: checksSeen.length ? "ok" : "muted",
        sources: []
      };
    }
  },
  {
    key: "users",
    label: "Users",
    evidenceQuery: "entra users",
    evidenceHint: "Filter Evidence for Entra user inventory checks.",
    derive: (observed) => {
      const users = findCount(observed, mUsers, pathsUsers);
      return {
        value: users === undefined ? "—" : formatInt(users),
        tone: users === undefined ? "muted" : "ok",
        hint: users === undefined ? "Not derived from observed data yet" : undefined,
        sources: sourcesFor(observed, mUsers)
      };
    }
  },
  {
    key: "groups",
    label: "Groups",
    evidenceQuery: "entra groups",
    evidenceHint: "Filter Evidence for Entra group inventory checks.",
    derive: (observed) => {
      const groups = findCount(observed, mGroups, pathsGroups);
      return {
        value: groups === undefined ? "—" : formatInt(groups),
        tone: groups === undefined ? "muted" : "ok",
        hint: groups === undefined ? "Not derived from observed data yet" : undefined,
        sources: sourcesFor(observed, mGroups)
      };
    }
  },
  {
    key: "apps",
    label: "Enterprise apps",
    evidenceQuery: "enterprise apps",
    evidenceHint: "Filter Evidence for enterprise app inventory checks.",
    derive: (observed) => {
      const apps = findCount(observed, mApps, pathsApps);
      return {
        value: apps === undefined ? "—" : formatInt(apps),
        tone: apps === undefined ? "muted" : "ok",
        hint: apps === undefined ? "Not derived from observed data yet" : undefined,
        sources: sourcesFor(observed, mApps)
      };
    }
  },
  {
    key: "ca",
    label: "CA policies",
    evidenceQuery: "conditional access",
    evidenceHint: "Filter Evidence for Conditional Access policy inventory checks.",
    derive: (observed) => {
      const ca = findCount(observed, mCA, pathsCA);
      return {
        value: ca === undefined ? "—" : formatInt(ca),
        tone: ca === undefined ? "muted" : "ok",
        hint: ca === undefined ? "Not derived from observed data yet" : undefined,
        sources: sourcesFor(observed, mCA)
      };
    }
  },

  // -------------------------
  // SharePoint Online (SPO) metrics (Graph reports)
  // -------------------------
  {
    key: "spo_sites_in_report",
    label: "SharePoint sites",
    evidenceQuery: SPO_STORAGE_OBS_CHECK_ID,
    evidenceHint: "Filter Evidence to the SharePoint storage usage observed check.",
    derive: (observed) => {
      const spo = observed.find((x) => x.checkId === SPO_STORAGE_OBS_CHECK_ID);
      if (!spo) return null;

      const sites = readNumberAtPath(spo.data, pathsSPO_SitesInReport);
      const tone = toneFromSignals(spo.data);
      const sources = uniq([spo.checkId, spo.collectorId].filter(Boolean) as string[]);

      if (sites === undefined) {
        return { value: "—", tone: "muted", hint: "Not derived from observed data yet", sources };
      }

      return {
        value: formatInt(sites),
        tone,
        hint: hintFromSignals({
          base: "Sites included in the SharePoint usage report.",
          data: spo.data
        }),
        sources
      };
    }
  },
  {
    key: "spo_storage_used_gb",
    label: "SPO storage used",
    evidenceQuery: SPO_STORAGE_OBS_CHECK_ID,
    evidenceHint: "Filter Evidence to the SharePoint storage usage observed check.",
    derive: (observed) => {
      const spo = observed.find((x) => x.checkId === SPO_STORAGE_OBS_CHECK_ID);
      if (!spo) return null;

      const gbRaw = readNumberAtPath(spo.data, pathsSPO_StorageUsedGbTotal);
      const tone = toneFromSignals(spo.data);
      const sources = uniq([spo.checkId, spo.collectorId].filter(Boolean) as string[]);

      if (gbRaw === undefined) {
        return { value: "—", tone: "muted", hint: "Not derived from observed data yet", sources };
      }

      return {
        value: `${formatGb(gbRaw)} GB`,
        tone,
        hint: hintFromSignals({
          base: "Total storage used derived from SharePoint usage reports.",
          data: spo.data
        }),
        sources
      };
    }
  },

  // -------------------------
  // SharePoint Online – admin settings (SPO_ADMIN_OBS_001)
  // -------------------------
  {
    key: "spo_sharing_capability",
    label: "SPO sharing",
    evidenceQuery: "SPO_ADMIN_OBS_001",
    evidenceHint: "Filter Evidence to the SharePoint admin settings observed check.",
    derive: (observed) => {
      const obs = observed.find((x) => x.checkId === "SPO_ADMIN_OBS_001");
      if (!obs) return null;

      const d = obs.data;
      const permDenied = ocPermissionDeniedList(d);
      const isComplete = readBool(d, "isComplete");
      const capability =
        typeof (d as any)?.sharingCapability === "string"
          ? ((d as any).sharingCapability as string)
          : null;

      const sources = uniq([obs.checkId, obs.collectorId].filter(Boolean) as string[]);

      if (!isComplete || permDenied.length > 0) {
        return {
          value: "—",
          tone: "muted",
          hint:
            permDenied.length > 0
              ? "Permission missing: SharePointTenantSettings.Read.All not granted."
              : "SharePoint admin settings not collected.",
          sources
        };
      }

      if (!capability) {
        return { value: "—", tone: "muted", hint: "Sharing capability not returned by Graph.", sources };
      }

      const tone: MetricTone =
        capability === "externalUserAndGuestSharing"
          ? "warn"
          : "ok";

      const hint =
        capability === "externalUserAndGuestSharing"
          ? "Anonymous (Anyone) links are enabled at the tenant level."
          : capability === "externalUserSharingOnly"
            ? "External user invitations are enabled; anonymous links are disabled."
            : capability === "disabled"
              ? "External sharing is disabled."
              : capability === "existingExternalUserSharingOnly"
                ? "Sharing is restricted to existing external users only."
                : capability;

      const capabilityLabels: Record<string, string> = {
        externalUserAndGuestSharing: "Anyone links allowed",
        externalUserSharingOnly: "External users only",
        existingExternalUserSharingOnly: "Existing guests only",
        disabled: "Disabled"
      };
      const label = capabilityLabels[capability] ?? capability;

      return { value: label, tone, hint, sources };
    }
  },

  // -------------------------
  // Intune / MDM metrics (MDM_DEVICES_OBS_001)
  // -------------------------
  {
    key: "mdm_devices_total",
    label: "MDM devices",
    evidenceQuery: "MDM_DEVICES_OBS_001",
    evidenceHint: "Filter Evidence to the Intune managed device observed check.",
    derive: (observed) => {
      const obs = observed.find((x) => x.checkId === "MDM_DEVICES_OBS_001");
      if (!obs) return null;

      const d = obs.data;
      const permDenied = ocPermissionDeniedList(d);
      const isComplete = readBool(d, "isComplete");
      const truncated = readBool(d, "truncated");
      const sources = uniq([obs.checkId, obs.collectorId].filter(Boolean) as string[]);

      if (permDenied.length > 0 || isComplete === false) {
        return {
          value: "—",
          tone: "muted" as MetricTone,
          hint:
            permDenied.length > 0
              ? "Permission missing: DeviceManagementManagedDevices.Read.All not granted."
              : "Intune device data not collected.",
          sources
        };
      }

      const total = readNumber(getPath(d, "counts") as any, "total");

      if (total === null) {
        return { value: "—", tone: "muted", hint: "Device count not available.", sources };
      }

      return {
        value: truncated ? `${total.toLocaleString()} (capped)` : total.toLocaleString(),
        tone: "ok" as MetricTone,
        hint: truncated
          ? `${total.toLocaleString()} devices enumerated (collection capped — actual total may be higher).`
          : `${total.toLocaleString()} device${total === 1 ? "" : "s"} enrolled in Intune MDM.`,
        sources
      };
    }
  },
  {
    key: "mdm_noncompliant_devices",
    label: "Non-compliant",
    evidenceQuery: "MDM_DEVICES_OBS_001",
    evidenceHint: "Filter Evidence to the Intune managed device observed check.",
    derive: (observed) => {
      const obs = observed.find((x) => x.checkId === "MDM_DEVICES_OBS_001");
      if (!obs) return null;

      const d = obs.data;
      const permDenied = ocPermissionDeniedList(d);
      const isComplete = readBool(d, "isComplete");
      const sources = uniq([obs.checkId, obs.collectorId].filter(Boolean) as string[]);

      if (permDenied.length > 0 || isComplete === false) {
        return {
          value: "—",
          tone: "muted" as MetricTone,
          hint:
            permDenied.length > 0
              ? "Permission missing: DeviceManagementManagedDevices.Read.All not granted."
              : "Intune device data not collected.",
          sources
        };
      }

      const noncompliant = readNumber(getPath(d, "counts") as any, "noncompliant");

      if (noncompliant === null) {
        return { value: "—", tone: "muted", hint: "Non-compliant count not available.", sources };
      }

      return {
        value: noncompliant.toLocaleString(),
        tone: noncompliant > 0 ? "warn" : "ok",
        hint:
          noncompliant > 0
            ? `${noncompliant} device${noncompliant === 1 ? "" : "s"} in non-compliant state. Review compliance policies and device status in Intune.`
            : "No devices in non-compliant state.",
        sources
      };
    }
  },

  // -------------------------
  // EXO mailbox metrics (Graph reports)
  // -------------------------
  {
    key: "exo_mailboxes_total",
    label: "EXO mailboxes",
    evidenceQuery: EXO_OBS_CHECK_ID,
    evidenceHint: "Filter Evidence to the EXO mailbox usage observed check.",
    derive: (observed) => {
      const exo = observed.find((x) => x.checkId === EXO_OBS_CHECK_ID);
      if (!exo) return null;

      const d = exo.data;
      const totalMailboxes = readNumber(d, "totalMailboxes");

      const permissionDenied = ocPermissionDeniedList(d);
      const isComplete = readBool(d, "isComplete");

      const notesRaw = getPath(d, "notes");
      const notes = Array.isArray(notesRaw)
        ? notesRaw.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        : [];

      const tone: MetricTone =
        permissionDenied.length > 0 ? "warn" : isComplete === false ? "warn" : "ok";

      const hint =
        permissionDenied.length > 0
          ? `Permission missing: ${permissionDenied.join(", ")}`
          : isComplete === false
            ? notes[0] ?? "Exchange reporting is not available yet (Graph reports)."
            : "Derived from Microsoft Graph mailbox usage reports.";

      const sources = uniq([exo.checkId, exo.collectorId].filter(Boolean) as string[]);

      return {
        value: totalMailboxes === null ? "—" : totalMailboxes.toLocaleString(),
        tone,
        hint,
        sources
      };
    }
  },
  {
    key: "exo_mailboxes_near50",
    label: "EXO near 50GB",
    evidenceQuery: EXO_OBS_CHECK_ID,
    evidenceHint: "Filter Evidence to the EXO mailbox usage observed check.",
    derive: (observed) => {
      const exo = observed.find((x) => x.checkId === EXO_OBS_CHECK_ID);
      if (!exo) return null;

      const d = exo.data;
      const sizeBuckets = getPath(d, "sizeBuckets");

      const near50 =
        typeof getPath(sizeBuckets, "40to50GB") === "number" &&
        Number.isFinite(getPath(sizeBuckets, "40to50GB") as number)
          ? (getPath(sizeBuckets, "40to50GB") as number)
          : null;

      const permissionDenied = ocPermissionDeniedList(d);
      const isComplete = readBool(d, "isComplete");
      const baseTone: MetricTone =
        permissionDenied.length > 0 ? "warn" : isComplete === false ? "warn" : "ok";

      const sources = uniq([exo.checkId, exo.collectorId].filter(Boolean) as string[]);

      return {
        value: near50 === null ? "—" : near50.toLocaleString(),
        tone: near50 !== null && near50 > 0 ? "warn" : baseTone,
        hint: "Mailboxes in the 40–50GB range (licensing threshold watchlist).",
        sources
      };
    }
  },
  {
    key: "exo_mailboxes_over50",
    label: "EXO over 50GB",
    evidenceQuery: EXO_OBS_CHECK_ID,
    evidenceHint: "Filter Evidence to the EXO mailbox usage observed check.",
    derive: (observed) => {
      const exo = observed.find((x) => x.checkId === EXO_OBS_CHECK_ID);
      if (!exo) return null;

      const d = exo.data;
      const sizeBuckets = getPath(d, "sizeBuckets");

      const over50 =
        typeof getPath(sizeBuckets, "over50GB") === "number" &&
        Number.isFinite(getPath(sizeBuckets, "over50GB") as number)
          ? (getPath(sizeBuckets, "over50GB") as number)
          : null;

      const permissionDenied = ocPermissionDeniedList(d);
      const isComplete = readBool(d, "isComplete");
      const baseTone: MetricTone =
        permissionDenied.length > 0 ? "warn" : isComplete === false ? "warn" : "ok";

      const sources = uniq([exo.checkId, exo.collectorId].filter(Boolean) as string[]);

      return {
        value: over50 === null ? "—" : over50.toLocaleString(),
        tone: over50 !== null && over50 > 0 ? "warn" : baseTone,
        hint: "Mailboxes above 50GB (often require EXO Plan 2 / E3/E5+).",
        sources
      };
    }
  },

  // Fallback mailbox count (non-EXO-specific heuristic) — still registry-contained.
  {
    key: "mailboxes",
    label: "Mailboxes",
    evidenceQuery: "mailbox exchange",
    evidenceHint: "Filter Evidence for mailbox-related checks (heuristic).",
    derive: (observed) => {
      const exo = observed.find((x) => x.checkId === EXO_OBS_CHECK_ID);
      if (exo) return null; // if EXO metrics exist, we don't show the heuristic card

      const mailboxes = findCount(observed, mMail, pathsMailboxes);

      return {
        value: mailboxes === undefined ? "—" : mailboxes.toLocaleString(),
        tone: mailboxes === undefined ? "muted" : "ok",
        hint: mailboxes === undefined ? "Not derived from observed data yet" : "Heuristic (non-EXO-specific) count",
        sources: sourcesFor(observed, mMail)
      };
    }
  },

  // A run-level signals summary card (kept in environmentOverview, registry-driven)
  {
    key: "signals",
    label: "Completeness signals",
    evidenceQuery: "permissionDenied truncated incomplete",
    evidenceHint: "Filter Evidence for common completeness signals.",
    derive: (observed) => {
      const anyPermissionDenied = observed.some((o) => ocPermissionDeniedList(o.data).length > 0);
      const anyTruncated = observed.some((o) => ocIsTruncated(o.data));
      const anyIncomplete = observed.some((o) => ocIsIncomplete(o.data));

      const attention = anyPermissionDenied || anyTruncated || anyIncomplete;

      const hint = anyPermissionDenied
        ? "Some checks reported permissionDenied"
        : anyTruncated
          ? "Some checks reported truncated"
          : anyIncomplete
            ? "Some checks reported incomplete"
            : "No permissionDenied/truncated/incomplete detected";

      return {
        value: attention ? "attention" : "ok",
        tone: attention ? "warn" : "ok",
        hint,
        sources: []
      };
    }
  }
];

export function buildEnvironmentOverview(observed: ObservedCheckItem[]): EnvMetric[] {
  const out: EnvMetric[] = [];
  for (const def of metricRegistry) {
    const r = def.derive(observed);
    if (!r) continue;

    out.push({
      key: def.key,
      label: def.label,
      value: r.value ?? "—",
      tone: r.tone ?? "muted",
      hint: r.hint,
      sources: r.sources,
      evidenceQuery: def.evidenceQuery,
      evidenceHint: def.evidenceHint
    });
  }
  return out;
}
