import Link from "next/link";
import { FileText, ShieldCheck } from "lucide-react";

export function CreationModePicker({ active }: { active: "standard" | "defense" }) {
  return (
    <nav className="creation-mode-picker" aria-label="Режим создания презентации">
      <Link
        className={active === "standard" ? "creation-mode-option creation-mode-option-active" : "creation-mode-option"}
        href="/new"
        aria-current={active === "standard" ? "page" : undefined}
      >
        <FileText aria-hidden="true" size={18} />
        <span><strong>Обычная презентация</strong><small>Тема, источники и готовое выступление</small></span>
      </Link>
      <Link
        className={active === "defense" ? "creation-mode-option creation-mode-option-active" : "creation-mode-option"}
        href="/new/defense"
        aria-current={active === "defense" ? "page" : undefined}
      >
        <ShieldCheck aria-hidden="true" size={18} />
        <span><strong>Защита проекта</strong><small>Презентация по ТЗ с проверкой требований</small></span>
      </Link>
    </nav>
  );
}
