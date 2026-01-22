import type { Collector } from "./types";

/**
 * Exchange Online – Mailbox Inventory (v1)
 *
 * Contract-first skeleton:
 * - No Exchange/Graph calls yet
 * - No artefacts yet
 * - No observed checks yet
 *
 * Purpose of this file right now is to:
 * - Reserve the stable collector ID
 * - Provide a safe, predictable CollectorResult shape
 * - Allow the worker + API to enqueue/run it without errors
 */
export const exchangeMailboxesInventoryCollector: Collector = {
  id: "exchange.mailboxes.inventory",
  displayName: "Exchange Online – Mailbox Inventory",

  run: async (ctx) => {
    // Data profile handling: unknown values coerced to safe.
    const rawProfile = (ctx.run as any)?.dataProfile;
    const dataProfile = rawProfile === "full" ? "full" : "safe";

    return {
      id: "exchange.mailboxes.inventory",
      status: "ok",
      summary: {
        dataProfile,
        implemented: false,
        note: "Collector skeleton only. Exchange mailbox inventory is not implemented yet; no observed checks or artefacts are emitted."
      }
    };
  }
};
