import { ExportPanelQuery } from "@/components/export-panel-query";
import { ProjectUnavailable } from "@/components/project-unavailable";
import { InternalApiError, internalFetch } from "@/lib/internal-api";
import { sanitizeProjectForDisplay } from "@/lib/presentation-display";
import type { ProjectDetail } from "@/lib/account-types";

export const dynamic = "force-dynamic";

export default async function ExportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const project = sanitizeProjectForDisplay(await internalFetch<ProjectDetail>(`/projects/${id}`));

    return (
      <main className="page">
        <ExportPanelQuery project={project} />
      </main>
    );
  } catch (error) {
    const missing = error instanceof InternalApiError && error.status === 404;
    return (
      <main className="page">
        <ProjectUnavailable
          title={missing ? "Презентация не найдена" : "Не удалось открыть экспорт"}
          description={missing ? "Возможно, презентация была удалена или ссылка устарела." : "Проверьте подключение и попробуйте ещё раз. Пока можно вернуться к списку презентаций."}
        />
      </main>
    );
  }
}
