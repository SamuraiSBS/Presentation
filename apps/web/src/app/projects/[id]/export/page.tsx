import { ExportPanelV2 } from "@/components/export-panel-v2";
import { internalFetch } from "@/lib/internal-api";
import { sanitizeProjectForDisplay } from "@/lib/presentation-display";

export const dynamic = "force-dynamic";

export default async function ExportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = sanitizeProjectForDisplay(await internalFetch(`/projects/${id}`));

  return (
    <main className="page">
      <ExportPanelV2 project={project} />
    </main>
  );
}
