"use client";

import Link from "next/link";
import { Clock3, FileStack, Layers3, Plus, Sparkles } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { DashboardSummary, ProjectSummary } from "@/lib/account-types";
import { useDashboard } from "@/lib/dashboard-queries";
import { formatResetDate, formatShortDate, projectStatusLabel, usagePercent } from "@/lib/project-ui";

export function DashboardOverview({ initialDashboard }: { initialDashboard: DashboardSummary }) {
  const { data = initialDashboard, isFetching } = useDashboard(initialDashboard);
  const firstName = data.user.name?.trim().split(/\s+/)[0];
  const continueProject = data.activeProjects[0] || data.recentProjects.find((project) => project.status !== "ready");

  return (
    <main className="page account-page dashboard-page" aria-busy={isFetching}>
      <header className="account-page-header">
        <div>
          <p className="account-kicker">Личный кабинет</p>
          <h1 className="page-title">{firstName ? `${firstName}, продолжим?` : "Продолжим работу?"}</h1>
          <p className="lead">Все презентации, прогресс и совместные проекты в одном месте.</p>
        </div>
        <Link className="button" href="/new"><Plus size={18} />Создать презентацию</Link>
      </header>

      <section className="usage-panel" aria-labelledby="usage-title">
        <div className="usage-copy">
          <div><p className="account-kicker">Бесплатный тариф</p><h2 id="usage-title">{data.usage.used} из {data.usage.limit} презентаций</h2></div>
          <strong>{Math.max(0, data.usage.remaining)} осталось</strong>
        </div>
        <Progress value={usagePercent(data.usage)} aria-label={`Использовано ${data.usage.used} из ${data.usage.limit}`} />
        <p>Лимит обновится {formatResetDate(data.usage)} по московскому времени.</p>
      </section>

      <dl className="stats-strip">
        <Stat icon={<FileStack />} label="Создано презентаций" value={data.stats.presentationsCreated} />
        <Stat icon={<Layers3 />} label="Создано слайдов" value={data.stats.slidesCreated} />
        <Stat icon={<Clock3 />} label="Примерно сэкономлено" value={`${data.stats.savedHoursMin}–${data.stats.savedHoursMax} ч`} hint="Ориентировочная оценка" />
      </dl>

      {continueProject ? (
        <section className="continue-panel">
          <div><p className="account-kicker"><Sparkles size={15} />Продолжить работу</p><h2>{continueProject.title}</h2><p>{projectStatusLabel(continueProject.status)} · обновлено {formatShortDate(continueProject.updatedAt)}</p></div>
          <Link className="ghost" href={`/projects/${continueProject.id}/editor`}>Открыть</Link>
        </section>
      ) : null}

      <DashboardSection title="Последние презентации" projects={data.recentProjects.slice(0, 5)} allHref="/projects" />
      {data.activeProjects.length ? <DashboardSection title="Создаются сейчас" projects={data.activeProjects} /> : null}
      {data.sharedProjects.length ? <DashboardSection title="Доступные мне" projects={data.sharedProjects.slice(0, 5)} allHref="/projects?scope=shared" /> : null}

      {!data.recentProjects.length && !data.activeProjects.length && !data.sharedProjects.length ? (
        <section className="panel empty-state account-empty">
          <h2>Первая презентация начинается с темы</h2>
          <p>Расскажите, о чём будете выступать, а материалы можно добавить на следующем шаге.</p>
          <Link className="button" href="/new"><Plus size={18} />Создать презентацию</Link>
        </section>
      ) : null}
    </main>
  );
}

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string }) {
  return <div className="stat-item"><span>{icon}</span><div><dt>{label}</dt><dd>{value}</dd>{hint ? <small>{hint}</small> : null}</div></div>;
}

function DashboardSection({ title, projects, allHref }: { title: string; projects: ProjectSummary[]; allHref?: string }) {
  if (!projects.length) return null;
  return (
    <section className="dashboard-section">
      <header><h2>{title}</h2>{allHref ? <Link href={allHref}>Показать все</Link> : null}</header>
      <div className="account-project-list">
        {projects.map((project) => (
          <Link className="account-project-row" href={`/projects/${project.id}/editor`} key={project.id}>
            <div><strong>{project.title}</strong><span>{project.slideCount} слайдов · {formatShortDate(project.updatedAt)}</span></div>
            <span className={`status status-${project.status}`}>{projectStatusLabel(project.status)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
