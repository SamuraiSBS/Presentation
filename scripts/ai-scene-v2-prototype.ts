import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  aiScenePrototypeCostPolicy,
  presentationSchema,
  type DeckStyleSpec,
  type Slide,
} from "@studydeck/shared";
import { AitunnelProjectBudget, runWithAitunnelProjectBudget } from "../apps/worker/src/aitunnel-narration-budget.js";
import { readObjectBuffer, putObjectBuffer } from "../apps/worker/src/storage.js";
import { createPdf, createPptx } from "../apps/worker/src/tasks/export.js";
import { generateSlideConcept } from "../apps/worker/src/tasks/presentation/ai-scene/concept-generator.js";
import { createSlideContentLock } from "../apps/worker/src/tasks/presentation/ai-scene/content-lock.js";
import { generateBackgroundLayer } from "../apps/worker/src/tasks/presentation/ai-scene/layer-generator.js";
import { inspectAiScene } from "../apps/worker/src/tasks/presentation/ai-scene/scene-quality.js";
import { inspectAiSceneVisuals } from "../apps/worker/src/tasks/presentation/ai-scene/scene-visual-quality.js";
import { compileAiScene } from "../apps/worker/src/tasks/presentation/ai-scene/scene-compiler.js";
import { renderAiSceneCanvas } from "../apps/worker/src/tasks/presentation/ai-scene/scene-render.js";
import { analyzeScene } from "../apps/worker/src/tasks/presentation/ai-scene/scene-analyzer.js";
import { inspectAiScenePreflight } from "../apps/worker/src/tasks/presentation/ai-scene/scene-preflight.js";
import { directDeckStyle } from "../apps/worker/src/tasks/presentation/ai-scene/style-director.js";
import { AiScenePrototypeBudget } from "../apps/worker/src/tasks/presentation/ai-scene/prototype-budget.js";
import { selectAiProviders } from "../apps/worker/src/tasks/presentation/providers/provider-selection.js";

const referencePath = "D:\\presentation\\референц слайдов\\Солнечная_система_текст_выступления_2.docx";
let activeOutputDir = "";

const sourceSections = [
  "Солнечная система — это гравитационно связанная совокупность Солнца, планет, их спутников, карликовых планет, астероидов, комет, метеороидов и разреженного межпланетного вещества. Она сформировалась около 4,6 миллиарда лет назад из вращающегося облака газа и пыли.",
  "Солнце — звезда среднего размера, состоящая главным образом из водорода и гелия. В его центре происходят термоядерные реакции: ядра водорода объединяются в ядра гелия, а часть массы превращается в энергию.",
];

const slides: Slide[] = [
  {
    id: "solar-system-1", order: 1, title: "Солнечная система как единая система", slideKind: "content", layout: "statement",
    thesis: "Солнце удерживает планеты гравитацией, а их боковая скорость превращает падение в устойчивые орбиты.",
    bullets: ["Около 4,6 млрд лет", "Солнце — главный центр массы", "Орбита — падение с боковой скоростью"],
    definition: null, keyConcepts: [], visual: { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] }, highlights: [],
    blocks: [{ type: "callout", content: "Система развивается как единая динамическая структура." }],
    speakerNotes: sourceSections[0], timingSeconds: 55, sourceRefs: [],
  },
  {
    id: "solar-system-2", order: 2, title: "Солнце — источник энергии и главный центр движения", slideKind: "content", layout: "process",
    thesis: "Термоядерные реакции питают свет и солнечный ветер, а масса Солнца задаёт движение планет.",
    bullets: ["Водород → гелий", "Излучение поддерживает условия для жизни", "Солнечный ветер формирует гелиосферу"],
    definition: null, keyConcepts: [], visual: { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] }, highlights: [],
    blocks: [{ type: "callout", content: "Вспышки и выбросы вещества влияют на спутники, радиосвязь и навигацию." }],
    speakerNotes: sourceSections[1], timingSeconds: 55, sourceRefs: [],
  },
];

async function main() {
  const provider = selectAiProviders()[0];
  if (provider !== "aitunnel") throw new Error("ai_scene_v2_prototype_requires_explicit_aitunnel_provider");
  const diagnosticOnly = process.argv.includes("--diagnostic");
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  const prototypePolicy = authorizedPrototypePolicyFromArgs();
  const priorSpendRub = priorSpendFromArgs();
  const prototypeBudget = new AiScenePrototypeBudget(prototypePolicy, priorSpendRub);
  const outputDir = path.join(process.cwd(), ".codex-artifacts", "ai-scene-v2", runId);
  activeOutputDir = outputDir;
  await fs.mkdir(outputDir, { recursive: true });
  await fs.access(referencePath);
  await writeCheckpoint(outputDir, "initialized", prototypeBudget);

  const locks = [
    createSlideContentLock(slides[0]!, { composition: "statement", labels: [
      { key: "system", text: "Гравитационно связанная система" },
      { key: "age", text: "Около 4,6 млрд лет" },
      { key: "orbit", text: "Падение + боковая скорость = орбита" },
    ], facts: ["Почти вся масса системы сосредоточена в Солнце"] }),
    createSlideContentLock(slides[1]!, { composition: "process", labels: [
      { key: "fusion", text: "Водород → гелий" },
      { key: "radiation", text: "Излучение и энергия" },
      { key: "wind", text: "Солнечный ветер и гелиосфера" },
    ], facts: ["Активность Солнца может влиять на спутники, связь и навигацию"] }),
  ];
  const project = { id: `prototype-${runId}`, title: "Солнечная система", prompt: "Создай визуально сильную учебную презентацию о Солнечной системе для старших классов.", scenario: "school_report", level: "school_student", mode: "with_sources", slideCount: 2 };
  const result = await runWithAitunnelProjectBudget(new AitunnelProjectBudget({
    ...process.env,
    AITUNNEL_PROJECT_BUDGET_RUB: subtractRub(prototypePolicy.limitRub, priorSpendRub),
  }), async () => {
    await writeCheckpoint(outputDir, "style_direction:started", prototypeBudget);
    const style = await directDeckStyle(provider, project, locks, prototypeBudget);
    await writeCheckpoint(outputDir, "style_direction:completed", prototypeBudget);
    if (diagnosticOnly) return { style, candidates: [] };
    const candidates = [];
    let repairPassesUsed = 0;
    for (const [index, lock] of locks.entries()) {
      const candidateId = `prototype-${runId}-slide-${lock.slideOrder}`;
      await writeCheckpoint(outputDir, `slide_${lock.slideOrder}:concept:started`, prototypeBudget);
      const concept = await generateSlideConcept({ projectId: project.id, candidateId, lock, style, costBudget: prototypeBudget });
      await writeObjectToFile(concept.artifact.objectKey, path.join(outputDir, `slide-${lock.slideOrder}-concept.png`));
      await writeCheckpoint(outputDir, `slide_${lock.slideOrder}:concept:completed`, prototypeBudget, { concept: artifactCheckpoint(concept.artifact) });
      await writeCheckpoint(outputDir, `slide_${lock.slideOrder}:scene_analysis:started`, prototypeBudget);
      const conceptBuffer = await readObjectBuffer(concept.artifact.objectKey);
      let scene = await analyzeScene(provider, { lock, style, conceptPrompt: concept.prompt, conceptImage: conceptBuffer, costBudget: prototypeBudget });
      await writeCheckpoint(outputDir, `slide_${lock.slideOrder}:scene_analysis:completed`, prototypeBudget);
      const preflightDiagnostics = inspectAiScenePreflight(scene, lock);
      const repairAttempts = preflightDiagnostics.length ? 1 : 0;
      if (preflightDiagnostics.length) {
        // This is the only automatic repair call in the two-slide candidate.
        // A second rejection is a visible candidate failure, never a hidden
        // template fallback or another paid retry.
        if (repairPassesUsed >= 1) {
          throw new Error(`ai_scene_repair_limit_reached: slide ${lock.slideOrder} preflight rejected after the candidate's one permitted repair: ${preflightDiagnostics.join("; ")}`);
        }
        repairPassesUsed += 1;
        await writeCheckpoint(outputDir, `slide_${lock.slideOrder}:scene_repair:started`, prototypeBudget, { diagnostics: preflightDiagnostics });
        scene = await analyzeScene(provider, { lock, style, conceptPrompt: concept.prompt, conceptImage: conceptBuffer, repairDiagnostics: preflightDiagnostics, costBudget: prototypeBudget });
        const repairedDiagnostics = inspectAiScenePreflight(scene, lock);
        if (repairedDiagnostics.length) throw new Error(`ai_scene_repair_failed:${repairedDiagnostics.join("; ")}`);
        await writeCheckpoint(outputDir, `slide_${lock.slideOrder}:scene_repair:completed`, prototypeBudget);
      }
      await writeCheckpoint(outputDir, `slide_${lock.slideOrder}:background:started`, prototypeBudget);
      const background = await generateBackgroundLayer({ projectId: project.id, candidateId, lock, style, scene, costBudget: prototypeBudget });
      await writeCheckpoint(outputDir, `slide_${lock.slideOrder}:background:completed`, prototypeBudget, { background: artifactCheckpoint(background) });
      const canvas = compileAiScene({ scene, contentLock: lock, assets: { background: { objectKey: background.objectKey, url: `/api/projects/${project.id}/design-review/candidates/${candidateId}/assets/background`, contentType: background.contentType, alt: `Фон: ${lock.title}` } } });
      const backgroundBuffer = await readObjectBuffer(background.objectKey);
      const rendered = await renderAiSceneCanvas(canvas, backgroundBuffer);
      const previewObjectKey = `projects/${project.id}/design-review/${candidateId}/rendered-preview.png`;
      await putObjectBuffer(previewObjectKey, rendered, "image/png");
      const visualReview = await inspectAiSceneVisuals({ concept: conceptBuffer, background: backgroundBuffer, rendered, scene, lock, style });
      const quality = { ...inspectAiScene({ canvas, contentLock: lock, conceptObjectKey: concept.artifact.objectKey, renderedPreviewObjectKey: previewObjectKey, visualReview }), repairAttempts };
      await fs.writeFile(path.join(outputDir, `slide-${lock.slideOrder}-editable-render.png`), rendered);
      await writeCheckpoint(outputDir, `slide_${lock.slideOrder}:rendered`, prototypeBudget);
      candidates.push({ lock, canvas, scene, concept: concept.artifact, background, renderedPreviewObjectKey: previewObjectKey, quality });
      await writePrototypeState(outputDir, style, candidates, prototypePolicy, prototypeBudget);
    }
    return { style, candidates };
  });

  if (diagnosticOnly) {
    await fs.writeFile(path.join(outputDir, "style-diagnostic.json"), JSON.stringify({
      runId, engine: "ai_scene_v2", diagnosticOnly, prototypePolicy,
      prototypeBudget: prototypeBudget.snapshot(), style: result.style as DeckStyleSpec,
    }, null, 2));
    process.stdout.write(`${outputDir}\n`);
    return;
  }

  const document = presentationSchema.parse({
    id: `ai-scene-v2-${runId}`, title: project.title, scenario: project.scenario, level: project.level, slideCount: 2, generationMode: "aitunnel",
    generatedText: sourceSections.join("\n\n"), sources: [], outline: slides.map((slide) => slide.title), narrativePlan: [],
    speechScript: slides.map((slide) => ({ slideOrder: slide.order, slideTitle: slide.title, text: slide.speakerNotes })),
    slides: slides.map((slide, index) => ({ ...slide, canvas: result.candidates[index]!.canvas })),
  });
  const manifest = {
    runId, referencePath, engine: "ai_scene_v2", prototypePolicy, prototypeBudget: prototypeBudget.snapshot(), style: result.style as DeckStyleSpec,
    candidates: result.candidates.map(({ lock, canvas, scene, concept, background, renderedPreviewObjectKey, quality }) => ({ lock, canvas, scene, concept, background, renderedPreviewObjectKey, quality })),
    verdict: "manual_visual_stop_go_required",
  };
  // Persist the successful editable scenes before an optional renderer fails.
  // A host without Chromium can still validate the exact same state in the
  // worker container, rather than paying for another concept/analysis pass.
  await fs.writeFile(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  const exportStatus: { pptx: "ready"; pdf: "ready" | "failed"; pdfDiagnostic?: string } = { pptx: "ready", pdf: "failed" };
  const pptx = await createPptx(document);
  await fs.writeFile(path.join(outputDir, "solar-system-ai-scene-v2.pptx"), pptx);
  try {
    const pdf = await createPdf(document);
    await fs.writeFile(path.join(outputDir, "solar-system-ai-scene-v2.pdf"), pdf);
    exportStatus.pdf = "ready";
  } catch (error) {
    // The candidate, previews and editable PPTX are already durable. A local
    // host without Chromium must be reported as an export-only failure, not a
    // failed generation that tempts somebody to repeat paid scene calls.
    exportStatus.pdfDiagnostic = error instanceof Error ? error.message : String(error);
  }
  await fs.writeFile(path.join(outputDir, "export-status.json"), JSON.stringify(exportStatus, null, 2));
  await fs.writeFile(path.join(outputDir, "manifest.json"), JSON.stringify({ ...manifest, exportStatus }, null, 2));
  process.stdout.write(`${outputDir}\n`);
}

async function writePrototypeState(
  outputDir: string,
  style: DeckStyleSpec,
  candidates: Array<unknown>,
  prototypePolicy: ReturnType<typeof aiScenePrototypeCostPolicy>,
  prototypeBudget: AiScenePrototypeBudget,
) {
  await fs.writeFile(path.join(outputDir, "prototype-state.json"), JSON.stringify({
    engine: "ai_scene_v2",
    prototypePolicy,
    prototypeBudget: prototypeBudget.snapshot(),
    style,
    candidates,
  }, null, 2));
}

function artifactCheckpoint(artifact: { objectKey: string; byteSize: number; model: string; providerRequestId?: string; costRub?: string }) {
  return { objectKey: artifact.objectKey, byteSize: artifact.byteSize, model: artifact.model, providerRequestId: artifact.providerRequestId, costRub: artifact.costRub };
}

function priorSpendFromArgs() {
  const prefix = "--prior-spend-rub=";
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || "0";
  if (!/^\d+(?:\.\d+)?$/.test(value) || rubUnits(value) > rubUnits(authorizedPrototypePolicyFromArgs().limitRub)) {
    throw new Error("ai_scene_prototype_prior_spend_invalid");
  }
  return value;
}

/**
 * The normal prototype cap stays at 24 RUB. A higher cap is accepted only as
 * an explicit command-line authorization and is recorded as a separate,
 * auditable non-callable extension bucket in the run manifest.
 */
function authorizedPrototypePolicyFromArgs() {
  const base = aiScenePrototypeCostPolicy();
  const prefix = "--authorized-limit-rub=";
  const requested = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!requested) return base;
  if (!/^\d+(?:\.\d+)?$/.test(requested) || rubUnits(requested) <= rubUnits(base.limitRub) || rubUnits(requested) > rubUnits("42")) {
    throw new Error("ai_scene_prototype_authorized_limit_invalid");
  }
  return {
    version: `${base.version}-authorized-${requested}`,
    limitRub: requested,
    buckets: { ...base.buckets, authorized_extension: rubFromUnits(rubUnits(requested) - rubUnits(base.limitRub)) },
  };
}

function subtractRub(left: string, right: string) {
  return rubFromUnits(rubUnits(left) - rubUnits(right));
}

function rubUnits(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100_000_000n + BigInt(`${fraction}00000000`.slice(0, 8));
}

function rubFromUnits(value: bigint) {
  return `${value / 100_000_000n}.${(value % 100_000_000n).toString().padStart(8, "0")}`;
}

async function writeCheckpoint(outputDir: string, stage: string, budget: AiScenePrototypeBudget, extra: Record<string, unknown> = {}) {
  await fs.writeFile(path.join(outputDir, "progress.json"), JSON.stringify({
    at: new Date().toISOString(), stage, prototypeBudget: budget.snapshot(), ...extra,
  }, null, 2));
}

async function writeObjectToFile(objectKey: string, destination: string) {
  await fs.writeFile(destination, await readObjectBuffer(objectKey));
}

void main().catch((error) => {
  // Some OpenAI-compatible SDK errors contain objects that Node 24's
  // inspector cannot format on Windows. Preserve the real failure string.
  const detail = error instanceof Error
    ? `${error.name}: ${error.message}\n${error.stack || ""}`
    : String(error);
  // A paid stage can fail after the provider has accepted a request. Keep an
  // auditable local failure record next to progress.json, including the last
  // completed checkpoint, before returning a non-zero status. This prevents
  // a later run from being mistaken for a safe retry with zero prior spend.
  const failure = JSON.stringify({
    at: new Date().toISOString(),
    stage: activeOutputDir ? "failed" : "initialization_failed",
    error: detail,
  }, null, 2);
  const saveFailure = activeOutputDir
    ? fs.writeFile(path.join(activeOutputDir, "failure.json"), failure)
    : Promise.resolve();
  void saveFailure.finally(() => {
    process.stderr.write(`${detail}\n`);
    process.exitCode = 1;
  });
});
