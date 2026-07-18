import type { DefensePlan, DefensePlanSlide, ProjectRequirement } from "@studydeck/shared";
import type { DefenseComplianceReport, DefenseWorkspacePayload } from "@/lib/defense-queries";

export function defenseReviewCounts(data: Pick<DefenseWorkspacePayload, "requirements" | "facts" | "sources" | "conflicts">) {
  return {
    requirements: data.requirements.filter((item) => item.state === "active").length,
    facts: data.facts.filter((item) => item.state === "active").length,
    sources: data.sources.length,
    conflicts: data.conflicts.filter((item) => item.state === "unresolved").length,
  };
}

export function defenseReportIsStale(report: Pick<DefenseComplianceReport, "presentationRevision" | "stale"> | undefined, presentationRevision: number) {
  return Boolean(report && (report.stale || report.presentationRevision !== presentationRevision));
}

export function defensePlanTiming(slides: DefensePlanSlide[]) {
  return slides.reduce((total, slide) => total + slide.timingSeconds, 0);
}

export function reorderDefensePlanSlides(plan: DefensePlan, fromIndex: number, toIndex: number): DefensePlan {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= plan.slides.length || toIndex >= plan.slides.length) return plan;
  const slides = [...plan.slides];
  const [moved] = slides.splice(fromIndex, 1);
  slides.splice(toIndex, 0, moved);
  const ordered = slides.map((slide, index) => ({ ...slide, order: index + 1 }));
  return { ...plan, slides: ordered, totalTimingSeconds: defensePlanTiming(ordered), status: "draft", approvedAt: null };
}

export function requirementLabel(requirement: ProjectRequirement) {
  if (requirement.origin === "builtin") return "Встроенный пресет";
  if (requirement.origin === "user") return "Добавлено пользователем";
  return requirement.locator || "Из загруженного ТЗ";
}

export function formatDefenseDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}:${String(rest).padStart(2, "0")}` : `${minutes} мин`;
}
