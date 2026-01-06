export type CollectorStatus = "ok" | "warning" | "error";

export type CollectorResult = {
  /** Stable ID (used for routing + UI grouping). Example: "entra.users" */
  id: string;

  /** Human friendly name. Example: "Entra ID - Users report" */
  title: string;

  /** What happened overall */
  status: CollectorStatus;

  /** Start/end timestamps for auditability */
  startedAt: string;   // ISO
  finishedAt: string;  // ISO

  /** Short summary for UI cards */
  summary: Record<string, unknown>;

  /**
   * Any raw/structured output that the UI might render.
   * Keep this JSON-serialisable.
   */
  data?: unknown;

  /**
   * Optional downloadable artefacts (CSV, ZIP, logs).
   * For now just metadata + content (or a reference we can upload to MinIO later).
   */
  artefacts?: Array<{
    type: "csv" | "json" | "zip" | "log" | "raw";
    filename: string;
    contentType: string; // e.g. "text/csv"
    /** Either inline content (small) OR omit and store in object storage later */
    content?: string; // base64 or plain text (we’ll decide later)
  }>;
};

export type CollectorContext = {
  /** Required so collectors can write findings/artefacts later (or return data only) */
  runId: string;
  tenantId: string;
  tenantGuid: string;
  primaryDomain: string;
  triggeredBy?: string | null;

  /** Feature flags / modules requested for this run */
  modulesEnabled: Record<string, unknown>;

  /**
   * Future: auth tokens/Graph client/credential handle.
   * Keep empty for now – we’ll add later when we integrate your PS/Graph logic.
   */
};

export type Collector = (ctx: CollectorContext) => Promise<CollectorResult>;
