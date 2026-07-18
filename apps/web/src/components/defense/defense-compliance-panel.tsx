"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock3, FileWarning, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import type { Slide } from "@studydeck/shared";
import { Button } from "@/components/ui/button";
import { useDefenseWorkspace, useStartComplianceCheck } from "@/lib/defense-queries";
import { defenseReportIsStale, formatDefenseDuration } from "@/lib/defense-ui";
import { ApiClientError } from "@/lib/project-queries";
import { useState } from "react";

export function DefenseCompliancePanel({ projectId, presentationRevision, slides, canEdit, onSelectSlide }: { projectId: string; presentationRevision: number; slides: Slide[]; canEdit: boolean; onSelectSlide: (index: number) => void }) {
  const defenseQuery = useDefenseWorkspace(projectId);
  const startCheck = useStartComplianceCheck(projectId);
  const [error, setError] = useState("");
  const data = defenseQuery.data;
  if (!data) return <div className="defense-compliance-panel defense-compliance-loading" role="status"><LoaderCircle className="spin" size={18} /><span>Загружаем состояние ТЗ…</span></div>;

  const report = data.reports[0];
  const stale = defenseReportIsStale(report, presentationRevision);
  const placeholders = slides.flatMap((slide, index) => (slide.placeholders || []).filter((item) => !item.resolved).map((item) => ({ ...item, slideIndex: index, slideTitle: slide.title })));
  const timing = slides.reduce((total, slide) => total + (slide.timingSeconds || 0), 0);
  const timingOver = timing > data.workspace.targetDurationSeconds;
  const reportPending = report && ["queued", "processing"].includes(report.status);
  const analysisRevision = data.workspace.analysisRevision;
  const planRevision = data.workspace.planRevision;

  async function check() {
    setError("");
    try {
      await startCheck.mutateAsync({
        expectedPresentationRevision: presentationRevision,
        expectedAnalysisRevision: analysisRevision,
        expectedPlanRevision: planRevision,
      });
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Не получилось запустить проверку по ТЗ.");
    }
  }

  return (
    <section className="defense-compliance-panel" aria-labelledby="defense-compliance-title">
      <div className="defense-compliance-heading">
        <ShieldCheck aria-hidden="true" />
        <div><h2 id="defense-compliance-title">Соответствие ТЗ</h2><p>{reportPending ? "Проверяем текущую версию презентации" : stale ? "Отчёт устарел после правок" : report?.status === "ready" ? "Есть актуальный отчёт" : "Проверка запускается только вручную"}</p></div>
      </div>
      <div className="defense-compliance-signals">
        <span data-state={placeholders.length ? "warning" : "ok"}><FileWarning size={15} />{placeholders.length} заполнителей</span>
        <span data-state={timingOver ? "warning" : "ok"}><Clock3 size={15} />{formatDefenseDuration(timing)} / {formatDefenseDuration(data.workspace.targetDurationSeconds)}</span>
        {report ? <span data-state={stale ? "warning" : report.status === "ready" ? "ok" : "ai"}>{stale ? <RefreshCw size={15} /> : report.status === "ready" ? <CheckCircle2 size={15} /> : <LoaderCircle className={reportPending ? "spin" : ""} size={15} />}{stale ? "Отчёт устарел" : report.status === "ready" ? "Отчёт актуален" : "Отчёт готовится"}</span> : null}
      </div>
      {placeholders.length ? <div className="defense-placeholder-links" aria-label="Незаполненные данные">{placeholders.slice(0, 3).map((item) => <button type="button" key={`${item.slideIndex}-${item.id}`} onClick={() => onSelectSlide(item.slideIndex)}><span>Слайд {item.slideIndex + 1}</span><strong>{item.label}</strong><ChevronRight size={15} /></button>)}</div> : null}
      {timingOver ? <p className="defense-compliance-warning"><AlertTriangle size={16} />Тайминг превышен на {formatDefenseDuration(timing - data.workspace.targetDurationSeconds)}.</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="defense-compliance-actions"><Button variant="secondary" size="sm" asChild><Link href={`/projects/${projectId}/defense/review`}>Требования</Link></Button>{report ? <Button variant="secondary" size="sm" asChild><Link href={`/projects/${projectId}/export`}>История отчётов</Link></Button> : null}{canEdit ? <Button size="sm" type="button" onClick={check} disabled={startCheck.isPending || Boolean(reportPending)}>{startCheck.isPending || reportPending ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}{reportPending ? "Проверяем…" : stale || report ? "Проверить заново" : "Проверить по ТЗ"}</Button> : null}</div>
    </section>
  );
}
