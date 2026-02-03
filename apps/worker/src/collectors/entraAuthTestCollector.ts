import type { Collector } from "./types";
import { graphGetJsonWithClientCredentials, GraphHttpError } from "./graph";

function asNonEmptyString(x: unknown): string | null {
  return typeof x === "string" && x.trim().length > 0 ? x.trim() : null;
}

function getErrorMessage(err: unknown): string {
  // Deterministic handling for permission/consent gaps (no string matching).
  if (err instanceof GraphHttpError && err.status === 403) {
    return "Graph returned 403 Forbidden. The app likely lacks required application permissions and/or admin consent in the tenant.";
  }

  const e = err as any;
  if (typeof e?.message === "string" && e.message.trim().length > 0) {
    return e.message.trim();
  }

  // If the error is not an Error but is string-like, keep it.
  if (typeof err === "string" && err.trim().length > 0) {
    return err.trim();
  }

  return "Unknown error testing Graph connection";
}

export const entraAuthTestCollector: Collector = {
  id: "entra.auth.test",
  displayName: "Entra Auth Test (app-only Graph)",

  run: async (ctx) => {
    const tenantId = ctx.tenant.id;
    const tenantGuid = asNonEmptyString((ctx.tenant as any).tenantGuid);

    if (!tenantGuid) {
      const msg = "Tenant.tenantGuid is missing; cannot request Graph token";
      await ctx.prisma.tenantAuth.upsert({
        where: { tenantId },
        create: {
          tenantId,
          status: "error",
          lastError: msg
        } as any,
        update: {
          status: "error",
          lastError: msg
        } as any
      });

      return {
        id: "entra.auth.test",
        status: "error",
        errors: [msg]
      };
    }

    const clientId = process.env.GRAPH_CLIENT_ID;
    const clientSecret = process.env.GRAPH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      const msg = "Worker env missing GRAPH_CLIENT_ID or GRAPH_CLIENT_SECRET";
      await ctx.prisma.tenantAuth.upsert({
        where: { tenantId },
        create: {
          tenantId,
          status: "error",
          lastError: msg
        } as any,
        update: {
          status: "error",
          lastError: msg
        } as any
      });

      return {
        id: "entra.auth.test",
        status: "error",
        errors: [msg]
      };
    }

    try {
      const org = await graphGetJsonWithClientCredentials<{
        value?: Array<{ id?: string; displayName?: string }>;
      }>({
        tenantGuid,
        clientId,
        clientSecret,
        path: "/v1.0/organization?$select=id,displayName"
      });

      const orgId = org?.value?.[0]?.id ?? null;

      await ctx.prisma.tenantAuth.upsert({
        where: { tenantId },
        create: {
          tenantId,
          status: "connected",
          lastError: null,
          consentedAt: new Date()
        } as any,
        update: {
          status: "connected",
          lastError: null,
          consentedAt: new Date()
        } as any
      });

      return {
        id: "entra.auth.test",
        status: "ok",
        summary: {
          orgId
        }
      };
    } catch (err: unknown) {
      const message = getErrorMessage(err);

      await ctx.prisma.tenantAuth.upsert({
        where: { tenantId },
        create: {
          tenantId,
          status: "error",
          lastError: message
        } as any,
        update: {
          status: "error",
          lastError: message
        } as any
      });

      return {
        id: "entra.auth.test",
        status: "error",
        errors: [message]
      };
    }
  }
};
