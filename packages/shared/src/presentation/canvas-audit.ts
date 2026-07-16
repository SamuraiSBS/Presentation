import { CANVAS_SAFE_BOTTOM, elementsVisuallyOverlap, estimatedTextHeight, minimumReadableFontSize, sortCanvasElements } from "./canvas-helpers.js";
import type { CanvasElement, CanvasShapeElement, CanvasTextElement, SlideCanvas } from "./schemas.js";

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
    if (element.fontSize < minFontSize) issues.push(`${element.id} uses ${element.fontSize}px text below the ${minFontSize}px readable minimum`);
    if (estimatedTextHeight(element.text, element.fontSize, element.w) > element.h * 1.14) {
      issues.push(`${element.id} text does not fit its box`);
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
  return shape.type === "shape" && text.type === "text" && shape.zIndex < text.zIndex && (shape.h <= 8 || shape.w <= 8);
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
