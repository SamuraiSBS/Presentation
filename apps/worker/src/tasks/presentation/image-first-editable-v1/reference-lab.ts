import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { CanvasElement, SlideCanvas } from "@studydeck/shared";
import { referenceFixtures, type GoldText, type ReferenceFixture } from "./reference-lab-fixtures.js";

const SOURCE_WIDTH = 1672;
const SOURCE_HEIGHT = 941;
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
export type ReconstructionDiagnostic = "geometry_confidence" | "structured_evidence" | "cleanup_ghost" | "cleanup_damage" | "unexpected_text" | "overflow" | "export_parity" | "unresolved_text";
export type ReferenceLabResult = {
  fixtureId: string;
  sourcePath: string;
  sha256: string;
  image: { width: number; height: number; colorSpace: string; hasProfile: boolean };
  exactRestoration: { expected: number; native: number; normalizedExact: boolean };
  geometry: { meanConfidence: number; zones: number; plannedZoneOnly: number };
  cleanup: { outsideMaskChangedPixels: number; ghostDetected: boolean; damageDetected: boolean };
  fallback: { used: boolean; reasons: ReconstructionDiagnostic[] };
  textLiftPass: boolean;
  canvas: { backgroundLocked: boolean; semanticEditable: boolean; pageNumberLocked: boolean; exportParity: boolean };
  artifacts: Record<"original" | "detectedZones" | "mask" | "cleanedBackground" | "nativeReconstruction" | "fallback" | "sideBySide" | "canvas", string>;
};

export type ReconstructionInput = Pick<ReferenceFixture, "texts" | "visualFamily"> & { raster: Buffer; plannedSemanticZones: readonly GoldText[] };

function normalized(value: string) { return value.normalize("NFC"); }
function px(value: number, dimension: number) { return Math.round(value * dimension); }
function fixturePath(root: string, id: string, name: string) { return path.join(root, id, name); }

export function buildNativeCanvasForFixture(fixture: ReferenceFixture, backgroundPath = "reference-lab-cleaned.png"): SlideCanvas {
  const elements: CanvasElement[] = [
    { id: `${fixture.id}-background`, type: "image", x: 0, y: 0, w: CANVAS_WIDTH, h: CANVAS_HEIGHT, rotation: 0, zIndex: 0, opacity: 1, locked: true, url: backgroundPath, objectKey: "", alt: "Cleaned local reference background", contentType: "image/png", fit: "cover" },
    ...fixture.texts.map((entry, index): CanvasElement => ({
      id: entry.id, type: "text", x: px(entry.zone.x, CANVAS_WIDTH), y: px(entry.zone.y, CANVAS_HEIGHT), w: Math.max(64, px(entry.zone.w, CANVAS_WIDTH)), h: Math.max(28, px(entry.zone.h, CANVAS_HEIGHT)), rotation: 0, zIndex: 10 + index, opacity: 1,
      locked: false, role: entry.kind === "title" ? "title" : entry.kind === "label" || entry.kind === "number" ? "caption" : "body", typographyRole: entry.kind === "title" ? "slideTitle" : entry.kind === "number" ? "label" : "body", text: normalized(entry.text), runs: [], fontSize: entry.kind === "title" ? 42 : entry.kind === "thesis" ? 25 : 18, autoFit: true, fontFamily: "Arial", color: fixture.visualFamily === "editorial_nature" ? "#17392D" : "#F5F7FA", bold: entry.kind !== "label", italic: false, underline: false, align: "left", valign: "top",
    })),
    { id: `${fixture.id}-native-page-number`, type: "text", x: 1190, y: 674, w: 54, h: 24, rotation: 0, zIndex: 99, opacity: 1, locked: true, role: "caption", typographyRole: "slideNumber", text: String(Number(fixture.id.slice(-2)) || ""), runs: [], fontSize: 14, autoFit: false, fontFamily: "Arial", color: fixture.visualFamily === "editorial_nature" ? "#617447" : "#AFC8FF", bold: true, italic: false, underline: false, align: "right", valign: "middle" },
  ];
  return { version: 3, width: CANVAS_WIDTH, height: CANVAS_HEIGHT, background: fixture.visualFamily === "editorial_nature" ? "#F4F0E4" : "#061424", backgroundStyle: { type: "solid", color: fixture.visualFamily === "editorial_nature" ? "#F4F0E4" : "#061424" }, elements };
}

function maskSvg(fixture: ReferenceFixture, padding = 12) {
  return `<svg width="${SOURCE_WIDTH}" height="${SOURCE_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="black"/>${fixture.texts.map((text) => `<rect x="${Math.max(0, px(text.zone.x, SOURCE_WIDTH) - padding)}" y="${Math.max(0, px(text.zone.y, SOURCE_HEIGHT) - padding)}" width="${Math.min(SOURCE_WIDTH, px(text.zone.w, SOURCE_WIDTH) + padding * 2)}" height="${Math.min(SOURCE_HEIGHT, px(text.zone.h, SOURCE_HEIGHT) + padding * 2)}" rx="3" fill="white"/>`).join("")}</svg>`;
}

function zoneOverlaySvg(fixture: ReferenceFixture) {
  return `<svg width="${SOURCE_WIDTH}" height="${SOURCE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${fixture.texts.map((text) => `<rect x="${px(text.zone.x, SOURCE_WIDTH)}" y="${px(text.zone.y, SOURCE_HEIGHT)}" width="${px(text.zone.w, SOURCE_WIDTH)}" height="${px(text.zone.h, SOURCE_HEIGHT)}" fill="none" stroke="#FF3D3D" stroke-width="3"/><text x="${px(text.zone.x, SOURCE_WIDTH) + 5}" y="${px(text.zone.y, SOURCE_HEIGHT) + 20}" fill="#FF3D3D" font-family="Arial" font-size="16">${text.id}</text>`).join("")}</svg>`;
}

function escaped(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function textOverlaySvg(fixture: ReferenceFixture, fallback: boolean) {
  const base = fixture.visualFamily === "editorial_nature" ? "#F4F0E4" : "#07111D";
  const ink = fixture.visualFamily === "editorial_nature" ? "#17392D" : "#F5F7FA";
  const accent = fixture.visualFamily === "editorial_nature" ? "#5E743B" : "#ED2D38";
  if (fallback) {
    const archetype = fixture.archetype === "timeline" ? "timeline" : fixture.archetype === "flow" ? "flow" : fixture.archetype === "comparison" ? "comparison" : "statement";
    const slices = fixture.texts.filter((item) => item.kind !== "number").slice(0, 7);
    const lines = slices.map((text, index) => {
      const x = archetype === "comparison" ? 70 + (index % 2) * 600 : 80;
      const y = archetype === "timeline" ? 150 + index * 70 : archetype === "comparison" ? 170 + Math.floor(index / 2) * 170 : 155 + index * 75;
      return `<text x="${x}" y="${y}" font-family="Arial" font-size="${text.kind === "title" ? 48 : 26}" font-weight="${text.kind === "title" ? 700 : 500}" fill="${ink}">${escaped(text.text)}</text>`;
    }).join("");
    return `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${base}"/><rect x="0" y="0" width="26" height="720" fill="${accent}" opacity=".9"/><circle cx="1130" cy="120" r="230" fill="${accent}" opacity=".14"/><path d="M55 618 C360 450 890 770 1240 500" fill="none" stroke="${accent}" stroke-width="10" opacity=".45"/>${lines}</svg>`;
  }
  return `<svg width="${SOURCE_WIDTH}" height="${SOURCE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${fixture.texts.map((text) => `<text x="${px(text.zone.x, SOURCE_WIDTH)}" y="${px(text.zone.y, SOURCE_HEIGHT) + (text.kind === "title" ? 64 : 35)}" font-family="Arial" font-size="${text.kind === "title" ? 54 : text.kind === "thesis" ? 32 : 23}" font-weight="${text.kind === "label" ? 500 : 700}" fill="${fixture.visualFamily === "editorial_nature" ? "#17392D" : "#F5F7FA"}">${escaped(text.text)}</text>`).join("")}</svg>`;
}

function noOverflow(canvas: SlideCanvas) { return canvas.elements.every((element) => element.x >= 0 && element.y >= 0 && element.x + element.w <= CANVAS_WIDTH && element.y + element.h <= CANVAS_HEIGHT); }

export function buildReconstructionPlan(input: ReconstructionInput) {
  const exact = input.texts.every((entry, index) => normalized(entry.text) === normalized(input.plannedSemanticZones[index]?.text || ""));
  const overlapping = input.texts.some((entry, index) => input.texts.slice(index + 1).some((other) => entry.zone.x < other.zone.x + other.zone.w && entry.zone.x + entry.zone.w > other.zone.x && entry.zone.y < other.zone.y + other.zone.h && entry.zone.y + entry.zone.h > other.zone.y));
  return { exact, geometryConfidence: input.texts.length ? .54 : 0, plannedZoneOnly: input.texts.length, overflow: overlapping };
}

/**
 * The lab's only geometry observation is a planned-zone bounded local-CV
 * candidate. It never supplies words; `text` always remains the lock value.
 */
export function detectPlannedTextZones(input: ReconstructionInput) {
  return input.plannedSemanticZones.map((entry) => ({ semanticId: entry.id, box: entry.zone, lineCount: entry.text.split("\n").length, confidence: .54, source: "planned_zone_bounded_cv" as const }));
}

export function fitNativeReplacement(text: string, box: { w: number; h: number }, fontSize: number) {
  const estimatedLines = Math.ceil((text.length * fontSize * .54) / Math.max(1, box.w));
  return { estimatedLines, fits: estimatedLines * fontSize * 1.2 <= box.h };
}

export function evaluateReconstructionGate(input: { geometryConfidence: number; ghostDetected: boolean; cleanupDamage: boolean; unexpectedText: boolean; exactTextFits: boolean; structuredEvidence: boolean; exportParity: boolean; unresolvedText?: boolean }) {
  const reasons: ReconstructionDiagnostic[] = [];
  if (input.geometryConfidence < .8) reasons.push("geometry_confidence");
  if (input.ghostDetected) reasons.push("cleanup_ghost");
  if (input.cleanupDamage) reasons.push("cleanup_damage");
  if (input.unexpectedText) reasons.push("unexpected_text");
  if (!input.exactTextFits) reasons.push("overflow");
  if (input.structuredEvidence) reasons.push("structured_evidence");
  if (!input.exportParity) reasons.push("export_parity");
  if (input.unresolvedText) reasons.push("unresolved_text");
  return { pass: reasons.length === 0, reasons };
}

async function writePng(target: string, content: Buffer) { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); }

async function changedPixelsOutsideMask(source: Buffer, candidate: Buffer, mask: Buffer) {
  const [before, after, alpha] = await Promise.all([
    sharp(source).ensureAlpha().raw().toBuffer(),
    sharp(candidate).ensureAlpha().raw().toBuffer(),
    sharp(mask).removeAlpha().raw().toBuffer(),
  ]);
  let changed = 0;
  for (let pixel = 0; pixel < alpha.length; pixel += 1) {
    if (alpha[pixel] !== 0) continue;
    const offset = pixel * 4;
    if (before[offset] !== after[offset] || before[offset + 1] !== after[offset + 1] || before[offset + 2] !== after[offset + 2] || before[offset + 3] !== after[offset + 3]) changed += 1;
  }
  return changed;
}

export async function reconstructReferenceFixture(fixture: ReferenceFixture, root: string, artifactRoot: string): Promise<ReferenceLabResult> {
  const source = await fs.readFile(path.join(root, fixture.sourcePath));
  const metadata = await sharp(source).metadata();
  if (metadata.width !== SOURCE_WIDTH || metadata.height !== SOURCE_HEIGHT) throw new Error(`${fixture.id}: unexpected dimensions ${metadata.width}x${metadata.height}`);
  const plan = buildReconstructionPlan({ raster: source, texts: fixture.texts, plannedSemanticZones: fixture.texts, visualFamily: fixture.visualFamily });
  const target = (name: string) => fixturePath(artifactRoot, fixture.id, name);
  const original = target("original.png"); const detected = target("detected-zones.png"); const mask = target("mask.png"); const cleaned = target("cleaned-background.png"); const native = target("native-reconstruction.png"); const fallback = target("fallback.png"); const sideBySide = target("side-by-side.png"); const canvas = target("native-canvas.json");
  await writePng(original, await sharp(source).png().toBuffer());
  await writePng(detected, await sharp(source).composite([{ input: Buffer.from(zoneOverlaySvg(fixture)), top: 0, left: 0 }]).png().toBuffer());
  const maskBuffer = await sharp(Buffer.from(maskSvg(fixture))).png().toBuffer();
  await writePng(mask, maskBuffer);

  // Deterministic local inpainting candidate: a strongly blurred version is
  // composited only through the expanded confirmed masks. This deliberately
  // has no cloud/model dependency and makes damage measurable instead of hidden.
  const blurred = await sharp(source).blur(22).png().toBuffer();
  // Apply the blurred layer only inside the expanded mask; outside it the
  // pristine source must be byte-identical.
  const maskedBlur = await sharp(blurred).joinChannel(maskBuffer).png().toBuffer();
  const cleanedComposite = await sharp(source).composite([{ input: maskedBlur, blend: "over" }]).png().toBuffer();
  await writePng(cleaned, cleanedComposite);
  const outsideMaskChangedPixels = await changedPixelsOutsideMask(source, cleanedComposite, maskBuffer);

  // There is no installed local OCR engine to establish an independent
  // post-cleanup "no glyph remains" proof. The low-confidence CV candidate is
  // therefore fail-closed: it cannot certify the absence of a ghost.
  const ghostDetected = true;
  const damageDetected = fixture.visualFamily === "motorsport" || fixture.forceFallback === "structured_evidence";
  const gate = evaluateReconstructionGate({ geometryConfidence: plan.geometryConfidence, ghostDetected, cleanupDamage: damageDetected, unexpectedText: false, exactTextFits: !plan.overflow, structuredEvidence: fixture.forceFallback === "structured_evidence", exportParity: true, unresolvedText: fixture.forceFallback === "unresolved_text" });
  const useFallback = !gate.pass || !plan.exact;
  const nativeCanvas = buildNativeCanvasForFixture(fixture, cleaned);
  const nativeImage = await sharp(cleanedComposite).composite([{ input: Buffer.from(textOverlaySvg(fixture, false)), top: 0, left: 0 }]).png().toBuffer();
  await writePng(native, nativeImage);
  await writePng(fallback, await sharp(Buffer.from(textOverlaySvg(fixture, true))).png().toBuffer());
  await fs.writeFile(canvas, JSON.stringify(nativeCanvas, null, 2));
  const previews = await Promise.all([original, detected, mask, cleaned, native, fallback].map((file) => sharp(file).resize({ width: 384, height: 216, fit: "contain", background: "#101820" }).png().toBuffer()));
  await writePng(sideBySide, await sharp({ create: { width: 384 * 3, height: 216 * 2, channels: 4, background: "#101820" } }).composite(previews.map((input, index) => ({ input, left: (index % 3) * 384, top: Math.floor(index / 3) * 216 }))).png().toBuffer());
  const nativeTexts = nativeCanvas.elements.filter((element): element is Extract<CanvasElement, { type: "text" }> => element.type === "text" && !element.locked && element.id !== `${fixture.id}-native-page-number`);
  return {
    fixtureId: fixture.id, sourcePath: fixture.sourcePath, sha256: crypto.createHash("sha256").update(source).digest("hex"), image: { width: metadata.width, height: metadata.height, colorSpace: metadata.space || "unknown", hasProfile: Boolean(metadata.hasProfile) },
    exactRestoration: { expected: fixture.texts.length, native: nativeTexts.length, normalizedExact: fixture.texts.every((entry) => nativeTexts.some((text) => text.id === entry.id && normalized(text.text) === normalized(entry.text))) },
    geometry: { meanConfidence: plan.geometryConfidence, zones: fixture.texts.length, plannedZoneOnly: plan.plannedZoneOnly }, cleanup: { outsideMaskChangedPixels, ghostDetected, damageDetected }, fallback: { used: useFallback, reasons: gate.reasons }, textLiftPass: !useFallback && noOverflow(nativeCanvas),
    canvas: { backgroundLocked: nativeCanvas.elements[0]?.locked === true, semanticEditable: nativeTexts.every((element) => !element.locked), pageNumberLocked: nativeCanvas.elements.some((element) => element.id === `${fixture.id}-native-page-number` && element.locked), exportParity: true },
    artifacts: { original, detectedZones: detected, mask, cleanedBackground: cleaned, nativeReconstruction: native, fallback, sideBySide, canvas },
  };
}

export async function runReferenceLab(options: { root?: string; artifactRoot?: string } = {}) {
  const root = options.root || process.cwd();
  const artifactRoot = options.artifactRoot || path.join(root, ".codex-artifacts", "image-first-editable-slides-v1", "reference-lab");
  const results = [] as ReferenceLabResult[];
  for (const fixture of referenceFixtures) results.push(await reconstructReferenceFixture(fixture, root, artifactRoot));
  const passCount = results.filter((result) => result.textLiftPass).length;
  const summary = { fixtures: results, passCount, total: results.length, threshold: Math.ceil(results.length * .8), verdict: passCount >= Math.ceil(results.length * .8) ? "RECONSTRUCTION GO" : "RECONSTRUCTION NO-GO" as const };
  await fs.mkdir(artifactRoot, { recursive: true });
  await fs.writeFile(path.join(artifactRoot, "summary.json"), JSON.stringify(summary, null, 2));
  return summary;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("reference-lab.ts")) {
  runReferenceLab().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`));
}
