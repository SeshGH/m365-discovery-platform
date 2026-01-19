import type { Collector } from "./types";
import { entraUsersCollector } from "./entraUsersCollector";
import { enterpriseAppPermissionsCollector } from "./enterpriseAppPermissionsCollector";
import { entraConditionalAccessPoliciesCollector } from "./entraConditionalAccessPoliciesCollector";
import { entraAuthTestCollector } from "./entraAuthTestCollector";
import { runSummaryCsvReportCollector } from "./runSummaryCsvReportCollector";
import { runSummaryExcelReportCollector } from "./runSummaryExcelReportCollector";

const collectors: Collector[] = [
  entraUsersCollector,
  enterpriseAppPermissionsCollector,
  entraConditionalAccessPoliciesCollector,
  entraAuthTestCollector,

  // Reports (enqueued last by API)
  runSummaryCsvReportCollector,
  runSummaryExcelReportCollector
];

export const collectorRegistry: Record<string, Collector> = Object.fromEntries(
  collectors.map((c) => [c.id, c])
);

export function getCollectorOrThrow(id: string): Collector {
  const c = collectorRegistry[id];
  if (!c) throw new Error(`Unknown collectorId: ${id}`);
  return c;
}
