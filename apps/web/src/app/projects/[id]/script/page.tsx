import { ProjectScriptReviewQuery } from "@/components/project-script-review-query";
import { internalFetch } from "@/lib/internal-api";
import type { ProjectDetail } from "@/lib/account-types";

export const dynamic = "force-dynamic";

export default async function ProjectScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await internalFetch<ProjectDetail>(`/projects/${id}`);

  return (
    <main className="page">
      <ProjectScriptReviewQuery initialProject={project} />
    </main>
  );
}
