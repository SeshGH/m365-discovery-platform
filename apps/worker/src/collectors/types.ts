import type { PrismaClient, Job, Run, Tenant } from "@acme/db";

export type CollectorContext = {
  prisma: PrismaClient;
  job: Job;
  run: Run;
  tenant: Tenant;
};

export type CollectorArtefact = {
  type: string; // should align with Prisma ArtefactType enum (e.g. "json")
  filename: string;
  contentType: string; // e.g. "application/json", "text/csv"
  content?: string | Buffer; // optional: some collectors may only write Findings
};

export type CollectorStatus = "ok" | "error";

export type CollectorResult = {
  id: string; // usually same as collector.id
  status: CollectorStatus;
  data?: unknown;
  artefacts?: CollectorArtefact[];
  errors?: string[];
  summary?: Record<string, unknown>;
};

export type Collector = {
  id: string; // stable identifier stored in Job.collectorId
  displayName: string;
  run: (ctx: CollectorContext) => Promise<CollectorResult>;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error && typeof v.message === "string") return v.message;
  return String(v);
}

function normalizeArtefacts(input: unknown): CollectorArtefact[] | undefined {
  if (!Array.isArray(input)) return undefined;

  const out: CollectorArtefact[] = [];

  for (const raw of input) {
    const a = raw as Partial<CollectorArtefact> | null | undefined;
    if (!a || typeof a !== "object") continue;

    if (!isNonEmptyString(a.filename) || !isNonEmptyString(a.contentType)) continue;

    out.push({
      type: isNonEmptyString(a.type) ? a.type : "json",
      filename: a.filename,
      contentType: a.contentType,
      content: a.content
    });
  }

  return out.length > 0 ? out : undefined;
}

/**
 * Ensures every collector result stored in Job.result has a predictable, safe shape.
 * This avoids downstream UI/processing needing to handle a dozen "almost correct" variations.
 */
export function normalizeCollectorResult(
  collectorId: string,
  result: unknown
): CollectorResult {
  const r = (result ?? {}) as Partial<CollectorResult>;

  const status: CollectorStatus = r.status === "error" ? "error" : "ok";
  const id = isNonEmptyString(r.id) ? r.id : collectorId;

  const artefacts = normalizeArtefacts(r.artefacts);

  let errors: string[] | undefined;

  if (status === "error") {
    if (Array.isArray(r.errors) && r.errors.length > 0) {
      errors = r.errors.map(asString).filter((s) => s.trim().length > 0);
    } else {
      errors = ["Collector returned error"];
    }
  }

  const normalized: CollectorResult = {
    id,
    status
  };

  if (r.data !== undefined) normalized.data = r.data;
  if (artefacts) normalized.artefacts = artefacts;
  if (errors) normalized.errors = errors;
  if (r.summary && typeof r.summary === "object") normalized.summary = r.summary as any;

  return normalized;
}
