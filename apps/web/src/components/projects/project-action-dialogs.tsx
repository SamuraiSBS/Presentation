"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { FolderSummary, ProjectSummary, UsageSummary } from "@/lib/account-types";
import { formatResetDate } from "@/lib/project-ui";
import { ApiClientError, useDeleteProject, useDuplicateProject, useUpdateProject } from "@/lib/project-queries";
import { useLeaveProject } from "@/lib/collaboration-queries";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";

export type ProjectDialogKind = "rename" | "move" | "duplicate" | "delete" | "leave";

export function ProjectActionDialogs({ kind, onOpenChange, project, folders, usage }: { kind: ProjectDialogKind | null; onOpenChange: (open: boolean) => void; project: ProjectSummary; folders: FolderSummary[]; usage: UsageSummary }) {
  const router = useRouter();
  const [title, setTitle] = useState(project.title);
  const [folderId, setFolderId] = useState(project.folder?.id || "");
  const [error, setError] = useState("");
  const update = useUpdateProject(project.id);
  const duplicate = useDuplicateProject(project.id);
  const remove = useDeleteProject(project.id);
  const leave = useLeaveProject(project.id);
  const busy = update.isPending || duplicate.isPending || remove.isPending || leave.isPending;

  useEffect(() => {
    if (!kind) return;
    setTitle(kind === "duplicate" ? `${project.title} — копия` : project.title);
    setFolderId(project.folder?.id || "");
    setError("");
  }, [kind, project.folder?.id, project.title]);

  async function submit() {
    setError("");
    try {
      if (kind === "rename") await update.mutateAsync({ title: title.trim() });
      if (kind === "move") await update.mutateAsync({ folderId: folderId || null });
      if (kind === "duplicate") await duplicate.mutateAsync({ title: title.trim(), folderId: folderId || null });
      if (kind === "delete") await remove.mutateAsync();
      if (kind === "leave") await leave.mutateAsync(undefined);
      onOpenChange(false);
      if (kind === "delete" || kind === "leave") router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Не удалось выполнить действие");
    }
  }

  const copyBlocked = kind === "duplicate" && usage.used >= usage.limit;
  return (
    <Dialog open={Boolean(kind)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titleFor(kind)}</DialogTitle>
          <DialogDescription>{descriptionFor(kind, usage)}</DialogDescription>
        </DialogHeader>
        {kind === "rename" || kind === "duplicate" ? <label className="field"><span>Название</span><input className="input" value={title} maxLength={140} onChange={(event) => setTitle(event.target.value)} autoFocus /></label> : null}
        {kind === "move" || kind === "duplicate" ? <label className="field"><span>Папка</span><Select className="input" value={folderId} onValueChange={setFolderId} ariaLabel="Папка" options={[{ value: "", label: "Без папки" }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]} /></label> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><button className="ghost" type="button" onClick={() => onOpenChange(false)}>Отмена</button><button className={kind === "delete" || kind === "leave" ? "button button-danger" : "button"} type="button" onClick={() => void submit()} disabled={busy || copyBlocked || ((kind === "rename" || kind === "duplicate") && title.trim().length < 2)}>{busy ? "Сохраняем…" : actionFor(kind)}</button></div>
      </DialogContent>
    </Dialog>
  );
}

function titleFor(kind: ProjectDialogKind | null) {
  return ({ rename: "Переименовать презентацию", move: "Переместить в папку", duplicate: "Создать копию", delete: "Удалить презентацию?", leave: "Покинуть проект?" } as Record<string, string>)[kind || ""] || "Действие";
}
function descriptionFor(kind: ProjectDialogKind | null, usage: UsageSummary) {
  if (kind === "duplicate") return usage.used >= usage.limit ? `Лимит исчерпан. Новая копия будет доступна ${formatResetDate(usage)}.` : "Копия получит собственные слайды, материалы и изображения.";
  if (kind === "delete") return "Презентация, материалы и готовые файлы будут удалены без возможности восстановления.";
  if (kind === "leave") return "Проект исчезнет из списка доступных вам презентаций.";
  if (kind === "move") return "Содержимое презентации останется без изменений.";
  return "Новое название будет видно всем участникам проекта.";
}
function actionFor(kind: ProjectDialogKind | null) {
  return ({ rename: "Сохранить", move: "Переместить", duplicate: "Создать копию", delete: "Удалить", leave: "Покинуть" } as Record<string, string>)[kind || ""] || "Продолжить";
}
