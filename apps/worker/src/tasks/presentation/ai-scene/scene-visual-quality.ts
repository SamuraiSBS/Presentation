import sharp from "sharp";
import type { AiSceneSpec, DeckStyleSpec, SlideContentLock } from "@studydeck/shared";
import { diagramLabelLayoutDiagnostics, hasTemplateCardGrid } from "./scene-preflight.js";

export type AiSceneVisualReview = {
  noBakedTextInBackground: boolean;
  conceptSimilarity: number;
  speechRelevance: number;
  styleConsistency: number;
  noTemplateCardGrid: boolean;
  diagramTextReadable: boolean;
  detail: string;
};

/**
 * A deterministic, local visual check. It deliberately examines the actual
 * PNG bytes rather than trusting prompts or object keys, so a candidate cannot
 * become GO merely because a model was told to avoid text or cards.
 */
export async function inspectAiSceneVisuals(input: {
  concept: Buffer;
  background: Buffer;
  rendered: Buffer;
  scene: AiSceneSpec;
  lock: SlideContentLock;
  style: DeckStyleSpec;
}): Promise<AiSceneVisualReview> {
  const [concept, background, rendered] = await Promise.all([
    raster(input.concept), raster(input.background), raster(input.rendered),
  ]);
  const similarity = Math.round((gridSimilarity(concept, rendered) * 100));
  const style = paletteConsistency(background, input.style) * 100;
  const bakedTextRisk = rasterTextRisk(background);
  const lockedReferences = new Set(input.lock.text.map((item) => item.key));
  const suppliedRefs = input.scene.elements.flatMap((element) => element.type === "text" ? [element.textRef] : element.type === "diagram" ? element.nodeRefs : []);
  const relevance = suppliedRefs.length && suppliedRefs.every((ref) => lockedReferences.has(ref))
    && suppliedRefs.includes("title") && suppliedRefs.includes("thesis") ? 100 : 0;
  const cardGrid = hasTemplateCardGrid(input.scene);
  const diagramIssues = diagramLabelLayoutDiagnostics(input.scene, input.lock);
  return {
    noBakedTextInBackground: !bakedTextRisk,
    conceptSimilarity: similarity,
    speechRelevance: relevance,
    styleConsistency: Math.round(style),
    noTemplateCardGrid: !cardGrid,
    diagramTextReadable: diagramIssues.length === 0,
    detail: `pixel review: concept/render similarity=${similarity}; palette consistency=${Math.round(style)}; background text-risk=${bakedTextRisk ? "detected" : "clear"}; card-grid=${cardGrid ? "detected" : "clear"}; diagram-labels=${diagramIssues.length ? diagramIssues.join(" / ") : "clear"}`,
  };
}

type Raster = { pixels: Buffer; width: number; height: number };
async function raster(input: Buffer): Promise<Raster> {
  const { data, info } = await sharp(input, { failOn: "error" })
    .resize(96, 54, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { pixels: data, width: info.width, height: info.height };
}

function gridSimilarity(left: Raster, right: Raster) {
  let error = 0;
  for (let offset = 0; offset < left.pixels.length; offset += 3) {
    error += Math.abs(left.pixels[offset]! - right.pixels[offset]!);
    error += Math.abs(left.pixels[offset + 1]! - right.pixels[offset + 1]!);
    error += Math.abs(left.pixels[offset + 2]! - right.pixels[offset + 2]!);
  }
  return Math.max(0, 1 - error / (left.pixels.length * 255));
}

function paletteConsistency(background: Raster, style: DeckStyleSpec) {
  const palette = Object.values(style.palette).map(hexToRgb);
  let score = 0;
  for (let offset = 0; offset < background.pixels.length; offset += 3) {
    const color = [background.pixels[offset]!, background.pixels[offset + 1]!, background.pixels[offset + 2]!];
    const nearest = Math.min(...palette.map((entry) => colorDistance(color, entry)));
    score += 1 - Math.min(1, nearest / 255);
  }
  return score / (background.pixels.length / 3);
}

function hexToRgb(hex: string) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
function colorDistance(left: number[], right: number[]) { return Math.sqrt((left[0]! - right[0]!) ** 2 + (left[1]! - right[1]!) ** 2 + (left[2]! - right[2]!) ** 2) / Math.sqrt(3); }

/** Flags clusters of small high-contrast connected marks aligned as text rows. */
function rasterTextRisk(image: Raster) {
  const brightRunsByRow: number[] = [];
  for (let y = 1; y < image.height - 1; y += 1) {
    let runs = 0;
    let inRun = false;
    for (let x = 1; x < image.width - 1; x += 1) {
      const index = (y * image.width + x) * 3;
      const luminance = image.pixels[index]! * .2126 + image.pixels[index + 1]! * .7152 + image.pixels[index + 2]! * .0722;
      const above = ((y - 1) * image.width + x) * 3;
      const contrast = Math.abs(luminance - (image.pixels[above]! * .2126 + image.pixels[above + 1]! * .7152 + image.pixels[above + 2]! * .0722));
      const mark = luminance > 170 && contrast > 28;
      if (mark && !inRun) { runs += 1; inRun = true; }
      if (!mark) inRun = false;
    }
    brightRunsByRow.push(runs);
  }
  // Text produces several adjacent rows containing many short strokes. A sun,
  // orbit or star field does not normally create this repeated horizontal run.
  let consecutive = 0;
  for (const runs of brightRunsByRow) {
    consecutive = runs >= 6 ? consecutive + 1 : 0;
    if (consecutive >= 3) return true;
  }
  return false;
}
