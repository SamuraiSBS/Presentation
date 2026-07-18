import { planLimits } from "@studydeck/shared";
import { CreationModePicker } from "@/components/defense/creation-mode-picker";
import { DefenseWizard } from "@/components/defense/defense-wizard";
import { ProjectUnavailable } from "@/components/project-unavailable";
import { internalFetch } from "@/lib/internal-api";
import type { DashboardSummary } from "@/lib/account-types";

export const dynamic = "force-dynamic";

export default async function NewDefensePage() {
  let dashboard: DashboardSummary;
  try {
    dashboard = await internalFetch<DashboardSummary>("/dashboard");
  } catch {
    return <main className="page"><ProjectUnavailable title="Не удалось открыть мастер защиты" description="Проверьте подключение и попробуйте ещё раз. Уже созданные проекты доступны в списке презентаций." /></main>;
  }

  return (
    <main className="page defense-new-page">
      <CreationModePicker active="defense" />
      <header className="defense-new-heading">
        <span className="status">Презентация по ТЗ</span>
        <h1 className="page-title">Подготовим защиту без выдуманных фактов</h1>
        <p className="lead">Сначала загрузите проект и требования. До сборки слайдов вы проверите факты, противоречия и план выступления.</p>
      </header>
      <DefenseWizard usage={dashboard.usage} maxSlides={Math.min(20, planLimits[dashboard.usage.planCode].maxSlides)} />
    </main>
  );
}
