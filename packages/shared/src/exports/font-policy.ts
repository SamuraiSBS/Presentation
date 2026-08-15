/**
 * Exported decks intentionally use a single, Windows-compatible typeface.
 * PDF rendering uses Liberation Sans as the metric-compatible worker fallback;
 * the PPTX keeps Arial so it opens without a substitute on supported Windows
 * PowerPoint installations.
 */
export const EXPORT_FONT_FAMILY = "Arial";
export const EXPORT_PDF_FONT_STACK = 'Arial, "Liberation Sans", "Noto Sans", "DejaVu Sans", sans-serif';

export function exportFontFamily(_requested?: string | null) {
  return EXPORT_FONT_FAMILY;
}

export function exportPdfFontStack(_requested?: string | null) {
  return EXPORT_PDF_FONT_STACK;
}
