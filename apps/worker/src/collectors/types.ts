import type { PrismaClient, ArtefactType } from "@prisma/client";

/**
 * NOTE:
 * We intentionally do NOT import Prisma types (Run/Job/Tenant) from @acme/db.
 * @acme/db does not export those generated types, and the worker doesn't need
 * strict Prisma typing here to be useful.
 *
 * CollectorContext stays stable as a contract: prisma + job/run/tenant objects exist.
 */
export type CollectorContext = {
  prisma: PrismaClient;
  job: any;
  run: any;
  tenant: any;
};

export type CollectorArtefact = {
  // Must align with Prisma enum ArtefactType (e.g. "json" | "csv" | "raw")
  type: ArtefactType;
  filename: string;
  contentType: string; // e.g. "application/json", "text/csv"
  content?: string | Buffer; // optional: some collectors may only write findings
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

const ALLOWED_ARTEFACT_TYPES = new Set<ArtefactType>(["json", "csv", "raw"] as ArtefactType[]);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error && typeof v.message === "string") return v.message;
  return String(v);
}

function normalizeArtefactType(v: unknown): ArtefactType {
  if (typeof v === "string" && (ALLOWED_ARTEFACT_TYPES as Set<string>).has(v)) {
    return v as ArtefactType;
  }
  return "json" as ArtefactType;
}

function normalizeArtefacts(input: unknown): CollectorArtefact[] | undefined {
  if (!Array.isArray(input)) return undefined;

  const out: CollectorArtefact[] = [];

  for (const raw of input) {
    const a = raw as Partial<CollectorArtefact> | null | undefined;
    if (!a || typeof a !== "object") continue;

    if (!isNonEmptyString(a.filename) || !isNonEmptyString(a.contentType)) continue;

    out.push({
      type: normalizeArtefactType((a as any).type),
      filename: a.filename,
      contentType: a.contentType,
      content: (a as any).content
    });
  }

  return out.length > 0 ? out : undefined;
}

/**
 * Ensures every collector result stored in Job.result has a predictable shape.
 * This avoids downstream UI/processing needing to handle multiple variations.
 */
export function normalizeCollectorResult(collectorId: string, result: unknown): CollectorResult {
  const r = (result ?? {}) as Partial<CollectorResult>;

  const status: CollectorStatus = r.status === "error" ? "error" : "ok";
  const id = isNonEmptyString(r.id) ? r.id : collectorId;

  const artefacts = normalizeArtefacts((r as any).artefacts);

  let errors: string[] | undefined;
  if (status === "error") {
    if (Array.isArray(r.errors) && r.errors.length > 0) {
      errors = r.errors.map(asString).filter((s) => s.trim().length > 0);
    } else {
      errors = ["Collector returned error"];
    }
  }

  const normalized: CollectorResult = { id, status };

  if (r.data !== undefined) normalized.data = r.data;
  if (artefacts) normalized.artefacts = artefacts;
  if (errors) normalized.errors = errors;
  if (r.summary && typeof r.summary === "object") normalized.summary = r.summary as any;

  return normalized;
}
