import type { CSSProperties, PointerEvent } from "react";
import { PRESENTATION_FONT_STACK } from "@studydeck/shared";
import type { CanvasElement, CanvasShapeElement, CanvasTextElement, Slide, SlideCanvas } from "@studydeck/shared";

export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;
export const CUSTOM_CANVAS_MARKER_SUFFIX = "custom-canvas-marker";
export const MIN_READABLE_TEXT_SIZE = 12;
const TEXT_LINE_HEIGHT = 1.14;
const CANVAS_EDGE_MARGIN = 32;
const BACKPLATE_PADDING_X = 18;
const BACKPLATE_PADDING_Y = 12;


export function markCanvasAsCustom(slideId: string, canvas: SlideCanvas): SlideCanvas {
  const markerId = `${slideId}-${CUSTOM_CANVAS_MARKER_SUFFIX}`;
  if (canvas.elements.some((element) => element.id === markerId)) return canvas;

  const marker: CanvasShapeElement = {
    id: markerId,
    type: "shape",
    shape: "rect",
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    rotation: 0,
    zIndex: -1,
    opacity: 0,
    locked: true,
    fill: "#000000",
    stroke: "#000000",
    strokeWidth: 0,
  };

  return { ...canvas, elements: [...canvas.elements, marker] };
}


export function floatingMenuStyle(
  element: CanvasElement,
  scale: number,
  canvasWidth: number,
  canvasHeight: number,
): CSSProperties {
  const menuWidth = element.type === "text" ? 360 : 300;
  const menuHeight = element.type === "text" ? 92 : 84;
  const viewportWidth = canvasWidth * scale;
  const viewportHeight = canvasHeight * scale;
  const centerX = (element.x + element.w / 2) * scale;
  const above = element.y * scale - menuHeight - 10;
  const below = (element.y + element.h) * scale + 10;

  return {
    left: `${clamp(centerX - menuWidth / 2, 8, Math.max(8, viewportWidth - menuWidth - 8))}px`,
    top: `${above >= 8 ? above : clamp(below, 8, Math.max(8, viewportHeight - menuHeight - 8))}px`,
    width: `${menuWidth}px`,
  };
}


export function elementStyle(element: CanvasElement): CSSProperties {
  return {
    left: `${element.x}px`,
    top: `${element.y}px`,
    width: `${element.w}px`,
    height: `${element.h}px`,
    transform: `rotate(${element.rotation}deg)`,
    zIndex: element.zIndex,
    opacity: element.opacity,
  };
}

export function fittedTextSize(
  element: CanvasTextElement,
  width: number,
  height: number,
): number | null {
  const maximum = Math.max(
    MIN_READABLE_TEXT_SIZE,
    Math.floor(element.fontSize),
  );
  if (textFitsBox(element, width, height, maximum)) return maximum;
  if (!textFitsBox(element, width, height, MIN_READABLE_TEXT_SIZE)) return null;

  let low = MIN_READABLE_TEXT_SIZE;
  let high = maximum;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (textFitsBox(element, width, height, middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function textFitsBox(
  element: CanvasTextElement,
  width: number,
  height: number,
  fontSize: number,
) {
  if (!element.text.trim()) return true;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return true;
  context.font = `${element.bold ? 800 : 400} ${fontSize}px ${PRESENTATION_FONT_STACK}`;

  let lines = 0;
  for (const paragraph of element.text.split("\n")) {
    if (!paragraph) {
      lines += 1;
      continue;
    }
    let currentWidth = 0;
    for (const token of paragraph.match(/\S+\s*/g) || [paragraph]) {
      const tokenWidth = context.measureText(token).width;
      if (tokenWidth <= width) {
        if (currentWidth > 0 && currentWidth + tokenWidth > width) {
          lines += 1;
          currentWidth = tokenWidth;
        } else {
          currentWidth += tokenWidth;
        }
        continue;
      }
      for (const character of token) {
        const characterWidth = context.measureText(character).width;
        if (characterWidth > width) return false;
        if (currentWidth > 0 && currentWidth + characterWidth > width) {
          lines += 1;
          currentWidth = characterWidth;
        } else {
          currentWidth += characterWidth;
        }
      }
    }
    lines += 1;
  }
  return lines * fontSize * 1.14 <= height + 0.5;
}

export function textStyle(element: CanvasTextElement): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    color: element.color,
    fontFamily: PRESENTATION_FONT_STACK,
    fontSize: `${element.fontSize}px`,
    fontWeight: element.bold ? 800 : 400,
    fontStyle: "normal",
    textDecoration: element.underline ? "underline" : "none",
    textAlign: element.align,
    display: "flex",
    flexDirection: "column",
    justifyContent:
      element.valign === "middle"
        ? "center"
        : element.valign === "bottom"
          ? "flex-end"
          : "flex-start",
    lineHeight: 1.14,
    outline: "none",
    overflow: "hidden",
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
  };
}

/**
 * Grow an edited text element without shrinking its approved design.
 *
 * The editor intentionally grows width first, matching the slide behavior the
 * user sees in the preview. Once the available horizontal space is exhausted,
 * the measured wrapped height grows instead. Generated backplates and grouped
 * containers follow the text so the background never clips the new copy.
 */
export function growCanvasTextElement(
  canvas: SlideCanvas,
  element: CanvasTextElement,
  value: string,
): SlideCanvas {
  const text = value.replace(/\r\n?/g, "\n");
  const relatedIds = new Set([
    element.id,
    `${element.id}-backplate`,
    `${element.id}-shape`,
  ]);
  const rightBoundary = canvas.elements
    .filter((candidate) => {
      if (relatedIds.has(candidate.id) || candidate.x <= element.x) return false;
      const overlapsVertically = candidate.y < element.y + element.h && candidate.y + candidate.h > element.y;
      return overlapsVertically && candidate.opacity > 0;
    })
    .reduce(
      (boundary, candidate) => Math.min(boundary, candidate.x - CANVAS_EDGE_MARGIN / 2),
      canvas.width - CANVAS_EDGE_MARGIN,
    );
  const maxWidth = Math.max(element.w, rightBoundary - element.x);
  const measurement = measureCanvasText(text, element, maxWidth);
  const nextText: CanvasTextElement = {
    ...element,
    text,
    runs: [{ text }],
    w: Math.min(maxWidth, Math.max(element.w, Math.ceil(measurement.width))),
    h: Math.min(
      canvas.height - element.y,
      Math.max(
        element.h,
        Math.ceil(measurement.lines * element.fontSize * TEXT_LINE_HEIGHT),
      ),
    ),
  };

  const nextElements = canvas.elements.map((candidate) => {
    if (candidate.id === element.id) return nextText;
    if (
      candidate.type === "shape" &&
      (candidate.id === `${element.id}-backplate` || candidate.id === `${element.id}-shape`)
    ) {
      return resizeBackplate(candidate, nextText, canvas);
    }
    if (element.groupId && candidate.type === "shape" && candidate.groupId === element.groupId) {
      return resizeGroupContainer(candidate, canvas.elements, nextText, canvas);
    }
    return candidate;
  });

  return { ...canvas, elements: nextElements };
}

function measureCanvasText(
  value: string,
  element: CanvasTextElement,
  maxWidth: number,
) {
  const context = typeof document === "undefined"
    ? null
    : document.createElement("canvas").getContext("2d");
  if (context) {
    context.font = `${element.bold ? 800 : 400} ${element.fontSize}px ${element.fontFamily || PRESENTATION_FONT_STACK}`;
  }

  const measure = (sample: string) => context
    ? context.measureText(sample).width
    : sample.length * element.fontSize * (element.bold ? 0.6 : 0.54);
  const paragraphs = value.split("\n");
  let lines = 0;
  let widestLine = 0;

  paragraphs.forEach((paragraph) => {
    const wrapped = wrapCanvasLine(paragraph, maxWidth, measure);
    lines += wrapped.lines;
    widestLine = Math.max(widestLine, wrapped.widest);
  });

  return { lines: Math.max(1, lines), width: Math.min(maxWidth, widestLine) };
}

function wrapCanvasLine(
  value: string,
  maxWidth: number,
  measure: (value: string) => number,
) {
  const normalized = value || " ";
  const words = normalized.match(/\S+\s*/g) || [normalized];
  let lines = 1;
  let current = "";
  let widest = 0;

  words.forEach((word) => {
    if (measure(word) > maxWidth) {
      if (current) {
        widest = Math.max(widest, measure(current));
        lines += 1;
        current = "";
      }
      for (const character of word) {
        const characterLine = `${current}${character}`;
        if (current && measure(characterLine) > maxWidth) {
          widest = Math.max(widest, measure(current));
          lines += 1;
          current = character;
        } else {
          current = characterLine;
        }
      }
      return;
    }
    const candidate = current ? `${current}${word}` : word;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      return;
    }
    widest = Math.max(widest, measure(current));
    lines += 1;
    current = word;
  });

  widest = Math.max(widest, Math.min(maxWidth, measure(current)));
  return { lines, widest };
}

function resizeBackplate(
  shape: Extract<CanvasElement, { type: "shape" }>,
  text: CanvasTextElement,
  canvas: SlideCanvas,
) {
  const paddingX = text.role === "title" ? 26 : BACKPLATE_PADDING_X;
  const paddingY = text.role === "title" ? 16 : BACKPLATE_PADDING_Y;
  const x = Math.max(0, text.x - paddingX);
  const y = Math.max(0, text.y - paddingY);
  const right = Math.min(canvas.width, text.x + text.w + paddingX);
  const bottom = Math.min(canvas.height, text.y + text.h + paddingY);
  const left = Math.min(shape.x, x);
  const top = Math.min(shape.y, y);
  const safeRight = Math.max(shape.x + shape.w, right);
  const safeBottom = Math.max(shape.y + shape.h, bottom);
  return {
    ...shape,
    x: left,
    y: top,
    w: Math.max(1, Math.min(canvas.width, safeRight) - left),
    h: Math.max(1, Math.min(canvas.height, safeBottom) - top),
  };
}

function resizeGroupContainer(
  shape: Extract<CanvasElement, { type: "shape" }>,
  originalElements: CanvasElement[],
  editedText: CanvasTextElement,
  canvas: SlideCanvas,
) {
  const groupElements = originalElements
    .filter((candidate) => candidate.groupId === editedText.groupId)
    .map((candidate) => candidate.id === editedText.id ? editedText : candidate);
  const left = Math.max(0, Math.min(...groupElements.map((candidate) => candidate.x)));
  const top = Math.max(0, Math.min(...groupElements.map((candidate) => candidate.y)));
  const right = Math.min(canvas.width, Math.max(...groupElements.map((candidate) => candidate.x + candidate.w)));
  const bottom = Math.min(canvas.height, Math.max(...groupElements.map((candidate) => candidate.y + candidate.h)));
  return {
    ...shape,
    x: left,
    y: top,
    w: Math.max(1, right - left),
    h: Math.max(1, bottom - top),
  };
}

export function shapeStyle(element: CanvasShapeElement): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    background: element.shape === "line" ? "transparent" : element.fill,
    border:
      element.shape === "line"
        ? "0"
        : `${element.strokeWidth}px solid ${element.stroke}`,
    borderRadius:
      element.shape === "roundRect"
        ? 18
        : element.shape === "ellipse"
          ? "50%"
          : 0,
    borderTop:
      element.shape === "line"
        ? `${Math.max(1, element.strokeWidth)}px solid ${element.stroke}`
        : undefined,
  };
}

export function eventPoint(
  event: PointerEvent<HTMLElement>,
  stageElement: HTMLElement | null,
  scale: number,
) {
  const stage = stageElement || findStage(event.currentTarget);
  const rect = stage.getBoundingClientRect();
  const safeScale = scale > 0 ? scale : 1;
  return {
    x: (event.clientX - rect.left) / safeScale,
    y: (event.clientY - rect.top) / safeScale,
  };
}

export function findStage(target: HTMLElement) {
  return (target.closest(".object-canvas") as HTMLElement | null) || target;
}

export function nextZIndex(canvas: SlideCanvas) {
  return Math.max(1, ...canvas.elements.map((element) => element.zIndex)) + 1;
}

export function titleFromCanvas(slide: Slide, canvas: SlideCanvas) {
  const title = canvas.elements.find(
    (element): element is CanvasTextElement =>
      element.type === "text" && element.role === "title",
  );
  return title?.text.trim() || slide.title;
}

export function blocksFromSlideText(slide: Slide): Slide["blocks"] {
  const bullets = slide.bullets.map((item) => item.trim()).filter(Boolean);
  if (bullets.length) return [{ type: "bullets", items: bullets }];
  const thesis = slide.thesis.trim();
  if (thesis) return [{ type: "callout", content: thesis }];
  return slide.blocks;
}

export function cloneCanvas(canvas: SlideCanvas): SlideCanvas {
  return JSON.parse(JSON.stringify(canvas)) as SlideCanvas;
}

export function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function isTypingTarget(target: EventTarget) {
  const element = target as HTMLElement | null;
  return Boolean(
    element?.closest("input, textarea, select, [contenteditable='true']"),
  );
}
