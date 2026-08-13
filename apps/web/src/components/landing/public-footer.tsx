import Link from "next/link";

const links = [
  { href: "/privacy", label: "Конфиденциальность" },
  { href: "/terms", label: "Условия использования" },
  { href: "/support", label: "Поддержка" },
] as const;

export function PublicFooter() {
  return (
    <footer className="public-footer" aria-label="Служебная навигация">
      <div className="public-footer-inner">
        <p>© {new Date().getFullYear()} StudyDeck AI</p>
        <nav aria-label="Юридическая информация и поддержка">
          {links.map((link) => <Link href={link.href} key={link.href}>{link.label}</Link>)}
        </nav>
      </div>
    </footer>
  );
}
