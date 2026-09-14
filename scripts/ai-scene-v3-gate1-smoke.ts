import "dotenv/config";
import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AI_SCENE_V3_GATE_1_COST_POLICY } from "@studydeck/shared";
import { createAitunnelClient, aitunnelConfig } from "../apps/worker/src/openai-client.js";
import { renderPdfCanvasElement } from "../apps/worker/src/tasks/export/pdf-canvas.js";
import { renderPptxCanvasSlide } from "../apps/worker/src/tasks/export/pptx-canvas.js";
import { AI_SCENE_V3_GATE_1_SINGLE_CANDIDATE_COST_POLICY, runAiSceneV3Gate1, type AiSceneV3Gate1Topic } from "../apps/worker/src/tasks/presentation/ai-scene-v3/gate-1-runner.js";
import { loadAiSceneV3Gate1Input, prepareAiSceneV3Gate1Input, type AiSceneV3Gate1Topic as Gate1InputTopic } from "../apps/worker/src/tasks/presentation/ai-scene-v3/gate-1-inputs.js";
import { assertAiSceneV3ProviderPreflight, fetchAiSceneV3ProviderCapabilities } from "../apps/worker/src/tasks/presentation/ai-scene-v3/provider-preflight.js";
import { prepareAiSceneV3ReferenceDataUrl } from "../apps/worker/src/tasks/presentation/ai-scene-v3/reference-data.js";
import { aitunnelReportedCostRub } from "../apps/worker/src/tasks/presentation/ai-scene/provider-cost.js";

const referenceRoot = path.resolve("референц слайдов");
const outputDirectory = path.resolve("plans/ai-scene-v3-gate-1", `rerun-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const manifestPath = path.join(outputDirectory, "manifest.json");
const env = { ...process.env, AI_SCENE_V3_IMAGE_SIZE: "1536x864" };
const candidateLimit = process.env.AI_SCENE_V3_GATE1_CANDIDATE_LIMIT ? Number(process.env.AI_SCENE_V3_GATE1_CANDIDATE_LIMIT) : undefined;

const inputTopics: Gate1InputTopic[] = [
  { id: "solar_system", profileId: "solar_scientific_dark", contentSlideOrder: 2, docxPath: path.join(referenceRoot, "Солнечная_система_текст_выступления_2.docx"), referencePaths: [path.join(referenceRoot, "1.png"), path.join(referenceRoot, "2.png"), path.join(referenceRoot, "3.png")] },
  { id: "porsche_911", profileId: "porsche_cinematic_dark", contentSlideOrder: 2, docxPath: path.join(referenceRoot, "Porsche", "Porsche 911- история и наследие.docx"), referencePaths: [path.join(referenceRoot, "Porsche", "1.png"), path.join(referenceRoot, "Porsche", "2.png"), path.join(referenceRoot, "Porsche", "3.png")] },
  { id: "don_nature", profileId: "don_nature_light", contentSlideOrder: 2, docxPath: path.join(referenceRoot, "Природа и растения Ростовской области", "Природа и растения Ростовской области.docx"), referencePaths: [path.join(referenceRoot, "Природа и растения Ростовской области", "ChatGPT Image 10 сент. 2026 г., 21_52_13 (1).png"), path.join(referenceRoot, "Природа и растения Ростовской области", "ChatGPT Image 10 сент. 2026 г., 21_52_14 (2).png"), path.join(referenceRoot, "Природа и растения Ростовской области", "ChatGPT Image 10 сент. 2026 г., 21_52_14 (3).png")] },
];

function assertExplicitGate1Authorization() {
  if (process.env.AI_SCENE_V3_GATE1_PAID_RUN_AUTHORIZED !== "true") throw new Error("ai_scene_v3_gate_1_explicit_paid_authorization_required");
  const expectedCeiling = candidateLimit === 1 ? AI_SCENE_V3_GATE_1_SINGLE_CANDIDATE_COST_POLICY.limitRub : AI_SCENE_V3_GATE_1_COST_POLICY.limitRub;
  if (process.env.AI_SCENE_V3_GATE1_BUDGET_CEILING_RUB !== expectedCeiling) throw new Error(`ai_scene_v3_gate_1_budget_ceiling_must_equal_${expectedCeiling}`);
}

void (async () => {
  assertExplicitGate1Authorization();
  const config = aitunnelConfig(env);
  if (!config) throw new Error("ai_scene_v3_gate_1_aitunnel_text_configuration_required");
  await mkdir(outputDirectory, { recursive: true });
  const capabilities = await fetchAiSceneV3ProviderCapabilities(env);
  assertAiSceneV3ProviderPreflight(env, capabilities);
  const topics = await Promise.all(inputTopics.map(buildTopic));
  const manifest = await runAiSceneV3Gate1({ env, capabilities, topics, candidateLimit, policy: candidateLimit === 1 ? AI_SCENE_V3_GATE_1_SINGLE_CANDIDATE_COST_POLICY : undefined }, {
    nativeTextLayout: async ({ prompt, background }) => chatJson({ stage: "native_text_layout", prompt, images: [background], maxTokens: 900 }),
    highDetailVision: async ({ prompt, background, preview }) => chatJson({ stage: "high_detail_vision", prompt, images: [background, preview], maxTokens: 1_600 }),
    saveBackground: async ({ topic, plan, background }) => {
      const base = `${topic.id}-${plan.variant}`;
      const backgroundObjectKey = `${base}-background.png`;
      await writeFile(path.join(outputDirectory, backgroundObjectKey), background);
      return { backgroundObjectKey, url: `https://gate-1.local/${encodeURIComponent(backgroundObjectKey)}` };
    },
    savePreview: async ({ topic, plan, preview }) => {
      const base = `${topic.id}-${plan.variant}`;
      const renderedPreviewObjectKey = `${base}-native-preview.png`;
      await writeFile(path.join(outputDirectory, renderedPreviewObjectKey), preview);
      return { renderedPreviewObjectKey };
    },
    assertExportCompatibility,
    onProgress: async (progress) => writeFile(manifestPath, JSON.stringify(progress, null, 2), "utf8"),
  });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(JSON.stringify({ outputDirectory, status: manifest.status, stopGo: manifest.stopGo, reservedRub: manifest.reservedRub, actualRub: manifest.actualRub, diagnostics: manifest.diagnostics }, null, 2));
  if (manifest.status === "failed") process.exitCode = 1;
})().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

async function buildTopic(input: Gate1InputTopic): Promise<AiSceneV3Gate1Topic> {
  const loaded = await loadAiSceneV3Gate1Input(input);
  const prepared = prepareAiSceneV3Gate1Input(loaded);
  const references = await Promise.all(loaded.referencePaths.map(async (referencePath, index) => {
    const prepared = await prepareAiSceneV3ReferenceDataUrl(await readFile(referencePath));
    return { id: `${loaded.id}-reference-${index + 1}`, url: prepared.dataUrl };
  }));
  return { id: loaded.id, ...prepared, references };
}

async function chatJson(input: { stage: "native_text_layout" | "high_detail_vision"; prompt: string; images: readonly Buffer[]; maxTokens: number }) {
  const config = aitunnelConfig(env);
  if (!config) throw new Error("ai_scene_v3_gate_1_aitunnel_text_configuration_required");
  const client = createAitunnelClient(env);
  const system = input.stage === "native_text_layout"
    ? "Return exactly the compact TextLayoutV3 JSON required by the user prompt. Never omit entries or required entry fields."
    : "Return exactly the compact high-detail vision JSON required by the user prompt. Never omit a required field, including empty diagnostics, anchor evidence, or scores.";
  const { data, response } = await client.chat.completions.create({ model: config.narrationModel, messages: [{ role: "system", content: system }, { role: "user", content: [{ type: "text", text: input.prompt }, ...input.images.map((image) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${image.toString("base64")}`, detail: "high" } }))] as any }], response_format: { type: "json_object" }, max_tokens: input.maxTokens, temperature: 0.1, reasoning_effort: "minimal" }).withResponse();
  const costRub = aitunnelReportedCostRub(data, response.headers);
  if (!costRub) throw new Error(`ai_scene_v3_gate_1_${input.stage}_cost_unavailable`);
  const raw = data.choices[0]?.message.content;
  if (!raw) throw providerResponseError(input.stage, "empty_response", costRub, "");
  try {
    return { value: JSON.parse(String(raw).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")), costRub };
  } catch (error) {
    throw providerResponseError(input.stage, "malformed_json", costRub, String(raw), error);
  }
}

function providerResponseError(stage: "native_text_layout" | "high_detail_vision", reason: string, costRub: string, raw: string, cause?: unknown) {
  const fingerprint = raw ? crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16) : "none";
  const error = new Error(`ai_scene_v3_gate_1_${stage}_${reason}`);
  return Object.assign(error, {
    costRub,
    cause,
    diagnostic: `ai_scene_v3_gate_1_${stage}_${reason}:response_chars=${raw.length}:response_sha256_16=${fingerprint}`,
  });
}

async function assertExportCompatibility(input: { canvas: any; background: Buffer }) {
  const text = input.canvas.elements.filter((element: { type: string }) => element.type === "text");
  const pdf = await Promise.all(text.map((element: any) => renderPdfCanvasElement(element, { readObjectBuffer: async () => input.background, contentTypeFromObjectKey: () => "image/png", warn: () => undefined })));
  if (pdf.some((item, index) => !item.includes(text[index]!.text))) return false;
  const pptx = { ShapeType: { ellipse: "ellipse", line: "line", rect: "rect", roundRect: "roundRect" } };
  const slide = { addShape: () => undefined, addText: () => undefined, addImage: () => undefined };
  await renderPptxCanvasSlide(pptx as any, slide as any, input.canvas, { colors: { background: "#071827", surface: "#16385C", text: "#FFFFFF", muted: "#DDEEFF", accent: "#FFC857", accentAlt: "#55D6E8", line: "#55D6E8" }, fonts: { heading: "Nunito", body: "Nunito" }, themeId: "ai-scene-v3-gate-1", name: "AI Scene v3 Gate 1", mood: "dark", pptx: { background: "071827", surface: "16385C", surfaceAlt: "16385C", text: "FFFFFF", muted: "DDEEFF", accent: "FFC857", accentAlt: "55D6E8", line: "55D6E8" } } as any, { readObjectBuffer: async () => input.background, contentTypeFromObjectKey: () => "image/png", warn: () => undefined });
  return true;
}

function hash(value: unknown) { return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
