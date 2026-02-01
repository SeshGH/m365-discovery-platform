// apps/portal/src/app/t/[tenantId]/runs/page.tsx
import Link from "next/link";
import { headers } from "next/headers";
import RunsList from "../runs-list";

type RunItem = {
  id: string;
  status: string;
  dataProfile: string;
  createdAt: string;
  triggeredBy: string | null;
  counts: { jobs: number; findings: number; artefacts: number };
};

function getOriginFromHeaders(h: Headers): string {
  // Best-effort origin derivation for server-side fetch to /api/*
  // (keeps browser-only calls under /api/* while allowing server render)
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "http://localhost:3000";
  return `${proto}://${host}`;
}

export default async function RunsPage({
  params
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  const origin = getOriginFromHeaders(await headers());

  const res = await fetch(`${origin}/api/tenants/${tenantId}/runs`, {
    cache: "no-store"
  });

  // Fail closed: show empty list rather than exploding the page
  const initialRuns: RunItem[] = res.ok ? ((await res.json()) as RunItem[]) : [];
  const totalRuns = initialRuns.length;

  return (
    <main>
      <p style={{ margin: "10px 0 0 0" }}>
        <Link className="link" href={`/t/${tenantId}`}>
          ← Back to tenant
        </Link>
      </p>

      <h2 style={{ marginBottom: 8 }}>Runs</h2>

      <p className="subtle" style={{ marginTop: 0 }}>
        Full run history for this tenant. This page is a contract consumer; data is sourced via the portal BFF under{" "}
        <code>/api/*</code>.
      </p>

      <RunsList tenantId={tenantId} initialRuns={initialRuns} totalRuns={totalRuns} />
    </main>
  );
}
