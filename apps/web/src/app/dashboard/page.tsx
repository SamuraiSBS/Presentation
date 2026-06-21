import Link from "next/link";
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
      <div className="row" style={{ justifyContent: "space-between", gap: 16, marginBottom: 24 }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 48 }}>Проекты</h1>
          <p className="lead">Здесь хранятся черновики, готовые презентации и файлы для скачивания.</p>
        </div>
        <Link className="button" href="/new">Новая презентация</Link>
      </div>

      <section className="project-list">
        {projects.length ? (
          projects.map((project) => (
            <Link className="card" href={`/projects/${project.id}/editor`} key={project.id}>
              <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                <div>
                  <strong>{project.title}</strong>
                  <p className="muted">{project.slideCount} слайдов</p>
                </div>
                <span className="status">{statusLabel(project.status)}</span>
              </div>
            </Link>
          ))
        ) : (
          <div className="panel">
            <h2>Пока нет проектов</h2>
            <p className="muted">Создайте первую презентацию: добавьте тему, файлы и запустите генерацию.</p>
            <Link className="button" href="/new">Создать</Link>
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
    script_generating: "Создаём текст",
    script_ready: "Текст готов",
    queued: "В очереди",
    generating: "Создаём презентацию",
    ready: "Готово",
    failed: "Ошибка",
  };
  return labels[status] || status;
}
