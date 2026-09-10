import crypto from "node:crypto";
import sharp from "sharp";
import { type AiSceneSpec, type DeckStyleSpec, type SlideContentLock } from "@studydeck/shared";
import { generateAitunnelImage } from "../../../aitunnel-image.js";
import { putObjectBuffer } from "../../../storage.js";
import type { SceneArtifact } from "./concept-generator.js";
import type { AiScenePrototypeBudget } from "./prototype-budget.js";
import { aiSceneImageEnv } from "./image-timeout.js";

type LayerDependencies = { generate?: typeof generateAitunnelImage; put?: typeof putObjectBuffer };

/** Creates a clean, text-free layer; all readable content stays in the canvas. */
export async function generateBackgroundLayer(input: {
  projectId: string;
  candidateId: string;
  lock: SlideContentLock;
  style: DeckStyleSpec;
  scene: AiSceneSpec;
  costBudget: AiScenePrototypeBudget;
}, dependencies: LayerDependencies = {}): Promise<SceneArtifact> {
  const prompt = [
    "Create only a clean 16:9 presentation background layer, with no text, no letters, no numbers, no labels, no diagram arrows and no logos.",
    `Subject: ${input.lock.title}. ${input.lock.thesis}`,
    `Art direction: ${input.style.generationPrompt}`,
    `Background direction: ${input.scene.background.prompt}`,
    "Leave generous quiet areas behind the planned editable title and thesis. Decorative texture, atmosphere and light are allowed, but meaningful content must remain separable.",
  ].join("\n");
  const reservationKey = `background-layer:${input.candidateId}`;
  const reserved = input.costBudget.reserve(reservationKey, "layer_generation");
  if (reserved.status !== "reserved") throw new Error(reserved.status);
  const generated = await (dependencies.generate || generateAitunnelImage)(prompt, aiSceneImageEnv(), { purpose: "background_layer" });
  const settled = input.costBudget.settle(reservationKey, generated.costRub);
  if (settled.status !== "settled") throw new Error(settled.status);
  const buffer = await sharp(generated.buffer, { density: 144 }).resize(1280, 720, { fit: "cover", position: "centre" }).png().toBuffer();
  const nonce = crypto.createHash("sha1").update(`${input.projectId}:${input.candidateId}:background`).digest("hex").slice(0, 12);
  const objectKey = `projects/${input.projectId}/design-review/${input.candidateId}/background-${nonce}.png`;
  await (dependencies.put || putObjectBuffer)(objectKey, buffer, "image/png");
  return { objectKey, contentType: "image/png", byteSize: buffer.length, provider: "aitunnel", model: generated.model, providerRequestId: generated.providerRequestId, costRub: generated.costRub };
}
