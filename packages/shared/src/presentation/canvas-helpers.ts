import type { CanvasElement, CanvasTextElement } from "./schemas.js";
import { presentationTypography, typographyForCanvasText, typographyRoleForCanvasText } from "./typography.js";

export const MIN_GENERATED_BODY_FONT_SIZE = presentationTypography.body.minPx;
export const MIN_GENERATED_CAPTION_FONT_SIZE = presentationTypography.supporting.minPx;
export const CANVAS_SAFE_BOTTOM = 680;
export const CANVAS_SAFE_MARGIN_X = 48;
export const CANVAS_SAFE_TOP = 32;
export const STUDYDECK_EDITORIAL_THEME_ID = "studydeckEditorial";

export function cleanCanvasText(value: unknown) {
  return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

export function minimumReadableFontSize(element: CanvasTextElement) {
  return typographyForCanvasText(element).minPx;
}

export function estimatedTextHeight(value: string, fontSize: number, width: number) {
  return estimatedWrappedLineCount(cleanCanvasText(value), estimatedCharactersPerLine(fontSize, width)) * fontSize * typographyForCanvasText({ id: "", role: "body", text: value }).lineHeight;
}

export function estimatedCharactersPerLine(fontSize: number, width: number) {
  const safeWidth = Math.max(1, width);
  const averageCharacterWidth = fontSize * 0.54;
  return Math.max(1, Math.floor(safeWidth / averageCharacterWidth));
}

export function textSlotCapacity(element: Pick<CanvasTextElement, "id" | "role" | "text" | "typographyRole" | "fontSize" | "w" | "h">) {
  const typography = typographyForCanvasText(element);
  const fontSize = Math.max(element.fontSize, typography.minPx);
  const maxLines = Math.max(1, Math.floor(element.h / (fontSize * typography.lineHeight)));
  const charactersPerLine = estimatedCharactersPerLine(fontSize, element.w);
  return { fontSize, maxLines, charactersPerLine, maxCharacters: maxLines * charactersPerLine };
}

export function minimumTextColumnWidth(element: Pick<CanvasTextElement, "id" | "role" | "text" | "typographyRole">) {
  const role = typographyRoleForCanvasText(element);
  if (role === "slideNumber") return 40;
  if (role === "sourceCredit") return 120;
  if (role === "label" || role === "supporting") return 160;
  if (role === "mainClaim") return 300;
  if (role === "deckTitle" || role === "slideTitle") return 320;
  return 220;
}

/** Keeps a complete sentence where possible, then falls back to a word-safe ellipsis. */
export function compactCanvasTextToFit(value: string, fontSize: number, width: number, height: number, lineHeight = 1.14) {
  const clean = cleanCanvasText(value);
  const maxLines = Math.max(1, Math.floor(height / (fontSize * lineHeight)));
  const maxCharacters = Math.max(1, maxLines * estimatedCharactersPerLine(fontSize, width));
  if (clean.length <= maxCharacters && estimatedTextHeight(clean, fontSize, width) <= height) return clean;

  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  let selected = "";
  for (const sentence of sentences) {
    const candidate = selected ? `${selected} ${sentence}` : sentence;
    if (candidate.length > maxCharacters || estimatedTextHeight(candidate, fontSize, width) > height) break;
    selected = candidate;
  }
  if (selected) return selected;

  const words = clean.split(/\s+/).filter(Boolean);
  const selectedWords: string[] = [];
  for (const word of words) {
    const candidate = [...selectedWords, word].join(" ");
    if (candidate.length + 1 > maxCharacters || estimatedTextHeight(`${candidate}…`, fontSize, width) > height) break;
    selectedWords.push(word);
  }
  return `${selectedWords.join(" ").trim() || clean.slice(0, Math.max(1, maxCharacters - 1)).trim()}…`;
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
