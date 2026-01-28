// apps/portal/src/app/tenants/[tenantId]/runs/[runId]/page.tsx
import { redirect } from "next/navigation";

export default async function RunRedirectPage({
  params
}: {
  params: Promise<{ tenantId: string; runId: string }>;
}) {
  const { tenantId, runId } = await params;
  redirect(`/t/${tenantId}/runs/${runId}`);
}
