"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, RefreshCw, Rocket, Save, ShieldCheck } from "lucide-react";
import {
  ApiClientError,
  useAcceptSpeechAndGenerate,
  useGenerationJob,
  useSaveSpeechDraft,
  useStartNarration,
  type ProjectPayload,
} from "@/lib/project-queries";
import { Button } from "@/components/ui/button";
import { WorkflowProgress } from "@/components/workflow-progress";
import { RUSSIAN_STUDENT_SPEECH_WORDS_PER_MINUTE } from "@studydeck/shared";
import { narrationFailureUi, narrationReviewMode } from "@/lib/narration-failure-ui";

export function ProjectScriptReviewQuery({ initialProject }: { initialProject: ProjectPayload }) {
  const router = useRouter();
  const projectQuery = useGenerationJob(initialProject.id, initialProject);
  const project = projectQuery.data || initialProject;
  const [draft, setDraft] = useState(() => project.speechDraft || "");
  const [dirty, setDirty] = useState(false);
  const [actionError, setActionError] = useState("");
  const [quotaLimit, setQuotaLimit] = useState<{ limit: number; remaining: number; resetsAt: string } | null>(null);
  const scriptShellRef = useRef<HTMLElement>(null);
  const redirectedRef = useRef(false);

  const startNarration = useStartNarration(project.id);
  const saveSpeechDraft = useSaveSpeechDraft(project.id);
  const acceptSpeech = useAcceptSpeechAndGenerate(project.id);
  const canEdit = project.accessRole !== "viewer";
  const hasSavedSpeechDraft = Boolean(project.speechDraft?.trim());
  const isTextReady = narrationReviewMode(project) === "editor";
  const isWaitingForText = project.status === "script_queued" || project.status === "script_generating";
  const isFinalGeneration = project.status === "queued" || project.status === "generating";
  const draftIsLongEnough = draft.trim().length >= 50;
  const totalWords = wordCount(draft);
  const totalMinutes = totalWords ? Math.max(1, Math.round(totalWords / RUSSIAN_STUDENT_SPEECH_WORDS_PER_MINUTE)) : 0;
  const busy = startNarration.isPending || saveSpeechDraft.isPending || acceptSpeech.isPending;
  const terminalFailure = narrationFailureUi(project.narrationState, project.generationErrorCategory);

  useEffect(() => {
    if (!dirty) setDraft(project.speechDraft || "");
  }, [dirty, project.speechDraft]);

  useEffect(() => {
    if (project.status !== "ready" || redirectedRef.current) return;
    redirectedRef.current = true;
    router.replace(`/projects/${project.id}/editor`);
  }, [project.id, project.status, router]);

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
    setQuotaLimit(null);
    try {
      await projectQuery.refetch();
    } catch (error) {
      setActionError(userError(error, "Не получилось обновить проект. Попробуйте ещё раз."));
    }
  }

  async function startText() {
    if (!canEdit) return;
    setActionError("");
    setQuotaLimit(null);
    try {
      await startNarration.mutateAsync(undefined);
    } catch (error) {
      setActionError(userError(error, "Не получилось запустить подготовку текста. Попробуйте ещё раз."));
    }
  }

  async function saveDraft() {
    if (!canEdit || !draftIsLongEnough) {
      setActionError("Добавьте ещё немного текста. Нужно не менее 50 символов.");
      return null;
    }
    setActionError("");
    try {
      const next = await saveSpeechDraft.mutateAsync(draft.trim());
      setDraft(next.speechDraft || draft.trim());
      setDirty(false);
      return next;
    } catch (error) {
      setActionError(userError(error, "Не получилось сохранить текст. Правки остались на экране — попробуйте ещё раз."));
      return null;
    }
  }

  async function acceptAndGenerate() {
    if (!canEdit || !draftIsLongEnough) {
      setActionError("Добавьте ещё немного текста. Нужно не менее 50 символов.");
      return;
    }
    setActionError("");
    setQuotaLimit(null);
    try {
      const next = await acceptSpeech.mutateAsync(draft.trim());
      setDraft(next.speechDraft || draft.trim());
      setDirty(false);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "PRESENTATION_GENERATION_LIMIT_REACHED") {
        const details = error.details || {};
        setQuotaLimit({
          limit: Number(details.limit) || 0,
          remaining: Number(details.remaining) || 0,
          resetsAt: typeof details.resetsAt === "string" ? details.resetsAt : "",
        });
        return;
      }
      setActionError(userError(error, "Не получилось запустить сборку слайдов. Попробуйте ещё раз."));
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

      {isWaitingForText && !isTextReady ? <JobStatusPanel title="Готовим текст выступления" detail="Подбираем материалы и собираем черновик. Когда он будет готов, он появится здесь автоматически." /> : null}
      {isFinalGeneration ? <JobStatusPanel title="Собираем презентацию" detail="Используем принятый текст. Редактор откроется автоматически после завершения." /> : null}

      {isTextReady && !isFinalGeneration ? (
        <section className="panel script-editor-panel" aria-labelledby="speech-review-title">
          <div className="script-review-heading">
            <div>
              <span className="status">Текст</span>
              <h2 id="speech-review-title">Текст выступления</h2>
              <p className="muted">Проверьте черновик, внесите правки и создайте презентацию.</p>
            </div>
            <div><strong>{totalWords} слов</strong><span>{totalMinutes ? `≈ ${totalMinutes} мин` : "Добавьте текст"}</span></div>
          </div>

          <label className="field">
            <span>Текст выступления</span>
            <textarea
              className="textarea script-textarea"
              data-testid="speech-draft-editor"
              aria-label="Текст выступления"
              value={draft}
              readOnly={!canEdit}
              onChange={(event) => {
                setDraft(event.target.value);
                setDirty(true);
              }}
            />
          </label>

          <div className="script-toolbar" data-testid="script-save-toolbar">
            <div className="script-save-status">
              <p className="muted" role="status" aria-live="polite">{dirty ? "Есть несохранённые правки" : "Сохранено"}</p>
              {actionError ? <p className="form-error" role="alert" data-testid="script-action-error">{actionError}</p> : null}
            </div>
            {canEdit ? <div className="actions">
              <Button variant="secondary" type="button" onClick={saveDraft} disabled={busy || !draftIsLongEnough}>
                <Save size={18} />{saveSpeechDraft.isPending ? "Сохраняем…" : "Сохранить черновик"}
              </Button>
              <Button type="button" data-testid="create-presentation-button" onClick={acceptAndGenerate} disabled={busy || !draftIsLongEnough}>
                {acceptSpeech.isPending ? <LoaderCircle className="spin" size={18} /> : <Rocket size={18} />}Создать презентацию
              </Button>
            </div> : <p className="muted">Редактирование доступно владельцу и редакторам.</p>}
          </div>
          {quotaLimit ? <QuotaLimitNotice limit={quotaLimit.limit} remaining={quotaLimit.remaining} resetsAt={quotaLimit.resetsAt} /> : null}
        </section>
      ) : null}

      {project.status === "draft" && !isTextReady ? (
        <section className="panel script-error-panel" role="status">
          <h2>Подготовка текста ещё не запущена</h2>
          <p className="muted">Проект сохранён. Запустите подготовку текста, чтобы продолжить.</p>
          {canEdit ? <Button type="button" onClick={startText} disabled={busy}>{startNarration.isPending ? <LoaderCircle className="spin" size={18} /> : <Rocket size={18} />}Подготовить текст</Button> : null}
        </section>
      ) : null}

      {project.status === "failed" ? <section className="panel script-error-panel" role="alert">
        <h2>{terminalFailure.title}</h2>
        <p className="muted">{terminalFailure.message}</p>
        {canEdit ? (project.workflow === "requirements_driven"
          ? <Button asChild><Link href={`/projects/${project.id}/defense/plan`}><ShieldCheck size={18} />Открыть подтверждённый план защиты</Link></Button>
          : hasSavedSpeechDraft
            ? <Button type="button" onClick={acceptAndGenerate} disabled={busy || !draftIsLongEnough}>{acceptSpeech.isPending ? <LoaderCircle className="spin" size={18} /> : <Rocket size={18} />}Полная AI-пересборка презентации</Button>
            : <Button type="button" onClick={startText} disabled={busy}>{startNarration.isPending ? <LoaderCircle className="spin" size={18} /> : <Rocket size={18} />}Повторить подготовку текста</Button>) : null}
      </section> : null}
      {quotaLimit && !isTextReady ? <QuotaLimitNotice limit={quotaLimit.limit} remaining={quotaLimit.remaining} resetsAt={quotaLimit.resetsAt} /> : null}
      {actionError && !isTextReady ? <p className="form-error" role="alert">{actionError}</p> : null}
    </section>
  );
}

function QuotaLimitNotice({ limit, remaining, resetsAt }: { limit: number; remaining: number; resetsAt: string }) {
  const reset = resetsAt && !Number.isNaN(new Date(resetsAt).valueOf())
    ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" }).format(new Date(resetsAt))
    : "в следующий период";
  return <section className="usage-blocked" role="alert"><strong>Лимит генераций исчерпан</strong><span>Осталось {remaining} из {limit}. Следующий сброс — {reset}. Черновик и текст выступления сохранены.</span><Link className="button" href="/pricing">Выбрать тариф и оплатить</Link></section>;
}

function JobStatusPanel({ title, detail }: { title: string; detail: string }) {
  return <div className="panel script-waiting" role="status" aria-live="polite"><LoaderCircle className="spin" aria-hidden="true" /><h2>{title}</h2><p className="muted">{detail}</p></div>;
}

function wordCount(value: string) { return value.trim() ? value.trim().split(/\s+/).length : 0; }

function statusLabel(status: string, canEdit: boolean) {
  if (!canEdit) return "Только просмотр";
  if (status === "draft") return "Проект сохранён";
  if (status === "script_queued") return "Текст в очереди";
  if (status === "script_generating") return "Готовим текст";
  if (status === "script_ready") return "Текст готов";
  if (status === "queued") return "Слайды в очереди";
  if (status === "generating") return "Собираем слайды";
  if (status === "ready") return "Презентация готова";
  if (status === "failed") return "Не удалось завершить шаг";
  return "Проект сохранён";
}

function userError(error: unknown, fallback: string) {
  if (error instanceof Error && /Presentation layout check failed/i.test(error.message)) {
    return "Не удалось автоматически подстроить вёрстку. Текст выступления и источники сохранены; повторная сборка слайдов не требует заново готовить речь.";
  }
  if (error instanceof Error && /[А-Яа-яЁё]/.test(error.message) && !/<[^>]+>|\b(?:error|failed|invalid|internal)\b/i.test(error.message)) return error.message;
  return fallback;
}
