"use client";

import { useEffect, useMemo, useState } from "react";
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
    if (project.status === "script_queued") return "Текст выступления в очереди";
    if (project.status === "script_generating") return "Генерируем текст выступления";
    if (project.status === "script_ready") return "Текст готов к проверке";
    if (project.status === "queued") return "Презентация в очереди";
    if (project.status === "generating") return "Создаем презентацию";
    if (project.status === "failed") return "Нужно повторить действие";
    return project.status;
  }, [project.status]);

  async function refresh() {
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
  }

  useEffect(() => {
    if (project.status === "ready") {
      router.replace(`/projects/${project.id}/editor`);
      return;
    }

    if (!isWaiting) return;
    const timer = window.setInterval(() => {
      refresh().catch((error) => setActionError(error instanceof Error ? error.message : "Не удалось обновить проект"));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [project.id, project.status, isWaiting, dirty, router]);

  async function startNarration() {
    setBusy(true);
    setActionError("");
    try {
      const response = await fetch(`/api/projects/${project.id}/narration`, { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Не удалось запустить генерацию текста");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!draftIsLongEnough) {
      setActionError("Текст выступления должен быть не короче 50 символов.");
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
      setActionError(error instanceof Error ? error.message : "Не удалось сохранить текст");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function acceptAndGenerate() {
    if (!draftIsLongEnough) {
      setActionError("Проверьте текст выступления перед созданием презентации.");
      return;
    }

    setBusy(true);
    setActionError("");
    try {
      const response = await fetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ speechDraft: draft.trim() }),
      });
      if (!response.ok) throw new Error(await response.text());
      setDirty(false);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Не удалось создать презентацию");
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
          onClick={() => refresh().catch((error) => setActionError(error instanceof Error ? error.message : "Не удалось обновить проект"))}
          disabled={busy}
        >
          Обновить
        </button>
      </div>

      {isWaiting && !isTextReady ? (
        <div className="panel script-waiting">
          <div className="loading-band" />
          <h2>Готовим текст выступления</h2>
          <p className="muted">После генерации здесь появится полный текст. Его можно будет отредактировать перед созданием слайдов.</p>
        </div>
      ) : null}

      {isFinalGeneration ? (
        <div className="panel script-waiting">
          <div className="loading-band" />
          <h2>Создаем презентацию</h2>
          <p className="muted">Слайды строятся из принятого текста выступления. Когда презентация будет готова, откроется редактор.</p>
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
            <p className="muted">{dirty ? "Есть несохраненные правки" : "Текст сохранен"}</p>
            <div className="actions">
              <button className="ghost" type="button" onClick={saveDraft} disabled={busy || !draftIsLongEnough}>
                Сохранить
              </button>
              <button className="button" type="button" onClick={acceptAndGenerate} disabled={busy || !draftIsLongEnough}>
                {busy ? "Запускаем..." : "Принять и создать презентацию"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {project.status === "failed" ? (
        <div className="panel script-error-panel">
          <h2>Не удалось выполнить шаг</h2>
          {project.error ? <p className="muted">{project.error}</p> : null}
          <div className="actions">
            {draft ? (
              <button className="button" type="button" onClick={acceptAndGenerate} disabled={busy || !draftIsLongEnough}>
                Повторить создание презентации
              </button>
            ) : (
              <button className="button" type="button" onClick={startNarration} disabled={busy}>
                Повторить генерацию текста
              </button>
            )}
          </div>
        </div>
      ) : null}

      {actionError ? <p className="form-error">{actionError}</p> : null}
    </section>
  );
}
