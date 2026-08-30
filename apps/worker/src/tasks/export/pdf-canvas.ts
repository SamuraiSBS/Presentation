import { canvasTextLineHeight, exportPdfFontStack, type CanvasElement, type CanvasImageElement, type CanvasShapeElement, type CanvasTextElement } from "@studydeck/shared";

export type PdfCanvasDependencies = {
  readObjectBuffer: (key: string) => Promise<Buffer>;
  contentTypeFromObjectKey: (key: string) => string;
  warn: (fields: Record<string, unknown>, message: string) => void;
};

/** HTML projection of saved canvas elements, isolated from document templates. */
export async function renderPdfCanvasElement(element: CanvasElement, dependencies: PdfCanvasDependencies) {
  const style = [`left:${element.x}px`, `top:${element.y}px`, `width:${element.w}px`, `height:${element.h}px`, `z-index:${element.zIndex}`, `opacity:${element.opacity}`, `transform:rotate(${element.rotation}deg)`].join(";");
  if (element.type === "text") return `<div class="element text" data-canvas-element="${escapeHtml(element.id)}" style="${style};${pdfTextStyle(element)}">${renderPdfText(element)}</div>`;
  if (element.type === "shape") return `<div class="element" data-canvas-element="${escapeHtml(element.id)}" style="${style}"><div class="shape" style="${pdfShapeStyle(element)}"></div></div>`;
  const src = await pdfImageSrc(element, dependencies);
  return src ? `<div class="element" data-canvas-element="${escapeHtml(element.id)}" style="${style};overflow:hidden"><img class="image" src="${escapeHtml(src)}" alt="${escapeHtml(element.alt)}" style="object-fit:${element.fit}" /></div>` : "";
}

function renderPdfText(element: CanvasTextElement) {
  if (!element.runs.length) return escapeHtml(element.text);
  return element.runs.map((run) => `<span style="${[(run.bold ?? element.bold) ? "font-weight:800" : "", (run.underline ?? element.underline) ? "text-decoration:underline" : "", run.color ? `color:${run.color}` : ""].filter(Boolean).join(";")}">${escapeHtml(run.text)}</span>`).join("");
}

function pdfTextStyle(element: CanvasTextElement) {
  return [`color:${element.color}`, `font-family:${exportPdfFontStack(element.fontFamily)}`, `font-size:${element.fontSize}px`, `font-weight:${element.bold ? 800 : 400}`, "font-style:normal", `text-decoration:${element.underline ? "underline" : "none"}`, `text-align:${element.align}`, "display:flex", "flex-direction:column", `justify-content:${element.valign === "middle" ? "center" : element.valign === "bottom" ? "flex-end" : "flex-start"}`, `line-height:${canvasTextLineHeight(element)}`, "overflow-wrap:anywhere", "word-break:normal"].join(";");
}

function pdfShapeStyle(element: CanvasShapeElement) {
  if (element.shape === "line") return `border-top:${Math.max(1, element.strokeWidth)}px solid ${element.stroke};margin-top:${Math.max(0, element.h / 2)}px`;
  return [`background:${element.fill}`, `border:${element.strokeWidth}px solid ${element.stroke}`, `border-radius:${element.shape === "roundRect" ? "18px" : element.shape === "ellipse" ? "50%" : "0"}`].join(";");
}

async function pdfImageSrc(element: CanvasImageElement, dependencies: PdfCanvasDependencies) {
  if (!element.objectKey) return element.url;
  try {
    const buffer = await dependencies.readObjectBuffer(element.objectKey);
    return `data:${element.contentType || dependencies.contentTypeFromObjectKey(element.objectKey)};base64,${buffer.toString("base64")}`;
  } catch (error) {
    dependencies.warn({ objectKey: element.objectKey, error }, "could not read pdf image");
    return element.url;
  }
}

function escapeHtml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;"); }
