"use client";

import Link from "next/link";
import { Folder, Presentation, Users } from "lucide-react";
import type { FolderSummary, ProjectSummary, UsageSummary } from "@/lib/account-types";
import { accessRoleLabel, formatShortDate, projectStatusLabel } from "@/lib/project-ui";
import { ProjectActionsMenu } from "@/components/projects/project-actions-menu";

export function ProjectRow({ project, folders, usage }: { project: ProjectSummary; folders: FolderSummary[]; usage: UsageSummary }) {
  return (
    <article className="projects-row">
      <Link className="projects-row-main" href={`/projects/${project.id}/editor`}>
        <span className={`project-icon project-icon-${project.status}`}><Presentation size={22} aria-hidden="true" /></span>
        <div className="projects-row-copy">
          <strong>{project.title}</strong>
          <div className="projects-row-meta">
            <span>{project.slideCount} слайдов</span>
            <span>{formatShortDate(project.updatedAt)}</span>
            {project.folder ? <span><Folder size={14} />{project.folder.name}</span> : null}
            {project.memberCount ? <span><Users size={14} />{project.memberCount}</span> : null}
          </div>
        </div>
      </Link>
      <span className={`status status-${project.status}`}>{projectStatusLabel(project.status)}</span>
      <span className={`role-chip role-${project.accessRole}`}>{accessRoleLabel(project.accessRole)}</span>
      <ProjectActionsMenu folders={folders} project={project} usage={usage} />
    </article>
  );
}
