import { complianceReportDocumentSchema, type ComplianceReportDocument } from "@studydeck/shared";
import { renderHtmlToPdf } from "../pdf-renderer.js";

export async function createComplianceReportPdf(input: ComplianceReportDocument) {
  const report = complianceReportDocumentSchema.parse(input);
  return renderHtmlToPdf(renderComplianceReportHtml(report), { format: "A4", viewportWidth: 1240, viewportHeight: 1754 });
}

export function renderComplianceReportHtml(input: ComplianceReportDocument) {
  const report = complianceReportDocumentSchema.parse(input);
  const priorities = [
    ["Обязательные", report.counts.required],
    ["Рекомендуемые", report.counts.recommended],
    ["Пожелания", report.counts.preference],
  ] as const;
  const issueItems = report.items.filter((item) => item.result !== "satisfied" && item.result !== "ignored");

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #3a2109; font-family: "Nunito", "Nunito Variable", "Noto Sans", "DejaVu Sans", sans-serif; font-size: 10.5pt; line-height: 1.45; }
  h1, h2, h3 { margin: 0; color: #3a2109; line-height: 1.15; }
  h1 { font-size: 23pt; }
  h2 { margin-top: 22px; font-size: 15pt; }
  h3 { font-size: 11pt; }
  p { margin: 6px 0; }
  .meta { margin: 12px 0 18px; color: #805c38; }
  .summary { width: 100%; border-collapse: collapse; margin-top: 12px; }
  .summary th, .summary td { border-bottom: 1px solid #efd6b9; padding: 8px 7px; text-align: left; }
  .summary th { background: #fff0dc; font-size: 9pt; }
  .ok { color: #168552; font-weight: 700; }
  .problem { color: #a73822; font-weight: 700; }
  .review { color: #7b3dff; font-weight: 700; }
  .item { break-inside: avoid; margin: 10px 0; border-radius: 10px; padding: 10px 12px; background: #fff8f1; }
  .item[data-result="unsatisfied"] { background: #fff0ec; }
  .item[data-result="needs_review"] { background: #f7f1ff; }
  .item-head { display: flex; justify-content: space-between; gap: 12px; }
  .status { white-space: nowrap; font-size: 9pt; font-weight: 700; }
  ul { margin: 8px 0 0; padding-left: 20px; }
  .muted { color: #805c38; }
  .warning { break-inside: avoid; margin: 8px 0; border-radius: 8px; padding: 9px 11px; background: #fff0ec; color: #7a2416; font-weight: 700; }
  footer { margin-top: 28px; border-top: 1px solid #efd6b9; padding-top: 8px; color: #805c38; font-size: 8.5pt; }
</style>
</head>
<body>
  <h1>Проверка презентации по ТЗ</h1>
  <p class="meta">Версия презентации: ${report.presentationRevision} · Версия анализа: ${report.analysisRevision} · ${escapeHtml(formatDate(report.checkedAt))}</p>
  <table class="summary">
    <thead><tr><th>Группа</th><th>Всего</th><th>Выполнено</th><th>Частично</th><th>Не выполнено</th><th>Проверить</th><th>Исключено</th></tr></thead>
    <tbody>${priorities.map(([label, counts]) => `<tr><td><strong>${label}</strong></td><td>${counts.total}</td><td class="ok">${counts.satisfied}</td><td>${counts.partial}</td><td class="problem">${counts.unsatisfied}</td><td class="review">${counts.needsReview}</td><td>${counts.ignored}</td></tr>`).join("")}</tbody>
  </table>

  ${report.warnings.map((warning) => `<div class="warning">${escapeHtml(warning)}</div>`).join("")}

  <h2>Требования, которым нужно внимание</h2>
  ${issueItems.length ? issueItems.map((item) => `
    <section class="item" data-result="${item.result}">
      <div class="item-head"><h3>${escapeHtml(item.checkKey)}</h3><span class="status ${item.result === "unsatisfied" ? "problem" : "review"}">${escapeHtml(resultLabel(item.result))}</span></div>
      <p>${escapeHtml(item.reason)}</p>
      ${item.evidence.length ? `<ul>${item.evidence.slice(0, 5).map((evidence) => `<li>${evidence.slideOrder ? `Слайд ${evidence.slideOrder}. ` : ""}${escapeHtml(evidence.matchedTextFragment || "Структурная проверка")}</li>`).join("")}</ul>` : ""}
    </section>`).join("") : `<p class="ok">Все активные требования прошли доступные проверки.</p>`}

  <h2>Заполнители и противоречия</h2>
  <p>Незаполненных данных: <strong>${report.placeholders.filter((item) => !item.resolved).length}</strong>. Неразрешённых противоречий: <strong>${report.conflicts.filter((item) => item.state === "unresolved").length}</strong>.</p>
  ${report.placeholders.filter((item) => !item.resolved).slice(0, 30).map((item) => `<div class="item" data-result="unsatisfied"><strong>${escapeHtml(item.label)}</strong><p class="muted">Тип: ${escapeHtml(item.kind)} · Важность: ${escapeHtml(item.severity)}</p></div>`).join("")}
  ${report.conflicts.filter((item) => item.state === "unresolved").slice(0, 20).map((item) => `<div class="item" data-result="unsatisfied"><strong>${escapeHtml(item.summary)}</strong><p class="muted">Противоречие: ${escapeHtml(item.kind)}</p></div>`).join("")}

  <h2>Тайминг</h2>
  ${report.timingOverloads.length ? `<ul>${report.timingOverloads.map((item) => `<li>Слайд ${item.slideOrder}: выделено ${item.allocatedSeconds} сек., оценка ${item.estimatedSeconds} сек. (+${item.overflowSeconds})</li>`).join("")}</ul>` : `<p class="ok">Перегруженных слайдов по оценке чтения не найдено.</p>`}

  <h2>Происхождение материалов</h2>
  <p>Подтверждённых фактов: <strong>${report.factProvenance.length}</strong>. Изображений в отчёте: <strong>${report.imageProvenance.length}</strong>.</p>
  ${report.imageProvenance.length ? `<ul>${report.imageProvenance.slice(0, 40).map((item) => `<li>${escapeHtml(item.label || item.sourceId)} — ${escapeHtml(item.provider)}${item.evidenceRole ? ", доказательный материал" : ""}</li>`).join("")}</ul>` : ""}

  <footer>Lazyum · Отчёт неизменяем и относится только к указанным версиям презентации и анализа.</footer>
</body>
</html>`;
}

function resultLabel(value: string) {
  if (value === "satisfied") return "Выполнено";
  if (value === "partial") return "Частично";
  if (value === "unsatisfied") return "Не выполнено";
  if (value === "ignored") return "Исключено";
  return "Нужно проверить";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(value));
}

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
