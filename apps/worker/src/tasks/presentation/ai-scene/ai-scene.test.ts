import { describe, expect, it, vi } from "vitest";
import { aiSceneSpecSchema, ensureEditableCanvas, presentationSchema } from "@studydeck/shared";
import { createSlideContentLock, assertContentLockUnchanged } from "./content-lock.js";
import { compileAiScene } from "./scene-compiler.js";
import { inspectAiScene } from "./scene-quality.js";
import { inspectAiSceneVisuals } from "./scene-visual-quality.js";
import { inspectAiScenePreflight } from "./scene-preflight.js";
import { markAiSceneRepair, mayRepairAiScene } from "./scene-repair.js";
import { renderAiSceneCanvas } from "./scene-render.js";
import { renderPdfCanvasElement } from "../../export/pdf-canvas.js";
import { renderPptxCanvasSlide } from "../../export/pptx-canvas.js";
import { SCENE_ANALYSIS_MAX_OUTPUT_TOKENS, compactSceneAnalysisContract, normalizeAiSceneSpec, prepareVisionReference } from "./scene-analyzer.js";
import sharp from "sharp";

const slide = {
  id: "slide-1", order: 1, title: "Система", slideKind: "content" as const, layout: "process" as const,
  thesis: "Гравитация и скорость создают орбиту.", bullets: ["Солнце", "Планеты"], definition: null, keyConcepts: [],
  visual: { type: "none" as const, title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] }, highlights: [],
  blocks: [{ type: "callout" as const, content: "Орбита — это движение." }], speakerNotes: "Система движется по общим законам.", timingSeconds: 45, sourceRefs: [],
};

describe("ai scene v2", () => {
  it("compiles freeform coordinates with exact content-lock strings", () => {
    const lock = createSlideContentLock(slide, { composition: "process", labels: [{ key: "sun", text: "Солнце" }, { key: "orbit", text: "Орбита" }] });
    const canvas = compileAiScene({
      contentLock: lock,
      assets: { background: { objectKey: "projects/test/background.png", url: "/background", contentType: "image/png", alt: "Космический фон" } },
      scene: {
        version: 2, slideId: "slide-1", background: { color: "#08111F", prompt: "deep-space blue background" },
        elements: [
          { type: "shape", id: "wash", shape: "roundRect", x: 48, y: 42, w: 565, h: 260, fill: "#08111F", stroke: "#08111F", opacity: 0.86, zIndex: 2 },
          { type: "text", id: "title", textRef: "title", role: "title", x: 80, y: 78, w: 510, h: 90, fontSize: 50, color: "#FFFFFF", align: "left", bold: true, zIndex: 4 },
          { type: "text", id: "thesis", textRef: "thesis", role: "thesis", x: 80, y: 182, w: 490, h: 100, fontSize: 28, color: "#DDEBFF", align: "left", bold: false, zIndex: 4 },
          { type: "diagram", id: "orbit", x: 620, y: 210, w: 560, h: 230, template: "flow", nodeRefs: ["label:sun", "label:orbit"], zIndex: 6 },
        ],
      },
    });

    expect(canvas.origin).toBe("ai_scene_v2");
    expect(canvas.elements.find((element) => element.id === "title")).toMatchObject({ type: "text", text: "Система" });
    expect(canvas.elements.find((element) => element.id === "orbit")).toMatchObject({ type: "diagram", model: { kind: "scheme", nodes: [{ label: "Солнце" }, { label: "Орбита" }] } });
  });

  it("does not rebuild an ai scene through the legacy canvas builder", () => {
    const lock = createSlideContentLock(slide);
    const canvas = compileAiScene({
      contentLock: lock,
      assets: { background: { objectKey: "projects/test/background.png", url: "/background", contentType: "image/png", alt: "Космический фон" } },
      scene: { version: 2, slideId: "slide-1", background: { color: "#08111F", prompt: "deep-space blue background" }, elements: [
        { type: "shape", id: "wash", shape: "roundRect", x: 48, y: 42, w: 565, h: 260, fill: "#08111F", stroke: "#08111F", opacity: 0.86, zIndex: 2 },
        { type: "text", id: "title", textRef: "title", role: "title", x: 80, y: 78, w: 510, h: 90, fontSize: 50, color: "#FFFFFF", align: "left", bold: true, zIndex: 4 },
        { type: "text", id: "thesis", textRef: "thesis", role: "thesis", x: 80, y: 182, w: 490, h: 100, fontSize: 28, color: "#DDEBFF", align: "left", bold: false, zIndex: 4 },
        { type: "shape", id: "subject", shape: "ellipse", x: 760, y: 220, w: 240, h: 240, fill: "#FFC857", stroke: "#55D6E8", opacity: 1, zIndex: 5 },
      ] },
    });
    const document = presentationSchema.parse({ id: "deck", title: "Тест", scenario: "school_report", level: "school", slideCount: 1, generationMode: "local", generatedText: "", sources: [], outline: [], narrativePlan: [], speechScript: [{ slideOrder: 1, slideTitle: "Система", text: slide.speakerNotes }], slides: [{ ...slide, canvas }] });
    expect(ensureEditableCanvas(document).slides[0]?.canvas).toEqual(canvas);
  });

  it("rejects a redesign that changes the content hash", () => {
    const original = createSlideContentLock(slide);
    const changed = createSlideContentLock({ ...slide, thesis: "Другой тезис." });
    expect(() => assertContentLockUnchanged(original, changed)).toThrow("ai_scene_content_hash_changed");
  });

  it("reports a hard failure instead of a template fallback when required artifacts are absent", () => {
    const lock = createSlideContentLock(slide);
    const report = inspectAiScene({ canvas: { origin: "ai_scene_v2", width: 1280, height: 720, background: "#08111F", elements: [] }, contentLock: lock });
    expect(report.passed).toBe(false);
    expect(report.hardChecks.assetsAvailable.passed).toBe(false);
  });

  it("compresses the concept before the vision analysis request", async () => {
    const source = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#112233" } }).png().toBuffer();
    const compact = await prepareVisionReference(source);
    const metadata = await sharp(compact).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBeLessThanOrEqual(640);
    expect(metadata.height).toBeLessThanOrEqual(360);
  });

  it("keeps the provider scene-analysis contract compact enough for one JSON response", () => {
    const contract = compactSceneAnalysisContract("process");
    expect(SCENE_ANALYSIS_MAX_OUTPUT_TOKENS).toBe(2600);
    expect(contract).toContain("one line");
    expect(contract).toContain("exactly 4–8 elements");
    expect(contract).toContain("label:* nodeRefs");
    expect(contract).toContain("cycle diagram");
  });

  it("only fills provider-omitted structural fields without replacing its scene geometry", () => {
    const lock = createSlideContentLock(slide, { composition: "process", labels: [{ key: "sun", text: "Солнце" }, { key: "orbit", text: "Орбита" }] });
    const normalized = normalizeAiSceneSpec({
      background: { color: "#08111F", prompt: "text-free cosmic background with calm dark space" },
      elements: [
        { type: "text", textRef: "title", x: 100, y: 80, w: 500, h: 80, fontSize: 48, color: "#FFFFFF" },
        { type: "text", textRef: "thesis", x: 110, y: 180, w: 440, h: 120, fontSize: 28, color: "#DDEBFF" },
        { type: "shape", shape: "roundRect", x: 80, y: 60, w: 560, h: 260, fill: "#08111F" },
        { type: "diagram", x: 640, y: 200, w: 500, h: 250 },
      ],
    }, lock);
    const parsed = aiSceneSpecSchema.parse(normalized);
    expect(parsed.slideId).toBe(lock.slideId);
    expect(parsed.elements[0]).toMatchObject({ id: "ai-scene-text-1", role: "title", x: 100, y: 80 });
    expect(parsed.elements[2]).toMatchObject({ id: "ai-scene-shape-3", stroke: "#08111F", w: 560 });
    expect(parsed.elements[3]).toMatchObject({ id: "ai-scene-diagram-4", template: "flow", nodeRefs: ["label:sun", "label:orbit"], x: 640 });
  });

  it("maps only exact locked text back to textRef and preserves numeric geometry", () => {
    const lock = createSlideContentLock(slide, { composition: "process", labels: [{ key: "sun", text: "Солнце" }, { key: "orbit", text: "Орбита" }] });
    const parsed = aiSceneSpecSchema.parse(normalizeAiSceneSpec({
      background: { color: "#08111F", prompt: "text-free cosmic background with calm dark space" },
      elements: [
        { type: "text", text: lock.title, x: "64", y: "32", w: "1152", h: "120", fontSize: "40", color: "#FFFFFF" },
        { type: "text", text: lock.thesis, x: "64", y: "165", w: "1152", h: "145", fontSize: "30", color: "#DDEBFF" },
        { type: "diagram", x: "560", y: "350", w: "640", h: "320", template: "flow", nodeRefs: ["label:sun", "label:orbit"] },
      ],
    }, lock));
    expect(parsed.elements[0]).toMatchObject({ textRef: "title", x: 64, fontSize: 40 });
    expect(parsed.elements[1]).toMatchObject({ textRef: "thesis", y: 165, h: 145 });
  });

  it("maps an exact locked value incorrectly placed in textRef back to its key", () => {
    const lock = createSlideContentLock(slide);
    const parsed = aiSceneSpecSchema.parse(normalizeAiSceneSpec({
      background: { color: "#08111F", prompt: "text-free cosmic background with calm dark space" },
      elements: [
        { type: "text", textRef: lock.title, x: 64, y: 32, w: 1152, h: 120, fontSize: 40, color: "#FFFFFF" },
        { type: "text", textRef: lock.thesis, x: 64, y: 165, w: 1152, h: 145, fontSize: 30, color: "#DDEBFF" },
        { type: "shape", shape: "ellipse", x: 700, y: 370, w: 200, h: 200, fill: "#FFC857", stroke: "#FFC857" },
      ],
    }, lock));
    expect(parsed.elements[0]).toMatchObject({ textRef: "title", role: "title" });
    expect(parsed.elements[1]).toMatchObject({ textRef: "thesis", role: "thesis" });
  });

  it("normalizes common provider aliases without changing its scene geometry", () => {
    const lock = createSlideContentLock(slide, { composition: "statement", labels: [{ key: "sun", text: "Солнце" }, { key: "orbit", text: "Орбита" }] });
    const parsed = aiSceneSpecSchema.parse(normalizeAiSceneSpec({
      background: { color: "#08111F", prompt: "text-free cosmic background" },
      elements: [
        { type: "text", textRef: "title", x: 100, y: 80, w: 500, h: 80, fontSize: 48, color: "#FFFFFF" },
        { type: "text", textRef: "thesis", x: 110, y: 180, w: 440, h: 120, fontSize: 28, color: "#DDEBFF" },
        { type: "shape", shape: "circle", x: 720, y: 200, w: 240, h: 240, fill: "#F4C542" },
        { type: "diagram", x: 640, y: 470, w: 500, h: 130, template: "solar-orbit-system", nodeRefs: ["label:sun", "label:orbit"] },
      ],
    }, lock));
    expect(parsed.elements[2]).toMatchObject({ type: "shape", shape: "ellipse", x: 720, y: 200, w: 240, h: 240 });
    expect(parsed.elements[3]).toMatchObject({ type: "diagram", template: "cycle", x: 640, y: 470, w: 500, h: 130 });
  });

  it("accepts common CSS color syntax without changing scene geometry", () => {
    const lock = createSlideContentLock(slide);
    const parsed = aiSceneSpecSchema.parse(normalizeAiSceneSpec({
      background: { color: "#123", prompt: "text-free cosmic background with a quiet area for the editable title" },
      elements: [
        { type: "text", textRef: "title", x: 100, y: 80, w: 500, h: 80, fontSize: 48, color: "rgb(255, 255, 255)" },
        { type: "text", textRef: "thesis", x: 110, y: 180, w: 440, h: 120, fontSize: 28, color: "#DDEBFF" },
        { type: "shape", shape: "roundRect", x: 80, y: 60, w: 560, h: 260, fill: "rgba(8, 17, 31, 0.86)", stroke: "#08111FFF" },
      ],
    }, lock));
    expect(parsed.background.color).toBe("#112233");
    expect(parsed.elements[0]).toMatchObject({ color: "#FFFFFF", x: 100, y: 80 });
    expect(parsed.elements[2]).toMatchObject({ fill: "#08111F", stroke: "#08111F", opacity: 0.86, x: 80, y: 60 });
  });

  it("reduces transparent and gradient CSS fills to editable canvas colors", () => {
    const lock = createSlideContentLock(slide);
    const parsed = aiSceneSpecSchema.parse(normalizeAiSceneSpec({
      background: { color: "#08111F", prompt: "text-free cosmic background with a quiet area for the editable title" },
      elements: [
        { type: "text", textRef: "title", x: 100, y: 80, w: 500, h: 80, fontSize: 48, color: "white" },
        { type: "text", textRef: "thesis", x: 110, y: 180, w: 440, h: 120, fontSize: 28, color: "#DDEBFF" },
        { type: "shape", shape: "roundRect", x: 80, y: 60, w: 560, h: 260, fill: "linear-gradient(135deg, #08111F 0%, #1D4ED8 100%)", stroke: "transparent" },
      ],
    }, lock));
    expect(parsed.elements[2]).toMatchObject({ fill: "#08111F", stroke: "#000000", x: 80, y: 60 });
  });

  it("maps an SVG none fill to a transparent editable shape", () => {
    const lock = createSlideContentLock(slide);
    const parsed = aiSceneSpecSchema.parse(normalizeAiSceneSpec({
      background: { color: "#08111F", prompt: "text-free cosmic background with a quiet area for the editable title" },
      elements: [
        { type: "text", textRef: "title", x: 100, y: 80, w: 500, h: 80, fontSize: 48, color: "white" },
        { type: "text", textRef: "thesis", x: 110, y: 180, w: 440, h: 120, fontSize: 28, color: "#DDEBFF" },
        { type: "shape", shape: "line", x: 80, y: 60, w: 560, h: 8, fill: "none", stroke: "#3286C8" },
      ],
    }, lock));
    expect(parsed.elements[2]).toMatchObject({ fill: "#000000", opacity: 0, stroke: "#3286C8", x: 80, y: 60 });
  });

  it("renders an editable ellipse as an ellipse rather than a template rectangle", async () => {
    const background = await sharp({ create: { width: 128, height: 72, channels: 3, background: "#000000" } }).png().toBuffer();
    const rendered = await renderAiSceneCanvas({ version: 1, origin: "ai_scene_v2", width: 128, height: 72, background: "#000000", elements: [
      { id: "ellipse", type: "shape", x: 32, y: 16, w: 64, h: 40, rotation: 0, zIndex: 2, opacity: 1, locked: false, shape: "ellipse", fill: "#FF0000", stroke: "#FF0000", strokeWidth: 1 },
    ] }, background);
    const { data } = await sharp(rendered).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => data[(y * 128 + x) * 4]!;
    expect(pixel(64, 36)).toBeGreaterThan(180);
    expect(pixel(33, 17)).toBeLessThan(40);
  });

  it("rejects a repeated card grid and text that cannot fit before canvas render", () => {
    const lock = createSlideContentLock(slide);
    const scene = {
      version: 2 as const, slideId: "slide-1", background: { color: "#08111F", prompt: "text-free cosmic background with a quiet editable title area" }, elements: [
        { type: "text" as const, id: "title", textRef: "title", role: "title" as const, x: 70, y: 50, w: 300, h: 44, fontSize: 36, color: "#FFFFFF", align: "left" as const, bold: true, zIndex: 10 },
        { type: "text" as const, id: "thesis", textRef: "thesis", role: "thesis" as const, x: 70, y: 118, w: 280, h: 32, fontSize: 24, color: "#DDEBFF", align: "left" as const, bold: false, zIndex: 10 },
        { type: "shape" as const, id: "card-a", shape: "roundRect" as const, x: 90, y: 280, w: 220, h: 140, fill: "#FFFFFF", stroke: "#FFFFFF", opacity: 1, zIndex: 4 },
        { type: "shape" as const, id: "card-b", shape: "roundRect" as const, x: 350, y: 280, w: 220, h: 140, fill: "#FFFFFF", stroke: "#FFFFFF", opacity: 1, zIndex: 4 },
        { type: "shape" as const, id: "card-c", shape: "roundRect" as const, x: 610, y: 280, w: 220, h: 140, fill: "#FFFFFF", stroke: "#FFFFFF", opacity: 1, zIndex: 4 },
      ],
    };
    const diagnostics = inspectAiScenePreflight(scene, lock);
    expect(diagnostics).toContain("scene contains a repeated card-grid composition");
    expect(diagnostics.some((item) => item.includes("title uses 36px"))).toBe(true);
    expect(diagnostics.some((item) => item.includes("thesis needs"))).toBe(true);
    expect(() => compileAiScene({ contentLock: lock, assets: { background: { objectKey: "projects/test/background.png", url: "/background", contentType: "image/png", alt: "Космический фон" } }, scene })).toThrow("ai_scene_preflight_failed");
  });

  it("rejects a cramped cycle diagram before it can overlap its own 24px labels", () => {
    const lock = createSlideContentLock(slide, { composition: "statement", labels: [{ key: "one", text: "Гравитационно связанная система" }, { key: "two", text: "Около 4,6 млрд лет" }] });
    const diagnostics = inspectAiScenePreflight({ version: 2, slideId: "slide-1", background: { color: "#08111F", prompt: "text-free cosmic background with a quiet title and thesis area" }, elements: [
      { type: "text", id: "title", textRef: "title", role: "title", x: 64, y: 32, w: 800, h: 70, fontSize: 48, color: "#FFFFFF", align: "left", bold: true, zIndex: 10 },
      { type: "text", id: "thesis", textRef: "thesis", role: "thesis", x: 64, y: 130, w: 800, h: 90, fontSize: 30, color: "#DDEBFF", align: "left", bold: false, zIndex: 10 },
      { type: "diagram", id: "cycle", x: 70, y: 390, w: 1100, h: 250, template: "cycle", nodeRefs: ["label:one", "label:two"], zIndex: 15 },
    ] }, lock);
    expect(diagnostics).toContain("cycle needs at least 320px height for a readable non-overlapping cycle diagram");
  });

  it("does not treat a low-opacity named glow as a semantic collision", () => {
    const lock = createSlideContentLock(slide, { composition: "statement", labels: [{ key: "one", text: "Короткая метка" }, { key: "two", text: "Ещё метка" }] });
    const diagnostics = inspectAiScenePreflight({ version: 2, slideId: "slide-1", background: { color: "#08111F", prompt: "text-free space" }, elements: [
      { type: "text", id: "title", textRef: "title", role: "title", x: 64, y: 32, w: 1152, h: 120, fontSize: 40, color: "#FFFFFF", align: "left", bold: true, zIndex: 10 },
      { type: "text", id: "thesis", textRef: "thesis", role: "thesis", x: 64, y: 165, w: 1152, h: 145, fontSize: 30, color: "#DDEBFF", align: "left", bold: false, zIndex: 10 },
      { type: "shape", id: "sun-glow", shape: "ellipse", x: 700, y: 360, w: 220, h: 220, fill: "#FFC857", stroke: "#FFC857", opacity: 0.3, zIndex: 1 },
      { type: "diagram", id: "orbits", x: 560, y: 350, w: 640, h: 320, template: "cycle", nodeRefs: ["label:one", "label:two"], zIndex: 5 },
    ] }, lock);
    expect(diagnostics).not.toContain("sun-glow overlaps orbits");
  });

  it("requires actual pixel review and allows only one repair attempt", async () => {
    const lock = createSlideContentLock(slide, { composition: "process", labels: [{ key: "sun", text: "Солнце" }, { key: "orbit", text: "Орбита" }] });
    const scene = {
      version: 2 as const, slideId: "slide-1", background: { color: "#08111F", prompt: "text-free cosmic background with quiet title and thesis areas" }, elements: [
        { type: "text" as const, id: "title", textRef: "title", role: "title" as const, x: 70, y: 45, w: 680, h: 70, fontSize: 48, color: "#FFFFFF", align: "left" as const, bold: true, zIndex: 10 },
        { type: "text" as const, id: "thesis", textRef: "thesis", role: "thesis" as const, x: 70, y: 135, w: 610, h: 90, fontSize: 30, color: "#DDEBFF", align: "left" as const, bold: false, zIndex: 10 },
        { type: "diagram" as const, id: "orbit", x: 700, y: 270, w: 500, h: 300, template: "flow" as const, nodeRefs: ["label:sun", "label:orbit"], zIndex: 15 },
      ],
    };
    const canvas = compileAiScene({ contentLock: lock, assets: { background: { objectKey: "projects/test/background.png", url: "/background", contentType: "image/png", alt: "Космический фон" } }, scene });
    const png = await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#08111F" } }).png().toBuffer();
    const review = await inspectAiSceneVisuals({ concept: png, background: png, rendered: png, scene, lock, style: { version: 1, palette: { background: "#08111F", surface: "#112233", text: "#FFFFFF", mutedText: "#DDEBFF", accent: "#FFCC00", accentSecondary: "#33CCFF" }, atmosphere: "Тёмное космическое пространство", typography: { title: "Arial", body: "Arial", hierarchy: "Крупная ясная иерархия" }, imageStyle: "Научная иллюстрация", diagramStyle: "Орбитальная схема", whitespaceRule: "Свободные поля", allowedEffects: ["glow"], forbiddenTechniques: ["card grid"], generationPrompt: "Astronomy editorial composition" } });
    const withoutReview = inspectAiScene({ canvas, contentLock: lock, conceptObjectKey: "concept", renderedPreviewObjectKey: "preview" });
    expect(withoutReview.passed).toBe(false);
    expect(withoutReview.hardChecks.visualFidelity.passed).toBe(false);
    const report = inspectAiScene({ canvas, contentLock: lock, conceptObjectKey: "concept", renderedPreviewObjectKey: "preview", visualReview: review });
    expect(report.hardChecks.noTemplateCardGrid.passed).toBe(true);
    const failed = { ...report, passed: false, diagnostics: ["forced visual failure"] };
    expect(mayRepairAiScene(failed)).toBe(true);
    const repaired = markAiSceneRepair(failed);
    expect(mayRepairAiScene(repaired)).toBe(false);
    expect(() => markAiSceneRepair(repaired)).toThrow("ai_scene_repair_limit_reached");
  });

  it("exports an AI canvas diagram as editable PDF and PPTX primitives", async () => {
    const lock = createSlideContentLock(slide, { composition: "process", labels: [{ key: "sun", text: "Солнце" }, { key: "orbit", text: "Орбита" }] });
    const canvas = compileAiScene({
      contentLock: lock,
      assets: { background: { objectKey: "projects/test/background.png", url: "/background", contentType: "image/png", alt: "Космический фон" } },
      scene: { version: 2, slideId: "slide-1", background: { color: "#08111F", prompt: "text-free cosmic background with quiet title and thesis areas" }, elements: [
        { type: "text", id: "title", textRef: "title", role: "title", x: 70, y: 45, w: 680, h: 70, fontSize: 48, color: "#FFFFFF", align: "left", bold: true, zIndex: 10 },
        { type: "text", id: "thesis", textRef: "thesis", role: "thesis", x: 70, y: 135, w: 610, h: 90, fontSize: 30, color: "#DDEBFF", align: "left", bold: false, zIndex: 10 },
        { type: "diagram", id: "orbit", x: 700, y: 270, w: 500, h: 300, template: "flow", nodeRefs: ["label:sun", "label:orbit"], zIndex: 15 },
      ] },
    });
    const diagram = canvas.elements.find((element) => element.id === "orbit")!;
    const pdf = await renderPdfCanvasElement(diagram, { readObjectBuffer: async () => Buffer.alloc(0), contentTypeFromObjectKey: () => "image/png", warn: () => undefined });
    expect(pdf).toContain("border-radius:50%");
    expect(pdf).toContain("Солнце");
    const addShape = vi.fn(); const addText = vi.fn();
    await renderPptxCanvasSlide(
      { ShapeType: { ellipse: "ellipse", line: "line", rect: "rect", roundRect: "roundRect" } },
      { addShape, addText, addImage: vi.fn() }, canvas,
      { colors: { background: "#08111F", surface: "#102A43", text: "#FFFFFF", muted: "#DDEBFF", accent: "#FFC857", accentAlt: "#55D6E8", line: "#55D6E8" }, fonts: { heading: "Arial", body: "Arial" }, themeId: "test", name: "test", mood: "dark", pptx: { background: "08111F", surface: "102A43", surfaceAlt: "102A43", text: "FFFFFF", muted: "DDEBFF", accent: "FFC857", accentAlt: "55D6E8", line: "55D6E8" } } as any,
      { readObjectBuffer: async () => Buffer.alloc(0), contentTypeFromObjectKey: () => "image/png", warn: () => undefined },
    );
    expect(addShape).toHaveBeenCalledWith("ellipse", expect.any(Object));
    expect(addText).toHaveBeenCalledWith("Солнце", expect.objectContaining({ fit: "shrink" }));
  });
});
