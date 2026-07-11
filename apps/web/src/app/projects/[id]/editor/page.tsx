import { ProjectEditor } from "@/components/project-editor";
import { internalFetch } from "@/lib/internal-api";
import { sanitizeProjectForDisplay } from "@/lib/presentation-display";
import type { ProjectDetail } from "@/lib/account-types";

export const dynamic = "force-dynamic";

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = sanitizeProjectForDisplay(await internalFetch<ProjectDetail>(`/projects/${id}`));

  return (
    <main className="page editor-page">
      <ProjectEditor initialProject={project} />
    </main>
  );
}
