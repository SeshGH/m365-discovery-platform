import type { Collector } from "./types";
import { graphGetJsonWithClientCredentials } from "../lib/graph";

function asNonEmptyString(x: unknown): string | null {
  return typeof x === "string" && x.trim().length > 0 ? x.trim() : null;
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
    } catch (err: any) {
      const message =
        typeof err?.message === "string" && err.message.length > 0
          ? err.message
          : "Unknown error testing Graph connection";

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
