"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PresentationDocument, SlideBlock } from "@studydeck/shared";
import { sanitizeDisplayText, sanitizeProjectForDisplay } from "@/lib/presentation-display";

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
            <SlideCanvas slide={slide} />
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

function SlideCanvas({ slide }: { slide: PresentationDocument["slides"][number] }) {
  const isDivider = slide.slideKind === "title" || slide.slideKind === "section";

  if (isDivider) {
    return (
      <div className={`slide-content slide-content-${slide.slideKind}`}>
        <span className="slide-kind">{slide.slideKind === "title" ? "Тема" : "Раздел"}</span>
        <h2 className="slide-title">{slide.title}</h2>
        {slide.thesis ? <p className="slide-body">{slide.thesis}</p> : null}
        {slide.highlights.length ? <HighlightBadges highlights={slide.highlights} /> : null}
      </div>
    );
  }

  return (
    <div className="slide-content slide-content-structured">
      <div className="slide-main">
        <div>
          <span className="slide-kind">{slide.slideKind === "summary" ? "Выводы" : "Учебный слайд"}</span>
          <h2 className="slide-title">{slide.title}</h2>
          {slide.thesis ? <p className="slide-thesis">{slide.thesis}</p> : null}
        </div>
        {slide.highlights.length ? <HighlightBadges highlights={slide.highlights} /> : null}
      </div>

      <div className="slide-grid">
        <section className="slide-copy">
          {slide.bullets.length ? (
            <ul className="slide-bullets">
              {slide.bullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {slide.definition ? (
            <div className="definition-block">
              <strong>{slide.definition.term}</strong>
              <span>{slide.definition.text}</span>
            </div>
          ) : null}
          {slide.keyConcepts.length ? (
            <div className="concept-row">
              {slide.keyConcepts.map((concept) => (
                <span className="concept-chip" key={`${concept.icon}-${concept.label}`}>
                  <span aria-hidden="true">{conceptIcon(concept.icon)}</span>
                  {concept.label}
                </span>
              ))}
            </div>
          ) : null}
        </section>
        <VisualBlock slide={slide} />
      </div>
    </div>
  );
}

function HighlightBadges({ highlights }: { highlights: PresentationDocument["slides"][number]["highlights"] }) {
  return (
    <div className="highlight-row">
      {highlights.map((item) => (
        <span className={`highlight-badge highlight-${item.tone}`} key={`${item.tone}-${item.text}`}>
          {item.text}
        </span>
      ))}
    </div>
  );
}

function VisualBlock({ slide }: { slide: PresentationDocument["slides"][number] }) {
  const visual = slide.visual;
  if (!visual || visual.type === "none") return <div className="visual-card visual-empty">Смысловая схема</div>;

  if (visual.rows.length && ["comparison_diagram", "before_after_table", "pros_cons_table", "cause_effect_diagram"].includes(visual.type)) {
    return (
      <section className={`visual-card visual-${visual.type}`}>
        <strong>{visual.title}</strong>
        <div className="visual-table">
          <span>{visual.leftLabel || "Первое"}</span>
          <span>{visual.rightLabel || "Второе"}</span>
          {visual.rows.map((row, index) => (
            <div className="visual-row" key={`${row.label}-${index}`}>
              <p>{row.left || row.label}</p>
              <p>{row.right || row.label}</p>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (visual.type === "timeline") {
    return (
      <section className="visual-card visual-timeline">
        <strong>{visual.title}</strong>
        {visual.items.map((item, index) => (
          <div className="timeline-item" key={`${item.label}-${index}`}>
            <span>{index + 1}</span>
            <p>{item.label}</p>
          </div>
        ))}
      </section>
    );
  }

  if (visual.type === "mind_map") {
    return (
      <section className="visual-card visual-mindmap">
        <strong>{visual.title || slide.title}</strong>
        <div className="mindmap-center">{slide.title}</div>
        <div className="mindmap-nodes">
          {visual.items.slice(0, 6).map((item) => (
            <span key={item.label}>{item.label}</span>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className={`visual-card visual-${visual.type}`}>
      <strong>{visual.title || "Схема"}</strong>
      <div className="visual-steps">
        {(visual.items.length ? visual.items : slide.bullets.map((label) => ({ label, text: "" }))).slice(0, 5).map((item, index) => (
          <div className="visual-step" key={`${item.label}-${index}`}>
            <span>{index + 1}</span>
            <p>{item.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function conceptIcon(icon: string) {
  const map: Record<string, string> = {
    idea: "!",
    process: ">",
    compare: "=",
    cause: "+",
    time: "#",
    map: "*",
    check: "✓",
  };
  return map[icon] || "•";
}
