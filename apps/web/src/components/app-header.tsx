import Link from "next/link";
import { FolderKanban, GraduationCap, Plus, Sparkles, Tags } from "lucide-react";

export function AppHeader() {
  return (
    <header className="topbar">
      <Link className="brand" href="/">
        <span className="mark"><GraduationCap aria-hidden="true" size={22} /></span>
        <span>StudyDeck AI</span>
      </Link>
      <nav className="nav" aria-label="Основная навигация">
        <Link href="/dashboard"><FolderKanban aria-hidden="true" size={17} />Проекты</Link>
        <Link href="/new"><Sparkles aria-hidden="true" size={17} />Создать</Link>
        <Link href="/pricing"><Tags aria-hidden="true" size={17} />Тарифы</Link>
      </nav>
      <div className="actions">
        <Link className="ghost header-dashboard" href="/dashboard">Мои проекты</Link>
        <Link className="button" href="/new"><Plus aria-hidden="true" size={18} />Создать</Link>
      </div>
    </header>
  );
}
