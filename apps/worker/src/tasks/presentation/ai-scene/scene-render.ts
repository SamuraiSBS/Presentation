import sharp from "sharp";
import type { CanvasElement, SlideCanvas } from "@studydeck/shared";

/** A deterministic PNG of the editable canvas for review and visual comparison. */
export async function renderAiSceneCanvas(canvas: SlideCanvas, background: Buffer) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
    <defs><radialGradient id="ai-scene-sun" cx="42%" cy="38%"><stop offset="0" stop-color="#FFF7BC"/><stop offset=".46" stop-color="#FFD45C"/><stop offset="1" stop-color="#F6B83F"/></radialGradient><filter id="ai-scene-sun-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="9"/></filter></defs>
    <image href="data:image/png;base64,${background.toString("base64")}" width="${canvas.width}" height="${canvas.height}" preserveAspectRatio="xMidYMid slice"/>
    ${canvas.elements.filter((element) => element.id !== "ai-scene-background").sort((left, right) => left.zIndex - right.zIndex).map(renderElement).join("\n")}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function renderElement(element: CanvasElement) {
  if (element.type === "shape") {
    const style = `fill="${element.fill}" fill-opacity="${element.opacity}" stroke="${element.stroke}" stroke-width="${element.strokeWidth}"`;
    if (element.shape === "ellipse") {
      const sun = /(?:^|[-_])sun(?:[-_]|$)/i.test(element.id);
      const glow = sun ? `<ellipse cx="${element.x + element.w / 2}" cy="${element.y + element.h / 2}" rx="${element.w * .56}" ry="${element.h * .56}" fill="#FFC857" fill-opacity=".45" filter="url(#ai-scene-sun-glow)"/>` : "";
      return `${glow}<ellipse cx="${element.x + element.w / 2}" cy="${element.y + element.h / 2}" rx="${element.w / 2}" ry="${element.h / 2}" ${sun ? `${style.replace(`fill=\"${element.fill}\"`, 'fill=\"url(#ai-scene-sun)\"')}` : style}/>`;
    }
    if (element.shape === "line") return `<line x1="${element.x}" y1="${element.y + element.h / 2}" x2="${element.x + element.w}" y2="${element.y + element.h / 2}" stroke="${element.stroke}" stroke-opacity="${element.opacity}" stroke-width="${Math.max(1, element.strokeWidth)}"/>`;
    return `<rect x="${element.x}" y="${element.y}" width="${element.w}" height="${element.h}" rx="${element.shape === "roundRect" ? 18 : 0}" ${style}/>`;
  }
  if (element.type === "text") return renderText(element);
  if (element.type === "diagram") {
    return renderDiagram(element);
  }
  return "";
}

function renderText(element: Extract<CanvasElement, { type: "text" }>) {
  const maxChars = Math.max(10, Math.floor(element.w / (element.fontSize * .54)));
  const words = element.text.split(/\s+/); const lines: string[] = []; let line = "";
  for (const word of words) { const next = line ? `${line} ${word}` : word; if (next.length > maxChars && line) { lines.push(line); line = word; } else line = next; }
  if (line) lines.push(line);
  const anchor = element.align === "center" ? "middle" : element.align === "right" ? "end" : "start";
  const x = element.align === "center" ? element.x + element.w / 2 : element.align === "right" ? element.x + element.w : element.x;
  return `<text x="${x}" y="${element.y + element.fontSize}" text-anchor="${anchor}" fill="${element.color}" font-family="Arial" font-size="${element.fontSize}" font-weight="${element.bold ? 700 : 400}">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? Math.round(element.fontSize * 1.14) : 0}">${escapeXml(line)}</tspan>`).join("")}</text>`;
}

function renderDiagram(element: Extract<CanvasElement, { type: "diagram" }>) {
  const labels = element.model.kind === "scheme" ? element.model.nodes.map((node) => node.label) : element.model.categories;
  const labelSize = 24;
  if (element.model.kind === "scheme" && element.model.template === "cycle") {
    const centerX = element.x + element.w / 2; const centerY = element.y + element.h * .58;
    const orbitX = element.w * .22; const orbitY = element.h * .24;
    const points = labels.map((_, index) => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / labels.length;
      return { x: centerX + Math.cos(angle) * orbitX, y: centerY + Math.sin(angle) * orbitY };
    });
    const boxWidth = Math.min(250, Math.max(180, element.w * .24));
    return `<ellipse cx="${centerX}" cy="${centerY}" rx="${orbitX}" ry="${orbitY}" fill="none" stroke="#55D6E8" stroke-width="3" opacity=".8"/>${labels.map((label, index) => { const point = points[index]!; const lines = wrapLabel(label, Math.floor(boxWidth / (labelSize * .54))); const boxHeight = Math.max(54, lines.length * labelSize * 1.08 + 18); return `<circle cx="${point.x}" cy="${point.y}" r="10" fill="#FFC857" stroke="#FFF3D1" stroke-width="2"/>${svgLabel(lines, point.x, point.y + (index === 0 ? -boxHeight * .62 : boxHeight * .62), labelSize)}`; }).join("")}`;
  }
  const step = element.w / labels.length;
  const pathY = element.y + element.h * .6;
  return `<path d="M ${element.x + step * .32} ${pathY} C ${element.x + step * .8} ${pathY - 36}, ${element.x + step * 1.25} ${pathY + 36}, ${element.x + element.w - step * .32} ${pathY}" fill="none" stroke="#55D6E8" stroke-width="4" opacity=".9"/>${labels.map((label, index) => { const x = element.x + step * (index + .5); const y = pathY + (index % 2 ? 54 : -54); const lines = wrapLabel(label, Math.floor(Math.min(260, step * .78) / (labelSize * .54))); return `<circle cx="${x}" cy="${pathY}" r="11" fill="#FFC857" stroke="#FFF3D1" stroke-width="2"/>${svgLabel(lines, x, y, labelSize)}${index < labels.length - 1 ? `<path d="M ${x + step * .33} ${pathY} l -15 -9 M ${x + step * .33} ${pathY} l -15 9" stroke="#55D6E8" stroke-width="4" fill="none"/>` : ""}`; }).join("")}`;
}

function wrapLabel(label: string, charactersPerLine: number) {
  const words = label.split(/\s+/); const lines: string[] = []; let line = "";
  for (const word of words) { const next = line ? `${line} ${word}` : word; if (next.length > charactersPerLine && line) { lines.push(line); line = word; } else line = next; }
  if (line) lines.push(line);
  return lines;
}

function svgLabel(lines: string[], x: number, y: number, fontSize: number) {
  const startY = y - ((lines.length - 1) * fontSize * 1.05) / 2 + fontSize * .34;
  return `<text x="${x}" y="${startY}" text-anchor="middle" fill="#F5F7FA" stroke="#071827" stroke-width="7" paint-order="stroke" stroke-linejoin="round" font-family="Arial" font-size="${fontSize}" font-weight="700">${lines.map((item, index) => `<tspan x="${x}" dy="${index ? Math.round(fontSize * 1.05) : 0}">${escapeXml(item)}</tspan>`).join("")}</text>`;
}

function escapeXml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;"); }
