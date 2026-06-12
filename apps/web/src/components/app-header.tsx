import Link from "next/link";
import { getAuthSession } from "@/lib/auth";
import { SignOutButton } from "./sign-out-button";

export async function AppHeader() {
  const session = await getAuthSession();

  return (
    <header className="topbar">
      <Link className="brand" href="/">
        <span className="mark">S</span>
        <span>StudyDeck AI</span>
      </Link>
      <nav className="nav" aria-label="Основная навигация">
        <Link href="/dashboard">Проекты</Link>
        <Link href="/new">Создать</Link>
        <Link href="/pricing">Тарифы</Link>
      </nav>
      <div className="actions">
        {session?.user ? (
          <>
            <Link className="ghost" href="/dashboard">Кабинет</Link>
            <SignOutButton />
          </>
        ) : (
          <>
            <Link className="ghost" href="/sign-in">Войти</Link>
            <Link className="button" href="/new">Начать</Link>
          </>
        )}
      </div>
    </header>
  );
}
