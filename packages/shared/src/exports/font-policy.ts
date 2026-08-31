/**
 * Exported decks intentionally use the same rounded typeface as the product UI.
 * PDF rendering keeps broad fallbacks for worker environments where the bundled
 * webfont cannot be loaded.
 */
import { PRESENTATION_FONT_FAMILY } from "../presentation/fonts.js";

export const EXPORT_FONT_FAMILY = PRESENTATION_FONT_FAMILY;
export const EXPORT_PDF_FONT_STACK = `"${PRESENTATION_FONT_FAMILY}", "${PRESENTATION_FONT_FAMILY} Variable", "Liberation Sans", "Noto Sans", "DejaVu Sans", sans-serif`;

export function exportFontFamily(_requested?: string | null) {
  return EXPORT_FONT_FAMILY;
}

export function exportPdfFontStack(_requested?: string | null) {
  return EXPORT_PDF_FONT_STACK;
}
