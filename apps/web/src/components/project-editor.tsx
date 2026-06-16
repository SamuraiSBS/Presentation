"use client";

import { useState } from "react";
import Link from "next/link";
import type { PresentationDocument, SlideBlock } from "@studydeck/shared";
import { sanitizeProjectForDisplay } from "@/lib/presentation-display";

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
  const activeSlideText = presentation && slide ? presentationTextForSlide(presentation, slide, active) : "";

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
          <div className="slide-workspace">
            <div className="slide-stage">
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
            </div>
            {activeSlideText ? (
              <aside className="slide-text-panel">
                <strong>Текст презентации</strong>
                <textarea
                  className="textarea notes"
                  value={activeSlideText}
                  readOnly
                  aria-label="Текст презентации"
                />
              </aside>
            ) : null}
          </div>
        </section>
      </section>
    </>
  );
}

function presentationTextForSlide(
  presentation: PresentationDocument,
  slide: PresentationDocument["slides"][number],
  activeIndex: number,
) {
  return (
    extractGeneratedTextForSlide(presentation.generatedText, slide.order) ||
    presentation.speechScript.find((item) => item.slideOrder === slide.order)?.text ||
    presentation.speechScript[activeIndex]?.text ||
    slide.speakerNotes
  );
}

function extractGeneratedTextForSlide(generatedText: string, slideOrder: number) {
  const text = generatedText.trim();
  if (!text) return "";

  const slideHeader = new RegExp(`(?:^|\\n)\\s*Слайд\\s+${slideOrder}\\s*:`, "i");
  const current = slideHeader.exec(text);
  if (!current) return "";

  const start = current.index + current[0].length;
  const rest = text.slice(start);
  const next = /\n\s*Слайд\s+\d+\s*:/i.exec(rest);
  return rest.slice(0, next?.index ?? undefined).trim();
}

function VisualImage({ image }: { image: NonNullable<PresentationDocument["slides"][number]["visual"]["image"]> }) {
  return (
    <figure className="visual-image">
      <img src={image.url} alt={image.alt || ""} loading="lazy" />
      {image.sourceTitle || image.sourceUrl ? <figcaption>{image.sourceTitle || image.sourceUrl}</figcaption> : null}
    </figure>
  );
}

function slideImageUrl(slide: PresentationDocument["slides"][number]) {
  return slide.visual.image?.url || "";
}

function SlideCanvas({ slide }: { slide: PresentationDocument["slides"][number] }) {
  const isDivider = slide.slideKind === "title" || slide.slideKind === "section";
  const imageUrl = slideImageUrl(slide);
  const hasVisualContent = hasSlideVisualContent(slide);

  if (isDivider) {
    return (
      <div
        className={`slide-content slide-content-${slide.slideKind} ${imageUrl ? "slide-content-image" : ""}`}
        style={imageUrl ? { backgroundImage: `linear-gradient(rgba(255, 253, 248, 0.9), rgba(255, 253, 248, 0.94)), url("${imageUrl}")` } : undefined}
      >
        <h2 className="slide-title">{slide.title}</h2>
        {slide.thesis ? <p className="slide-body">{slide.thesis}</p> : null}
        {slide.bullets.length ? <MiniPointRow items={slide.bullets.slice(0, 3)} /> : null}
      </div>
    );
  }

  if (slide.slideKind === "summary") {
    return <SummarySlide slide={slide} />;
  }

  if (slide.layout === "statement") {
    return <StatementSlide slide={slide} />;
  }

  if (slide.layout === "quote") {
    return <QuoteSlide slide={slide} />;
  }

  if (slide.layout === "definition") {
    return <DefinitionSlide slide={slide} />;
  }

  if (slide.layout === "timeline" || slide.layout === "process") {
    return <SequenceSlide slide={slide} mode={slide.layout} />;
  }

  if (slide.layout === "comparison" || slide.layout === "two-column") {
    return <ComparisonSlide slide={slide} />;
  }

  if (slide.layout === "image-focus") {
    return <ImageFocusSlide slide={slide} />;
  }

  if (slide.layout === "case-study") {
    return <CaseStudySlide slide={slide} />;
  }

  if (slide.layout === "question-answer") {
    return <QuestionAnswerSlide slide={slide} />;
  }

  if (slide.layout === "myth-fact") {
    return <MythFactSlide slide={slide} />;
  }

  if (slide.layout === "metrics") {
    return <MetricsSlide slide={slide} />;
  }

  return (
    <div className="slide-content slide-content-structured">
      <div className="slide-main">
        <div>
          <h2 className="slide-title">{slide.title}</h2>
          {slide.thesis ? <p className="slide-thesis">{slide.thesis}</p> : null}
        </div>
      </div>

      <div className={`slide-grid ${hasVisualContent ? "" : "slide-grid-single"}`}>
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
        </section>
        {hasVisualContent ? <VisualBlock slide={slide} /> : null}
      </div>
    </div>
  );
}

function slideBlockText(slide: PresentationDocument["slides"][number], type?: SlideBlock["type"]) {
  const blocks = type ? slide.blocks.filter((block) => block.type === type) : slide.blocks;
  return blocks
    .flatMap((block) => (block.type === "bullets" ? block.items : [block.content]))
    .filter(Boolean)
    .join(" ");
}

function compactItems(slide: PresentationDocument["slides"][number]) {
  const visualItems = slide.visual.items.map((item) => item.label || item.text).filter(Boolean);
  return (visualItems.length ? visualItems : slide.bullets.length ? slide.bullets : splitDisplaySentences(slideBlockText(slide) || slide.thesis)).slice(0, 5);
}

function splitDisplaySentences(value: string) {
  return value
    .split(/(?<=[.!?])\s+|[;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function SlideImageLayout({
  slide,
  className,
  children,
}: {
  slide: PresentationDocument["slides"][number];
  className: string;
  children: React.ReactNode;
}) {
  const image = slide.visual.image;
  if (!image) {
    return <div className={className}>{children}</div>;
  }

  const reverse = slide.order % 2 === 0;
  return (
    <div className={`${className} slide-with-image ${reverse ? "slide-with-image-reverse" : ""}`}>
      <div className="slide-text-stack">{children}</div>
      <VisualImage image={image} />
    </div>
  );
}

function SummarySlide({ slide }: { slide: PresentationDocument["slides"][number] }) {
  const items = compactItems(slide);
  return (
    <SlideImageLayout slide={slide} className="slide-content slide-layout-summary">
      <h2 className="slide-title">{slide.title}</h2>
      <div className="summary-grid">
        {items.map((item, index) => (
          <div className="summary-takeaway" key={`${item}-${index}`}>
            <span>{index + 1}</span>
            <p>{item}</p>
          </div>
        ))}
      </div>
    </SlideImageLayout>
  );
}

function StatementSlide({ slide }: { slide: PresentationDocument["slides"][number] }) {
  return (
    <SlideImageLayout slide={slide} className="slide-content slide-layout-statement">
      <h2 className="slide-title">{slide.title}</h2>
      <p>{slide.thesis || slideBlockText(slide)}</p>
      {slide.bullets.length ? <MiniPointRow items={slide.bullets.slice(0, 3)} /> : null}
    </SlideImageLayout>
  );
}

function QuoteSlide({ slide }: { slide: PresentationDocument["slides"][number] }) {
  const quote = slideBlockText(slide, "quote") || slide.thesis || slideBlockText(slide);
  return (
    <SlideImageLayout slide={slide} className="slide-content slide-layout-quote">
      <h2 className="slide-title">{slide.title}</h2>
      <blockquote>{quote}</blockquote>
      {slide.bullets[0] ? <p>{slide.bullets[0]}</p> : null}
    </SlideImageLayout>
  );
}

function DefinitionSlide({ slide }: { slide: PresentationDocument["slides"][number] }) {
  const definition = slide.definition || { term: slide.title, text: slide.thesis || slideBlockText(slide) };
  const showTerm = definition.term && !isDuplicateDisplayText(definition.term, slide.title);
  return (
    <SlideImageLayout slide={slide} className="slide-content slide-layout-definition">
      <h2 className="slide-title">{slide.title}</h2>
      <div className="definition-hero">
        {showTerm ? <strong>{definition.term}</strong> : null}
        <p>{definition.text}</p>
      </div>
      {slide.bullets.length ? <MiniPointRow items={slide.bullets.slice(0, 3)} /> : null}
    </SlideImageLayout>
  );
}

function SequenceSlide({ slide, mode }: { slide: PresentationDocument["slides"][number]; mode: "timeline" | "process" }) {
  const items = compactItems(slide);
  return (
    <SlideImageLayout slide={slide} className={`slide-content slide-layout-sequence slide-layout-${mode}`}>
      <h2 className="slide-title">{slide.title}</h2>
      {slide.thesis ? <p className="slide-kicker">{slide.thesis}</p> : null}
      <div className="sequence-track">
        {items.map((item, index) => (
          <div className="sequence-node" key={`${item}-${index}`}>
            <span>{index + 1}</span>
            <p>{item}</p>
          </div>
        ))}
      </div>
    </SlideImageLayout>
  );
}

function ComparisonSlide({ slide }: { slide: PresentationDocument["slides"][number] }) {
  const rows = slide.visual.rows.length
    ? slide.visual.rows
    : [
        {
          label: slide.title,
          left: slide.bullets[0] || slide.thesis,
          right: slide.bullets[1] || slideBlockText(slide),
        },
      ];
  return (
    <SlideImageLayout slide={slide} className="slide-content slide-layout-comparison">
      <h2 className="slide-title">{slide.title}</h2>
      <div className="comparison-board">
        <strong>{slide.visual.leftLabel || "Первое"}</strong>
        <strong>{slide.visual.rightLabel || "Второе"}</strong>
        {rows.slice(0, 4).map((row, index) => (
          <div className="comparison-row" key={`${row.label}-${index}`}>
            <p>{row.left || row.label}</p>
            <p>{row.right || row.label}</p>
          </div>
        ))}
      </div>
    </SlideImageLayout>
  );
}

function ImageFocusSlide({ slide }: { slide: PresentationDocument["slides"][number] }) {
  return (
    <div className="slide-content slide-layout-image-focus">
      <div>
        <h2 className="slide-title">{slide.title}</h2>
        {slide.thesis ? <p>{slide.thesis}</p> : null}
        {slide.bullets.length ? <MiniPointRow items={slide.bullets.slice(0, 3)} /> : null}
      </div>
      {slide.visual.image ? <VisualImage image={slide.visual.image} /> : null}
    </div>
  );
}

function CaseStudySlide({ slide }: { slide: PresentationDocument["slides"][number] }) {
  const items = compactItems(slide);
  const labels = ["Ситуация", "Действие", "Результат"];
  return (
    <SlideImageLayout slide={slide} className="slide-content slide-layout-case">
      <h2 className="slide-title">{slide.title}</h2>
      <div className="case-grid">
        {labels.map((label, index) => (
          <div className="case-step" key={label}>
            <strong>{label}</strong>
            <p>{items[index] || slide.thesis}</p>
          </div>
        ))}
      </div>
    </SlideImageLayout>
  );
}

function QuestionAnswerSlide({ slide }: { slide: PresentationDocument["slides"][number] }) {
  return (
    <SlideImageLayout slide={slide} className="slide-content slide-layout-qa">
      <h2 className="slide-title">{slide.title}</h2>
      <div className="answer-panel">
        <strong>Ответ</strong>
        <p>{slide.thesis || slideBlockText(slide)}</p>
      </div>
      {slide.bullets.length ? <MiniPointRow items={slide.bullets.slice(0, 3)} /> : null}
    </SlideImageLayout>
  );
}

function MythFactSlide({ slide }: { slide: PresentationDocument["slides"][number] }) {
  const items = compactItems(slide);
  return (
    <SlideImageLayout slide={slide} className="slide-content slide-layout-myth">
      <h2 className="slide-title">{slide.title}</h2>
      <div className="myth-fact-grid">
        <div>
          <strong>Миф</strong>
          <p>{items[0] || slide.title}</p>
        </div>
        <div>
          <strong>Факт</strong>
          <p>{items[1] || slide.thesis}</p>
        </div>
      </div>
    </SlideImageLayout>
  );
}

function MetricsSlide({ slide }: { slide: PresentationDocument["slides"][number] }) {
  const items = compactItems(slide);
  return (
    <SlideImageLayout slide={slide} className="slide-content slide-layout-metrics">
      <h2 className="slide-title">{slide.title}</h2>
      <div className="metric-grid">
        {items.slice(0, 4).map((item, index) => (
          <div className="metric-tile" key={`${item}-${index}`}>
            <strong>{metricLead(item, index)}</strong>
            <p>{item}</p>
          </div>
        ))}
      </div>
    </SlideImageLayout>
  );
}

function metricLead(item: string, index: number) {
  return item.match(/\d+[.,]?\d*\s*[%\wА-Яа-я-]*/u)?.[0] || String(index + 1).padStart(2, "0");
}

function MiniPointRow({ items }: { items: string[] }) {
  return (
    <div className="mini-point-row">
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}

function hasSlideVisualContent(slide: PresentationDocument["slides"][number]) {
  const visual = slide.visual;
  return Boolean(visual?.image?.url || (visual && visual.type !== "none" && !isImageOnlyVisual(visual.type)));
}

function VisualBlock({ slide }: { slide: PresentationDocument["slides"][number] }) {
  const visual = slide.visual;
  const image = visual?.image;
  const imageFigure = image ? <VisualImage image={image} /> : null;
  const visualTitle = visual?.title && !isDuplicateDisplayText(visual.title, slide.title) ? visual.title : "";
  if (!visual || visual.type === "none") {
    return imageFigure ? <section className="visual-card visual-image-card">{imageFigure}</section> : null;
  }

  if (isImageOnlyVisual(visual.type)) {
    return imageFigure ? <section className="visual-card visual-image-card">{imageFigure}</section> : null;
  }

  if (visual.rows.length && ["comparison_diagram", "before_after_table", "pros_cons_table", "cause_effect_diagram"].includes(visual.type)) {
    return (
      <section className={`visual-card visual-${visual.type}`}>
        {imageFigure}
        {visualTitle ? <strong>{visualTitle}</strong> : null}
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
        {imageFigure}
        {visualTitle ? <strong>{visualTitle}</strong> : null}
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
        {imageFigure}
        {visualTitle ? <strong>{visualTitle}</strong> : null}
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
      {imageFigure}
      {visualTitle ? <strong>{visualTitle}</strong> : null}
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

function isImageOnlyVisual(type: PresentationDocument["slides"][number]["visual"]["type"]) {
  return type === "image" || type === "illustration";
}

function isDuplicateDisplayText(value: string, reference: string) {
  const left = normalizeComparableText(value);
  const right = normalizeComparableText(reference);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  return shorter.length >= 18 && longer.includes(shorter);
}

function normalizeComparableText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
