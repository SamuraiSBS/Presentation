"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw, Rocket, Save } from "lucide-react";
import {
  useAcceptSpeechAndGenerate,
  useGenerationJob,
  useSaveSpeechDraft,
  useStartNarration,
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
import { Progress } from "@/components/ui/progress";

export function ProjectScriptReviewQuery({ initialProject }: { initialProject: ProjectPayload }) {
  const router = useRouter();
  const projectQuery = useGenerationJob(initialProject.id, initialProject);
  const project = projectQuery.data || initialProject;
  const [draft, setDraft] = useState(project.speechDraft || "");
  const [dirty, setDirty] = useState(false);
  const [actionError, setActionError] = useState("");

  const startNarration = useStartNarration(project.id);
  const saveSpeechDraft = useSaveSpeechDraft(project.id);
  const acceptSpeech = useAcceptSpeechAndGenerate(project.id);
  const canEdit = project.accessRole !== "viewer";
  const isTextReady = project.status === "script_ready" || Boolean(project.speechDraft);
  const isWaitingForText = project.status === "script_queued" || project.status === "script_generating";
  const isFinalGeneration = project.status === "queued" || project.status === "generating";
  const draftIsLongEnough = draft.trim().length >= 50;
  const busy = startNarration.isPending || saveSpeechDraft.isPending || acceptSpeech.isPending;

  useEffect(() => {
    if (project.status === "ready") {
      router.replace(`/projects/${project.id}/editor`);
    }
  }, [project.id, project.status, router]);

  useEffect(() => {
    if (!dirty) {
      setDraft(project.speechDraft || "");
    }
  }, [dirty, project.speechDraft]);

  const statusText = useMemo(() => {
    if (project.status === "script_queued") return "Текст в очереди";
    if (project.status === "script_generating") return "Готовим текст выступления";
    if (project.status === "script_ready") return "Текст готов";
    if (project.status === "queued") return "Презентация в очереди";
    if (project.status === "generating") return "Собираем презентацию";
    if (project.status === "failed") return "Нужно повторить";
    return "Обновляем статус";
  }, [project.status]);

  const progress = useMemo(() => {
    if (project.status === "script_queued") return 20;
    if (project.status === "script_generating") return 55;
    if (project.status === "script_ready") return 100;
    if (project.status === "queued") return 35;
    if (project.status === "generating") return 72;
    return isTextReady ? 100 : 12;
  }, [isTextReady, project.status]);

  async function refresh() {
    setActionError("");
    try {
      await projectQuery.refetch();
    } catch (error) {
      setActionError(userError(error, "Не получилось обновить проект. Попробуй ещё раз."));
    }
  }

  async function startText() {
    if (!canEdit) return;
    setActionError("");
    try {
      await startNarration.mutateAsync(undefined);
    } catch (error) {
      setActionError(userError(error, "Не получилось начать подготовку текста. Попробуй ещё раз."));
    }
  }

  async function saveDraft() {
    if (!canEdit) return null;
    if (!draftIsLongEnough) {
      setActionError("Добавь немного деталей. Текст должен быть хотя бы 50 символов.");
      return null;
    }
    setActionError("");
    try {
      const next = await saveSpeechDraft.mutateAsync(draft.trim());
      setDraft(next.speechDraft || draft.trim());
      setDirty(false);
      return next;
    } catch (error) {
      setActionError(userError(error, "Не получилось сохранить текст. Попробуй ещё раз."));
      return null;
    }
  }

  async function acceptAndGenerate() {
    if (!canEdit) return;
    if (!draftIsLongEnough) {
      setActionError("Сначала проверь текст выступления и добавь недостающие детали.");
      return;
    }
    setActionError("");
    try {
      const next = await acceptSpeech.mutateAsync(draft.trim());
      setDraft(next.speechDraft || draft.trim());
      setDirty(false);
    } catch (error) {
      setActionError(userError(error, "Не получилось собрать презентацию. Попробуй ещё раз."));
    }
  }

  return (
    <section className="script-shell">
      <div className="script-header">
        <div>
          <span className={`status status-${project.status}`}>{canEdit ? statusText : "Только просмотр"}</span>
          <h1>{project.title}</h1>
        </div>
        <Button variant="ghost" type="button" onClick={refresh} disabled={busy || projectQuery.isFetching}>
          {projectQuery.isFetching ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}
          Обновить
        </Button>
      </div>

      {isWaitingForText && !isTextReady ? (
        <JobStatusPanel
          title="Готовим текст выступления"
          detail="Черновик появится здесь автоматически."
          value={progress}
        />
      ) : null}

      {isFinalGeneration ? (
        <JobStatusPanel
          title="Собираем презентацию"
          detail="Редактор откроется сам, когда слайды будут готовы."
          value={progress}
        />
      ) : null}

      {isTextReady && !isFinalGeneration ? (
        <div className="panel script-editor-panel">
          <label className="field">
            Текст выступления
            <textarea
              className="textarea script-textarea"
              value={draft}
              readOnly={!canEdit}
              onChange={(event) => {
                setDraft(event.target.value);
                setDirty(true);
              }}
            />
          </label>
          <div className="script-toolbar">
            <p className="muted">{dirty ? "Есть несохранённые правки" : "Всё сохранено"}</p>
            {canEdit ? <div className="actions">
              <Button variant="secondary" type="button" onClick={saveDraft} disabled={busy || !draftIsLongEnough}>
                <Save size={18} />
                Сохранить
              </Button>
              <Dialog>
                <DialogTrigger asChild>
                  <Button type="button" disabled={busy || !draftIsLongEnough}>
                    {acceptSpeech.isPending ? <LoaderCircle className="spin" size={18} /> : <Rocket size={18} />}
                    Собрать слайды
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Принять текст и собрать слайды?</DialogTitle>
                    <DialogDescription>
                      StudyDeck возьмёт этот текст как основу для слайдов и заметок докладчика.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="ui-dialog-actions">
                    <DialogClose asChild>
                      <Button variant="secondary" type="button">Вернуться</Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button type="button" onClick={acceptAndGenerate}>Запустить генерацию</Button>
                    </DialogClose>
                  </div>
                </DialogContent>
              </Dialog>
            </div> : <p className="muted">Редактирование доступно владельцу и редакторам.</p>}
          </div>
        </div>
      ) : null}

      {project.status === "failed" ? (
        <div className="panel script-error-panel">
          <h2>Что-то пошло не так</h2>
          {project.error ? <p className="muted">{userError(new Error(project.error), "Не получилось завершить этот шаг. Попробуй ещё раз.")}</p> : null}
          {canEdit ? <div className="actions">
            {draft ? (
              <Button type="button" onClick={acceptAndGenerate} disabled={busy || !draftIsLongEnough}>
                Попробовать собрать слайды ещё раз
              </Button>
            ) : (
              <Button type="button" onClick={startText} disabled={busy}>
                Попробовать подготовить текст ещё раз
              </Button>
            )}
          </div> : null}
        </div>
      ) : null}

      {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
    </section>
  );
}

function JobStatusPanel({ title, detail, value }: { title: string; detail: string; value: number }) {
  return (
    <div className="panel script-waiting" role="status" aria-live="polite">
      <Progress value={value} />
      <h2>{title}</h2>
      <p className="muted">{detail}</p>
    </div>
  );
}

function userError(error: unknown, fallback: string) {
  if (error instanceof Error && /[А-Яа-яЁё]/.test(error.message) && !/<[^>]+>|\b(?:error|failed|invalid|internal)\b/i.test(error.message)) {
    return error.message;
  }
  return fallback;
}
