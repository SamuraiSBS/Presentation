import { DashboardOverview } from "@/components/dashboard/dashboard-overview";
import type { DashboardSummary } from "@/lib/account-types";
import { internalFetch } from "@/lib/internal-api";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const dashboard = await internalFetch<DashboardSummary>("/dashboard");
  return <DashboardOverview initialDashboard={dashboard} />;
}
