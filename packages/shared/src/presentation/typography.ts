import type { CanvasTextElement } from "./schemas.js";

/**
 * Shared canvas typography for the 1280×720 presentation surface.  The
 * values are CSS pixels; PPTX converts them to points using 0.75 and the PDF
 * renderer uses them directly.  Generated canvases must not go below these
 * minima in order to remain readable from a classroom projector.
 */
export const presentationTypography = {
  deckTitle: { minPx: 50, preferredPx: 58, lineHeight: 1.1 },
  slideTitle: { minPx: 40, preferredPx: 44, lineHeight: 1.12 },
  mainClaim: { minPx: 44, preferredPx: 50, lineHeight: 1.12 },
  body: { minPx: 27, preferredPx: 30, lineHeight: 1.14 },
  supporting: { minPx: 24, preferredPx: 24, lineHeight: 1.14 },
  label: { minPx: 24, preferredPx: 24, lineHeight: 1.1 },
  sourceCredit: { minPx: 14, preferredPx: 14, lineHeight: 1.1 },
  slideNumber: { minPx: 16, preferredPx: 16, lineHeight: 1.1 },
} as const;

export type PresentationTypographyRole = keyof typeof presentationTypography;

export function typographyRoleForCanvasText(element: Pick<CanvasTextElement, "id" | "role" | "text" | "typographyRole">): PresentationTypographyRole {
  if (element.typographyRole) return element.typographyRole;
  if (/-source-\d+$|(?:source|credit|attribution)(?:-|$)/i.test(element.id)) return "sourceCredit";
  if (/(?:slide|page)-?(?:number|no)|-(?:number|order)$/i.test(element.id) || (element.role === "caption" && /^\d{1,2}$/.test(element.text.trim()))) return "slideNumber";
  if (element.role === "caption") return /label|mini|chip|tag/i.test(element.id) ? "label" : "supporting";
  if (element.role === "title") return "slideTitle";
  if (/statement|quote|thesis|conclusion|phrase|poster/i.test(element.id)) return "mainClaim";
  if (/label|mini|chip|tag|criterion/i.test(element.id)) return "label";
  return "body";
}

export function typographyForCanvasText(element: Pick<CanvasTextElement, "id" | "role" | "text" | "typographyRole">) {
  return presentationTypography[typographyRoleForCanvasText(element)];
}

export function canvasTextLineHeight(element: Pick<CanvasTextElement, "id" | "role" | "text" | "typographyRole">) {
  return typographyForCanvasText(element).lineHeight;
}
