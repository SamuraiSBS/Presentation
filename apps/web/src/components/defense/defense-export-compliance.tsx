"use client";

import { AlertTriangle, CheckCircle2, Download, FileCheck2, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiJson } from "@/lib/project-queries";
import { useDefenseWorkspace, useRequestCompliancePdf, useStartComplianceCheck } from "@/lib/defense-queries";
import { defenseReportIsStale } from "@/lib/defense-ui";
import { useState } from "react";

export function DefenseExportCompliance({ projectId, presentationRevision, canEdit }: { projectId: string; presentationRevision: number; canEdit: boolean }) {
  const defenseQuery = useDefenseWorkspace(projectId);
  const startCheck = useStartComplianceCheck(projectId);
  const requestPdf = useRequestCompliancePdf(projectId);
  const [error, setError] = useState("");
  const data = defenseQuery.data;
  if (!data) return <div className="export-stage-main defense-export-loading" role="status"><LoaderCircle className="spin" /><span>Загружаем отчёты по ТЗ…</span></div>;
  const report = data.reports[0];
  const stale = defenseReportIsStale(report, presentationRevision);
  const pending = report && ["queued", "processing"].includes(report.status);
  const counts = report?.counts;
  const hasProblems = counts ? counts.required.unsatisfied + counts.required.partial + counts.required.needsReview > 0 : false;
  const analysisRevision = data.workspace.analysisRevision;
  const planRevision = data.workspace.planRevision;

  async function runCheck() {
    setError("");
    try {
      await startCheck.mutateAsync({ expectedPresentationRevision: presentationRevision, expectedAnalysisRevision: analysisRevision, expectedPlanRevision: planRevision });
    } catch {
      setError("Не получилось запустить проверку по ТЗ.");
    }
  }

  async function preparePdf() {
    if (!report) return;
    setError("");
    try {
      await requestPdf.mutateAsync({ reportId: report.id, expectedPresentationRevision: report.presentationRevision });
    } catch {
      setError("Не получилось подготовить PDF-отчёт.");
    }
  }

  async function downloadPdf() {
    if (!report) return;
    setError("");
    try {
      const result = await apiJson<{ url: string }>(`/api/projects/${projectId}/defense/compliance-reports/${report.id}/pdf/download-url`);
      window.location.assign(result.url);
    } catch {
      setError("Не получилось получить ссылку на PDF-отчёт.");
    }
  }

  return (
    <div className="defense-export-stage">
      <section className="export-stage-main">
        <div className="export-stage-heading"><span className="icon-surface icon-surface-large defense-report-icon"><ShieldCheck size={28} /></span><div><p className="export-stage-kicker">Отдельный документ</p><h2>Отчёт о соответствии ТЗ</h2><p>Проверка привязана к версии презентации и не смешивается с PDF/PPTX выступления.</p></div></div>
        {!report ? <div className="defense-report-state"><FileCheck2 /><div><strong>Проверка ещё не запускалась</strong><span>Запустите её вручную после финальных правок.</span></div></div> : pending ? <div className="defense-report-state defense-report-state-ai"><LoaderCircle className="spin" /><div><strong>Проверяем презентацию</strong><span>Детерминированные и смысловые проверки выполняются в фоне.</span></div></div> : report.status === "failed" ? <div className="defense-report-state defense-report-state-problem"><AlertTriangle /><div><strong>Отчёт не готов</strong><span>Повторите проверку текущей версии.</span></div></div> : stale ? <div className="defense-report-state defense-report-state-problem"><RefreshCw /><div><strong>Отчёт устарел после правок</strong><span>Изменилась презентация, факты или план. Запустите проверку заново.</span></div></div> : <div className={hasProblems ? "defense-report-state defense-report-state-problem" : "defense-report-state defense-report-state-ok"}>{hasProblems ? <AlertTriangle /> : <CheckCircle2 />}<div><strong>{hasProblems ? "Есть пункты для проверки" : "Обязательные требования выполнены"}</strong><span>Отчёт относится к текущей версии презентации.</span></div></div>}
        {counts ? <div className="defense-report-counts"><ReportCount label="Обязательные" count={counts.required} /><ReportCount label="Рекомендуемые" count={counts.recommended} /><ReportCount label="Пожелания" count={counts.preference} /></div> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="export-actions">{canEdit ? <Button type="button" onClick={runCheck} disabled={startCheck.isPending || Boolean(pending)}>{startCheck.isPending || pending ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}{report ? "Проверить текущую версию" : "Проверить по ТЗ"}</Button> : null}{report?.status === "ready" && !stale ? report.pdfStatus === "ready" ? <Button variant="secondary" type="button" onClick={downloadPdf}><Download size={18} />Скачать PDF-отчёт</Button> : <Button variant="secondary" type="button" onClick={preparePdf} disabled={requestPdf.isPending || report.pdfStatus === "queued" || report.pdfStatus === "processing"}>{requestPdf.isPending || report.pdfStatus === "queued" || report.pdfStatus === "processing" ? <LoaderCircle className="spin" size={18} /> : <Download size={18} />}{report.pdfStatus === "queued" || report.pdfStatus === "processing" ? "Готовим PDF-отчёт" : "Подготовить PDF-отчёт"}</Button> : null}</div>
      </section>
      <aside className="defense-report-history"><h3>История проверок</h3>{data.reports.length ? <ol>{data.reports.map((item, index) => <li key={item.id}><span>{index + 1}</span><div><strong>Версия {item.presentationRevision}</strong><small>{formatReportDate(item.checkedAt)} · {item.status === "ready" ? "готов" : item.status === "failed" ? "ошибка" : "обрабатывается"}</small></div>{!item.stale && item.presentationRevision === presentationRevision ? <em>Текущая</em> : null}</li>)}</ol> : <p>После первой проверки здесь появятся версии отчёта.</p>}</aside>
    </div>
  );
}

function ReportCount({ label, count }: { label: string; count: { total: number; satisfied: number; partial: number; unsatisfied: number; needsReview: number } }) {
  return <div><span>{label}</span><strong>{count.satisfied}/{count.total}</strong><small>{count.unsatisfied ? `${count.unsatisfied} не выполнено` : count.partial || count.needsReview ? `${count.partial + count.needsReview} проверить` : "выполнено"}</small></div>;
}

function formatReportDate(value: string | null) {
  if (!value) return "ещё не завершён";
  try { return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
  catch { return "дата неизвестна"; }
}
