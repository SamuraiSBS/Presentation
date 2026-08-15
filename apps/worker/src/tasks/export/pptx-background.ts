import { presentationSchema } from "@studydeck/shared";
import type { ExportTheme } from "./presentation-content.js";

type PptxSlide = { addShape: (...args: unknown[]) => void };
type PptxApi = { ShapeType: Record<string, string> };
type PresentationSlide = ReturnType<typeof presentationSchema.parse>["slides"][number];

/** Owns the deterministic decorative background for each PPTX slide variant. */
export function renderPptxSlideBackground(pptx: PptxApi, slide: PptxSlide, item: PresentationSlide, theme: ExportTheme, transparencyOffset = 0) {
  const variant = slideBackgroundVariant(item);
  const soft = Math.min(88, 70 + transparencyOffset);
  const medium = Math.min(82, 58 + transparencyOffset);
  const add = (x: number, y: number, w: number, h: number, color: string, transparency: number, line: Record<string, unknown> = { transparency: 100 }) =>
    slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color, transparency }, line });

  if (variant === "title") { add(0, 0, 4.1, 7.5, theme.pptx.accent, medium); add(10.8, 0, 2.53, 2.4, theme.pptx.accentAlt, soft); return; }
  if (variant === "section") { add(0, 0, 2.15, 7.5, theme.pptx.surfaceAlt, medium); add(0, 3.45, 13.333, 0.18, theme.pptx.accent, soft); return; }
  if (variant === "summary") { add(0, 5.95, 13.333, 1.55, theme.pptx.surfaceAlt, medium); add(10.45, 0, 2.88, 7.5, theme.pptx.accentAlt, soft); return; }
  if (variant === "v1") { add(8.45, 0, 4.88, 7.5, theme.pptx.surfaceAlt, medium); add(9.25, 5.6, 3.35, 0.42, theme.pptx.accentAlt, soft); return; }
  if (variant === "v2") {
    for (let x = 0.35; x < 13.2; x += 1.25) add(x, 0.25, 0.03, 7, theme.pptx.line, 72 + transparencyOffset / 2);
    add(0, 0, 3.2, 1.1, theme.pptx.accent, soft); return;
  }
  if (variant === "v3") {
    add(0.28, 0.25, 12.77, 7, theme.pptx.background, 100, { color: theme.pptx.line, transparency: 18 + transparencyOffset / 3 });
    add(0.55, 0.52, 12.23, 6.46, theme.pptx.background, 100, { color: theme.pptx.accent, transparency: 62 + transparencyOffset / 3 }); return;
  }
  if (variant === "v4") { add(0, 0, 3.8, 7.5, theme.pptx.surfaceAlt, medium); add(9.8, 0, 3.53, 7.5, theme.pptx.accentAlt, soft); return; }
  if (variant === "v5") { add(0, 0, 13.333, 1.25, theme.pptx.surfaceAlt, medium); add(11.25, 0, 2.08, 7.5, theme.pptx.accent, soft); return; }
  add(0, 5.1, 13.333, 2.4, theme.pptx.surfaceAlt, medium);
  add(0.2, 0.2, 2.2, 0.18, theme.pptx.accent, soft);
}

export function slideBackgroundVariant(item: PresentationSlide) {
  if (item.slideKind === "title") return "title";
  if (item.slideKind === "section") return "section";
  if (item.slideKind === "summary") return "summary";
  return `v${(item.order - 1) % 6}`;
}
