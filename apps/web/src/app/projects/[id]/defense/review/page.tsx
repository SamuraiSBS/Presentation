import { DefenseReviewWorkspace } from "@/components/defense/defense-review-workspace";
import { ProjectUnavailable } from "@/components/project-unavailable";
import type { ProjectDetail } from "@/lib/account-types";
import type { DefenseWorkspacePayload } from "@/lib/defense-queries";
import { internalFetch } from "@/lib/internal-api";

export const dynamic = "force-dynamic";

export default async function DefenseReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const [project, defense] = await Promise.all([
      internalFetch<ProjectDetail>(`/projects/${id}`),
      internalFetch<DefenseWorkspacePayload>(`/projects/${id}/defense`),
    ]);
    return <main className="page defense-route-page"><DefenseReviewWorkspace projectId={id} projectTitle={project.title} initialData={defense} /></main>;
  } catch {
    return <main className="page"><ProjectUnavailable title="Не удалось открыть проверку материалов" description="Проверьте подключение и доступ к проекту, затем попробуйте ещё раз." /></main>;
  }
}
