"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, AlertTriangle, Banknote, BellRing, Bot, CircleDollarSign, ClipboardList, LayoutDashboard, Menu, Users, X } from "lucide-react";
import { useState } from "react";
import { Select } from "@/components/ui/select";

const links = [
  ["/admin", "Обзор", LayoutDashboard],
  ["/admin/users", "Пользователи", Users],
  ["/admin/revenue", "Выручка", Banknote],
  ["/admin/costs", "Расходы", CircleDollarSign],
  ["/admin/generations", "Генерации", Bot],
  ["/admin/errors", "Ошибки", AlertTriangle],
  ["/admin/logs", "События", Activity],
  ["/admin/audit", "Аудит", ClipboardList],
  ["/admin/alerts", "Уведомления", BellRing],
] as const;

export function AdminShell({ children, localAccess }: { children: React.ReactNode; localAccess: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const period = searchParams.get("period") || "30d";

  function setPeriod(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", value);
    if (value !== "custom") { params.delete("from"); params.delete("to"); }
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="admin-layout">
      <button className="admin-mobile-menu" type="button" onClick={() => setOpen(true)} aria-expanded={open}><Menu size={18} />Разделы</button>
      {open ? <button className="admin-nav-backdrop" aria-label="Закрыть меню" onClick={() => setOpen(false)} /> : null}
      <aside className={open ? "admin-sidebar admin-sidebar-open" : "admin-sidebar"}>
        <div className="admin-sidebar-heading"><div><strong>Управление</strong><span>Московское время</span></div><button type="button" onClick={() => setOpen(false)} aria-label="Закрыть меню"><X size={18} /></button></div>
        <nav aria-label="Навигация админки">{links.map(([href, label, Icon]) => { const active = href === "/admin" ? pathname === href : pathname.startsWith(href); return <Link href={href} key={href} className={active ? "admin-nav-link admin-nav-link-active" : "admin-nav-link"} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}><Icon size={17} />{label}</Link>; })}</nav>
        {localAccess ? <div className="admin-local-banner"><strong>Локальный открытый доступ</strong><span>Telegram ID не проверяется. Не включать этот режим в production.</span></div> : null}
      </aside>
      <main className="admin-main">
        <div className="admin-toolbar">
          <div><span>Период</span><Select className="admin-period-select" value={period} onValueChange={setPeriod} ariaLabel="Период данных" options={[{ value: "today", label: "Сегодня" }, { value: "7d", label: "7 дней" }, { value: "30d", label: "30 дней" }, { value: "month", label: "Текущий месяц" }, { value: "all", label: "Всё время" }]} /></div>
          <time dateTime={new Date().toISOString()}>Europe/Moscow</time>
        </div>
        {children}
      </main>
    </div>
  );
}
