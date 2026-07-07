"use client";

import Link from "next/link";
import { ArrowRight, Plus, Presentation } from "lucide-react";
import { useProjects, type ProjectPayload } from "@/lib/project-queries";

export function DashboardProjectList({ initialProjects }: { initialProjects: ProjectPayload[] }) {
  const { data: projects = initialProjects, isFetching } = useProjects(initialProjects);

  return (
    <section className="project-list" aria-busy={isFetching}>
      {projects.length ? (
        projects.map((project) => (
          <Link className="card project-card" href={`/projects/${project.id}/editor`} key={project.id}>
            <span className="icon-surface"><Presentation aria-hidden="true" size={23} /></span>
            <div className="project-card-copy">
              <strong>{project.title}</strong>
              <p className="muted">{project.slideCount || 0} слайдов</p>
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
