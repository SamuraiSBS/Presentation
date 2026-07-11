import { ProjectsView } from "@/components/projects/projects-view";
import type { FolderSummary, ProjectListResponse } from "@/lib/account-types";
import { internalFetch } from "@/lib/internal-api";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const values = await searchParams;
  const query = new URLSearchParams();
  for (const key of ["scope", "folderId", "status", "search", "sort"]) {
    const value = values[key];
    if (typeof value === "string" && value) query.set(key, value);
  }
  query.set("limit", "24");
  const [projects, foldersResponse] = await Promise.all([
    internalFetch<ProjectListResponse>(`/projects?${query.toString()}`),
    internalFetch<{ items: FolderSummary[] }>("/folders"),
  ]);
  return <ProjectsView initialProjects={projects} initialFolders={foldersResponse.items} initialQuery={query.toString()} />;
}
