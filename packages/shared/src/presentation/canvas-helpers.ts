import type { CanvasElement, CanvasTextElement } from "./schemas.js";

export const MIN_GENERATED_BODY_FONT_SIZE = 22;
export const MIN_GENERATED_CAPTION_FONT_SIZE = 18;
export const CANVAS_SAFE_BOTTOM = 680;
export const STUDYDECK_EDITORIAL_THEME_ID = "studydeckEditorial";

export function cleanCanvasText(value: unknown) {
  return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

export function minimumReadableFontSize(element: CanvasTextElement) {
  if (/-source-\d+$/.test(element.id)) return 14;
  if (element.role === "title") return 28;
  if (element.role === "body") return MIN_GENERATED_BODY_FONT_SIZE;
  if (element.role === "caption" && /^\d{1,2}$/.test(cleanCanvasText(element.text))) return 16;
  if (element.role === "caption") return MIN_GENERATED_CAPTION_FONT_SIZE;
  return 16;
}

export function estimatedTextHeight(value: string, fontSize: number, width: number) {
  const safeWidth = Math.max(1, width);
  const averageCharacterWidth = fontSize * 0.54;
  const charactersPerLine = Math.max(1, Math.floor(safeWidth / averageCharacterWidth));
  const lines = estimatedWrappedLineCount(cleanCanvasText(value), charactersPerLine);
  return Math.ceil(lines * fontSize * 1.14);
}

export function elementsVisuallyOverlap(left: CanvasElement, right: CanvasElement) {
  const overlapX = Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x);
  const overlapY = Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y);
  if (overlapX <= 1 || overlapY <= 1) return false;
  const overlapArea = overlapX * overlapY;
  const smallerArea = Math.max(1, Math.min(left.w * left.h, right.w * right.h));
  return overlapArea / smallerArea > 0.08;
}

function estimatedWrappedLineCount(value: string, charactersPerLine: number) {
  const words = value.split(/\s+/).filter(Boolean);
  if (!words.length) return 1;

  let lines = 1;
  let currentLineLength = 0;

  words.forEach((word) => {
    const separator = currentLineLength ? 1 : 0;
    if (currentLineLength + separator + word.length <= charactersPerLine) {
      currentLineLength += separator + word.length;
      return;
    }

    if (currentLineLength) lines += 1;
    const fullLines = Math.floor(word.length / charactersPerLine);
    lines += Math.max(0, fullLines - (word.length % charactersPerLine === 0 ? 1 : 0));
    currentLineLength = word.length % charactersPerLine || charactersPerLine;
  });

  return lines;
}

export function sortCanvasElements(elements: CanvasElement[]) {
  return [...elements].sort((left, right) => left.zIndex - right.zIndex);
}
