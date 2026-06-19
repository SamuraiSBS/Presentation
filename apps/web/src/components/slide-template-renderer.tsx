import type { CSSProperties, ReactNode } from "react";
import type { PresentationDocument, PresentationTheme, SlideBlock } from "@studydeck/shared";

type Slide = PresentationDocument["slides"][number];

export function slideBackgroundVariant(slide: Slide) {
  if (slide.slideKind === "title") return "title";
  if (slide.slideKind === "section") return "section";
  if (slide.slideKind === "summary") return "summary";
  return `v${(slide.order - 1) % 6}`;
}

export function slideTemplateThemeStyle(theme: PresentationTheme): CSSProperties {
  return {
    "--slide-bg": theme.colors.background,
    "--slide-surface": theme.colors.surface,
    "--slide-surface-alt": theme.colors.surfaceAlt,
    "--slide-text": theme.colors.text,
    "--slide-muted": theme.colors.muted,
    "--slide-accent": theme.colors.accent,
    "--slide-accent-alt": theme.colors.accentAlt,
    "--slide-line": theme.colors.line,
    "--slide-heading-font": `${theme.fonts.heading}, Georgia, Arial, sans-serif`,
    "--slide-body-font": `${theme.fonts.body}, Arial, sans-serif`,
  } as CSSProperties;
}

export function presentationTextForSlide(presentation: PresentationDocument, slide: Slide, activeIndex: number) {
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

export function SlideTemplatePreview({ slide }: { slide: Slide }) {
  const isDivider = slide.slideKind === "title" || slide.slideKind === "section";
  const imageUrl = slideImageUrl(slide);
  const hasVisualContent = hasSlideVisualContent(slide);

  if (isDivider) {
    return (
      <div
        className={`slide-content slide-content-${slide.slideKind} ${imageUrl ? "slide-content-image" : ""}`}
        style={
          imageUrl
            ? { backgroundImage: `linear-gradient(color-mix(in srgb, var(--slide-bg) 90%, transparent), color-mix(in srgb, var(--slide-bg) 94%, transparent)), url("${imageUrl}")` }
            : undefined
        }
      >
        <h2 className="slide-title">{slide.title}</h2>
        {slide.thesis ? <p className="slide-body">{slide.thesis}</p> : null}
        {slide.bullets.length ? <MiniPointRow items={slide.bullets.slice(0, 3)} /> : null}
      </div>
    );
  }

  if (slide.slideKind === "summary") return <SummarySlide slide={slide} />;
  if (slide.layout === "statement") return <StatementSlide slide={slide} />;
  if (slide.layout === "quote") return <QuoteSlide slide={slide} />;
  if (slide.layout === "definition") return <DefinitionSlide slide={slide} />;
  if (slide.layout === "timeline" || slide.layout === "process") return <SequenceSlide slide={slide} mode={slide.layout} />;
  if (slide.layout === "comparison" || slide.layout === "two-column") return <ComparisonSlide slide={slide} />;
  if (slide.layout === "image-focus") return <ImageFocusSlide slide={slide} />;
  if (slide.layout === "case-study") return <CaseStudySlide slide={slide} />;
  if (slide.layout === "question-answer") return <QuestionAnswerSlide slide={slide} />;
  if (slide.layout === "myth-fact") return <MythFactSlide slide={slide} />;
  if (slide.layout === "metrics") return <MetricsSlide slide={slide} />;

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

function VisualImage({ image }: { image: NonNullable<Slide["visual"]["image"]> }) {
  return (
    <figure className="visual-image">
      <img src={image.url} alt={image.alt || ""} loading="lazy" />
      {image.sourceTitle || image.sourceUrl ? <figcaption>{image.sourceTitle || image.sourceUrl}</figcaption> : null}
    </figure>
  );
}

function slideImageUrl(slide: Slide) {
  return slide.visual.image?.url || "";
}

function slideBlockText(slide: Slide, type?: SlideBlock["type"]) {
  const blocks = type ? slide.blocks.filter((block) => block.type === type) : slide.blocks;
  return blocks
    .flatMap((block) => (block.type === "bullets" ? block.items : [block.content]))
    .filter(Boolean)
    .join(" ");
}

function compactItems(slide: Slide) {
  const visualItems = slide.visual.items.map((item) => item.label || item.text).filter(Boolean);
  return (visualItems.length ? visualItems : slide.bullets.length ? slide.bullets : splitDisplaySentences(slideBlockText(slide) || slide.thesis)).slice(0, 5);
}

function splitDisplaySentences(value: string) {
  return value
    .split(/(?<=[.!?])\s+|[;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function SlideImageLayout({ slide, className, children }: { slide: Slide; className: string; children: ReactNode }) {
  const image = slide.visual.image;
  if (!image) return <div className={className}>{children}</div>;

  const reverse = slide.order % 2 === 0;
  return (
    <div className={`${className} slide-with-image ${reverse ? "slide-with-image-reverse" : ""}`}>
      <div className="slide-text-stack">{children}</div>
      <VisualImage image={image} />
    </div>
  );
}

function SummarySlide({ slide }: { slide: Slide }) {
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

function StatementSlide({ slide }: { slide: Slide }) {
  return (
    <SlideImageLayout slide={slide} className="slide-content slide-layout-statement">
      <h2 className="slide-title">{slide.title}</h2>
      <p>{slide.thesis || slideBlockText(slide)}</p>
      {slide.bullets.length ? <MiniPointRow items={slide.bullets.slice(0, 3)} /> : null}
    </SlideImageLayout>
  );
}

function QuoteSlide({ slide }: { slide: Slide }) {
  const quote = slideBlockText(slide, "quote") || slide.thesis || slideBlockText(slide);
  return (
    <SlideImageLayout slide={slide} className="slide-content slide-layout-quote">
      <h2 className="slide-title">{slide.title}</h2>
      <blockquote>{quote}</blockquote>
      {slide.bullets[0] ? <p>{slide.bullets[0]}</p> : null}
    </SlideImageLayout>
  );
}

function DefinitionSlide({ slide }: { slide: Slide }) {
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

function SequenceSlide({ slide, mode }: { slide: Slide; mode: "timeline" | "process" }) {
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

function ComparisonSlide({ slide }: { slide: Slide }) {
  const rows = slide.visual.rows.length
    ? slide.visual.rows
    : [{ label: slide.title, left: slide.bullets[0] || slide.thesis, right: slide.bullets[1] || slideBlockText(slide) }];
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

function ImageFocusSlide({ slide }: { slide: Slide }) {
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

function CaseStudySlide({ slide }: { slide: Slide }) {
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

function QuestionAnswerSlide({ slide }: { slide: Slide }) {
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

function MythFactSlide({ slide }: { slide: Slide }) {
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

function MetricsSlide({ slide }: { slide: Slide }) {
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

function hasSlideVisualContent(slide: Slide) {
  const visual = slide.visual;
  return Boolean(visual?.image?.url || (visual && visual.type !== "none" && !isImageOnlyVisual(visual.type)));
}

function VisualBlock({ slide }: { slide: Slide }) {
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

function isImageOnlyVisual(type: Slide["visual"]["type"]) {
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
