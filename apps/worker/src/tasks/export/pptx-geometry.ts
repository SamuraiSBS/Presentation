import type { CanvasElement } from "@studydeck/shared";

/** Conversion boundary between the 96-DPI canvas and PPTX coordinates. */
export function canvasBox(element: Pick<CanvasElement, "x" | "y" | "w" | "h">) {
  return { x: element.x / 96, y: element.y / 96, w: element.w / 96, h: element.h / 96 };
}

export function pixelsToPoints(pixels: number) {
  return Math.round(pixels * 75) / 100;
}

export function opacityToTransparency(opacity: number) {
  return Math.max(0, Math.min(100, Math.round((1 - opacity) * 100)));
}
