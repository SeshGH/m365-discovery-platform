// apps/portal/src/app/tenants/page.tsx
import { listTenants } from "@/lib/api";
import { TenantsClient } from "./_components/TenantsClient";

export default async function TenantsPage() {
  const tenants = await listTenants({ take: 50 });
  return <TenantsClient initialTenants={tenants} />;
}
