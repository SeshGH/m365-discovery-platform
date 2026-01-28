// apps/portal/src/app/tenants/[tenantId]/runs/[runId]/observed-checks/[observedId]/page.tsx
import { redirect } from "next/navigation";

export default async function ObservedRedirectPage({
  params
}: {
  params: Promise<{ tenantId: string; runId: string; observedId: string }>;
}) {
  const { tenantId, runId, observedId } = await params;
  // Existing route is /t/:tenantId/runs/:runId/observed/:observedId
  redirect(`/t/${tenantId}/runs/${runId}/observed/${observedId}`);
}
