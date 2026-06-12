import Link from "next/link";

export function AppHeader() {
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
        <Link className="ghost" href="/dashboard">Кабинет</Link>
        <Link className="button" href="/new">Начать</Link>
      </div>
    </header>
  );
}
