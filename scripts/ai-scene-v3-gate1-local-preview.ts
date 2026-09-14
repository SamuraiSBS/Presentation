import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { auditSlideCanvas, type TextLayoutV3 } from "@studydeck/shared";
import { loadAiSceneV3Gate1Input, prepareAiSceneV3Gate1Input } from "../apps/worker/src/tasks/presentation/ai-scene-v3/gate-1-inputs.js";
import { renderAiSceneV3Candidate } from "../apps/worker/src/tasks/presentation/ai-scene-v3/candidate-renderer.js";
import { aiSceneV3TextFitDiagnostics, aiSceneV3TextLayoutGeometryDiagnostics, validateAiSceneV3TextLayout } from "../apps/worker/src/tasks/presentation/ai-scene-v3/text-layout-analyzer.js";

const referenceRoot = path.resolve("референц слайдов");
const outputDirectory = path.resolve("plans/ai-scene-v3-gate-1/local-solar-system-a-2026-09-13");
const backgroundPath = path.resolve("plans/ai-scene-v3-gate-1/rerun-2026-09-13T09-04-10-382Z/solar_system-A-background.png");

void (async () => {
  // This is deliberately a local renderer check: it reuses the already-saved
  // background and makes no provider, vision, or billing request.
  const input = await loadAiSceneV3Gate1Input({
    id: "solar_system",
    profileId: "solar_scientific_dark",
    contentSlideOrder: 2,
    docxPath: path.join(referenceRoot, "Солнечная_система_текст_выступления_2.docx"),
    referencePaths: [path.join(referenceRoot, "1.png"), path.join(referenceRoot, "2.png"), path.join(referenceRoot, "3.png")],
  });
  const prepared = prepareAiSceneV3Gate1Input(input);
  const plan = prepared.plans[0];
  const draft: TextLayoutV3 = {
    version: 3,
    slideId: prepared.brief.slideId,
    entries: plan.textZones.map((entry) => ({
      semanticId: entry.semanticId,
      x: entry.zone.x * 1280,
      y: entry.zone.y * 720,
      w: entry.zone.w * 1280,
      h: entry.zone.h * 720,
      fontFamily: prepared.artDirection.typography.primaryFontFamily,
      fallbackFontFamily: prepared.artDirection.typography.fallbackFontFamily,
      fontSize: entry.semanticId === "title" ? 40 : 24,
      minimumFontSize: entry.semanticId === "title" ? 40 : 24,
      fontWeight: entry.semanticId === "title" ? 700 : 500,
      lineHeight: entry.semanticId === "title" ? 1.12 : 1.14,
      letterSpacing: 0,
      color: prepared.artDirection.palette.primaryText,
      align: "left",
      verticalAlign: "top",
      maxLines: entry.maxLines,
      editable: true,
      zoneReason: "deterministic local Solar A quiet text field",
      contrastScore: 100,
      placementConfidence: 1,
    })),
  };
  const layout = validateAiSceneV3TextLayout({ value: draft, brief: prepared.brief, plan, artDirection: prepared.artDirection });
  const background = await readFile(backgroundPath);
  const rendered = await renderAiSceneV3Candidate({
    background: { buffer: background, objectKey: path.basename(backgroundPath), url: "https://gate-1.local/solar_system-A-background.png", alt: prepared.brief.title.text, contentType: "image/png" },
    layout,
    textValues: [{ semanticId: "title", value: prepared.brief.title }, ...prepared.brief.anchors.map((anchor) => ({ semanticId: anchor.id, value: { text: anchor.text } }))],
    backgroundColor: prepared.artDirection.palette.background,
  });
  const geometryDiagnostics = aiSceneV3TextLayoutGeometryDiagnostics(layout, plan);
  const textFitDiagnostics = aiSceneV3TextFitDiagnostics(layout, prepared.brief);
  const canvasDiagnostics = auditSlideCanvas({ ...rendered.canvas, elements: rendered.canvas.elements.filter((element) => element.id !== "ai-scene-v3-background") });
  if (geometryDiagnostics.length || textFitDiagnostics.length || canvasDiagnostics.length) {
    throw new Error(`ai_scene_v3_local_preview_preflight_failed:${[...geometryDiagnostics, ...textFitDiagnostics, ...canvasDiagnostics].join(";")}`);
  }
  await mkdir(outputDirectory, { recursive: true });
  const previewPath = path.join(outputDirectory, "solar_system-A-native-preview.png");
  const reviewPath = path.join(outputDirectory, "local-review.json");
  await writeFile(previewPath, rendered.preview);
  await writeFile(reviewPath, JSON.stringify({
    kind: "ai_scene_v3_gate_1_local_solar_a_preview",
    providerCalls: 0,
    billingCalls: 0,
    background: backgroundPath,
    preview: previewPath,
    slideId: prepared.brief.slideId,
    speechSectionHash: prepared.brief.speechSectionHash,
    contentHash: prepared.brief.contentHash,
    nativeEditableText: layout.entries.map((entry) => ({ semanticId: entry.semanticId, x: entry.x, y: entry.y, w: entry.w, h: entry.h, fontSize: entry.fontSize, maxLines: entry.maxLines })),
    sourceTrace: prepared.brief.anchors.map((anchor) => ({ semanticId: anchor.id, sourceTrace: anchor.sourceTrace })),
    geometryDiagnostics,
    textFitDiagnostics,
    canvasDiagnostics,
  }, null, 2));
  console.log(JSON.stringify({ status: "ready_for_human_review", previewPath, reviewPath, nativeEditableText: layout.entries.length }, null, 2));
})().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
