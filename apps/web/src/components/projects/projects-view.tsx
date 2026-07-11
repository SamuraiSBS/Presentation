"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import type { FolderSummary, ProjectListResponse } from "@/lib/account-types";
import { canCreateProject } from "@/lib/account-types";
import { useProjectList } from "@/lib/project-queries";
import { formatResetDate } from "@/lib/project-ui";
import { ProjectRow } from "@/components/projects/project-row";
import { ProjectsToolbar } from "@/components/projects/projects-toolbar";

export function ProjectsView({ initialProjects, initialFolders, initialQuery }: { initialProjects: ProjectListResponse; initialFolders: FolderSummary[]; initialQuery: string }) {
  const query = new URLSearchParams(initialQuery);
  const projectsQuery = useProjectList(query, initialProjects);
  const pages = projectsQuery.data?.pages || [initialProjects];
  const projects = pages.flatMap((page) => page.items);
  const usage = pages[0]?.usage || initialProjects.usage;
  const canCreate = canCreateProject(usage);

  return (
    <main className="page account-page projects-page">
      <header className="account-page-header">
        <div><p className="account-kicker">Библиотека</p><h1 className="page-title">Презентации</h1><p className="lead">Личные и совместные работы — без тяжёлой загрузки содержимого слайдов.</p></div>
        {canCreate ? <Link className="button" href="/new"><Plus size={18} />Создать</Link> : <button className="button" type="button" disabled title={`Лимит обновится ${formatResetDate(usage)}`}><Plus size={18} />Создать</button>}
      </header>

      <ProjectsToolbar folders={initialFolders} usage={usage} initialQuery={initialQuery} />

      {projects.length ? (
        <section className="projects-list" aria-busy={projectsQuery.isFetching}>
          {projects.map((project) => <ProjectRow folders={initialFolders.filter((folder) => !folder.isShared)} key={project.id} project={project} usage={usage} />)}
        </section>
      ) : (
        <section className="panel empty-state account-empty"><h2>Ничего не найдено</h2><p>Измените фильтры или создайте новую презентацию.</p>{canCreate ? <Link className="button" href="/new"><Plus size={18} />Создать презентацию</Link> : null}</section>
      )}

      {projectsQuery.hasNextPage ? <button className="ghost load-more" type="button" onClick={() => void projectsQuery.fetchNextPage()} disabled={projectsQuery.isFetchingNextPage}>{projectsQuery.isFetchingNextPage ? "Загружаем…" : "Показать ещё"}</button> : null}
      {!canCreate ? <p className="limit-note" role="status">Использовано {usage.used} из {usage.limit}. Новые презентации и дубликаты будут доступны {formatResetDate(usage)}.</p> : null}
    </main>
  );
}
