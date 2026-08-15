import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import JSZip from "jszip";
import sharp from "sharp";
import { auditSlideCanvas, ensureEditableCanvas, presentationSchema } from "@studydeck/shared";
import { createPdf, createPptx, renderPdfHtml } from "./export.js";
import { chromiumExecutablePath } from "./pdf-renderer.js";

const execFileAsync = promisify(execFile);
const caseName = process.argv[process.argv.indexOf("--case") + 1];

if (caseName === "real-pdf") {
  await runRealPdfSmoke();
} else if (caseName === "golden") {
  await runGoldenExportSmoke();
} else {
  throw new Error('Usage: node export-runtime-smoke.js --case <real-pdf|golden>');
}

async function runRealPdfSmoke() {
  const pdf = await createPdf(presentationSchema.parse(canvasDeck()));
  assert(pdf.subarray(0, 5).toString("utf8") === "%PDF-", "PDF output has no valid header");
  assert(pdf.length > 1000, "PDF output is unexpectedly small");
  console.info(`[worker-export-smoke] real-pdf bytes=${pdf.length}`);
}

async function runGoldenExportSmoke() {
  const timings: Record<string, number> = {};
  const golden = goldenExportDeck();
  const canvasIssues = await measure(timings, "canvas-audit", () => golden.slides.flatMap((slide) => auditSlideCanvas(slide.canvas!)));
  assert(canvasIssues.length === 0, `Golden canvas audit failed: ${canvasIssues.join("; ")}`);

  const html = await measure(timings, "html", () => renderPdfHtml(golden));
  assert(html.includes("Golden export evidence"), "Golden PDF HTML is missing its title");
  assert(html.includes("Golden source"), "Golden PDF HTML is missing source attribution");

  const pptx = await measure(timings, "pptx", async () => JSZip.loadAsync(await createPptx(golden)));
  const slideXml = await pptx.file("ppt/slides/slide1.xml")?.async("string");
  assert(slideXml?.includes("Golden export evidence"), "Golden PPTX is missing its title");
  assert(slideXml?.includes("Golden source"), "Golden PPTX is missing source attribution");

  const pdf = await measure(timings, "pdf-chromium", () => createPdf(golden));
  const { preview, pdfPage } = await measure(timings, "preview-and-raster", () => renderGoldenExportPages(html, pdf));
  const [previewMetadata, pdfMetadata] = await Promise.all([sharp(preview).metadata(), sharp(pdfPage).metadata()]);
  assert(previewMetadata.width === 1280 && previewMetadata.height === 720 && previewMetadata.format === "png", "HTML preview has unexpected dimensions");
  assert(pdfMetadata.width === 1280 && pdfMetadata.height === 720 && pdfMetadata.format === "png", "PDF raster has unexpected dimensions");

  const difference = await measure(timings, "raster-comparison", () => meanPixelDifference(preview, pdfPage));
  assert(difference < 12, `Golden preview/PDF difference ${difference.toFixed(2)} exceeds 12`);

  console.info(`[golden-export] ${Object.entries(timings).map(([stage, duration]) => `${stage}=${duration}ms`).join(" ")}`);
}

function canvasDeck() {
  return {
    id: "presentation-canvas",
    title: "Canvas deck",
    scenario: "lesson",
    level: "beginner",
    slideCount: 1,
    generationMode: "demo" as const,
    generatedText: "Slide 1: Canvas title\nCanvas body.",
    sources: [],
    outline: ["Canvas title"],
    narrativePlan: [],
    speechScript: [{ slideOrder: 1, slideTitle: "Canvas title", text: "Narration." }],
    slides: [{
      id: "slide-1",
      order: 1,
      title: "Canvas title",
      slideKind: "content" as const,
      layout: "bullets" as const,
      thesis: "Canvas body.",
      bullets: [],
      definition: null,
      keyConcepts: [],
      visual: { type: "none" as const, title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] },
      highlights: [],
      blocks: [{ type: "callout" as const, content: "Canvas body." }],
      canvas: {
        width: 1280,
        height: 720,
        background: "#FFFFFF",
        elements: [
          { id: "shape-1", type: "shape" as const, shape: "roundRect" as const, x: 80, y: 90, w: 1120, h: 500, rotation: 0, zIndex: 1, opacity: 1, locked: false, fill: "#FF8A00", stroke: "#161A1F", strokeWidth: 2 },
          { id: "text-1", type: "text" as const, role: "title" as const, x: 150, y: 160, w: 980, h: 120, rotation: 0, zIndex: 2, opacity: 1, locked: false, text: "Canvas title", runs: [{ text: "Canvas title", bold: true }], fontSize: 46, fontFamily: "Arial", color: "#161A1F", bold: true, italic: false, underline: false, align: "center" as const, valign: "middle" as const },
          { id: "text-2", type: "text" as const, role: "body" as const, x: 220, y: 310, w: 840, h: 120, rotation: 0, zIndex: 3, opacity: 1, locked: false, text: "Canvas body", runs: [{ text: "Canvas body", italic: true }], fontSize: 30, fontFamily: "Arial", color: "#161A1F", bold: false, italic: true, underline: false, align: "center" as const, valign: "middle" as const },
        ],
      },
      speakerNotes: "Narration.",
      timingSeconds: 45,
      placeholders: [],
      sourceRefs: [],
    }],
  };
}

function goldenExportDeck() {
  const source = canvasDeck();
  return ensureEditableCanvas(presentationSchema.parse({
    ...source,
    title: "Golden export evidence",
    sources: [{ id: "golden-source", label: "Golden source", type: "WEB", excerpt: "Verified source attribution." }],
    slides: source.slides.map(({ canvas: _canvas, ...slide }) => ({
      ...slide,
      title: "Golden export evidence",
      thesis: "The golden deck keeps preview and exported artifacts aligned.",
      bullets: ["One checked layout", "One visible attribution"],
      blocks: [{ type: "bullets" as const, items: ["One checked layout", "One visible attribution"] }],
      sourceRefs: [{ sourceId: "golden-source", label: "Golden source", excerpt: "Verified source attribution.", page: null }],
    })),
  }));
}

async function renderGoldenExportPages(html: string, pdf: Buffer) {
  const puppeteer = await import("puppeteer-core");
  const browser = await puppeteer.default.launch({
    executablePath: chromiumExecutablePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-software-rasterizer"],
    headless: true,
  });
  let preview: Buffer;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    preview = Buffer.from(await page.screenshot({ type: "png" }));
  } finally {
    await browser.close();
  }

  const directory = await mkdtemp(join(tmpdir(), "studydeck-export-golden-"));
  const pdfPath = join(directory, "golden.pdf");
  const imageBasePath = join(directory, "golden-page");
  try {
    await writeFile(pdfPath, pdf);
    await execFileAsync("pdftoppm", ["-png", "-singlefile", "-scale-to-x", "1280", "-scale-to-y", "720", pdfPath, imageBasePath]);
    return { preview: preview!, pdfPage: await readFile(`${imageBasePath}.png`) };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function measure<T>(timings: Record<string, number>, stage: string, action: () => T | Promise<T>) {
  const startedAt = performance.now();
  try {
    return await action();
  } finally {
    timings[stage] = Math.round(performance.now() - startedAt);
  }
}

async function meanPixelDifference(left: Buffer, right: Buffer) {
  const [leftPixels, rightPixels] = await Promise.all([sharp(left).ensureAlpha().raw().toBuffer(), sharp(right).ensureAlpha().raw().toBuffer()]);
  assert(leftPixels.length === rightPixels.length, "Golden comparison images have different pixel buffers");
  let difference = 0;
  for (let index = 0; index < leftPixels.length; index += 4) {
    difference += Math.abs(leftPixels[index]! - rightPixels[index]!);
    difference += Math.abs(leftPixels[index + 1]! - rightPixels[index + 1]!);
    difference += Math.abs(leftPixels[index + 2]! - rightPixels[index + 2]!);
  }
  return difference / (leftPixels.length / 4 * 3);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
