import { Check, Eye, LayoutTemplate, Settings2 } from "lucide-react";
import type { MobileEditorSection, SaveStatus } from "./editor-types";

export function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;
  const label =
    status === "saving"
      ? "Сохраняем…"
      : status === "saved"
        ? "Сохранено"
        : "Не удалось сохранить";
  return (
    <span className={`save-indicator save-indicator-${status}`} role="status">
      {status === "saved" ? <Check aria-hidden="true" /> : null}
      {label}
    </span>
  );
}

export function MobileEditorNav({
  section,
  onChange,
}: {
  section: MobileEditorSection;
  onChange: (section: MobileEditorSection) => void;
}) {
  return (
    <nav className="mobile-editor-nav" aria-label="Навигация редактора">
      <button
        className={section === "slides" ? "mobile-editor-nav-active" : ""}
        type="button"
        onClick={() => onChange("slides")}
      >
        <LayoutTemplate aria-hidden="true" />
        Слайды
      </button>
      <button
        className={section === "edit" ? "mobile-editor-nav-active" : ""}
        type="button"
        onClick={() => onChange("edit")}
      >
        <Settings2 aria-hidden="true" />
        Правка
      </button>
      <button
        className={section === "preview" ? "mobile-editor-nav-active" : ""}
        type="button"
        onClick={() => onChange("preview")}
      >
        <Eye aria-hidden="true" />
        Просмотр
      </button>
    </nav>
  );
}
