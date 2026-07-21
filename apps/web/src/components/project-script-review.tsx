"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ProjectPayload = {
  id: string;
  title: string;
  status: string;
  error?: string | null;
  speechDraft?: string | null;
};

const waitingStatuses = new Set(["script_queued", "script_generating", "queued", "generating"]);

export function ProjectScriptReview({ initialProject }: { initialProject: ProjectPayload }) {
  const router = useRouter();
  const [project, setProject] = useState(initialProject);
  const [draft, setDraft] = useState(initialProject.speechDraft || "");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const isTextReady = project.status === "script_ready" || Boolean(project.speechDraft);
  const isWaiting = waitingStatuses.has(project.status);
  const isFinalGeneration = project.status === "queued" || project.status === "generating";
  const draftIsLongEnough = draft.trim().length >= 50;

  const statusText = useMemo(() => {
    if (project.status === "script_queued") return "Скоро начнём готовить текст";
    if (project.status === "script_generating") return "Готовим текст выступления";
    if (project.status === "script_ready") return "Текст готов, проверь его";
    if (project.status === "queued") return "Презентация в очереди";
    if (project.status === "generating") return "Собираем презентацию";
    if (project.status === "failed") return "Не получилось, попробуй ещё раз";
    return "Обновляем статус";
  }, [project.status]);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/projects/${project.id}`);
    if (!response.ok) throw new Error(await response.text());
    const next = (await response.json()) as ProjectPayload;
    setProject(next);
    if (!dirty) {
      setDraft(next.speechDraft || "");
    }
    if (next.status === "ready") {
      router.replace(`/projects/${next.id}/editor`);
    }
  }, [dirty, project.id, router]);

  useEffect(() => {
    if (project.status === "ready") {
      router.replace(`/projects/${project.id}/editor`);
      return;
    }

    if (!isWaiting) return;
    const timer = window.setInterval(() => {
      refresh().catch((error) => setActionError(userError(error, "Не получилось обновить проект. Попробуй ещё раз.")));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [project.id, project.status, isWaiting, refresh, router]);

  async function startNarration() {
    setBusy(true);
    setActionError("");
    try {
      const response = await fetch(`/api/projects/${project.id}/narration`, { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      await refresh();
    } catch (error) {
      setActionError(userError(error, "Не получилось начать подготовку текста. Попробуй ещё раз."));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!draftIsLongEnough) {
      setActionError("Добавь немного деталей. Текст должен быть хотя бы 50 символов.");
      return null;
    }

    setBusy(true);
    setActionError("");
    try {
      const response = await fetch(`/api/projects/${project.id}/narration`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ speechDraft: draft.trim() }),
      });
      if (!response.ok) throw new Error(await response.text());
      const next = (await response.json()) as ProjectPayload;
      setProject(next);
      setDraft(next.speechDraft || draft.trim());
      setDirty(false);
      return next;
    } catch (error) {
      setActionError(userError(error, "Не получилось сохранить текст. Попробуй ещё раз."));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function acceptAndGenerate() {
    if (!draftIsLongEnough) {
      setActionError("Сначала проверь текст выступления и добавь недостающие детали.");
      return;
    }

    setBusy(true);
    setActionError("");
    try {
      const response = await fetch(`/api/projects/${project.id}/narration`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ speechDraft: draft.trim(), accept: true }),
      });
      if (!response.ok) throw new Error(await response.text());
      const next = (await response.json()) as ProjectPayload;
      setProject(next);
      setDraft(next.speechDraft || draft.trim());
      setDirty(false);
    } catch (error) {
      setActionError(userError(error, "Не получилось собрать презентацию. Попробуй ещё раз."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="script-shell">
      <div className="script-header">
        <div>
          <span className="status">{statusText}</span>
          <h1>{project.title}</h1>
        </div>
        <button
          className="ghost"
          type="button"
          onClick={() => refresh().catch((error) => setActionError(userError(error, "Не получилось обновить проект. Попробуй ещё раз.")))}
          disabled={busy}
        >
          Обновить
        </button>
      </div>

      {isWaiting && !isTextReady ? (
        <div className="panel script-waiting">
          <div className="loading-band" />
          <h2>Готовим текст выступления</h2>
          <p className="muted">Скоро здесь появится черновик. Прочитай его и поправь всё, что звучит не по-твоему.</p>
        </div>
      ) : null}

      {isFinalGeneration ? (
        <div className="panel script-waiting">
          <div className="loading-band" />
          <h2>Собираем презентацию</h2>
          <p className="muted">Берём за основу принятый текст. Когда слайды будут готовы, редактор откроется сам.</p>
        </div>
      ) : null}

      {isTextReady && !isFinalGeneration ? (
        <div className="panel script-editor-panel">
          <label className="field">
            Текст выступления
            <textarea
              className="textarea script-textarea"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setDirty(true);
              }}
            />
          </label>
          <div className="script-toolbar">
            <p className="muted">{dirty ? "Есть несохранённые правки" : "Всё сохранено"}</p>
            <div className="actions">
              <button className="ghost" type="button" onClick={saveDraft} disabled={busy || !draftIsLongEnough}>
                Сохранить
              </button>
              <button className="button" type="button" onClick={acceptAndGenerate} disabled={busy || !draftIsLongEnough}>
                {busy ? "Собираем слайды..." : "Принять текст и собрать слайды"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {project.status === "failed" ? (
        <div className="panel script-error-panel">
          <h2>Что-то пошло не так</h2>
          {project.error ? <p className="muted">{userError(new Error(project.error), "Не получилось завершить этот шаг. Попробуй ещё раз.")}</p> : null}
          <div className="actions">
            {draft ? (
              <button className="button" type="button" onClick={acceptAndGenerate} disabled={busy || !draftIsLongEnough}>
                Попробовать собрать слайды ещё раз
              </button>
            ) : (
              <button className="button" type="button" onClick={startNarration} disabled={busy}>
                Попробовать подготовить текст ещё раз
              </button>
            )}
          </div>
        </div>
      ) : null}

      {actionError ? <p className="form-error">{actionError}</p> : null}
    </section>
  );
}

function userError(error: unknown, fallback: string) {
  if (error instanceof Error && /Presentation layout check failed/i.test(error.message)) {
    return "Не удалось автоматически подстроить вёрстку. Текст выступления и источники сохранены; повторная сборка слайдов не требует заново готовить речь.";
  }
  if (error instanceof Error && /[А-Яа-яЁё]/.test(error.message) && !/<[^>]+>|\b(?:error|failed|invalid|internal)\b/i.test(error.message)) {
    return error.message;
  }
  return fallback;
}
