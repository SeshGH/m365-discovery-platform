export * from "./contracts";

// Temporary stub collector so worker can run something end-to-end.
// We'll replace this with real collectors (e.g. entra.users) next.
import type { CollectorResult } from "./contracts";

export async function runHelloCollector(): Promise<CollectorResult> {
  const startedAt = new Date().toISOString();

  const finishedAt = new Date().toISOString();

  return {
    id: "hello",
    title: "Hello (stub collector)",
    status: "ok",
    startedAt,
    finishedAt,
    summary: { note: "stub collector ran" },
    data: { message: "hello from collectors", ts: Date.now() }
  };
}
