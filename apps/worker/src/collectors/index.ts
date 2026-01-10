import type { Collector } from "./types";
import { entraUsersCollector } from "./entraUsersCollector";
import { enterpriseAppPermissionsCollector } from "./enterpriseAppPermissionsCollector";
import { entraAuthTestCollector } from "./entraAuthTestCollector";

const collectors: Collector[] = [
  entraUsersCollector,
  enterpriseAppPermissionsCollector,
  entraAuthTestCollector
];

export const collectorRegistry: Record<string, Collector> = Object.fromEntries(
  collectors.map((c) => [c.id, c])
);

export function getCollectorOrThrow(id: string): Collector {
  const c = collectorRegistry[id];
  if (!c) {
    throw new Error(`Unknown collectorId: ${id}`);
  }
  return c;
}
