import crypto from "node:crypto";
import sharp from "sharp";
import {
  type DeckStyleSpec,
  type SlideContentLock,
} from "@studydeck/shared";
import { generateAitunnelImage } from "../../../aitunnel-image.js";
import { putObjectBuffer } from "../../../storage.js";
import type { AiScenePrototypeBudget } from "./prototype-budget.js";
import { aiSceneImageEnv } from "./image-timeout.js";

export type SceneArtifact = {
  objectKey: string;
  contentType: "image/png";
  byteSize: number;
  provider: "aitunnel";
  model: string;
  providerRequestId?: string;
  costRub?: string;
};

type ArtifactDependencies = {
  generate?: typeof generateAitunnelImage;
  put?: typeof putObjectBuffer;
};

/** Produces the visual reference only. It is never used as the final background. */
export async function generateSlideConcept(input: {
  projectId: string;
  candidateId: string;
  lock: SlideContentLock;
  style: DeckStyleSpec;
  comment?: string;
  costBudget: AiScenePrototypeBudget;
}, dependencies: ArtifactDependencies = {}): Promise<{ artifact: SceneArtifact; prompt: string }> {
  const prompt = conceptPrompt(input.lock, input.style, input.comment);
  const reservationKey = `slide-concept:${input.candidateId}`;
  const reserved = input.costBudget.reserve(reservationKey, "slide_concept");
  if (reserved.status !== "reserved") throw new Error(reserved.status);
  const generated = await (dependencies.generate || generateAitunnelImage)(prompt, aiSceneImageEnv(), { purpose: "slide_concept" });
  const settled = input.costBudget.settle(reservationKey, generated.costRub);
  if (settled.status !== "settled") throw new Error(settled.status);
  const buffer = await toSlidePng(generated.buffer);
  const objectKey = artifactKey(input.projectId, input.candidateId, "concept");
  await (dependencies.put || putObjectBuffer)(objectKey, buffer, "image/png");
  return { artifact: metadata(objectKey, buffer, generated), prompt };
}

export function conceptPrompt(lock: SlideContentLock, style: DeckStyleSpec, comment?: string) {
  return [
    "Create one polished 16:9 Russian educational presentation-slide concept, not an app UI and not a card grid.",
    `Art direction: ${style.generationPrompt}`,
    `Atmosphere: ${style.atmosphere}. Image style: ${style.imageStyle}.`,
    `Title (render exactly): ${lock.title}`,
    `Main thesis (render exactly): ${lock.thesis}`,
    ...lock.text.filter((item) => item.key.startsWith("label:")).map((item) => `Short label (render exactly): ${item.text}`),
    "Make the composition information-rich but spacious, with a clear hierarchy and subject-specific visual metaphor. Do not use gibberish text, logos, stock-photo collage or browser chrome.",
    comment ? `Revision feedback: ${comment}` : "",
  ].filter(Boolean).join("\n");
}

function artifactKey(projectId: string, candidateId: string, kind: "concept") {
  const nonce = crypto.createHash("sha1").update(`${projectId}:${candidateId}:${kind}`).digest("hex").slice(0, 12);
  return `projects/${projectId}/design-review/${candidateId}/${kind}-${nonce}.png`;
}

function metadata(objectKey: string, buffer: Buffer, generated: Awaited<ReturnType<typeof generateAitunnelImage>>): SceneArtifact {
  return { objectKey, contentType: "image/png", byteSize: buffer.length, provider: "aitunnel", model: generated.model, providerRequestId: generated.providerRequestId, costRub: generated.costRub };
}

async function toSlidePng(buffer: Buffer) {
  return sharp(buffer, { density: 144 }).resize(1280, 720, { fit: "cover", position: "centre" }).png().toBuffer();
}
