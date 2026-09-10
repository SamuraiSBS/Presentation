import {
  presentationTypography,
  type AiSceneSpec,
  type SlideContentLock,
} from "@studydeck/shared";

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const SAFE_MARGIN_X = 48;
const SAFE_TOP = 32;
const SAFE_BOTTOM = 680;

/**
 * Rejects an unusable AI plan before a background is rendered or persisted.
 * It intentionally does not move objects: choosing a fallback composition
 * here would turn a failed AI scene into the old template renderer.
 */
export function inspectAiScenePreflight(scene: AiSceneSpec, lock: SlideContentLock) {
  const diagnostics: string[] = [];
  const ids = new Set<string>();
  const textElements = scene.elements.filter((element) => element.type === "text");
  const title = textElements.filter((element) => element.textRef === "title");
  const thesis = textElements.filter((element) => element.textRef === "thesis");

  if (title.length !== 1) diagnostics.push("scene must contain exactly one editable title");
  if (thesis.length !== 1) diagnostics.push("scene must contain exactly one editable thesis");
  if (!scene.elements.some((element) => element.type === "diagram" || (element.type === "shape" && element.shape === "ellipse" && element.w >= 140 && element.h >= 140))) {
    diagnostics.push("scene has no dominant subject-specific composition");
  }
  if (hasTemplateCardGrid(scene)) diagnostics.push("scene contains a repeated card-grid composition");

  for (const element of scene.elements) {
    if (ids.has(element.id)) diagnostics.push(`${element.id} duplicates another scene element id`);
    ids.add(element.id);
    if (element.x < 0 || element.y < 0 || element.x + element.w > CANVAS_WIDTH || element.y + element.h > CANVAS_HEIGHT) {
      diagnostics.push(`${element.id} is outside the 1280x720 slide`);
    }
    if (element.type !== "text") continue;
    const text = lock.text.find((item) => item.key === element.textRef)?.text;
    if (!text) {
      diagnostics.push(`${element.id} references unavailable locked text ${element.textRef}`);
      continue;
    }
    const minimum = element.role === "title" ? presentationTypography.slideTitle.minPx
      : element.role === "thesis" ? presentationTypography.body.minPx
      : presentationTypography.label.minPx;
    if (element.fontSize < minimum) diagnostics.push(`${element.id} uses ${element.fontSize}px below the ${minimum}px ${element.role} minimum`);
    const lineHeight = element.role === "title" ? presentationTypography.slideTitle.lineHeight
      : element.role === "thesis" ? presentationTypography.body.lineHeight
      : presentationTypography.label.lineHeight;
    const requiredHeight = estimatedTextHeight(text, element.fontSize, element.w, lineHeight);
    if (requiredHeight > element.h) diagnostics.push(`${element.id} needs ${Math.ceil(requiredHeight)}px height for its locked text but has ${Math.floor(element.h)}px`);
    if (element.x < SAFE_MARGIN_X || element.y < SAFE_TOP || element.x + element.w > CANVAS_WIDTH - SAFE_MARGIN_X || element.y + element.h > SAFE_BOTTOM) {
      diagnostics.push(`${element.id} is outside the readable safe area`);
    }
  }

  diagnostics.push(...diagramLabelLayoutDiagnostics(scene, lock));

  const meaningful = scene.elements.filter((element) => element.type === "text" || element.type === "diagram" || (element.type === "shape" && element.opacity > 0.12 && element.shape !== "line" && !isTextBackplate(element) && !isDecorativeGlow(element)));
  for (let index = 0; index < meaningful.length; index += 1) {
    for (const other of meaningful.slice(index + 1)) {
      if (overlaps(meaningful[index]!, other)) diagnostics.push(`${meaningful[index]!.id} overlaps ${other.id}`);
    }
  }
  return diagnostics;
}

export function hasTemplateCardGrid(scene: Pick<AiSceneSpec, "elements">) {
  const rectangles = scene.elements
    .filter((element): element is Extract<AiSceneSpec["elements"][number], { type: "shape" }> => element.type === "shape" && (element.shape === "rect" || element.shape === "roundRect") && element.opacity >= 0.55)
    .filter((element) => element.w >= 140 && element.h >= 70);
  return rectangles.some((candidate) => rectangles.filter((other) =>
    Math.abs(other.w - candidate.w) <= Math.max(16, candidate.w * 0.12)
    && Math.abs(other.h - candidate.h) <= Math.max(16, candidate.h * 0.16)
    && Math.abs(other.y - candidate.y) <= Math.max(24, candidate.h * 0.2)
  ).length >= 3);
}

/** Mirrors the label geometry used by PNG/PDF/PPTX diagram renderers. */
export function diagramLabelLayoutDiagnostics(scene: Pick<AiSceneSpec, "elements">, lock: Pick<SlideContentLock, "text">) {
  const diagnostics: string[] = [];
  for (const element of scene.elements) {
    if (element.type !== "diagram") continue;
    const labels = element.nodeRefs.map((ref) => lock.text.find((item) => item.key === ref)?.text || "");
    if (element.template === "cycle" && element.h < 320) {
      diagnostics.push(`${element.id} needs at least 320px height for a readable non-overlapping cycle diagram`);
    }
    const labelWidth = element.template === "cycle"
      ? Math.min(250, Math.max(180, element.w * .24))
      : Math.min(260, element.w / labels.length * .78);
    const charactersPerLine = Math.max(1, Math.floor(labelWidth / (presentationTypography.label.minPx * .54)));
    const estimatedLines = Math.max(...labels.map((label) => wrappedLineCount(label, charactersPerLine)));
    if (estimatedLines > 3) diagnostics.push(`${element.id} cannot fit its locked diagram labels at the 24px minimum`);
  }
  return diagnostics;
}

function overlaps(left: { x: number; y: number; w: number; h: number }, right: { x: number; y: number; w: number; h: number }) {
  const width = Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x);
  const height = Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y);
  return width > 1 && height > 1;
}

function isTextBackplate(element: Extract<AiSceneSpec["elements"][number], { type: "shape" }>) {
  return /(?:wash|backplate|overlay|text-field)/i.test(element.id);
}

/** A low-opacity halo belongs to the illustrated background, not the semantic diagram geometry. */
function isDecorativeGlow(element: Extract<AiSceneSpec["elements"][number], { type: "shape" }>) {
  return /(?:glow|halo|aura)/i.test(element.id) && element.opacity <= 0.45;
}

function estimatedTextHeight(text: string, fontSize: number, width: number, lineHeight: number) {
  const charactersPerLine = Math.max(1, Math.floor(width / (fontSize * .54)));
  const words = text.trim().split(/\s+/).filter(Boolean);
  let lines = 1; let current = 0;
  for (const word of words) {
    const next = current ? current + 1 + word.length : word.length;
    if (next > charactersPerLine && current) { lines += 1; current = word.length; } else current = next;
  }
  return lines * fontSize * lineHeight;
}

function wrappedLineCount(text: string, charactersPerLine: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let lines = 1; let current = 0;
  for (const word of words) {
    const next = current ? current + 1 + word.length : word.length;
    if (next > charactersPerLine && current) { lines += 1; current = word.length; } else current = next;
  }
  return lines;
}
