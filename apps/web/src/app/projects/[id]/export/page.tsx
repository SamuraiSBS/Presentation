import { ExportPanel } from "@/components/export-panel";
import { internalFetch } from "@/lib/internal-api";

export const dynamic = "force-dynamic";

export default async function ExportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await internalFetch(`/projects/${id}`);

  return (
    <main className="page">
      <ExportPanel project={project} />
    </main>
  );
}
