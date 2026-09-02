import {
  CANVAS_SAFE_BOTTOM,
  CANVAS_SAFE_MARGIN_X,
  CANVAS_SAFE_TOP,
  elementsVisuallyOverlap,
  estimatedTextHeight,
  minimumReadableFontSize,
  minimumTextColumnWidth,
  sortCanvasElements,
  textSlotCapacity,
} from "./canvas-helpers.js";
import type { CanvasElement, CanvasShapeElement, CanvasTextElement, SlideCanvas } from "./schemas.js";
import { typographyRoleForCanvasText } from "./typography.js";

export function auditSlideCanvas(canvas: SlideCanvas) {
  const issues: string[] = [];
  const ids = new Set<string>();
  const visible = sortCanvasElements(canvas.elements).filter((element) => element.opacity > 0.02);

  if (canvas.width <= 0 || canvas.height <= 0) issues.push("canvas has invalid dimensions");

  visible.forEach((element) => {
    if (ids.has(element.id)) issues.push(`${element.id} duplicates another canvas element id`);
    ids.add(element.id);
    if (element.x < 0 || element.y < 0 || element.x + element.w > canvas.width || element.y + element.h > canvas.height) {
      issues.push(`${element.id} is outside the slide bounds`);
    }
    if (element.type !== "text") return;

    const minFontSize = minimumReadableFontSize(element);
    if (/(?:…|\.\.\.)\s*$/.test(element.text)) {
      issues.push(`${element.id} ends with truncated text`);
    }
    if (element.fontSize < minFontSize) issues.push(`${element.id} uses ${element.fontSize}px text below the ${minFontSize}px readable minimum`);
    if (element.autoFit && element.fontSize <= minFontSize) issues.push(`${element.id} enables autoFit at the readable minimum`);
    if (estimatedTextHeight(element.text, element.fontSize, element.w) > element.h * 1.14) {
      issues.push(`${element.id} text does not fit its box`);
    }
    const capacity = textSlotCapacity(element);
    const isDecorativeGlyph = /^[«»“”"'`]+$/u.test(element.text.trim());
    if (!isDecorativeGlyph && element.w < minimumTextColumnWidth(element)) {
      issues.push(`${element.id} uses a ${Math.round(element.w)}px text column below its readable minimum`);
    }
    if (element.text.length > capacity.maxCharacters * 1.15) {
      issues.push(`${element.id} exceeds its ${capacity.maxLines}-line text capacity`);
    }
    if (hasUnbreakableOverflow(element.text, capacity.charactersPerLine)) {
      issues.push(`${element.id} contains a long word or URL that can overflow its text box`);
    }
    const typographyRole = typographyRoleForCanvasText(element);
    const isFooterException = typographyRole === "sourceCredit" || typographyRole === "slideNumber";
    if (!isFooterException && (element.x < CANVAS_SAFE_MARGIN_X || element.y < CANVAS_SAFE_TOP || element.x + element.w > canvas.width - CANVAS_SAFE_MARGIN_X || element.y + element.h > CANVAS_SAFE_BOTTOM)) {
      issues.push(`${element.id} is outside the readable safe margins`);
    }
    const container = element.groupId
      ? visible.find((candidate): candidate is CanvasShapeElement =>
          candidate.type === "shape" && candidate.groupId === element.groupId && candidate.id !== element.id,
        )
      : undefined;
    if (container && !shapeContainsElement(container, element)) {
      issues.push(`${element.id} extends outside ${container.id}`);
    }
  });

  visible.forEach((element, index) => {
    for (const other of visible.slice(index + 1)) {
      if (!elementsVisuallyOverlap(element, other)) continue;
      if (isAllowedCanvasOverlap(element, other)) continue;
      issues.push(`${element.id} overlaps ${other.id}`);
    }
  });

  return issues;
}

/** Checks deterministic generated slots without inspecting user-created art. */
export function auditGeneratedCanvasText(
  canvas: SlideCanvas | undefined,
  slide: { id: string; title: string; thesis: string },
) {
  if (!canvas) return ["canvas is missing"];
  const textById = new Map(canvas.elements
    .filter((element): element is CanvasTextElement => element.type === "text")
    .map((element) => [element.id, element.text.trim()]));
  const issues: string[] = [];
  const title = textById.get(`${slide.id}-title`);
  if (title !== undefined && title !== slide.title.trim()) issues.push("canvas title diverges from canonical slide title");
  const body = textById.get(`${slide.id}-body`);
  if (body !== undefined && slide.thesis.trim() && !body.includes(slide.thesis.trim())) issues.push("canvas body diverges from canonical slide thesis");
  return issues;
}

/**
 * Checks the persisted projection of a generated slide.  This is deliberately
 * narrower than a visual audit: custom canvases are user-authored and must not
 * be reconstructed just because their text does not mirror a generated slot.
 */
export function auditCanonicalSlideCanvas(slide: {
  id: string;
  title: string;
  thesis: string;
  bullets?: string[];
  visual?: { type?: string; image?: { url?: string; objectKey?: string } };
  canvas?: SlideCanvas;
}) {
  if (slide.canvas?.elements.some((element) => element.id === `${slide.id}-custom-canvas-marker`)) return [];
  const issues = auditGeneratedCanvasText(slide.canvas, slide);
  if (slide.visual?.type === "image" && !slide.visual.image?.url && !slide.visual.image?.objectKey) {
    issues.push("image visual has no canonical image asset");
  }
  if (!slide.canvas) return issues;
  const text = slide.canvas.elements
    .filter((element): element is CanvasTextElement => element.type === "text")
    .map((element) => element.text.trim())
    .filter(Boolean);
  const fallback = /(?:коротко\s+и\s+по\s+существу|short\s+and\s+to\s+the\s+point)/iu;
  if (text.some((value) => fallback.test(value))) issues.push("canvas contains a synthetic fallback phrase");
  return issues;
}

export function repairUnsafeGeneratedElements(elements: CanvasElement[]) {
  const optionalPlaquesUnsafe = elements.some((element) =>
    /-mini-\d+(?:-shape)?$/.test(element.id) && element.y + element.h > CANVAS_SAFE_BOTTOM,
  );
  if (!optionalPlaquesUnsafe) return elements;
  return elements.filter((element) => !/-mini-\d+(?:-shape)?$/.test(element.id));
}

function isAllowedCanvasOverlap(left: CanvasElement, right: CanvasElement) {
  if (left.groupId && left.groupId === right.groupId) {
    if (left.type === "shape" && right.type === "text") return shapeContainsElement(left, right);
    if (right.type === "shape" && left.type === "text") return shapeContainsElement(right, left);
  }
  if (isTextBackplatePair(left, right) || isTextBackplatePair(right, left)) return true;
  if (isTextBackplateBehindText(left, right) || isTextBackplateBehindText(right, left)) return true;
  if (isDecorativeRuleBehindText(left, right) || isDecorativeRuleBehindText(right, left)) return true;
  if (isSoftBackgroundBehindText(left, right) || isSoftBackgroundBehindText(right, left)) return true;
  if (isEditorialFieldBehindForeground(left, right) || isEditorialFieldBehindForeground(right, left)) return true;
  if (left.type === "shape" && right.type === "shape") return true;
  if (left.type === "image" && right.type === "shape") return right.opacity >= 0.65 && right.zIndex > left.zIndex;
  if (right.type === "image" && left.type === "shape") return left.opacity >= 0.65 && left.zIndex > right.zIndex;
  return false;
}

function shapeContainsElement(shape: CanvasShapeElement, element: CanvasElement) {
  const tolerance = 2;
  return element.x >= shape.x - tolerance && element.y >= shape.y - tolerance
    && element.x + element.w <= shape.x + shape.w + tolerance
    && element.y + element.h <= shape.y + shape.h + tolerance;
}

function isTextBackplatePair(shape: CanvasElement, text: CanvasElement) {
  return shape.id === `${text.id}-backplate` || text.id === `${shape.id}-backplate`;
}

function isTextBackplateBehindText(background: CanvasElement, text: CanvasElement) {
  return background.type === "shape"
    && text.type === "text"
    && background.id.endsWith("-backplate")
    && background.zIndex < text.zIndex
    && background.opacity <= 0.96;
}

function isDecorativeRuleBehindText(shape: CanvasElement, text: CanvasElement) {
  if (/-sequence-line$/.test(shape.id) && /-step-\d+-num$/.test(text.id)) return true;
  return shape.type === "shape" && text.type === "text" && shape.zIndex < text.zIndex && (shape.h <= 8 || shape.w <= 8)
    && !intersectsGlyphArea(shape, text);
}

function hasUnbreakableOverflow(value: string, charactersPerLine: number) {
  return value.split(/\s+/).some((token) =>
    token.split(/\u200B/).some((segment) => segment.length > charactersPerLine),
  );
}

function intersectsGlyphArea(shape: CanvasElement, text: CanvasElement) {
  const insetX = Math.min(12, text.w * 0.08);
  const insetY = Math.min(8, text.h * 0.12);
  const glyphArea = { x: text.x + insetX, y: text.y + insetY, w: Math.max(1, text.w - insetX * 2), h: Math.max(1, text.h - insetY * 2) };
  const overlapX = Math.min(shape.x + shape.w, glyphArea.x + glyphArea.w) - Math.max(shape.x, glyphArea.x);
  const overlapY = Math.min(shape.y + shape.h, glyphArea.y + glyphArea.h) - Math.max(shape.y, glyphArea.y);
  return overlapX > 1 && overlapY > 1;
}

function isSoftBackgroundBehindText(background: CanvasElement, text: CanvasElement) {
  if (text.type !== "text" || background.zIndex >= text.zIndex) return false;
  if (background.type === "image") return background.opacity <= 0.4 || /bg|background/i.test(background.id);
  return background.type === "shape" && /wash|bg|background/i.test(background.id) && background.opacity >= 0.55;
}

function isEditorialFieldBehindForeground(background: CanvasElement, foreground: CanvasElement) {
  return background.type === "shape"
    && /-editorial-field(?:-|$)/.test(background.id)
    && background.opacity <= 0.25
    && background.zIndex < foreground.zIndex;
}
