import type { Collector } from "./types";
import { entraUsersCollector } from "./entraUsersCollector";
import { enterpriseAppPermissionsCollector } from "./enterpriseAppPermissionsCollector";
import { entraConditionalAccessPoliciesCollector } from "./entraConditionalAccessPoliciesCollector";
import { entraDirectoryRolesAssignmentsCollector } from "./entraDirectoryRolesAssignmentsCollector";
import { entraAuthTestCollector } from "./entraAuthTestCollector";
import { exchangeMailboxesInventoryCollector } from "./exchangeMailboxesInventoryCollector";
import { sharepointSitesInventoryCollector } from "./sharepointSitesInventoryCollector";
import { sharepointAdminSettingsCollector } from "./sharepointAdminSettingsCollector";
import { intuneDevicesOverviewCollector } from "./intuneDevicesOverviewCollector";
import { entraGroupsInventoryCollector } from "./entraGroupsInventoryCollector";
import { exchangeTransportRulesCollector } from "./exchangeTransportRulesCollector";
import { exchangeConnectorsCollector } from "./exchangeConnectorsCollector";

// DEPRECATED (legacy exports): retained only so historical runs with queued jobs still work.
// These are no longer scheduled by default; portal-derived report snapshots replace them.
import { runSummaryCsvReportCollector } from "./runSummaryCsvReportCollector";
import { runSummaryExcelReportCollector } from "./runSummaryExcelReportCollector";

const collectors: Collector[] = [
  entraUsersCollector,
  enterpriseAppPermissionsCollector,
  entraConditionalAccessPoliciesCollector,
  entraDirectoryRolesAssignmentsCollector,
  entraAuthTestCollector,
  exchangeMailboxesInventoryCollector,
  sharepointSitesInventoryCollector,
  sharepointAdminSettingsCollector,
  intuneDevicesOverviewCollector,
  entraGroupsInventoryCollector,
  exchangeTransportRulesCollector,
  exchangeConnectorsCollector,

  // DEPRECATED legacy report collectors (do not schedule by default)
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
