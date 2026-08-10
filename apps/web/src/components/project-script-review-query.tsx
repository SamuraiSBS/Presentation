"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, LoaderCircle, RefreshCw, Rocket, Save, ShieldCheck } from "lucide-react";
import {
  useAcceptSpeechAndGenerate,
  useGenerationJob,
  useSaveSpeechDraft,
  useStartNarration,
  useUpdateSourceReview,
  type ProjectPayload,
} from "@/lib/project-queries";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { WorkflowProgress } from "@/components/workflow-progress";
import { parseSpeechDraft, serializeSpeechSections, type SpeechSection } from "@/lib/speech-review";
import { RUSSIAN_STUDENT_SPEECH_WORDS_PER_MINUTE } from "@studydeck/shared";
import { narrationFailureUi, narrationReviewMode } from "@/lib/narration-failure-ui";

export function ProjectScriptReviewQuery({ initialProject }: { initialProject: ProjectPayload }) {
  const projectQuery = useGenerationJob(initialProject.id, initialProject);
  const project = projectQuery.data || initialProject;
  const [sections, setSections] = useState(() => parseSpeechDraft(project.speechDraft || "", project.slideCount));
  const [dirty, setDirty] = useState(false);
  const [actionError, setActionError] = useState("");
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
  const [sectionSelections, setSectionSelections] = useState<Record<number, { end: number; start: number }>>({});
  const scriptShellRef = useRef<HTMLElement>(null);
  const jumpNavRef = useRef<HTMLElement>(null);
  const activeTextareaRef = useRef<HTMLTextAreaElement>(null);

  const startNarration = useStartNarration(project.id);
  const saveSpeechDraft = useSaveSpeechDraft(project.id);
  const acceptSpeech = useAcceptSpeechAndGenerate(project.id);
  const updateSource = useUpdateSourceReview(project.id);
  const canEdit = project.accessRole !== "viewer";
  const draft = useMemo(() => serializeSpeechSections(sections), [sections]);
  const hasSavedSpeechDraft = Boolean(project.speechDraft?.trim());
  const isTextReady = narrationReviewMode(project) === "editor";
  const isWaitingForText = project.status === "script_queued" || project.status === "script_generating";
  const isFinalGeneration = project.status === "queued" || project.status === "generating";
  const draftIsLongEnough = draft.trim().length >= 50 && sections.every((section) => section.text.trim().length >= 10);
  const sources = project.sources || [];
  const includedSources = sources.filter((source) => source.included !== false);
  const totalWords = useMemo(() => sections.reduce((sum, section) => sum + wordCount(section.text), 0), [sections]);
  const totalMinutes = Math.max(1, Math.round(totalWords / RUSSIAN_STUDENT_SPEECH_WORDS_PER_MINUTE));
  const activeSectionOrder = sections[activeSectionIndex]?.order;
  const busy = startNarration.isPending || saveSpeechDraft.isPending || acceptSpeech.isPending || updateSource.isPending;
  const terminalFailure = narrationFailureUi(project.narrationState);

  useEffect(() => {
    if (!dirty) setSections(parseSpeechDraft(project.speechDraft || "", project.slideCount));
  }, [dirty, project.slideCount, project.speechDraft]);

  useEffect(() => {
    setActiveSectionIndex((current) => Math.min(current, Math.max(0, sections.length - 1)));
  }, [sections.length]);

  useEffect(() => {
    const shell = scriptShellRef.current;
    if (!shell || !window.visualViewport) return;

    const updateKeyboardInset = () => {
      const viewport = window.visualViewport;
      if (!viewport) return;
      shell.style.setProperty("--script-keyboard-inset", `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
    };

    updateKeyboardInset();
    window.visualViewport.addEventListener("resize", updateKeyboardInset);
    window.visualViewport.addEventListener("scroll", updateKeyboardInset);
    return () => {
      window.visualViewport?.removeEventListener("resize", updateKeyboardInset);
      window.visualViewport?.removeEventListener("scroll", updateKeyboardInset);
    };
  }, []);

  useEffect(() => {
    const activeSection = document.getElementById(`speech-section-${activeSectionOrder}`);
    const activeJump = jumpNavRef.current?.querySelector<HTMLElement>(`[data-section-index="${activeSectionIndex}"]`);
    const frame = window.requestAnimationFrame(() => {
      activeSection?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" });
      activeJump?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest", inline: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSectionIndex, activeSectionOrder]);

  useEffect(() => {
    const selection = sectionSelections[activeSectionIndex];
    if (selection && activeTextareaRef.current) activeTextareaRef.current.setSelectionRange(selection.start, selection.end);
  }, [activeSectionIndex, sectionSelections]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function refresh() {
    setActionError("");
    try {
      await projectQuery.refetch();
    } catch (error) {
      setActionError(userError(error, "Не получилось обновить проект. Попробуйте ещё раз."));
    }
  }

  async function startText() {
    if (!canEdit) return;
    setActionError("");
    try {
      await startNarration.mutateAsync(undefined);
    } catch (error) {
      setActionError(userError(error, "Не получилось запустить подготовку текста. Проверьте баланс AI-провайдера и повторите попытку."));
    }
  }

  async function saveDraft() {
    if (!canEdit || !draftIsLongEnough) {
      setActionError("Добавьте текст в каждый раздел. В разделе должно быть хотя бы 10 символов.");
      return null;
    }
    setActionError("");
    try {
      const next = await saveSpeechDraft.mutateAsync(draft.trim());
      setSections(parseSpeechDraft(next.speechDraft || draft, next.slideCount));
      setDirty(false);
      return next;
    } catch (error) {
      setActionError(userError(error, "Не получилось сохранить текст. Правки остались на экране — попробуйте ещё раз."));
      return null;
    }
  }

  async function acceptAndGenerate() {
    if (!canEdit || !draftIsLongEnough) {
      setActionError("Проверьте все разделы речи перед запуском генерации слайдов.");
      return;
    }
    if (sources.length && !includedSources.length) {
      setActionError("Выберите хотя бы один источник для презентации.");
      return;
    }
    setActionError("");
    try {
      const next = await acceptSpeech.mutateAsync(draft.trim());
      setSections(parseSpeechDraft(next.speechDraft || draft, next.slideCount));
      setDirty(false);
    } catch (error) {
      setActionError(userError(error, "Не получилось запустить сборку слайдов. Проверьте баланс AI-провайдера и повторите попытку."));
    }
  }

  async function toggleSource(sourceId: string, included: boolean) {
    setActionError("");
    try {
      await updateSource.mutateAsync({ sourceId, included });
    } catch (error) {
      setActionError(userError(error, "Не получилось изменить набор источников."));
    }
  }

  const statusText = statusLabel(project.status, canEdit);

  return (
    <section className="script-shell" ref={scriptShellRef}>
      <WorkflowProgress current={3} />
      <div className="script-header">
        <div><span className={`status status-${project.status}`}>{statusText}</span><h1>{project.title}</h1></div>
        <Button variant="ghost" type="button" onClick={refresh} disabled={busy || projectQuery.isFetching}>
          {projectQuery.isFetching ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}Обновить
        </Button>
      </div>

      {!isTextReady && !isWaitingForText && !isFinalGeneration && project.status !== "failed" ? (
        <section className="panel generation-review" aria-labelledby="generation-review-title">
          <div><span className="status">Проверка перед AI</span><h2 id="generation-review-title">Настройки проекта сохранены</h2><p className="muted">AI ещё не запускался. Проверьте параметры и подтвердите расход баланса отдельно.</p></div>
          <dl className="generation-summary">
            <div><dt>Объём</dt><dd>{project.slideCount || 10} слайдов</dd></div>
            <div><dt>Уровень</dt><dd>{project.level === "school" ? "Школа" : "Вуз"}</dd></div>
            <div><dt>Материал</dt><dd>{project.mode === "with_sources" ? "Поиск в интернете" : `${sources.length} загруженных файлов`}</dd></div>
          </dl>
          <AiConfirmation
            title="Запустить AI-подготовку текста?"
            description="Сервер выполнит поиск источников и обращение к настроенному AI-провайдеру. Это может расходовать его платный баланс. Обычно шаг занимает 1–3 минуты."
            confirmLabel="Запустить AI и подготовить текст"
            pending={startNarration.isPending}
            onConfirm={startText}
          />
        </section>
      ) : null}

      {isWaitingForText && !isTextReady ? <JobStatusPanel title="Готовим текст выступления" detail="Ищем материалы и собираем черновик. Обычно это занимает 1–3 минуты." /> : null}
      {isFinalGeneration ? <JobStatusPanel title="Собираем презентацию" detail="Используем принятый текст и выбранные источники. Редактор станет доступен после завершения." /> : null}

      {isTextReady && !isFinalGeneration ? (
        <>
          <section className="panel source-review" aria-labelledby="source-review-title">
            <div className="source-review-heading">
              <div><span className="status">Источники</span><h2 id="source-review-title">Проверьте основу текста</h2><p className="muted">Отключённые материалы не попадут в генерацию слайдов.</p></div>
              <strong>{includedSources.length} из {sources.length}</strong>
            </div>
            {sources.length ? <div className="source-review-list" data-testid="source-review-summary">
              {sources.map((source) => {
                const included = source.included !== false;
                const disableLast = included && includedSources.length <= 1;
                const isExpanded = expandedSourceId === source.id;
                const detailsId = `source-details-${source.id}`;
                return <article className={included ? "source-review-item" : "source-review-item source-review-item-disabled"} key={source.id}>
                  <label><input type="checkbox" checked={included} disabled={!canEdit || busy || disableLast} onChange={(event) => toggleSource(source.id, event.target.checked)} /><span><strong>{source.label}</strong><small>{sourceKindLabel(source.type)} · {included ? "учтён" : "исключён"}</small></span></label>
                  <button className="source-detail-toggle" type="button" aria-expanded={isExpanded} aria-controls={detailsId} onClick={() => setExpandedSourceId(isExpanded ? null : source.id)}>
                    {isExpanded ? "Скрыть фрагмент" : "Показать фрагмент"}
                  </button>
                  {isExpanded ? <div className="source-review-detail" id={detailsId} data-testid={`source-review-detail-${source.id}`}>
                    {source.excerpt ? <p>{source.excerpt}</p> : <p className="muted">Фрагмент появится после обработки материала.</p>}
                    {source.url ? <a href={source.url} target="_blank" rel="noreferrer">Открыть источник <ExternalLink aria-hidden="true" size={14} /></a> : null}
                  </div> : null}
                </article>;
              })}
            </div> : <div className="source-empty"><ShieldCheck aria-hidden="true" /><p>{project.mode === "with_sources" ? "Источники появятся после завершения интернет-поиска." : "Используется принятый текст выступления."}</p></div>}
          </section>

          <section className="panel script-editor-panel" aria-labelledby="speech-review-title">
            <div className="script-review-heading"><div><span className="status">Текст</span><h2 id="speech-review-title">Речь по слайдам</h2></div><div><strong>{sections.length} разделов</strong><span>≈ {totalMinutes} мин · {totalWords} слов</span></div></div>
            <nav className="speech-jump-nav" aria-label="Переход к слайдам" ref={jumpNavRef}>
              {sections.map((section, index) => <button
                className={index === activeSectionIndex ? "speech-jump-button speech-jump-button-active" : "speech-jump-button"}
                type="button"
                key={`${section.order}-${index}`}
                data-section-index={index}
                data-testid={`script-jump-${section.order}`}
                aria-current={index === activeSectionIndex ? "step" : undefined}
                aria-controls={`speech-section-${section.order}`}
                onClick={() => setActiveSectionIndex(index)}
              >Слайд {section.order}</button>)}
            </nav>
            <div className="speech-section-list" aria-live="polite">
              {sections.map((section, index) => index === activeSectionIndex ? <article className="speech-section-card" id={`speech-section-${section.order}`} data-testid={`speech-section-${section.order}`} key={`${section.order}-${index}`}>
                <header><span>{section.order}</span><div><h3 id={`speech-section-heading-${section.order}`}>Слайд {section.order}: {section.title || "Без заголовка"}</h3><p>Раздел {index + 1} из {sections.length}</p></div><small>≈ {Math.max(20, Math.round(wordCount(section.text) / 2))} сек</small></header>
                <label>Заголовок слайда {section.order}<input value={section.title} readOnly={!canEdit} onChange={(event) => updateSection(index, { title: event.target.value }, setSections, setDirty)} /></label>
                <label>Текст выступления для слайда {section.order}<textarea ref={activeTextareaRef} value={section.text} readOnly={!canEdit} onBlur={(event) => rememberSelection(index, event.currentTarget, setSectionSelections)} onSelect={(event) => rememberSelection(index, event.currentTarget, setSectionSelections)} onChange={(event) => updateSection(index, { text: event.target.value }, setSections, setDirty)} /></label>
                <div className="speech-section-controls" aria-label={`Навигация по разделу ${section.order}`}>
                  <Button variant="ghost" type="button" onClick={() => setActiveSectionIndex(index - 1)} disabled={index === 0}>Предыдущий слайд</Button>
                  <Button variant="ghost" type="button" onClick={() => setActiveSectionIndex(index + 1)} disabled={index === sections.length - 1}>Следующий слайд</Button>
                </div>
              </article> : null)}
            </div>
            <details className="speech-raw-editor"><summary>Редактировать весь текст</summary><textarea className="textarea script-textarea" value={draft} readOnly={!canEdit} onChange={(event) => { setSections(parseSpeechDraft(event.target.value, project.slideCount)); setDirty(true); }} /></details>
            <div className="script-toolbar" data-testid="script-save-toolbar">
              <div className="script-save-status"><p className="muted" role="status" aria-live="polite">{dirty ? "Есть несохранённые правки" : "Все правки сохранены"}</p>{actionError ? <p className="form-error" role="alert" data-testid="script-action-error">{actionError}</p> : null}</div>
              {canEdit ? <div className="actions">
                <Button variant="secondary" type="button" onClick={saveDraft} disabled={busy || !draftIsLongEnough}><Save size={18} />{saveSpeechDraft.isPending ? "Сохраняем…" : "Сохранить текст"}</Button>
                {project.status === "ready" ? <Button asChild><Link href={`/projects/${project.id}/editor`}>Открыть редактор</Link></Button> : <AiConfirmation title="Собрать слайды по принятому тексту?" description="Это отдельный запрос к AI-провайдеру и он может расходовать платный баланс. Слайды будут собраны только по выбранным источникам и текущей версии речи." confirmLabel="Запустить AI-сборку слайдов" pending={acceptSpeech.isPending} onConfirm={acceptAndGenerate} />}
              </div> : <p className="muted">Редактирование доступно владельцу и редакторам.</p>}
            </div>
          </section>
        </>
      ) : null}

      {project.status === "failed" ? <section className="panel script-error-panel" role="alert"><h2>{terminalFailure.title}</h2><p className="muted">{terminalFailure.message}</p>{canEdit ? (project.workflow === "requirements_driven" ? <Button asChild><Link href={`/projects/${project.id}/defense/plan`}><ShieldCheck size={18} />Открыть подтверждённый план защиты</Link></Button> : hasSavedSpeechDraft ? <AiConfirmation title="Запустить сборку слайдов ещё раз?" description="Будет создан новый платный запрос к AI-провайдеру." confirmLabel="Запустить снова" pending={acceptSpeech.isPending} onConfirm={acceptAndGenerate} /> : <AiConfirmation title="Запустить подготовку текста ещё раз?" description="Будет создан новый платный запрос к AI-провайдеру." confirmLabel="Запустить снова" pending={startNarration.isPending} onConfirm={startText} />) : null}</section> : null}
      {actionError && !isTextReady ? <p className="form-error" role="alert">{actionError}</p> : null}
    </section>
  );
}

function AiConfirmation({ title, description, confirmLabel, pending, onConfirm }: { title: string; description: string; confirmLabel: string; pending: boolean; onConfirm: () => void | Promise<void> }) {
  return <Dialog><DialogTrigger asChild><Button type="button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={18} /> : <Rocket size={18} />}{confirmLabel}</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><div className="ai-cost-warning"><ShieldCheck aria-hidden="true" /><div><strong>Перед запуском</strong><span>После подтверждения запрос нельзя отменить из интерфейса.</span></div></div><div className="ui-dialog-actions"><DialogClose asChild><Button variant="secondary" type="button">Вернуться без запуска</Button></DialogClose><DialogClose asChild><Button type="button" onClick={onConfirm}>{confirmLabel}</Button></DialogClose></div></DialogContent></Dialog>;
}

function JobStatusPanel({ title, detail }: { title: string; detail: string }) {
  return <div className="panel script-waiting" role="status" aria-live="polite"><LoaderCircle className="spin" aria-hidden="true" /><h2>{title}</h2><p className="muted">{detail}</p></div>;
}

function updateSection(index: number, patch: Partial<SpeechSection>, setSections: (updater: (current: SpeechSection[]) => SpeechSection[]) => void, setDirty: (value: boolean) => void) {
  setSections((current) => current.map((section, sectionIndex) => sectionIndex === index ? { ...section, ...patch } : section));
  setDirty(true);
}

function rememberSelection(index: number, target: HTMLTextAreaElement, setSelection: (updater: (current: Record<number, { end: number; start: number }>) => Record<number, { end: number; start: number }>) => void) {
  setSelection((current) => ({ ...current, [index]: { start: target.selectionStart, end: target.selectionEnd } }));
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function sourceKindLabel(type: string) {
  if (type === "WEB") return "Интернет-источник";
  if (type === "DEMO") return "Учебный пример";
  return "Загруженный материал";
}

function wordCount(value: string) { return value.trim() ? value.trim().split(/\s+/).length : 0; }

function statusLabel(status: string, canEdit: boolean) {
  if (!canEdit) return "Только просмотр";
  if (status === "draft") return "Черновик сохранён";
  if (status === "script_queued") return "Текст в очереди";
  if (status === "script_generating") return "Готовим текст";
  if (status === "script_ready") return "Текст готов к проверке";
  if (status === "queued") return "Слайды в очереди";
  if (status === "generating") return "Собираем слайды";
  if (status === "ready") return "Презентация готова";
  if (status === "failed") return "Нужна проверка";
  return "Проект сохранён";
}

function userError(error: unknown, fallback: string) {
  if (error instanceof Error && /Presentation layout check failed/i.test(error.message)) {
    return "Не удалось автоматически подстроить вёрстку. Текст выступления и источники сохранены; повторная сборка слайдов не требует заново готовить речь.";
  }
  if (error instanceof Error && /[А-Яа-яЁё]/.test(error.message) && !/<[^>]+>|\b(?:error|failed|invalid|internal)\b/i.test(error.message)) return error.message;
  return fallback;
}
