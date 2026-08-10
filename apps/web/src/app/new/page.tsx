import { NewProjectForm } from "@/components/new-project-form";
import { ProjectUnavailable } from "@/components/project-unavailable";
import { planLimits } from "@studydeck/shared";
import type { DashboardSummary } from "@/lib/account-types";
import { internalFetch } from "@/lib/internal-api";
import { CreationModePicker } from "@/components/defense/creation-mode-picker";
import { ScrollToTop } from "@/components/scroll-to-top";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  let dashboard: DashboardSummary;

  try {
    dashboard = await internalFetch<DashboardSummary>("/dashboard");
  } catch {
    return (
      <main className="page">
        <ProjectUnavailable
          title="Не удалось открыть создание презентации"
          description="Проверьте подключение и попробуйте открыть страницу ещё раз. Пока можно вернуться к уже созданным презентациям."
        />
      </main>
    );
  }

  return (
    <main className="page new-page">
      <ScrollToTop />
      <CreationModePicker active="standard" />
      <p className="new-page-kicker">Одна тема → готовое выступление</p>
      <h1 className="page-title">О чём будешь выступать?</h1>
      <p className="lead">Начни с темы: примерно через 5 минут у тебя будут презентация и связный текст выступления. Перед запуском всё можно проверить.</p>
      <NewProjectForm usage={dashboard.usage} maxSlides={planLimits[dashboard.usage.planCode].maxSlides} />
    </main>
  );
}
