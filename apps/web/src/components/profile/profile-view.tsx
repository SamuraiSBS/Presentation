"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { CalendarDays, LogOut, ShieldCheck, Tags, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import type { ProfileSummary } from "@/lib/account-types";
import { useProfile } from "@/lib/dashboard-queries";
import { ApiClientError, apiJson } from "@/lib/project-queries";
import { planLabel } from "@/lib/project-ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function ProfileView({ initialProfile }: { initialProfile: ProfileSummary }) {
  const { data: profile = initialProfile } = useProfile(initialProfile);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const joined = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" }).format(new Date(profile.createdAt));
  return (
    <main className="page account-page profile-page">
      <header className="account-page-header"><div><p className="account-kicker">Аккаунт</p><h1 className="page-title">Профиль</h1><p className="lead">Данные Telegram и настройки личного кабинета.</p></div></header>
      <section className="profile-card">
        <div className="profile-avatar">{profile.image ? <img src={profile.image} alt="" referrerPolicy="no-referrer" /> : <UserRound size={34} />}</div>
        <div className="profile-identity"><h2>{profile.name || "Пользователь StudyDeck"}</h2><p>{profile.telegramUsername ? `@${profile.telegramUsername}` : "Имя пользователя Telegram не указано"}</p></div>
        <dl className="profile-facts"><div><dt><CalendarDays size={17} />В StudyDeck с</dt><dd>{joined}</dd></div><div><dt><ShieldCheck size={17} />Вход</dt><dd>Telegram</dd></div></dl>
      </section>
      <section className="profile-plan"><div><span className="icon-surface"><Tags size={22} /></span><div><p className="account-kicker">Текущий тариф</p><h2>{planLabel(profile.usage.planCode)}</h2><p>{profile.usage.limit} презентаций в месяц, папки, совместная работа, PDF и PPTX.</p></div></div><Link className="ghost" href="/pricing">Подробнее о тарифе</Link></section>
      <section className="profile-actions"><h2>Действия</h2><button className="ghost" type="button" onClick={() => void signOut({ callbackUrl: "/" })}><LogOut size={18} />Выйти из аккаунта</button></section>
      <section className="danger-zone"><div><h2>Удаление аккаунта</h2><p>Проекты, материалы, приглашения и готовые файлы будут удалены без возможности восстановления.</p></div><button className="ghost danger-button" type="button" onClick={() => setDeleteOpen(true)}><Trash2 size={18} />Удалить аккаунт</button></section>
      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
    </main>
  );
}

function DeleteAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    setBusy(true); setError("");
    try { await apiJson<unknown>("/api/users/me", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation }) }); await signOut({ callbackUrl: "/" }); }
    catch (cause) { setError(cause instanceof ApiClientError ? cause.message : "Не удалось удалить аккаунт"); setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) { setConfirmation(""); setError(""); } }}><DialogContent><DialogHeader><DialogTitle>Удалить аккаунт безвозвратно?</DialogTitle><DialogDescription>Введите «УДАЛИТЬ», чтобы подтвердить удаление всех данных.</DialogDescription></DialogHeader><label className="field"><span>Подтверждение</span><input className="input" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="dialog-actions"><button className="ghost" type="button" onClick={() => onOpenChange(false)}>Отмена</button><button className="button button-danger" type="button" onClick={() => void remove()} disabled={busy || confirmation !== "УДАЛИТЬ"}>{busy ? "Удаляем…" : "Удалить аккаунт"}</button></div></DialogContent></Dialog>;
}
