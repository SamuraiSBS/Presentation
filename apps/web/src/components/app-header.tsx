"use client";

import Link from "next/link";
import NextImage from "next/image";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "@studydeck/auth/react";
import {
  Folder,
  Gauge,
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
import { WorkflowProgress } from "@/components/workflow-progress";

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
  const isPresentationEditor = /^\/projects\/[^/]+\/editor\/?$/.test(pathname);

  return (
    <header className="topbar">
      <div className="topbar-main">
        <Link className="brand" href={session ? "/dashboard" : "/"}>
          <span>Lazyum</span>
        </Link>
        <div className="topbar-navigation">
          <nav className="nav" aria-label="Основная навигация">
            {links.map(({ href, label, icon: Icon }) => (
              <Link className={isActive(pathname, href) ? "nav-link nav-link-active" : "nav-link"} href={href} key={href} aria-current={isActive(pathname, href) ? "page" : undefined}>
                <Icon aria-hidden="true" size={17} />{label}
              </Link>
            ))}
          </nav>
          {isPresentationEditor ? <WorkflowProgress current={4} /> : null}
        </div>
        <div className="actions header-actions">
          <Link className="button header-create" href="/new"><Plus aria-hidden="true" size={18} />Создать</Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="account-trigger" type="button" aria-label="Открыть меню профиля">
                {session?.user?.image ? <NextImage className="account-avatar" src={session.user.image} alt="" width={34} height={34} unoptimized referrerPolicy="no-referrer" /> : <span>{initials}</span>}
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
      </div>
    </header>
  );
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
