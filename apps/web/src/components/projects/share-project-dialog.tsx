"use client";

import { useState } from "react";
import NextImage from "next/image";
import { Check, Copy, Link2, LoaderCircle, Trash2, UserRound } from "lucide-react";
import type { ProjectMemberRole } from "@/lib/account-types";
import {
  useCreateInvitation,
  useProjectMembers,
  useRemoveMember,
  useRevokeInvitation,
  useUpdateMember,
} from "@/lib/collaboration-queries";
import { ApiClientError } from "@/lib/project-queries";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";

export function ShareProjectDialog({ open, onOpenChange, projectId, projectTitle }: { open: boolean; onOpenChange: (open: boolean) => void; projectId: string; projectTitle: string }) {
  const [role, setRole] = useState<ProjectMemberRole>("viewer");
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const membersQuery = useProjectMembers(projectId, open);
  const createInvitation = useCreateInvitation(projectId);
  const updateMember = useUpdateMember(projectId);
  const removeMember = useRemoveMember(projectId);
  const revokeInvitation = useRevokeInvitation(projectId);

  async function createLink() {
    setError("");
    try {
      const created = await createInvitation.mutateAsync(role);
      const url = `${window.location.origin}/invite/${created.inviteUrlToken}`;
      setInviteUrl(url);
      setCopied(false);
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Не удалось создать ссылку");
    }
  }

  async function copyLink() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="share-dialog">
        <DialogHeader><DialogTitle>Поделиться презентацией</DialogTitle><DialogDescription>«{projectTitle}». Ссылка одноразовая: после принятия она больше не сработает.</DialogDescription></DialogHeader>
        <section className="invite-builder" aria-labelledby="invite-builder-title">
          <div><h3 id="invite-builder-title"><Link2 size={18} />Новая ссылка</h3><p>Выберите, что сможет делать участник.</p></div>
          <div className="invite-controls"><Select className="input" value={role} onValueChange={(value) => setRole(value as ProjectMemberRole)} ariaLabel="Роль по ссылке" options={[{ value: "viewer", label: "Только просмотр и экспорт" }, { value: "editor", label: "Редактирование и экспорт" }]} /><button className="button" type="button" onClick={() => void createLink()} disabled={createInvitation.isPending}>{createInvitation.isPending ? <LoaderCircle className="spin" size={18} /> : <Link2 size={18} />}Создать ссылку</button></div>
          {inviteUrl ? <div className="invite-link"><input value={inviteUrl} readOnly aria-label="Ссылка-приглашение" /><button className="ghost" type="button" onClick={() => void copyLink()}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? "Скопировано" : "Копировать"}</button></div> : null}
        </section>

        <section className="members-section" aria-labelledby="members-title">
          <h3 id="members-title">Участники</h3>
          {membersQuery.isLoading ? <p className="muted">Загружаем участников…</p> : null}
          {membersQuery.data?.members.length ? <div className="members-list">{membersQuery.data.members.map((member) => <div className="member-row" key={member.id}><span className="member-avatar">{member.user.image ? <NextImage src={member.user.image} alt="" width={34} height={34} unoptimized /> : <UserRound size={17} />}</span><div><strong>{member.user.name || "Участник"}</strong><small>{member.user.telegramUsername ? `@${member.user.telegramUsername}` : "Telegram"}</small></div><Select className="member-role-select" ariaLabel={`Роль: ${member.user.name || "участник"}`} value={member.role} onValueChange={(value) => void updateMember.mutateAsync({ memberId: member.id, role: value as ProjectMemberRole })} options={[{ value: "viewer", label: "Просмотр" }, { value: "editor", label: "Редактор" }]} /><button className="icon danger-icon" type="button" aria-label="Отозвать доступ" onClick={() => void removeMember.mutateAsync(member.id)}><Trash2 size={16} /></button></div>)}</div> : !membersQuery.isLoading ? <p className="muted">Пока доступ есть только у вас.</p> : null}
          {membersQuery.data?.invitations?.length ? <div className="active-invites"><h4>Активные ссылки</h4>{membersQuery.data.invitations.map((invitation) => <div key={invitation.id}><span>{invitation.role === "editor" ? "Редактор" : "Просмотр"} · до {new Date(invitation.expiresAt).toLocaleString("ru-RU")}</span><button type="button" onClick={() => void revokeInvitation.mutateAsync(invitation.id)}>Отозвать</button></div>)}</div> : null}
        </section>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
