// apps/portal/src/app/t/[tenantId]/runs/[runId]/page.tsx
import Link from "next/link";

export default async function RunPage({ params }: { params: { tenantId: string; runId: string } }) {
  return (
    <main>
      <p style={{ marginTop: 0 }}>
        <Link href={`/t/${params.tenantId}`}>← Back to tenant</Link>
      </p>

      <h2 style={{ marginTop: 0 }}>Run</h2>
      <p>
        Tenant: <code>{params.tenantId}</code>
        <br />
        Run: <code>{params.runId}</code>
      </p>

      <p style={{ opacity: 0.75 }}>
        Next step: fetch <code>GET /runs/:runId</code> + jobs/artefacts/observed-checks/findings and show
        completeness-first summaries.
      </p>
    </main>
  );
}
