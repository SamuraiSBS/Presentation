import sharp from "sharp";
import {
  canvasTextLineHeight,
  exportFontFamily,
  sortCanvasElements,
  type CanvasImageElement,
  type CanvasDiagramElement,
  type CanvasShapeElement,
  type CanvasTextElement,
  type SlideCanvas,
} from "@studydeck/shared";
import { canvasBox, opacityToTransparency, pixelsToPoints } from "./pptx-geometry.js";
import { addFittedPptxImage } from "./pptx-image.js";
import { pptxColor, type ExportTheme } from "./presentation-content.js";

type PptxSlide = {
  background?: { color: string };
  addImage: (...args: unknown[]) => void;
  addShape: (...args: unknown[]) => void;
  addText: (...args: unknown[]) => void;
};
type PptxApi = { ShapeType: Record<string, string> };

export type PptxCanvasDependencies = {
  readObjectBuffer: (key: string) => Promise<Buffer>;
  contentTypeFromObjectKey: (key: string) => string;
  warn: (fields: Record<string, unknown>, message: string) => void;
};

/** Renders saved canvas geometry without reaching into export-job orchestration. */
export async function renderPptxCanvasSlide(
  pptx: PptxApi,
  slide: PptxSlide,
  canvas: SlideCanvas,
  theme: ExportTheme,
  dependencies: PptxCanvasDependencies,
) {
  slide.background = { color: pptxColor(canvas.background || theme.colors.background) };
  if (canvas.backgroundStyle?.type === "gradient") {
    await addFittedPptxImage(slide, await canvasBackgroundPngData(canvas), { x: 0, y: 0, w: 40 / 3, h: 7.5 }, { fit: "cover" });
  }
  for (const element of sortCanvasElements(canvas.elements)) {
    if (element.opacity <= 0) continue;
    if (element.type === "text") renderCanvasText(slide, element, theme);
    else if (element.type === "shape") renderCanvasShape(pptx, slide, element);
    else if (element.type === "diagram") renderCanvasDiagram(pptx, slide, element, theme);
    else await renderCanvasImage(slide, element, dependencies);
  }
}

function renderCanvasText(slide: PptxSlide, element: CanvasTextElement, theme: ExportTheme) {
  const runs = element.runs.length ? element.runs.map((run) => ({ text: run.text, options: { bold: run.bold ?? element.bold, italic: false, underline: run.underline ?? element.underline, color: pptxColor(run.color || element.color) } })) : element.text;
  slide.addText(runs, { ...canvasBox(element), fontFace: exportFontFamily(element.fontFamily || theme.fonts.body), fontSize: pixelsToPoints(element.fontSize), bold: element.bold, italic: false, underline: element.underline, color: pptxColor(element.color), align: element.align, valign: element.valign === "middle" ? "mid" : element.valign, rotate: element.rotation, fit: "none", lineSpacingMultiple: canvasTextLineHeight(element), margin: 0 });
}

function renderCanvasDiagram(pptx: PptxApi, slide: PptxSlide, element: CanvasDiagramElement, theme: ExportTheme) {
  const labels = element.model.kind === "scheme" ? element.model.nodes.map((node) => node.label) : element.model.categories;
  const cycle = element.model.kind === "scheme" && element.model.template === "cycle";
  const pxBox = (x: number, y: number, w: number, h: number) => canvasBox({ x, y, w, h });
  const dot = (x: number, y: number) => slide.addShape(pptx.ShapeType.ellipse, { ...pxBox(x - 8, y - 8, 16, 16), fill: { color: pptxColor(theme.colors.accent) }, line: { color: pptxColor(theme.colors.text), width: 1 } });
  const label = (value: string, x: number, y: number, w: number, h: number) => slide.addText(value, { ...pxBox(x, y, w, h), fontFace: exportFontFamily(theme.fonts.body), fontSize: 18, color: pptxColor(theme.colors.text), bold: true, align: "center", valign: "mid", margin: 0, fit: "shrink" });
  if (cycle) {
    slide.addShape(pptx.ShapeType.ellipse, { ...pxBox(element.x + element.w * .28, element.y + element.h * .34, element.w * .44, element.h * .42), fill: { color: pptxColor(theme.colors.background), transparency: 100 }, line: { color: pptxColor(theme.colors.accentAlt), width: 1.5 } });
    const labelWidth = Math.min(250, Math.max(180, element.w * .24));
    labels.forEach((value, index) => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / labels.length;
      const x = element.x + element.w * (.5 + .22 * Math.cos(angle)); const y = element.y + element.h * (.58 + .24 * Math.sin(angle));
      dot(x, y);
      label(value, x - labelWidth / 2, y + (index === 0 ? -82 : 28), labelWidth, 72);
    });
    return;
  }
  const pathY = element.y + element.h * .6;
  slide.addShape(pptx.ShapeType.line, { ...pxBox(element.x + element.w * .1, pathY, element.w * .8, 0), line: { color: pptxColor(theme.colors.accentAlt), width: 1.5 } });
  labels.forEach((value, index) => {
    const x = element.x + element.w * ((index + .5) / labels.length);
    dot(x, pathY);
    label(value, x - Math.min(260, element.w / labels.length * .78) / 2, pathY + (index % 2 ? 36 : -96), Math.min(260, element.w / labels.length * .78), 64);
  });
}

function renderCanvasShape(pptx: PptxApi, slide: PptxSlide, element: CanvasShapeElement) {
  const shapeType = element.shape === "ellipse" ? pptx.ShapeType.ellipse : element.shape === "line" ? pptx.ShapeType.line : element.shape === "roundRect" ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
  if (element.shape === "ellipse" && /(?:^|[-_])sun(?:[-_]|$)/i.test(element.id)) {
    slide.addShape(pptx.ShapeType.ellipse, { ...canvasBox({ ...element, x: element.x - element.w * .08, y: element.y - element.h * .08, w: element.w * 1.16, h: element.h * 1.16 }), line: { color: pptxColor(element.fill), transparency: 100 }, fill: { color: pptxColor(element.fill), transparency: 70 } });
  }
  const options: Record<string, unknown> = { ...canvasBox(element), rotate: element.rotation, line: { color: pptxColor(element.stroke), width: pixelsToPoints(element.strokeWidth), transparency: opacityToTransparency(element.opacity) } };
  if (element.shape !== "line") options.fill = { color: pptxColor(element.fill), transparency: opacityToTransparency(element.opacity) };
  slide.addShape(shapeType, options);
}

async function renderCanvasImage(slide: PptxSlide, element: CanvasImageElement, dependencies: PptxCanvasDependencies) {
  if (!element.objectKey) return;
  try {
    const buffer = await dependencies.readObjectBuffer(element.objectKey);
    const contentType = element.contentType || dependencies.contentTypeFromObjectKey(element.objectKey);
    await addFittedPptxImage(slide, `data:${contentType};base64,${buffer.toString("base64")}`, canvasBox(element), { fit: element.fit, rotate: element.rotation, transparency: opacityToTransparency(element.opacity), altText: element.alt });
  } catch (error) {
    dependencies.warn({ objectKey: element.objectKey, error }, "could not read canvas image");
  }
}

async function canvasBackgroundPngData(canvas: SlideCanvas) {
  const png = await sharp(Buffer.from(canvasBackgroundSvg(canvas))).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

function canvasBackgroundSvg(canvas: SlideCanvas) {
  const style = canvas.backgroundStyle;
  if (!style || style.type === "solid") return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}"><rect width="100%" height="100%" fill="${style?.color || canvas.background}"/></svg>`;
  const x1 = 50 - Math.cos((style.angle * Math.PI) / 180) * 50;
  const y1 = 50 - Math.sin((style.angle * Math.PI) / 180) * 50;
  const stops = style.stops.map((stop) => `<stop offset="${stop.offset * 100}%" stop-color="${stop.color}" stop-opacity="${stop.opacity}"/>`).join("");
  const blobs = style.blobs.map((blob, index) => `<circle cx="${blob.x * canvas.width}" cy="${blob.y * canvas.height}" r="${blob.size * Math.min(canvas.width, canvas.height) * .52}" fill="${blob.color}" fill-opacity="${blob.opacity}" filter="url(#blur${index})"/>`).join("");
  const filters = style.blobs.map((blob, index) => `<filter id="blur${index}" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="${blob.blur}"/></filter>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><defs><linearGradient id="base" x1="${x1}%" y1="${y1}%" x2="${100 - x1}%" y2="${100 - y1}%">${stops}</linearGradient>${filters}</defs><rect width="100%" height="100%" fill="url(#base)"/>${blobs}</svg>`;
}
