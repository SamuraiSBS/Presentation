"use client";

import Link from "next/link";
import { Folder, FolderOpen, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { FolderColor, FolderSummary } from "@/lib/account-types";
import { useCreateFolder, useDeleteFolder, useFolders, useUpdateFolder } from "@/lib/folder-queries";
import { ApiClientError } from "@/lib/project-queries";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type DialogState = { type: "create" } | { type: "edit" | "delete"; folder: FolderSummary } | null;
const colors: FolderColor[] = ["orange", "green", "purple", "blue", "neutral"];

export function FoldersManager({ initialFolders }: { initialFolders: FolderSummary[] }) {
  const { data: folders = initialFolders } = useFolders(initialFolders);
  const [dialog, setDialog] = useState<DialogState>(null);
  const own = folders.filter((folder) => !folder.isShared);
  const shared = folders.filter((folder) => folder.isShared);

  return (
    <main className="page account-page folders-page">
      <header className="account-page-header"><div><p className="account-kicker">Организация</p><h1 className="page-title">Папки</h1><p className="lead">Один понятный уровень — презентации не потеряются в глубокой структуре.</p></div><button className="button" type="button" onClick={() => setDialog({ type: "create" })}><Plus size={18} />Создать папку</button></header>
      {own.length ? <FolderGroup title="Мои папки" folders={own} onEdit={(folder) => setDialog({ type: "edit", folder })} onDelete={(folder) => setDialog({ type: "delete", folder })} /> : <section className="panel empty-state account-empty"><h2>Папок пока нет</h2><p>Создайте папку для предмета, курса или большого проекта.</p><button className="button" type="button" onClick={() => setDialog({ type: "create" })}><Plus size={18} />Создать папку</button></section>}
      {shared.length ? <FolderGroup title="Папки совместных проектов" folders={shared} /> : null}
      <FolderDialog state={dialog} onOpenChange={(open) => !open && setDialog(null)} />
    </main>
  );
}

function FolderGroup({ title, folders, onEdit, onDelete }: { title: string; folders: FolderSummary[]; onEdit?: (folder: FolderSummary) => void; onDelete?: (folder: FolderSummary) => void }) {
  return <section className="folder-group"><h2>{title}</h2><div className="folders-grid">{folders.map((folder) => <article className="folder-card" key={folder.id}><Link href={`/projects?folderId=${encodeURIComponent(folder.id)}`}><span className={`folder-icon folder-${folder.color}`}><FolderOpen size={24} /></span><div><strong>{folder.name}</strong><span>{folder.projectCount} {projectWord(folder.projectCount)}</span>{folder.owner?.name ? <small>Владелец: {folder.owner.name}</small> : null}</div></Link>{onEdit && onDelete ? <DropdownMenu><DropdownMenuTrigger asChild><button className="row-menu-trigger" type="button" aria-label={`Действия: ${folder.name}`}><MoreHorizontal size={19} /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => onEdit(folder)}><Pencil size={16} />Изменить</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="danger-menu-item" onSelect={() => onDelete(folder)}><Trash2 size={16} />Удалить</DropdownMenuItem></DropdownMenuContent></DropdownMenu> : null}</article>)}</div></section>;
}

function FolderDialog({ state, onOpenChange }: { state: DialogState; onOpenChange: (open: boolean) => void }) {
  const folder = state && state.type !== "create" ? state.folder : null;
  const [name, setName] = useState("");
  const [color, setColor] = useState<FolderColor>("orange");
  const [error, setError] = useState("");
  const create = useCreateFolder();
  const update = useUpdateFolder(folder?.id || "missing");
  const remove = useDeleteFolder(folder?.id || "missing");
  const busy = create.isPending || update.isPending || remove.isPending;

  useEffect(() => { if (!state) return; setName(folder?.name || ""); setColor(folder?.color || "orange"); setError(""); }, [folder?.color, folder?.name, state]);

  async function submit() {
    setError("");
    try {
      if (state?.type === "create") await create.mutateAsync({ name: name.trim(), color });
      if (state?.type === "edit") await update.mutateAsync({ name: name.trim(), color });
      if (state?.type === "delete") await remove.mutateAsync(undefined);
      onOpenChange(false);
    } catch (cause) { setError(cause instanceof ApiClientError ? cause.message : "Не удалось сохранить папку"); }
  }

  return <Dialog open={Boolean(state)} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{state?.type === "create" ? "Новая папка" : state?.type === "edit" ? "Изменить папку" : "Удалить папку?"}</DialogTitle><DialogDescription>{state?.type === "delete" ? "Презентации останутся и попадут в «Без папки»." : "Название и цвет помогут быстро найти нужные работы."}</DialogDescription></DialogHeader>{state?.type !== "delete" ? <><label className="field"><span>Название</span><input className="input" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus /></label><fieldset className="color-picker"><legend>Цвет</legend>{colors.map((item) => <button className={`color-choice folder-${item}${color === item ? " color-choice-active" : ""}`} type="button" aria-label={colorLabel(item)} aria-pressed={color === item} key={item} onClick={() => setColor(item)} />)}</fieldset></> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="dialog-actions"><button className="ghost" type="button" onClick={() => onOpenChange(false)}>Отмена</button><button className={state?.type === "delete" ? "button button-danger" : "button"} type="button" onClick={() => void submit()} disabled={busy || (state?.type !== "delete" && name.trim().length < 1)}>{busy ? "Сохраняем…" : state?.type === "delete" ? "Удалить папку" : "Сохранить"}</button></div></DialogContent></Dialog>;
}

function projectWord(count: number) { const mod10 = count % 10; const mod100 = count % 100; return mod10 === 1 && mod100 !== 11 ? "презентация" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "презентации" : "презентаций"; }
function colorLabel(color: FolderColor) { return ({ orange: "Оранжевый", green: "Зелёный", purple: "Фиолетовый", blue: "Синий", neutral: "Нейтральный" } as Record<FolderColor, string>)[color]; }
