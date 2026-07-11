"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Folder, Gauge, Plus, Presentation, UserRound } from "lucide-react";

const items = [
  { href: "/dashboard", label: "Обзор", icon: Gauge },
  { href: "/projects", label: "Презентации", icon: Presentation },
  { href: "/new", label: "Создать", icon: Plus, primary: true },
  { href: "/folders", label: "Папки", icon: Folder },
  { href: "/profile", label: "Профиль", icon: UserRound },
];

export function MobileBottomNav() {
  const pathname = usePathname();
  return (
    <nav className="mobile-bottom-nav" aria-label="Мобильная навигация">
      <div className="mobile-bottom-nav-inner">
        {items.map(({ href, label, icon: Icon, primary }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              className={`mobile-nav-item${active ? " mobile-nav-item-active" : ""}${primary ? " mobile-nav-item-primary" : ""}`}
              href={href}
              key={href}
              aria-current={active ? "page" : undefined}
            >
              <Icon aria-hidden="true" size={21} strokeWidth={2.3} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
