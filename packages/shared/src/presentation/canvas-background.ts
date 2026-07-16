import { STUDYDECK_EDITORIAL_THEME_ID } from "./canvas-helpers.js";
import type { CanvasBackgroundStyle, PresentationTheme, Slide } from "./schemas.js";

export function slideBackgroundStyle(slide: Pick<Slide, "order" | "slideKind">, theme: PresentationTheme): CanvasBackgroundStyle {
  if (theme.themeId === STUDYDECK_EDITORIAL_THEME_ID) {
    const color = slide.slideKind === "title" || slide.slideKind === "section" || slide.slideKind === "summary"
      ? theme.colors.text
      : theme.colors.background;
    return { type: "solid", color };
  }

  const variant = slideBackgroundVariant(slide);
  const dark = theme.mood === "dark";
  const configurations: Record<string, { angle: number; blobs: Array<{ x: number; y: number; size: number; color: string; opacity: number; blur: number }> }> = {
    title: { angle: 145, blobs: [{ x: 0.18, y: 0.76, size: 0.66, color: theme.colors.accent, opacity: dark ? 0.46 : 0.3, blur: 92 }, { x: 0.76, y: 0.24, size: 0.58, color: theme.colors.accentAlt, opacity: dark ? 0.38 : 0.24, blur: 110 }] },
    section: { angle: 115, blobs: [{ x: 0.12, y: 0.18, size: 0.52, color: theme.colors.accentAlt, opacity: 0.24, blur: 105 }, { x: 0.82, y: 0.8, size: 0.72, color: theme.colors.accent, opacity: 0.28, blur: 120 }] },
    summary: { angle: 160, blobs: [{ x: 0.5, y: 1.02, size: 0.9, color: theme.colors.accentAlt, opacity: 0.26, blur: 125 }] },
    v0: { angle: 125, blobs: [{ x: 0.2, y: 0.84, size: 0.7, color: theme.colors.accent, opacity: 0.22, blur: 120 }] },
    v1: { angle: 90, blobs: [{ x: 0.86, y: 0.26, size: 0.62, color: theme.colors.accentAlt, opacity: 0.25, blur: 112 }] },
    v2: { angle: 35, blobs: [{ x: 0.1, y: 0.15, size: 0.55, color: theme.colors.accent, opacity: 0.2, blur: 100 }, { x: 0.9, y: 0.82, size: 0.62, color: theme.colors.accentAlt, opacity: 0.2, blur: 115 }] },
    v3: { angle: 180, blobs: [{ x: 0.5, y: 0.6, size: 0.82, color: theme.colors.accentAlt, opacity: 0.2, blur: 130 }] },
    v4: { angle: 105, blobs: [{ x: 0.15, y: 0.2, size: 0.7, color: theme.colors.accent, opacity: 0.18, blur: 120 }, { x: 0.82, y: 0.82, size: 0.7, color: theme.colors.accentAlt, opacity: 0.2, blur: 120 }] },
    v5: { angle: 155, blobs: [{ x: 0.78, y: 0.18, size: 0.6, color: theme.colors.accent, opacity: 0.22, blur: 110 }] },
  };
  const config = configurations[variant] || configurations.v0;
  return {
    type: "gradient",
    angle: config.angle,
    stops: [
      { offset: 0, color: theme.colors.background, opacity: 1 },
      { offset: 0.52, color: theme.colors.surfaceAlt, opacity: dark ? 0.64 : 0.52 },
      { offset: 1, color: theme.colors.background, opacity: 1 },
    ],
    blobs: config.blobs,
  };
}

export function canvasBackgroundCss(style: CanvasBackgroundStyle | undefined, fallback: string) {
  if (!style || style.type === "solid") return style?.color || fallback;
  const layers = style.blobs.map((blob) => {
    const radius = Math.max(8, blob.size * 58);
    return `radial-gradient(circle at ${blob.x * 100}% ${blob.y * 100}%, ${hexWithAlpha(blob.color, blob.opacity)} 0%, ${hexWithAlpha(blob.color, blob.opacity * 0.68)} ${radius * 0.36}%, transparent ${radius}%)`;
  });
  const stops = style.stops
    .map((stop) => `${hexWithAlpha(stop.color, stop.opacity)} ${stop.offset * 100}%`)
    .join(", ");
  layers.push(`linear-gradient(${style.angle}deg, ${stops})`);
  return layers.join(", ");
}

function hexWithAlpha(color: string, opacity: number) {
  const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, "0");
  return `${color}${alpha}`;
}

function slideBackgroundVariant(slide: Pick<Slide, "order" | "slideKind">) {
  if (slide.slideKind === "title") return "title";
  if (slide.slideKind === "section") return "section";
  if (slide.slideKind === "summary") return "summary";
  return `v${(slide.order - 1) % 6}`;
}
