// apps/worker/src/findings/types.ts

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info" | "unknown";

export type ObservedCheckLike = {
  checkId: string;
  collectorId?: string | null;
  data?: any;
  references?: any;
};

export type DerivedFinding = {
  checkId: string;
  severity: FindingSeverity;
  title: string;
  recommendation?: string | null;

  // Optional “future” fields (we won’t rely on them yet, but safe to carry)
  category?: string | null;
  confidence?: string | null;
  status?: string | null;
  score?: number | null;

  // Evidence pointers (optional)
  references?: any;
};

export type FindingDeriveContext = {
  observedChecks: ObservedCheckLike[];
};

export type FindingDerivation = {
  id: string; // stable derivation id (internal)
  emits: string[]; // list of finding checkIds this derivation may emit
  derive(ctx: FindingDeriveContext): DerivedFinding[];
};
