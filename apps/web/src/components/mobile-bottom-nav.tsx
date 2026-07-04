"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderKanban, Home, Plus, Tags } from "lucide-react";

const items = [
  { href: "/", label: "Главная", icon: Home },
  { href: "/dashboard", label: "Проекты", icon: FolderKanban },
  { href: "/new", label: "Создать", icon: Plus },
  { href: "/pricing", label: "Тарифы", icon: Tags },
];

export function MobileBottomNav() {
  const pathname = usePathname();
  return (
    <nav className="mobile-bottom-nav" aria-label="Мобильная навигация">
      <div className="mobile-bottom-nav-inner">
        {items.map(({ href, label, icon: Icon }) => {
          const active = href === "/"
            ? pathname === href
            : pathname === href
              || pathname.startsWith(`${href}/`)
              || (href === "/dashboard" && pathname.startsWith("/projects/"));
          return (
            <Link className={active ? "mobile-nav-item mobile-nav-item-active" : "mobile-nav-item"} href={href} key={href} aria-current={active ? "page" : undefined}>
              <Icon aria-hidden="true" size={21} strokeWidth={2.3} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
