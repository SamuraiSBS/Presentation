import fs from "node:fs/promises";

const [manifestPath, pptxPath, pdfPath] = process.argv.slice(2);
if (!manifestPath || !pptxPath || !pdfPath) throw new Error("usage: export-ai-scene-manifest.mjs <manifest> <pptx> <pdf>");

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const candidates = Array.isArray(manifest.candidates) ? manifest.candidates : [];
if (candidates.length !== 2) throw new Error("ai_scene_manifest_requires_two_candidates");

const { createPdf, createPptx } = await import("/app/apps/worker/dist/tasks/export.js");
const document = {
  id: `ai-scene-export-${manifest.runId}`,
  title: "Солнечная система",
  scenario: "school_report",
  level: "school_student",
  slideCount: candidates.length,
  generationMode: "aitunnel",
  generatedText: "",
  sources: [],
  outline: candidates.map((candidate) => candidate.lock.title),
  narrativePlan: [],
  speechScript: candidates.map((candidate) => ({ slideOrder: candidate.lock.slideOrder, slideTitle: candidate.lock.title, text: candidate.lock.thesis })),
  slides: candidates.map((candidate) => ({
    id: candidate.lock.slideId,
    order: candidate.lock.slideOrder,
    title: candidate.lock.title,
    slideKind: "content",
    layout: candidate.lock.composition === "process" ? "process" : "statement",
    thesis: candidate.lock.thesis,
    bullets: candidate.lock.text.filter((item) => item.key.startsWith("label:")).map((item) => item.text),
    definition: null,
    keyConcepts: [],
    visual: { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] },
    highlights: [],
    blocks: [],
    placeholders: [],
    speakerNotes: candidate.lock.thesis,
    timingSeconds: 55,
    sourceRefs: [],
    canvas: candidate.canvas,
  })),
};

await fs.writeFile(pptxPath, await createPptx(document));
await fs.writeFile(pdfPath, await createPdf(document));
