"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  Folder,
  Gauge,
  GraduationCap,
  LogOut,
  Plus,
  Presentation,
  Tags,
  UserRound,
  ShieldCheck,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const links = [
  { href: "/dashboard", label: "Обзор", icon: Gauge },
  { href: "/projects", label: "Презентации", icon: Presentation },
  { href: "/folders", label: "Папки", icon: Folder },
  { href: "/pricing", label: "Тариф", icon: Tags },
];

export function AppHeader({ adminAvailable = false }: { adminAvailable?: boolean }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const userName = session?.user?.name || "Профиль";
  const initials = userName === "Профиль" ? "Я" : userName.trim().slice(0, 1).toUpperCase();

  return (
    <header className="topbar">
      <Link className="brand" href={session ? "/dashboard" : "/"}>
        <span className="mark"><GraduationCap aria-hidden="true" size={22} /></span>
        <span>StudyDeck AI</span>
      </Link>
      <nav className="nav" aria-label="Основная навигация">
        {links.map(({ href, label, icon: Icon }) => (
          <Link className={isActive(pathname, href) ? "nav-link nav-link-active" : "nav-link"} href={href} key={href} aria-current={isActive(pathname, href) ? "page" : undefined}>
            <Icon aria-hidden="true" size={17} />{label}
          </Link>
        ))}
      </nav>
      <div className="actions header-actions">
        <Link className="button header-create" href="/new"><Plus aria-hidden="true" size={18} />Создать</Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="account-trigger" type="button" aria-label="Открыть меню профиля">
              {session?.user?.image ? <img src={session.user.image} alt="" referrerPolicy="no-referrer" /> : <span>{initials}</span>}
              <strong>{userName}</strong>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="account-menu">
            <DropdownMenuLabel>{userName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link href="/profile"><UserRound size={16} />Профиль</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link href="/pricing"><Tags size={16} />Тариф</Link></DropdownMenuItem>
            {adminAvailable ? <DropdownMenuItem asChild><Link href="/admin"><ShieldCheck size={16} />Админка</Link></DropdownMenuItem> : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOut({ callbackUrl: "/" })}><LogOut size={16} />Выйти</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
