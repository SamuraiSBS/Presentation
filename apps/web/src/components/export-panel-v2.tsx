"use client";

import { useEffect, useMemo, useState } from "react";
import type { PresentationDocument, SpeechScriptItem } from "@studydeck/shared";
import { Check, CheckCircle2, Clipboard, Download, FileText, LoaderCircle, Presentation, RefreshCw } from "lucide-react";
import { downloadSpeechDocx, speechPlainText } from "@/lib/speech-docx";

type ExportItem = { id: string; type: string; status: string; objectKey?: string | null; error?: string | null };
type ProjectPayload = {
  id: string;
  title: string;
  status: string;
  exports?: ExportItem[];
  presentation?: { document?: PresentationDocument } | null;
};

export function ExportPanelV2({ project }: { project: ProjectPayload }) {
  const [exports, setExports] = useState(project.exports || []);
  const [activeStep, setActiveStep] = useState<1 | 2>(1);
  const [isRequesting, setIsRequesting] = useState(false);
  const [isCreatingDocx, setIsCreatingDocx] = useState(false);
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const document = project.presentation?.document;
  const speechItems = useMemo(() => speechItemsFromDocument(document), [document]);
  const pendingIds = exports.filter((item) => item.type === "pptx" && isPending(item.status)).map((item) => item.id).join(",");
  const latestPptx = exports.find((item) => item.type === "pptx");

  useEffect(() => {
    if (!pendingIds) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refreshPendingExports() {
      const updates = await Promise.all(pendingIds.split(",").filter(Boolean).map(async (id) => {
        try {
          const response = await fetch(`/api/projects/${project.id}/exports/${id}`, { cache: "no-store" });
          return response.ok ? await response.json() as ExportItem : null;
        } catch {
          return null;
        }
      }));
      if (cancelled) return;
      const byId = new Map(updates.filter((item): item is ExportItem => Boolean(item)).map((item) => [item.id, item]));
      setExports((current) => current.map((item) => byId.get(item.id) || item));
      if (updates.some((item) => !item || isPending(item.status))) timer = setTimeout(refreshPendingExports, 1500);
    }

    timer = setTimeout(refreshPendingExports, 700);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pendingIds, project.id]);

  async function requestExport() {
    setIsRequesting(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${project.id}/exports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "pptx" }),
      });
      if (!response.ok) throw new Error(await response.text());
      const created = await response.json() as ExportItem;
      setExports((current) => [created, ...current]);
    } catch {
      setError("Не удалось начать подготовку PPTX. Попробуйте ещё раз.");
    } finally {
      setIsRequesting(false);
    }
  }

  function downloadPresentation(item: ExportItem) {
    setActiveStep(2);
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
        <p className="lead">«{project.title}» · {document?.slides.length || 0} слайдов. Сначала скачайте презентацию, затем сохраните текст выступления.</p>
      </header>

      <nav className="export-steps" aria-label="Шаги экспорта">
        <StepButton number={1} title="Презентация" detail="Файл PPTX" active={activeStep === 1} complete={latestPptx?.status === "ready"} onClick={() => setActiveStep(1)} />
        <span className="export-step-connector" aria-hidden="true" />
        <StepButton number={2} title="Текст выступления" detail="DOCX или копирование" active={activeStep === 2} onClick={() => setActiveStep(2)} />
      </nav>

      {activeStep === 1 ? (
        <div className="export-stage">
          <div className="export-stage-main">
            <StageHeading icon={<Presentation size={28} />} step="Шаг 1 из 2" title="Скачайте презентацию" description="PPTX откроется в PowerPoint, Keynote и других редакторах." />
            {latestPptx && isPending(latestPptx.status) ? (
              <div className="export-live-status" role="status" aria-live="polite">
                <div className="export-live-row"><LoaderCircle className="spin" size={22} aria-hidden="true" /><div><strong>{latestPptx.status === "queued" ? "Экспорт в очереди" : "Собираем PPTX"}</strong><span>Статус обновляется автоматически — перезагружать страницу не нужно.</span></div></div>
                <div className="export-progress" aria-hidden="true"><span /></div>
              </div>
            ) : latestPptx?.status === "ready" ? (
              <div className="export-ready" role="status"><CheckCircle2 size={22} aria-hidden="true" /><div><strong>PPTX готов</strong><span>Файл можно скачать прямо сейчас.</span></div></div>
            ) : latestPptx?.status === "failed" ? (
              <div className="export-error" role="alert"><strong>Не получилось подготовить файл</strong><span>Запустите экспорт ещё раз — изменения в презентации сохранятся.</span></div>
            ) : null}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <div className="export-actions">
              {latestPptx?.status === "ready" ? (
                <button className="button export-primary-action" type="button" onClick={() => downloadPresentation(latestPptx)}><Download size={19} aria-hidden="true" />Скачать PPTX</button>
              ) : (
                <button className="button export-primary-action" type="button" onClick={requestExport} disabled={isRequesting || Boolean(latestPptx && isPending(latestPptx.status))}>
                  {isRequesting || (latestPptx && isPending(latestPptx.status)) ? <LoaderCircle className="spin" size={19} /> : latestPptx?.status === "failed" ? <RefreshCw size={19} /> : <Presentation size={19} />}
                  {latestPptx && isPending(latestPptx.status) ? "Готовим PPTX" : latestPptx?.status === "failed" ? "Попробовать ещё раз" : "Подготовить PPTX"}
                </button>
              )}
              <button className="ghost" type="button" onClick={() => setActiveStep(2)}>Перейти к тексту</button>
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
      ) : (
        <div className="export-stage export-speech-stage">
          <div className="export-stage-main">
            <StageHeading icon={<FileText size={28} />} step="Шаг 2 из 2" title="Сохраните текст выступления" description="Тот же текст уже находится в заметках PPTX. Здесь его можно сохранить отдельно." speech />
            <div className="export-actions">
              <button className="button export-primary-action" type="button" onClick={saveSpeechDocx} disabled={isCreatingDocx || !speechItems.length}>{isCreatingDocx ? <LoaderCircle className="spin" size={19} /> : <Download size={19} />}{isCreatingDocx ? "Собираем DOCX" : "Скачать DOCX"}</button>
              <button className="ghost" type="button" onClick={copySpeech} disabled={!speechItems.length}>{copyState === "copied" ? <Check size={18} /> : <Clipboard size={18} />}{copyState === "copied" ? "Текст скопирован" : "Скопировать текст"}</button>
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
      )}
    </section>
  );
}

function StepButton({ number, title, detail, active, complete = false, onClick }: { number: number; title: string; detail: string; active: boolean; complete?: boolean; onClick: () => void }) {
  return <button className={`export-step ${active ? "export-step-active" : ""}`} type="button" onClick={onClick} aria-current={active ? "step" : undefined}><span>{complete ? <Check size={16} /> : number}</span><span><strong>{title}</strong><small>{detail}</small></span></button>;
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

function isPending(status: string) { return status === "queued" || status === "processing"; }
function statusLabel(status: string) {
  return ({ draft: "Черновик", queued: "В очереди", processing: "Готовим файл", generating: "Готовим презентацию", completed: "Готово", ready: "Готово", failed: "Не получилось" } as Record<string, string>)[status] || "Обновляем статус";
}
