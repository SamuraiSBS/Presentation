"use client";

import { useMemo, useState } from "react";
import type { PresentationDocument, SpeechScriptItem } from "@studydeck/shared";
import { Check, CheckCircle2, Clipboard, Download, FileText, LoaderCircle, MoreHorizontal, Presentation, RefreshCw } from "lucide-react";
import {
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
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ExportProjectPayload = ProjectPayload & {
  presentation?: { document?: PresentationDocument } | null;
};

export function ExportPanelQuery({ project: initialProject }: { project: ExportProjectPayload }) {
  const projectQuery = useProject(initialProject.id, initialProject);
  const project = (projectQuery.data || initialProject) as ExportProjectPayload;
  const [isCreatingDocx, setIsCreatingDocx] = useState(false);
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const requestExport = useRequestExport(project.id);
  const document = project.presentation?.document;
  const speechItems = useMemo(() => speechItemsFromDocument(document), [document]);
  const latestPptx = useMemo(() => (project.exports || []).find((item) => item.type === "pptx"), [project.exports]);
  const exportJob = useExportJob(project.id, latestPptx && isActiveExportStatus(latestPptx.status) ? latestPptx.id : undefined);
  const livePptx = exportJob.data && latestPptx?.id === exportJob.data.id ? exportJob.data : latestPptx;
  const pptxPending = isActiveExportStatus(livePptx?.status);

  async function startPptxExport() {
    setError("");
    try {
      await requestExport.mutateAsync("pptx");
    } catch {
      setError("Не удалось начать подготовку PPTX. Попробуйте ещё раз.");
    }
  }

  function downloadPresentation(item: ExportItem) {
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
    setError("");
    try {
      await downloadSpeechDocx(project.title, speechItems);
    } catch {
      setError("Не удалось собрать DOCX. Попробуйте скопировать текст.");
    } finally {
      setIsCreatingDocx(false);
    }
  }

  return (
    <section className="export-workspace" aria-labelledby="export-title">
      <header className="export-header">
        <span className={`status status-${project.status}`}>{statusLabel(project.status)}</span>
        <h1 className="page-title" id="export-title">Всё готово к выступлению</h1>
        <p className="lead">«{project.title}» · {document?.slides.length || 0} слайдов</p>
      </header>

      <Tabs defaultValue="presentation" className="export-tabs">
        <TabsList aria-label="Экспорт">
          <TabsTrigger value="presentation">Презентация</TabsTrigger>
          <TabsTrigger value="speech">Текст выступления</TabsTrigger>
        </TabsList>

        <TabsContent value="presentation">
          <div className="export-stage">
            <div className="export-stage-main">
              <StageHeading icon={<Presentation size={28} />} step="PPTX" title="Скачайте презентацию" description="Файл откроется в PowerPoint, Keynote и других редакторах." />
              {livePptx && pptxPending ? (
                <div className="export-live-status" role="status" aria-live="polite">
                  <div className="export-live-row">
                    <LoaderCircle className="spin" size={22} aria-hidden="true" />
                    <div>
                      <strong>{livePptx.status === "queued" ? "Экспорт в очереди" : "Собираем PPTX"}</strong>
                      <span>Статус обновляется автоматически.</span>
                    </div>
                  </div>
                  <Progress value={livePptx.status === "queued" ? 35 : 72} />
                </div>
              ) : livePptx?.status === "ready" ? (
                <div className="export-ready" role="status"><CheckCircle2 size={22} aria-hidden="true" /><div><strong>PPTX готов</strong><span>Файл можно скачать прямо сейчас.</span></div></div>
              ) : livePptx?.status === "failed" ? (
                <div className="export-error" role="alert"><strong>Не получилось подготовить файл</strong><span>Запустите экспорт ещё раз.</span></div>
              ) : null}
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              <div className="export-actions">
                {livePptx?.status === "ready" ? (
                  <Button className="export-primary-action" type="button" onClick={() => downloadPresentation(livePptx)}>
                    <Download size={19} aria-hidden="true" />Скачать PPTX
                  </Button>
                ) : (
                  <Button className="export-primary-action" type="button" onClick={startPptxExport} disabled={requestExport.isPending || pptxPending}>
                    {requestExport.isPending || pptxPending ? <LoaderCircle className="spin" size={19} /> : livePptx?.status === "failed" ? <RefreshCw size={19} /> : <Presentation size={19} />}
                    {pptxPending ? "Готовим PPTX" : livePptx?.status === "failed" ? "Попробовать ещё раз" : "Подготовить PPTX"}
                  </Button>
                )}
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
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" type="button" size="icon" aria-label="Действия с текстом">
                      <MoreHorizontal size={19} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={copySpeech} disabled={!speechItems.length}>
                      <Clipboard size={16} />{copyState === "copied" ? "Текст скопирован" : "Скопировать текст"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={saveSpeechDocx} disabled={isCreatingDocx || !speechItems.length}>
                      <Download size={16} />Скачать DOCX
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {copyState === "failed" ? <p className="form-error" role="alert">Не удалось скопировать текст. Скачайте его в DOCX.</p> : null}
              {error ? <p className="form-error" role="alert">{error}</p> : null}
            </div>
            <aside className="speech-preview" aria-label="Предпросмотр текста выступления">
              <div className="speech-preview-header"><div><h3>Текст по слайдам</h3><p>{speechItems.length} разделов</p></div><FileText size={21} /></div>
              <div className="speech-preview-list">
                {speechItems.map((item) => <article className="speech-preview-item" key={`${item.slideOrder}-${item.slideTitle}`}><span>{item.slideOrder}</span><div><h4>{item.slideTitle}</h4><p>{item.text}</p></div></article>)}
              </div>
            </aside>
          </div>
        </TabsContent>
      </Tabs>
    </section>
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
