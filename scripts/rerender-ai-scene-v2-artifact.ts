import fs from "node:fs/promises";
import path from "node:path";
import { presentationSchema } from "@studydeck/shared";
import { readObjectBuffer, putObjectBuffer } from "../apps/worker/src/storage.js";
import { createPdf, createPptx } from "../apps/worker/src/tasks/export.js";
import { inspectAiScene } from "../apps/worker/src/tasks/presentation/ai-scene/scene-quality.js";
import { inspectAiSceneVisuals } from "../apps/worker/src/tasks/presentation/ai-scene/scene-visual-quality.js";
import { renderAiSceneCanvas } from "../apps/worker/src/tasks/presentation/ai-scene/scene-render.js";

type StoredManifest = {
  runId: string;
  style: any;
  candidates: Array<{ lock: any; canvas: any; scene: any; concept: { objectKey: string }; background: { objectKey: string }; renderedPreviewObjectKey: string }>;
};

async function main() {
  const sourceDir = argument("--source-dir=");
  if (!sourceDir) throw new Error("ai_scene_rerender_source_dir_required");
  const sourceManifest = JSON.parse(await fs.readFile(path.join(sourceDir, "manifest.json"), "utf8")) as StoredManifest;
  const outputDir = `${sourceDir}-rerendered`;
  await fs.mkdir(outputDir, { recursive: true });
  const candidates = await Promise.all(sourceManifest.candidates.map(async (candidate) => {
    const [concept, background] = await Promise.all([readObjectBuffer(candidate.concept.objectKey), readObjectBuffer(candidate.background.objectKey)]);
    const rendered = await renderAiSceneCanvas(candidate.canvas, background);
    const renderedPreviewObjectKey = `${candidate.renderedPreviewObjectKey}.rerendered`;
    await putObjectBuffer(renderedPreviewObjectKey, rendered, "image/png");
    const visualReview = await inspectAiSceneVisuals({ concept, background, rendered, scene: candidate.scene, lock: candidate.lock, style: sourceManifest.style });
    const quality = inspectAiScene({ canvas: candidate.canvas, contentLock: candidate.lock, conceptObjectKey: candidate.concept.objectKey, renderedPreviewObjectKey, visualReview });
    await fs.writeFile(path.join(outputDir, `slide-${candidate.lock.slideOrder}-editable-render.png`), rendered);
    await fs.copyFile(path.join(sourceDir, `slide-${candidate.lock.slideOrder}-concept.png`), path.join(outputDir, `slide-${candidate.lock.slideOrder}-concept.png`));
    return { ...candidate, renderedPreviewObjectKey, quality };
  }));
  if (!candidates.every((candidate) => candidate.quality.passed)) throw new Error(`ai_scene_rerender_quality_failed:${candidates.flatMap((candidate) => candidate.quality.diagnostics).join("; ")}`);
  const document = presentationSchema.parse({
    id: `${sourceManifest.runId}-rerendered`, title: "Солнечная система", scenario: "school_report", level: "school_student", slideCount: candidates.length, generationMode: "aitunnel",
    generatedText: candidates.map((candidate) => candidate.lock.thesis).join("\n"), sources: [], outline: candidates.map((candidate) => candidate.lock.title), narrativePlan: [],
    speechScript: candidates.map((candidate) => ({ slideOrder: candidate.lock.slideOrder, slideTitle: candidate.lock.title, text: candidate.lock.thesis })),
    slides: candidates.map((candidate) => ({
      id: candidate.lock.slideId, order: candidate.lock.slideOrder, title: candidate.lock.title, slideKind: "content", layout: candidate.lock.composition === "process" ? "process" : "statement", thesis: candidate.lock.thesis,
      bullets: [], definition: null, keyConcepts: [], visual: { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] }, highlights: [], placeholders: [],
      blocks: [{ type: "callout", content: candidate.lock.facts[0] || candidate.lock.title }], canvas: candidate.canvas, speakerNotes: candidate.lock.thesis, timingSeconds: 55, sourceRefs: [],
    })),
  });
  const manifest = { ...sourceManifest, renderRevision: "editable-diagram-rerender-v1", candidates, verdict: "manual_visual_stop_go_required" };
  await fs.writeFile(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(outputDir, "solar-system-ai-scene-v2.pptx"), await createPptx(document));
  const exportStatus: { pptx: "ready"; pdf: "ready" | "failed"; pdfDiagnostic?: string } = { pptx: "ready", pdf: "failed" };
  try {
    await fs.writeFile(path.join(outputDir, "solar-system-ai-scene-v2.pdf"), await createPdf(document));
    exportStatus.pdf = "ready";
  } catch (error) {
    exportStatus.pdfDiagnostic = error instanceof Error ? error.message : String(error);
  }
  await fs.writeFile(path.join(outputDir, "export-status.json"), JSON.stringify(exportStatus, null, 2));
  await fs.writeFile(path.join(outputDir, "manifest.json"), JSON.stringify({ ...manifest, exportStatus }, null, 2));
  process.stdout.write(`${outputDir}\n`);
}

function argument(prefix: string) { return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length); }

void main();
