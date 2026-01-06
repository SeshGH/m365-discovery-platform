import { z } from "zod";

/**
 * Shared API contract: Create a discovery run.
 * This is used by the API (to validate input) and by the web (to build correct requests).
 */
export const CreateRunSchema = z.object({
  tenantGuid: z.string().min(5),
  primaryDomain: z.string().min(3),
  displayName: z.string().optional(),
  triggeredBy: z.string().optional(),
  modulesEnabled: z.record(z.any()).default({})
});

export type CreateRunInput = z.infer<typeof CreateRunSchema>;
