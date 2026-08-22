import sharp from "sharp";
import { currentUsageContext, recordAiUsage, recordCostEvent } from "../usage-ledger.js";
import { AITUNNEL_DEFAULT_BASE_URL } from "../openai-client.js";

export type AitunnelImageGenerationResult = {
  buffer: Buffer;
  contentType: string;
  model: string;
  endpoint: string;
  providerRequestId?: string;
  actualCostRub?: string;
};

type AitunnelImageResponse = {
  id?: unknown;
  model?: unknown;
  data?: unknown;
  usage?: unknown;
};

type AitunnelImageGenerationDependencies = {
  fetch?: typeof fetch;
  now?: () => Date;
};

/**
 * AITUNNEL's image endpoint is not part of the OpenAI-compatible SDK surface.
 * Keep this adapter intentionally small: one request, one result, no retry and
 * no fallback to another image provider.
 *
 * The selected model is configured explicitly through AITUNNEL_IMAGE_MODEL.
 * The staging release uses seedream-4.5, an image-generation model shown in
 * AITUNNEL's public image-generation documentation and catalog.
 */
export async function generateAitunnelImage(
  prompt: string,
  dependencies: AitunnelImageGenerationDependencies = {},
): Promise<AitunnelImageGenerationResult> {
  const apiKey = process.env.AITUNNEL_API_KEY?.trim();
  const model = process.env.AITUNNEL_IMAGE_MODEL?.trim();
  const baseURL = (process.env.AITUNNEL_BASE_URL?.trim() || AITUNNEL_DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (!apiKey) throw new Error("AITUNNEL_API_KEY is required for AITUNNEL image generation");
  if (!model || model.toLowerCase() === "auto") throw new Error("AITUNNEL_IMAGE_MODEL must be an explicit image model");

  const endpoint = `${baseURL}/images/generations`;
  const startedAt = dependencies.now?.() || new Date();
  const response = await (dependencies.fetch || fetch)(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, prompt: cleanText(prompt), n: 1 }),
  });

  if (!response.ok) {
    throw new Error(`AITUNNEL image generation failed: ${response.status} ${truncate(await response.text(), 500)}`);
  }

  const payload = (await response.json()) as AitunnelImageResponse;
  const first = Array.isArray(payload.data) ? asRecord(payload.data[0]) : undefined;
  const encoded = typeof first?.b64_json === "string" ? first.b64_json : "";
  if (!encoded) throw new Error("AITUNNEL image response was malformed: data[0].b64_json is missing");

  const buffer = decodeBase64Image(encoded);
  try {
    const metadata = await sharp(buffer, { failOn: "error" }).metadata();
    if (!metadata.width || !metadata.height) throw new Error("missing image dimensions");
  } catch (error) {
    throw new Error(`AITUNNEL image response was malformed: ${error instanceof Error ? error.message : "invalid image"}`);
  }

  const finishedAt = dependencies.now?.() || new Date();
  const providerRequestId = stringValue(payload.id);
  const actualCostRub = parseReportedCost(asRecord(payload.usage)?.cost_rub);
  const usage = currentUsageContext();
  await recordAiUsage({
    provider: "aitunnel",
    model,
    operation: "image_generation",
    stage: usage?.stage,
    providerRequestId,
    startedAt,
    finishedAt,
  });
  await recordCostEvent({
    idempotencyKey: `${usage?.generationJobId || usage?.queueJobId || usage?.projectId || "unknown"}:aitunnel:image:${providerRequestId || hashForKey(prompt)}`,
    category: "image_search",
    provider: "aitunnel",
    quantity: "1",
    unit: "image",
    currency: "RUB",
    measurement: "provider_reported",
    rubCostAtEvent: actualCostRub,
  });

  return {
    buffer,
    contentType: imageContentType(first?.media_type),
    model,
    endpoint,
    providerRequestId,
    actualCostRub,
  };
}

export function decodeBase64Image(value: string) {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
    throw new Error("AITUNNEL image response contained invalid base64");
  }

  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const buffer = Buffer.from(padded, "base64");
  if (!buffer.length || buffer.toString("base64").replace(/=+$/, "") !== padded.replace(/=+$/, "")) {
    throw new Error("AITUNNEL image response contained invalid base64");
  }
  return buffer;
}

function imageContentType(value: unknown) {
  const normalized = stringValue(value)?.toLowerCase();
  return normalized && ["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(normalized)
    ? normalized === "image/jpg" ? "image/jpeg" : normalized
    : "";
}

function parseReportedCost(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())) return value.trim();
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanText(value: string) {
  return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number) {
  const text = cleanText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function hashForKey(value: string) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}
