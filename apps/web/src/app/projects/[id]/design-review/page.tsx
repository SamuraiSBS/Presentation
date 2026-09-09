import { DesignReviewBoard } from "@/components/design-review-board";
import { internalFetch } from "@/lib/internal-api";
import type { DesignReview } from "@studydeck/shared";
import type { ProjectDetail } from "@/lib/account-types";

export const dynamic = "force-dynamic";

export default async function DesignReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project, review] = await Promise.all([internalFetch<ProjectDetail>(`/projects/${id}`), internalFetch<DesignReview>(`/projects/${id}/design-review`)]);
  return <main className="page"><DesignReviewBoard initialReview={review} title={project.title} accessRole={project.accessRole} /></main>;
}
