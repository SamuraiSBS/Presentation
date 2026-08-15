"use client";

import { useMemo, useState } from "react";
import type { ExportType, PresentationDocument, SpeechScriptItem } from "@studydeck/shared";
import { AlertTriangle, Check, CheckCircle2, Clipboard, Download, FileText, LoaderCircle, MoreHorizontal, Presentation, RefreshCw } from "lucide-react";
import {
  ApiClientError,
  isActiveExportStatus,
  useExportJob,
  useProject,
  useRequestExport,
  type ExportItem,
  type ProjectPayload,
} from "@/lib/project-queries";
import { downloadSpeechDocx, speechPlainText } from "@/lib/speech-docx";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { WorkflowProgress } from "@/components/workflow-progress";
import { isStaleExport } from "@/lib/export-revision";
import { DefenseExportCompliance } from "@/components/defense/defense-export-compliance";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConnectionStatus } from "@/components/connection-status";

type ExportProjectPayload = ProjectPayload & {
  presentation?: { document?: PresentationDocument } | null;
};

type ExportWarningState = {
  type: ExportType;
  presentationRevision: number;
  complianceReportId?: string;
  preflightToken?: string;
  issues: Array<{ code?: string; message: string; count?: number }>;
};

export function ExportPanelQuery({ project: initialProject }: { project: ExportProjectPayload }) {
  const projectQuery = useProject(initialProject.id, initialProject);
  const project = (projectQuery.data || initialProject) as ExportProjectPayload;
  const [isCreatingDocx, setIsCreatingDocx] = useState(false);
  const [presentationError, setPresentationError] = useState("");
  const [docxError, setDocxError] = useState("");
  const [downloadNotice, setDownloadNotice] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [exportWarning, setExportWarning] = useState<ExportWarningState | null>(null);
  const requestExport = useRequestExport(project.id);
  const document = project.presentation?.document;
  const speechItems = useMemo(() => speechItemsFromDocument(document), [document]);
  const latestPptx = useMemo(() => (project.exports || []).find((item) => item.type === "pptx"), [project.exports]);
  const latestPdf = useMemo(() => (project.exports || []).find((item) => item.type === "pdf"), [project.exports]);
  const exportJob = useExportJob(project.id, latestPptx && isActiveExportStatus(latestPptx.status) ? latestPptx.id : undefined);
  const pdfExportJob = useExportJob(project.id, latestPdf && isActiveExportStatus(latestPdf.status) ? latestPdf.id : undefined);
  const livePptx = exportJob.data && latestPptx?.id === exportJob.data.id ? exportJob.data : latestPptx;
  const livePdf = pdfExportJob.data && latestPdf?.id === pdfExportJob.data.id ? pdfExportJob.data : latestPdf;
  const pptxPending = isActiveExportStatus(livePptx?.status);
  const pdfPending = isActiveExportStatus(livePdf?.status);
  const pptxStale = isStaleExport(livePptx, project.presentationRevision);
  const pdfStale = isStaleExport(livePdf, project.presentationRevision);
  const allPrimaryFilesReady = livePptx?.status === "ready" && !pptxStale && speechItems.length > 0;

  async function startPptxExport() {
    setPresentationError("");
    try {
      await requestExport.mutateAsync("pptx");
    } catch (cause) {
      handleExportError(cause, "pptx", "Не удалось начать подготовку PPTX. Попробуйте ещё раз.");
    }
  }

  async function startPdfExport() {
    setPresentationError("");
    try {
      await requestExport.mutateAsync("pdf");
    } catch (cause) {
      handleExportError(cause, "pdf", "Не удалось начать подготовку PDF. Попробуйте ещё раз.");
    }
  }

  function handleExportError(cause: unknown, type: ExportType, fallback: string) {
    if (cause instanceof ApiClientError && cause.code === "DEFENSE_EXPORT_WARNING" && cause.details?.requiresAcknowledgement === true) {
      const details = cause.details;
      const issues = Array.isArray(details.issues) ? details.issues.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const value = item as Record<string, unknown>;
        return typeof value.message === "string" ? [{ code: typeof value.code === "string" ? value.code : undefined, message: value.message, count: typeof value.count === "number" ? value.count : undefined }] : [];
      }) : [];
      setExportWarning({
        type,
        presentationRevision: typeof details.presentationRevision === "number" ? details.presentationRevision : project.presentationRevision,
        complianceReportId: typeof details.complianceReportId === "string" ? details.complianceReportId : undefined,
        preflightToken: typeof details.preflightToken === "string" ? details.preflightToken : undefined,
        issues,
      });
      return;
    }
    setPresentationError(cause instanceof ApiClientError ? cause.message : fallback);
  }

  async function confirmWarningExport() {
    if (!exportWarning) return;
    setPresentationError("");
    try {
      await requestExport.mutateAsync({
        type: exportWarning.type,
        acknowledgement: {
          acknowledgeWarnings: true,
          expectedPresentationRevision: exportWarning.presentationRevision,
          ...(exportWarning.complianceReportId ? { complianceReportId: exportWarning.complianceReportId } : {}),
          ...(exportWarning.preflightToken ? { preflightToken: exportWarning.preflightToken } : {}),
        },
      });
      setExportWarning(null);
    } catch (cause) {
      setPresentationError(cause instanceof ApiClientError ? cause.message : "Презентация изменилась. Обновите страницу и повторите экспорт.");
      setExportWarning(null);
    }
  }

  function downloadPresentation(item: ExportItem) {
    setDownloadNotice(`Скачивание ${item.type.toUpperCase()} началось.`);
    window.location.assign(`/api/projects/${project.id}/exports/${item.id}/download`);
  }

  async function copySpeech() {
    if (!speechItems.length) return;
    try {
      const text = speechPlainText(project.title, speechItems);
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const input = window.document.createElement("textarea");
        input.value = text;
        input.style.cssText = "position:fixed;opacity:0";
        window.document.body.appendChild(input);
        input.select();
        window.document.execCommand("copy");
        input.remove();
      }
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2400);
    } catch {
      setCopyState("failed");
    }
  }

  async function saveSpeechDocx() {
    if (!speechItems.length) return;
    setIsCreatingDocx(true);
    setDocxError("");
    try {
      await downloadSpeechDocx(project.title, speechItems);
    } catch {
      setDocxError("Не удалось собрать DOCX. Попробуйте скопировать текст.");
    } finally {
      setIsCreatingDocx(false);
    }
  }

  return (
    <>
      <ConnectionStatus scope="export" onReconnect={() => projectQuery.refetch().then(() => undefined)} />
      <section className="export-workspace" aria-labelledby="export-title">
      <WorkflowProgress current={5} />
      <header className="export-header">
        <span className={`status status-${project.status}`}>{statusLabel(project.status)}</span>
        <h1 className="page-title" id="export-title">{allPrimaryFilesReady ? "Материалы готовы к выступлению" : "Подготовьте файлы для выступления"}</h1>
        <p className="lead">«{project.title}» · {document?.slides.length || 0} слайдов</p>
      </header>

      <Tabs defaultValue="presentation" className="export-tabs">
        <TabsList aria-label="Экспорт">
          <TabsTrigger value="presentation">Презентация</TabsTrigger>
          <TabsTrigger value="speech">Текст выступления</TabsTrigger>
          {project.workflow === "requirements_driven" ? <TabsTrigger value="compliance">Отчёт по ТЗ</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="presentation">
          <div className="export-stage">
            <div className="export-stage-main">
              <StageHeading icon={<Presentation size={28} />} step="PDF + PPTX" title="Скачайте презентацию" description="PPTX можно редактировать, PDF удобно отправить или распечатать." />
              {livePptx && pptxPending ? (
                <div className="export-live-status" role="status" aria-live="polite">
                  <div className="export-live-row">
                    <LoaderCircle className="spin" size={22} aria-hidden="true" />
                    <div>
                      <strong>{livePptx.status === "queued" ? "Экспорт в очереди" : "Собираем PPTX"}</strong>
                      <span>Статус обновляется автоматически.</span>
                    </div>
                  </div>
                  <div className="export-indeterminate" aria-hidden="true"><span /></div>
                </div>
              ) : pptxStale ? (
                <div className="export-warning" role="status"><RefreshCw size={22} aria-hidden="true" /><div><strong>PPTX устарел после правок</strong><span>Соберите новый файл, чтобы он соответствовал текущей версии презентации.</span></div></div>
              ) : livePptx?.status === "ready" ? (
                <div className="export-ready" role="status"><CheckCircle2 size={22} aria-hidden="true" /><div><strong>PPTX готов</strong><span>Файл можно скачать прямо сейчас.</span></div></div>
              ) : livePptx?.status === "failed" ? (
                <div className="export-error" role="alert"><strong>Не получилось подготовить файл</strong><span>Запустите экспорт ещё раз.</span></div>
              ) : null}
              {presentationError ? <p className="form-error" role="alert">{presentationError}</p> : null}
              {downloadNotice ? <p className="muted" role="status">{downloadNotice}</p> : null}
              <div className="export-actions">
                {livePptx?.status === "ready" && !pptxStale ? (
                  <Button className="export-primary-action" data-testid="export-pptx-action" type="button" onClick={() => downloadPresentation(livePptx)}>
                    <Download size={19} aria-hidden="true" />Скачать PPTX
                  </Button>
                ) : (
                  <Button className="export-primary-action" data-testid="export-pptx-action" type="button" onClick={startPptxExport} disabled={requestExport.isPending || pptxPending}>
                    {requestExport.isPending || pptxPending ? <LoaderCircle className="spin" size={19} /> : livePptx?.status === "failed" ? <RefreshCw size={19} /> : <Presentation size={19} />}
                    {pptxPending ? "Готовим PPTX" : pptxStale ? "Собрать актуальный PPTX" : livePptx?.status === "failed" ? "Попробовать ещё раз" : "Подготовить PPTX"}
                  </Button>
                )}
                {livePdf?.status === "ready" && !pdfStale ? (
                  <Button variant="secondary" data-testid="export-pdf-action" type="button" onClick={() => downloadPresentation(livePdf)}>
                    <Download size={19} aria-hidden="true" />Скачать PDF
                  </Button>
                ) : (
                  <Button variant="secondary" data-testid="export-pdf-action" type="button" onClick={startPdfExport} disabled={requestExport.isPending || pdfPending}>
                    {pdfPending ? <LoaderCircle className="spin" size={19} /> : livePdf?.status === "failed" ? <RefreshCw size={19} /> : <FileText size={19} />}
                    {pdfPending ? "Готовим PDF" : pdfStale ? "Собрать актуальный PDF" : livePdf?.status === "failed" ? "Повторить PDF" : "Подготовить PDF"}
                  </Button>
                )}
                <Button variant="secondary" type="button" onClick={saveSpeechDocx} disabled={isCreatingDocx || !speechItems.length}>
                  {isCreatingDocx ? <LoaderCircle className="spin" size={19} /> : <Download size={19} />}
                  {isCreatingDocx ? "Собираем DOCX" : "Скачать DOCX"}
                </Button>
                <Button variant="secondary" type="button" onClick={() => projectQuery.refetch()} disabled={projectQuery.isFetching}>
                  {projectQuery.isFetching ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}
                  Обновить
                </Button>
              </div>
            </div>
            <aside className="export-summary" aria-label="Что входит в файл">
              <h3>В файле</h3>
              <ul>
                <li><Check size={17} /><span><strong>{document?.slides.length || 0} слайдов</strong> в редактируемом формате</span></li>
                <li><Check size={17} /><span><strong>Текст выступления</strong> в заметках к каждому слайду</span></li>
                <li><Check size={17} /><span><strong>Оформление и изображения</strong> из редактора</span></li>
              </ul>
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="speech">
          <div className="export-stage export-speech-stage">
            <div className="export-stage-main">
              <StageHeading icon={<FileText size={28} />} step="DOCX" title="Сохраните текст выступления" description="Тот же текст уже находится в заметках PPTX." speech />
              <div className="export-actions">
                <Button className="export-primary-action" type="button" onClick={saveSpeechDocx} disabled={isCreatingDocx || !speechItems.length}>
                  {isCreatingDocx ? <LoaderCircle className="spin" size={19} /> : <Download size={19} />}
                  {isCreatingDocx ? "Собираем DOCX" : "Скачать DOCX"}
                </Button>
                <TooltipProvider delayDuration={350}>
                  <DropdownMenu>
                    <Tooltip>
                      <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" type="button" size="icon" aria-label="Действия с текстом">
                      <MoreHorizontal size={19} aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent>Действия с текстом</TooltipContent>
                    </Tooltip>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={copySpeech} disabled={!speechItems.length}>
                      <Clipboard size={16} />{copyState === "copied" ? "Текст скопирован" : "Скопировать текст"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={saveSpeechDocx} disabled={isCreatingDocx || !speechItems.length}>
                      <Download size={16} />Скачать DOCX
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                  </DropdownMenu>
                </TooltipProvider>
              </div>
              {copyState === "failed" ? <p className="form-error" role="alert">Не удалось скопировать текст. Скачайте его в DOCX.</p> : null}
              {docxError ? <p className="form-error" role="alert">{docxError}</p> : null}
            </div>
            <aside className="speech-preview" aria-label="Предпросмотр текста выступления">
              <div className="speech-preview-header"><div><h3>Текст по слайдам</h3><p>{speechItems.length} разделов</p></div><FileText size={21} /></div>
              <div className="speech-preview-list">
                {speechItems.map((item) => <article className="speech-preview-item" key={`${item.slideOrder}-${item.slideTitle}`}><span>{item.slideOrder}</span><div><h4>{item.slideTitle}</h4><p>{item.text}</p></div></article>)}
              </div>
            </aside>
          </div>
        </TabsContent>
        {project.workflow === "requirements_driven" ? <TabsContent value="compliance"><DefenseExportCompliance projectId={project.id} presentationRevision={project.presentationRevision} canEdit={project.accessRole !== "viewer"} /></TabsContent> : null}
      </Tabs>
      <Dialog open={Boolean(exportWarning)} onOpenChange={(open) => { if (!open) setExportWarning(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>В презентации остались проблемы</DialogTitle><DialogDescription>Экспорт возможен только после явного подтверждения. Отчёт и версия презентации будут повторно проверены на сервере.</DialogDescription></DialogHeader>
          <div className="defense-export-warning"><AlertTriangle aria-hidden="true" /><div><strong>Проверьте перед скачиванием</strong>{exportWarning?.issues.length ? <ul>{exportWarning.issues.map((issue, index) => <li key={`${issue.code || "issue"}-${index}`}>{issue.message}{issue.count ? ` · ${issue.count}` : ""}</li>)}</ul> : <p>Есть незаполненные данные, нерешённые требования или устаревший отчёт.</p>}</div></div>
          {presentationError ? <p className="form-error" role="alert">{presentationError}</p> : null}
          <div className="ui-dialog-actions"><Button variant="secondary" type="button" onClick={() => setExportWarning(null)}>Вернуться к проверке</Button><Button type="button" onClick={confirmWarningExport} disabled={requestExport.isPending || !exportWarning?.complianceReportId && !exportWarning?.preflightToken}>{requestExport.isPending ? <LoaderCircle className="spin" size={18} /> : <Download size={18} />}Подтвердить экспорт с проблемами</Button></div>
        </DialogContent>
      </Dialog>
      </section>
    </>
  );
}

function StageHeading({ icon, step, title, description, speech = false }: { icon: React.ReactNode; step: string; title: string; description: string; speech?: boolean }) {
  return <div className="export-stage-heading"><span className={`icon-surface icon-surface-large ${speech ? "export-speech-icon" : ""}`}>{icon}</span><div><p className="export-stage-kicker">{step}</p><h2>{title}</h2><p>{description}</p></div></div>;
}

function speechItemsFromDocument(document: PresentationDocument | undefined): SpeechScriptItem[] {
  if (!document) return [];
  return document.slides.map((slide, index) => {
    const script = document.speechScript.find((item) => item.slideOrder === slide.order) || document.speechScript[index];
    return { slideOrder: slide.order, slideTitle: script?.slideTitle || slide.title, text: script?.text || slide.speakerNotes };
  }).filter((item) => item.text.trim()).sort((a, b) => a.slideOrder - b.slideOrder);
}

function statusLabel(status: string) {
  return ({ draft: "Черновик", queued: "В очереди", processing: "Готовим файл", generating: "Готовим презентацию", completed: "Готово", ready: "Готово", failed: "Не получилось" } as Record<string, string>)[status] || "Обновляем статус";
}
