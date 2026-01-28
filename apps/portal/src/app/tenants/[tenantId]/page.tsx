// apps/portal/src/app/tenants/[tenantId]/page.tsx
import { redirect } from "next/navigation";

export default async function TenantRedirectPage({
  params
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  redirect(`/t/${tenantId}`);
}
