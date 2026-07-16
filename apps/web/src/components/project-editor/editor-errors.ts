import type { CanvasElement } from "@studydeck/shared";

export function elementLabel(element: CanvasElement) {
  if (element.type === "text") return "Текст";
  if (element.type === "image") return "Изображение";
  return "Фигура";
}

export function projectStatusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "Черновик",
    uploading: "Загрузка файлов",
    script_queued: "Текст в очереди",
    script_generating: "Готовим текст",
    script_ready: "Текст готов",
    queued: "В очереди",
    generating: "Собираем презентацию",
    ready: "Готово",
    failed: "Нужно повторить",
  };
  return labels[status] || "Обновляем статус";
}

export function editorError(error: unknown, fallback: string) {
  if (
    error instanceof Error &&
    /[А-Яа-яЁё]/.test(error.message) &&
    !/<[^>]+>|\b(?:error|failed|invalid|internal)\b/i.test(error.message)
  ) {
    return error.message;
  }
  return fallback;
}
