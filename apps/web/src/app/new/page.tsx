import { NewProjectForm } from "@/components/new-project-form";
import { planLimits } from "@studydeck/shared";
import type { DashboardSummary } from "@/lib/account-types";
import { internalFetch } from "@/lib/internal-api";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const dashboard = await internalFetch<DashboardSummary>("/dashboard");

  return (
    <main className="page new-page">
      <h1 className="page-title">О чём будешь выступать?</h1>
      <p className="lead">Сначала вместе подготовим текст, а после соберём из него слайды.</p>
      <NewProjectForm usage={dashboard.usage} maxSlides={planLimits[dashboard.usage.planCode].maxSlides} />
    </main>
  );
}
