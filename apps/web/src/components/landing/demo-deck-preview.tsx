import type { CSSProperties } from "react";
import { resolvePresentationTheme, type PresentationDocument } from "@studydeck/shared";
import {
  SlideTemplatePreview,
  slideBackgroundVariant,
  slideTemplateThemeStyle,
} from "@/components/slide-template-renderer";
import { cn } from "@/lib/utils";

type DemoSlidePreviewProps = {
  document: PresentationDocument;
  slideIndex?: number;
  className?: string;
};

type DemoDeckPreviewProps = {
  document: PresentationDocument;
  title: string;
  className?: string;
  maxSlides?: number;
  variant?: "stack" | "sequence";
};

/**
 * A small, read-only wrapper around the same template renderer used by the
 * editor and export surfaces. Landing previews intentionally do not introduce
 * a second slide-rendering implementation.
 */
export function DemoSlidePreview({ document, slideIndex = 0, className }: DemoSlidePreviewProps) {
  const slide = document.slides[slideIndex] ?? document.slides[0];

  if (!slide) return null;

  const theme = resolvePresentationTheme({
    title: document.title,
    scenario: document.scenario,
    level: document.level,
    presentationTheme: document.presentationTheme ?? undefined,
    designBrief: document.designBrief,
  });

  return (
    <div className={cn("landing-demo-slide", className)}>
      <div
        className="slide-canvas landing-demo-slide-canvas"
        data-bg-variant={slideBackgroundVariant(slide)}
        data-theme-preset={theme.preset}
        style={slideTemplateThemeStyle(theme)}
      >
        <SlideTemplatePreview slide={slide} />
      </div>
    </div>
  );
}

export function DemoDeckPreview({
  document,
  title,
  className,
  maxSlides,
  variant = "stack",
}: DemoDeckPreviewProps) {
  const slideLimit = Math.max(1, maxSlides ?? (variant === "sequence" ? document.slides.length : 3));
  const slides = document.slides.slice(0, slideLimit);

  if (!slides.length) return null;

  if (variant === "sequence") {
    return (
      <ol className={cn("landing-demo-deck", "landing-demo-deck-sequence", className)} aria-label={`Слайды: ${title}`}>
        {slides.map((slide, index) => (
          <li className="landing-demo-deck-sequence-item" key={slide.id}>
            <DemoSlidePreview document={document} slideIndex={index} />
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div
      className={cn("landing-demo-deck", "landing-demo-deck-stack", className)}
      data-slide-count={slides.length}
      aria-label={`Фрагмент презентации: ${title}`}
      role="group"
    >
      {slides.map((slide, index) => (
        <div
          className="landing-demo-deck-stack-item"
          key={slide.id}
          style={{ "--landing-deck-index": index } as CSSProperties}
        >
          <DemoSlidePreview document={document} slideIndex={index} />
        </div>
      ))}
    </div>
  );
}
