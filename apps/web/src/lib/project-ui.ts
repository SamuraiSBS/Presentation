import type { ProjectAccessRole, UsageSummary } from "@/lib/account-types";

export function projectStatusLabel(status: string) {
  return ({
    draft: "Черновик",
    uploading: "Загрузка файлов",
    script_queued: "Текст в очереди",
    script_generating: "Готовим текст",
    script_ready: "Текст готов",
    queued: "В очереди",
    generating: "Собираем презентацию",
    ready: "Готово",
    failed: "Нужно повторить",
  } as Record<string, string>)[status] || "Обновляем";
}

export function accessRoleLabel(role: ProjectAccessRole) {
  return role === "owner" ? "Владелец" : role === "editor" ? "Редактор" : "Только просмотр";
}

export function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(date);
}

export function formatResetDate(usage: UsageSummary) {
  const date = new Date(usage.resetsAt);
  if (Number.isNaN(date.valueOf())) return "в следующем месяце";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" }).format(date);
}

export function usagePercent(usage: UsageSummary) {
  if (usage.limit <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((usage.used / usage.limit) * 100)));
}
