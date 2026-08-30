import type { CSSProperties, PointerEvent } from "react";
import { PRESENTATION_FONT_STACK } from "@studydeck/shared";
import type { CanvasElement, CanvasShapeElement, CanvasTextElement, Slide, SlideCanvas } from "@studydeck/shared";

export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;
export const CUSTOM_CANVAS_MARKER_SUFFIX = "custom-canvas-marker";
export const MIN_READABLE_TEXT_SIZE = 12;


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
