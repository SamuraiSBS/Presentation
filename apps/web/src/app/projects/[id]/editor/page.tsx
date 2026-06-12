import { ProjectEditor } from "@/components/project-editor";
import { internalFetch } from "@/lib/internal-api";

export const dynamic = "force-dynamic";

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await internalFetch(`/projects/${id}`);

  return (
    <main className="page">
      <ProjectEditor initialProject={project} />
    </main>
  );
}
