import Link from "next/link";
import { ArrowUpRight, LayoutDashboard, LogIn } from "lucide-react";

const landingLinks = [
  { href: "#examples", label: "Примеры" },
  { href: "#create", label: "Создать" },
] as const;

export function PublicHeader({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  const accountHref = isAuthenticated ? "/dashboard" : "/login";
  const accountLabel = isAuthenticated ? "Кабинет" : "Войти";

  return (
    <header className="public-header">
      <a className="landing-skip-link" href="#main-content">Перейти к содержанию</a>
      <div className="public-header-inner">
        <Link className="public-header-brand" href="/" aria-label="Lazyum — на главную">
          <span>Lazyum</span>
        </Link>

        <nav className="public-header-nav" aria-label="Навигация по лендингу">
          {landingLinks.map((link) => (
            <Link className="public-header-nav-link" href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="public-header-actions">
          <Link
            className="public-header-account"
            href={accountHref}
            aria-label={isAuthenticated ? "Открыть личный кабинет" : "Войти в личный кабинет"}
          >
            {isAuthenticated ? <LayoutDashboard aria-hidden="true" size={18} /> : <LogIn aria-hidden="true" size={18} />}
            <span>{accountLabel}</span>
          </Link>
          <Link className="button public-header-cta" href="/new" aria-label="Создать презентацию за 5 минут">
            <span className="public-header-cta-label">Создать за 5 минут</span>
            <ArrowUpRight aria-hidden="true" size={18} />
          </Link>
        </div>
      </div>
    </header>
  );
}
