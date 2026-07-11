"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock3, Eye, LoaderCircle, Pencil, UserRound, XCircle } from "lucide-react";
import type { InvitationPreview } from "@/lib/account-types";
import { useAcceptInvitation, useInvitationPreview } from "@/lib/collaboration-queries";
import { ApiClientError } from "@/lib/project-queries";
import { useState } from "react";

export function InvitationView({ initialPreview, token }: { initialPreview: InvitationPreview; token: string }) {
  const router = useRouter();
  const previewQuery = useInvitationPreview(token, initialPreview);
  const accept = useAcceptInvitation(token);
  const [error, setError] = useState("");
  const preview = previewQuery.data || initialPreview;

  if (preview.status && preview.status !== "active") {
    const copy = ({ expired: ["Срок приглашения истёк", "Попросите владельца создать новую ссылку."], used: ["Ссылка уже использована", "Одноразовое приглашение больше не действует."], revoked: ["Приглашение отозвано", "Владелец проекта отключил эту ссылку."] } as Record<string, string[]>)[preview.status];
    return <main className="page invite-page"><section className="panel invitation-card invitation-unavailable"><XCircle size={34} /><h1>{copy?.[0] || "Приглашение недоступно"}</h1><p>{copy?.[1]}</p><Link className="button" href="/dashboard">Перейти в кабинет</Link></section></main>;
  }

  async function acceptInvite() {
    setError("");
    try { const result = await accept.mutateAsync(); router.push(`/projects/${result.projectId}/editor`); }
    catch (cause) { setError(cause instanceof ApiClientError ? cause.message : "Не удалось принять приглашение"); }
  }

  return <main className="page invite-page"><section className="panel invitation-card"><span className="invitation-icon"><CheckCircle2 size={30} /></span><p className="account-kicker">Вас пригласили в проект</p><h1>{preview.projectTitle}</h1><div className="invitation-owner"><span>{preview.owner.image ? <img src={preview.owner.image} alt="" /> : <UserRound size={20} />}</span><div><small>Владелец</small><strong>{preview.owner.name || "Пользователь StudyDeck"}</strong></div></div><div className="invitation-role">{preview.role === "editor" ? <Pencil size={19} /> : <Eye size={19} />}<div><strong>{preview.role === "editor" ? "Можно редактировать" : "Только просмотр"}</strong><span>Экспорт PDF и PPTX доступен в обеих ролях.</span></div></div>{preview.expiresAt ? <p className="invitation-expiry"><Clock3 size={16} />Ссылка действует до {new Date(preview.expiresAt).toLocaleString("ru-RU")}</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button invitation-accept" type="button" onClick={() => void acceptInvite()} disabled={accept.isPending}>{accept.isPending ? <LoaderCircle className="spin" size={18} /> : <CheckCircle2 size={18} />}{accept.isPending ? "Принимаем…" : "Принять приглашение"}</button></section></main>;
}
