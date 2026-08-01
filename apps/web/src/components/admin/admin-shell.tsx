"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, AlertTriangle, Banknote, BellRing, Bot, CircleDollarSign, ClipboardList, LayoutDashboard, Menu, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  const drawerRef = useRef<HTMLElement>(null);
  const period = searchParams.get("period") || "30d";

  useEffect(() => {
    if (!open) return;

    const scrollY = window.scrollY;
    const bodyStyle = document.body.style;
    const main = document.querySelector<HTMLElement>(".admin-main");
    const trigger = document.querySelector<HTMLElement>(".admin-mobile-menu");
    const previous = {
      overflow: bodyStyle.overflow,
      position: bodyStyle.position,
      top: bodyStyle.top,
      width: bodyStyle.width,
    };
    const previousAriaHidden = main?.getAttribute("aria-hidden");
    const previousInert = main?.inert;
    bodyStyle.overflow = "hidden";
    bodyStyle.position = "fixed";
    bodyStyle.top = `-${scrollY}px`;
    bodyStyle.width = "100%";
    if (main) {
      main.setAttribute("aria-hidden", "true");
      main.inert = true;
    }

    const drawer = drawerRef.current;
    const getFocusable = () => Array.from(drawer?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || []);
    const closeButton = drawer?.querySelector<HTMLElement>("button");
    closeButton?.focus();
    const preventBackgroundScroll = (event: Event) => {
      if (drawer?.contains(event.target as Node)) return;
      event.preventDefault();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("wheel", preventBackgroundScroll, { capture: true, passive: false });
    document.addEventListener("touchmove", preventBackgroundScroll, { capture: true, passive: false });

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("wheel", preventBackgroundScroll, true);
      document.removeEventListener("touchmove", preventBackgroundScroll, true);
      bodyStyle.overflow = previous.overflow;
      bodyStyle.position = previous.position;
      bodyStyle.top = previous.top;
      bodyStyle.width = previous.width;
      if (main) {
        if (previousAriaHidden == null) main.removeAttribute("aria-hidden"); else main.setAttribute("aria-hidden", previousAriaHidden);
        main.inert = previousInert ?? false;
      }
      const rootStyle = document.documentElement.style;
      const previousScrollBehavior = rootStyle.scrollBehavior;
      rootStyle.scrollBehavior = "auto";
      trigger?.focus({ preventScroll: true });
      window.scrollTo(0, scrollY);
      requestAnimationFrame(() => {
        window.scrollTo(0, scrollY);
        requestAnimationFrame(() => {
          window.scrollTo(0, scrollY);
          rootStyle.scrollBehavior = previousScrollBehavior;
        });
      });
    };
  }, [open]);

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
      <aside ref={drawerRef} className={open ? "admin-sidebar admin-sidebar-open" : "admin-sidebar"} role={open ? "dialog" : undefined} aria-modal={open || undefined}>
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
