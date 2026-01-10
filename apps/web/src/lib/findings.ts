export type Severity = "critical" | "high" | "medium" | "low" | "info" | "unknown";
export type FindingCategory =
  | "identity"
  | "access"
  | "application_permissions"
  | "tenant_configuration"
  | "audit_and_logging"
  | "data_protection"
  | "device_management"
  | "other";

export type Confidence = "low" | "medium" | "high";
export type FindingStatus = "open" | "acknowledged" | "resolved" | "false_positive";

export type Finding = {
  id: string;
  runId: string;
  jobId?: string | null;
  checkId: string;
  ruleId?: string | null;

  category?: FindingCategory;   // nullable in older rows; present after migration
  severity: Severity;
  confidence?: Confidence;
  status?: FindingStatus;
  score?: number | null;

  title: string;
  description: string;
  recommendation?: string | null;

  createdAt: string;
  updatedAt?: string;
};

export function severityRank(s: Severity): number {
  // Higher = more severe
  switch (s) {
    case "critical": return 5;
    case "high": return 4;
    case "medium": return 3;
    case "low": return 2;
    case "info": return 1;
    case "unknown": return 0;
    default: return 0;
  }
}
