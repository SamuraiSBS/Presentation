"use client";

import Link from "next/link";
import { Copy, Download, Edit3, FolderInput, LogOut, MoreHorizontal, Share2, Trash2 } from "lucide-react";
import { useState } from "react";
import type { FolderSummary, ProjectSummary, UsageSummary } from "@/lib/account-types";
import { canCreateProject } from "@/lib/account-types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectActionDialogs, type ProjectDialogKind } from "@/components/projects/project-action-dialogs";
import { ShareProjectDialog } from "@/components/projects/share-project-dialog";

export function ProjectActionsMenu({ project, folders, usage }: { project: ProjectSummary; folders: FolderSummary[]; usage: UsageSummary }) {
  const [dialog, setDialog] = useState<ProjectDialogKind | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const owner = project.accessRole === "owner";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button className="row-menu-trigger" type="button" aria-label={`Действия: ${project.title}`}><MoreHorizontal size={20} /></button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild><Link href={`/projects/${project.id}/export`}><Download size={16} />Экспорт</Link></DropdownMenuItem>
          {owner ? <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setDialog("rename")}><Edit3 size={16} />Переименовать</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("move")}><FolderInput size={16} />Переместить</DropdownMenuItem>
            <DropdownMenuItem disabled={!canCreateProject(usage)} onSelect={() => setDialog("duplicate")}><Copy size={16} />Дублировать</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setShareOpen(true)}><Share2 size={16} />Поделиться</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="danger-menu-item" onSelect={() => setDialog("delete")}><Trash2 size={16} />Удалить</DropdownMenuItem>
          </> : <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setDialog("leave")}><LogOut size={16} />Покинуть проект</DropdownMenuItem>
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
      <ProjectActionDialogs folders={folders} kind={dialog} onOpenChange={(open) => !open && setDialog(null)} project={project} usage={usage} />
      {owner ? <ShareProjectDialog open={shareOpen} onOpenChange={setShareOpen} projectId={project.id} projectTitle={project.title} /> : null}
    </>
  );
}
