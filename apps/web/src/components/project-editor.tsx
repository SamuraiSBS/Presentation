"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PresentationDocument, SlideBlock } from "@studydeck/shared";
import { sanitizeDisplayText, sanitizeProjectForDisplay, slideBodyTextForDisplay } from "@/lib/presentation-display";

type ProjectPayload = {
  id: string;
  title: string;
  status: string;
  error?: string | null;
  presentation?: { document: PresentationDocument } | null;
};

export function ProjectEditor({ initialProject }: { initialProject: ProjectPayload }) {
  const [project, setProject] = useState(() => sanitizeProjectForDisplay(initialProject));
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const presentation = project.presentation?.document;
  const slide = presentation?.slides[active];

  const speech = useMemo(
    () => presentation?.speechScript.find((item) => item.slideOrder === slide?.order),
    [presentation, slide],
  );

  async function refresh() {
    const response = await fetch(`/api/projects/${project.id}`);
    setProject(sanitizeProjectForDisplay(await response.json()));
  }

  async function generate() {
    setBusy(true);
    setActionError("");

    try {
      const response = await fetch(`/api/projects/${project.id}/generate`, { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveSlide(next: { title?: string; blocks?: SlideBlock[]; speakerNotes?: string }) {
    if (!slide) return;
    const response = await fetch(`/api/projects/${project.id}/slides/${slide.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    if (response.ok) await refresh();
  }

  if (!presentation || !slide) {
    const canStartGeneration = project.status === "draft" || project.status === "failed";

    return (
      <section className="panel">
        <span className="status">{project.status}</span>
        <h1 className="page-title" style={{ fontSize: 44 }}>{project.title}</h1>
        <p className="lead">
          {canStartGeneration
            ? "Презентация еще не отправлена в генерацию. Запустите ее вручную."
            : "Генерация еще идет. Обновите страницу через несколько секунд. Если worker запущен, статус сменится на ready."}
        </p>
        {project.error ? <p className="muted">{project.error}</p> : null}
        {actionError ? <p className="muted">{actionError}</p> : null}
        <div className="actions">
          {canStartGeneration ? (
            <button className="button" type="button" onClick={generate} disabled={busy}>
              {busy ? "Запускаем..." : "Запустить генерацию"}
            </button>
          ) : null}
          <button className="ghost" type="button" onClick={refresh}>Обновить</button>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div>
          <span className="status">{project.status}</span>
          <h1 style={{ margin: "8px 0 0" }}>{presentation.title}</h1>
        </div>
        <div className="actions">
          <button className="ghost" type="button" onClick={refresh}>Обновить</button>
          <Link className="button" href={`/projects/${project.id}/export`}>Экспорт</Link>
        </div>
      </div>
      <section className="editor">
        <aside className="rail">
          <strong>План</strong>
          <div style={{ height: 12 }} />
          {presentation.slides.map((item, index) => (
            <button className="slide-button" key={item.id} type="button" onClick={() => setActive(index)}>
              {String(index + 1).padStart(2, "0")} · {item.title}
            </button>
          ))}
        </aside>
        <section className="canvas-panel">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>Слайд {active + 1}</strong>
            <span className="muted">{slide.timingSeconds} сек</span>
          </div>
          <article className="slide-canvas">
            <div>
              <input
                key={`${slide.id}-${slide.title}`}
                className="input"
                defaultValue={slide.title}
                onBlur={(event) => saveSlide({ title: event.target.value })}
                aria-label="Заголовок слайда"
              />
              <p className="slide-body">{slideBodyTextForDisplay(slide.blocks, slide.title)}</p>
            </div>
          </article>
          <textarea
            key={`${slide.id}-${slide.speakerNotes}`}
            className="textarea notes"
            defaultValue={slide.speakerNotes}
            onBlur={(event) => saveSlide({ speakerNotes: event.target.value })}
            aria-label="Заметки спикера"
          />
        </section>
        <aside className="speech">
          <strong>Рассказ</strong>
          <div className="speech-item">
            <strong>{speech?.slideTitle || slide.title}</strong>
            <p>{sanitizeDisplayText(speech?.text || slide.speakerNotes)}</p>
          </div>
        </aside>
      </section>
    </>
  );
}
