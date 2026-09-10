import { canvasTextLineHeight, exportPdfFontStack, type CanvasDiagramElement, type CanvasElement, type CanvasImageElement, type CanvasShapeElement, type CanvasTextElement } from "@studydeck/shared";

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
  if (element.type === "diagram") return `<div class="element" data-canvas-element="${escapeHtml(element.id)}" style="${style}">${renderPdfDiagram(element)}</div>`;
  const src = await pdfImageSrc(element, dependencies);
  return src ? `<div class="element" data-canvas-element="${escapeHtml(element.id)}" style="${style};overflow:hidden"><img class="image" src="${escapeHtml(src)}" alt="${escapeHtml(element.alt)}" style="object-fit:${element.fit}" /></div>` : "";
}

function renderPdfDiagram(element: CanvasDiagramElement) {
  const labels = element.model.kind === "scheme" ? element.model.nodes.map((node) => node.label) : element.model.categories;
  const cycle = element.model.kind === "scheme" && element.model.template === "cycle";
  if (cycle) return `<div style="position:relative;width:100%;height:100%"><div style="position:absolute;left:28%;top:34%;width:44%;height:42%;border:2px solid #55D6E8;border-radius:50%"></div>${labels.map((label, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / labels.length;
    const left = 50 + 22 * Math.cos(angle); const top = 58 + 24 * Math.sin(angle);
    const labelTop = top + (index === 0 ? -17 : 12);
    return `<i style="position:absolute;left:${left}%;top:${top}%;width:12px;height:12px;border:2px solid #FFF3D1;border-radius:50%;background:#FFC857;transform:translate(-50%,-50%)"></i><span style="position:absolute;left:${left}%;top:${labelTop}%;width:26%;transform:translate(-50%,-50%);color:#F5F7FA;text-align:center;font:700 18px/1.1 Arial;text-shadow:0 0 7px #071827,0 0 7px #071827;overflow-wrap:anywhere">${escapeHtml(label)}</span>`;
  }).join("")}</div>`;
  return `<div style="position:relative;width:100%;height:100%"><div style="position:absolute;left:10%;right:10%;top:60%;border-top:3px solid #55D6E8"></div>${labels.map((label, index) => {
    const left = (index + .5) / labels.length * 100; const top = index % 2 ? 78 : 31;
    return `<i style="position:absolute;left:${left}%;top:60%;width:12px;height:12px;border:2px solid #FFF3D1;border-radius:50%;background:#FFC857;transform:translate(-50%,-50%)"></i><span style="position:absolute;left:${left}%;top:${top}%;width:30%;transform:translate(-50%,-50%);color:#F5F7FA;text-align:center;font:700 18px/1.1 Arial;text-shadow:0 0 7px #071827,0 0 7px #071827;overflow-wrap:anywhere">${escapeHtml(label)}</span>`;
  }).join("")}</div>`;
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
  const sun = element.shape === "ellipse" && /(?:^|[-_])sun(?:[-_]|$)/i.test(element.id);
  return [`background:${sun ? "radial-gradient(circle at 42% 38%,#FFF7BC 0%,#FFD45C 46%,#F6B83F 100%)" : element.fill}`, `border:${element.strokeWidth}px solid ${element.stroke}`, `border-radius:${element.shape === "roundRect" ? "18px" : element.shape === "ellipse" ? "50%" : "0"}`, sun ? "box-shadow:0 0 22px rgba(255,200,87,.52)" : ""].filter(Boolean).join(";");
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
