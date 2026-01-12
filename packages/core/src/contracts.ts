import { z } from "zod";

/**
 * CreateRunSchema
 *
 * Defines the public contract for creating a discovery run.
 * This schema is consumed by the API and is treated as a stable contract.
 */
export const CreateRunSchema = z.object({
  tenantGuid: z.string().uuid(),
  primaryDomain: z.string().min(1),
  displayName: z.string().min(1).optional(),

  /**
   * Identifies what triggered the run (portal, auth-test, demo, etc.)
   */
  triggeredBy: z.string().min(1),

  /**
   * Modules enabled for this run.
   * Keys must match API module -> collector mapping.
   */
  modulesEnabled: z.record(z.boolean()).optional(),

  /**
   * Data profile for this run.
   *
   * - "safe" (default): summary-only, no PII-heavy artefacts
   * - "full": explicit opt-in for sensitive exports (PII)
   *
   * Behaviour is enforced by collectors and report generators.
   */
  dataProfile: z.enum(["safe", "full"]).optional()
});

export type CreateRunInput = z.infer<typeof CreateRunSchema>;
