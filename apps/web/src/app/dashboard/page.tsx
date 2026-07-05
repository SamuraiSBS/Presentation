import Link from "next/link";
import { ArrowRight, Plus, Presentation } from "lucide-react";
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

      <section className="project-list">
        {projects.length ? (
          projects.map((project) => (
            <Link className="card project-card" href={`/projects/${project.id}/editor`} key={project.id}>
              <span className="icon-surface"><Presentation aria-hidden="true" size={23} /></span>
              <div className="project-card-copy">
                  <strong>{project.title}</strong>
                  <p className="muted">{project.slideCount} слайдов</p>
              </div>
              <span className={`status status-${project.status}`}>{statusLabel(project.status)}</span>
              <ArrowRight className="project-arrow" aria-hidden="true" size={20} />
            </Link>
          ))
        ) : (
          <div className="panel empty-state">
            <h2>Здесь пока пусто</h2>
            <p className="muted">Начни с темы. Материалы можно добавить сразу или обойтись без них.</p>
            <Link className="button" href="/new"><Plus aria-hidden="true" size={18} />Создать презентацию</Link>
          </div>
        )}
      </section>
    </main>
  );
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "Черновик",
    uploading: "Загрузка файлов",
    script_queued: "Текст в очереди",
    script_generating: "Готовим текст",
    script_ready: "Текст готов",
    queued: "В очереди",
    generating: "Собираем презентацию",
    ready: "Готово",
    failed: "Нужно повторить",
  };
  return labels[status] || "Обновляем статус";
}
