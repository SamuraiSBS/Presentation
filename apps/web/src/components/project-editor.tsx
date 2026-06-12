"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PresentationDocument, SlideBlock } from "@studydeck/shared";

type ProjectPayload = {
  id: string;
  title: string;
  status: string;
  error?: string | null;
  presentation?: { document: PresentationDocument } | null;
};

export function ProjectEditor({ initialProject }: { initialProject: ProjectPayload }) {
  const [project, setProject] = useState(initialProject);
  const [active, setActive] = useState(0);
  const presentation = project.presentation?.document;
  const slide = presentation?.slides[active];

  const speech = useMemo(
    () => presentation?.speechScript.find((item) => item.slideOrder === slide?.order),
    [presentation, slide],
  );

  async function refresh() {
    const response = await fetch(`/api/projects/${project.id}`);
    setProject(await response.json());
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
    return (
      <section className="panel">
        <span className="status">{project.status}</span>
        <h1 className="page-title" style={{ fontSize: 44 }}>{project.title}</h1>
        <p className="lead">
          Генерация еще идет. Обновите страницу через несколько секунд. Если worker запущен, статус сменится на ready.
        </p>
        {project.error ? <p className="muted">{project.error}</p> : null}
        <button className="button" type="button" onClick={refresh}>Обновить</button>
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
                className="input"
                defaultValue={slide.title}
                onBlur={(event) => saveSlide({ title: event.target.value })}
                aria-label="Заголовок слайда"
              />
              <ul>
                {slide.blocks.flatMap((block) => (block.type === "bullets" ? block.items : "content" in block ? [block.content] : [])).map((item, index) => (
                  <li key={`${slide.id}-${index}`}>{item}</li>
                ))}
              </ul>
            </div>
            <footer className="muted">Источник: {slide.sourceRefs.map((ref) => ref.label).join("; ") || "не указан"}</footer>
          </article>
          <textarea
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
            <p>{speech?.text || slide.speakerNotes}</p>
          </div>
          <strong>Источники</strong>
          {presentation.sources.map((source) => (
            <div className="speech-item" key={source.id}>
              <strong>{source.label}</strong>
              <p>{source.excerpt || "Фрагмент появится после извлечения текста."}</p>
            </div>
          ))}
        </aside>
      </section>
    </>
  );
}
