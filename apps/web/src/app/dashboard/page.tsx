import Link from "next/link";
import { Plus } from "lucide-react";
import { DashboardProjectList } from "@/components/dashboard-project-list";
import { internalFetch } from "@/lib/internal-api";

export const dynamic = "force-dynamic";

type ProjectRow = {
  id: string;
  title: string;
  status: string;
  slideCount: number;
  updatedAt: string;
  presentation?: { id: string } | null;
};

export default async function DashboardPage() {
  const projects = (await internalFetch("/projects")) as ProjectRow[];

  return (
    <main className="page">
      <div className="page-heading-row">
        <div>
          <h1 className="page-title">Проекты</h1>
          <p className="lead">Здесь лежат твои черновики и готовые презентации.</p>
        </div>
        <Link className="button" href="/new"><Plus aria-hidden="true" size={18} />Новая презентация</Link>
      </div>

      <DashboardProjectList initialProjects={projects} />
    </main>
  );
}
